#!/usr/bin/env bash
#
# Починка каналов выхода, когда VPN-подписка протухла.
#
# Зачем: провайдер время от времени переставляет серверы — германский узел
# переезжает на новый адрес, gslb-домен ротируется. Конфиг xray статичен,
# поэтому в один день все каналы разом умирают, и бот пишет «Живого канала до
# Anthropic не осталось», пока кто-нибудь не пересоберёт proxy/xray.json
# руками. Скрипт делает это сам.
#
# Чинит по факту поломки, а не по расписанию: подписка отдаёт адреса с
# балансировкой и почти на каждый запрос присылает чуть другой набор, так что
# «конфиг отличается от подписки» — не признак беды. Признак беды один: ни
# один канал не доходит до Anthropic. Пока хоть один жив, ничего не трогаем —
# перезапуск прокси рвёт живые соединения агента.
#
# Ссылка на подписку лежит вне репозитория, рядом со списком авторов выкатки:
# это ключ от VPN. В .env ему тоже не место — .env целиком уезжает в контейнер
# к агенту, а тому знать ключ незачем.
#
# Коды возврата: 0 — порядок (каналы живы либо починены), 1 — не повезло
# сейчас (подписка не ответила), 2 — нужен человек: конфиг не применился либо
# новая подписка тоже не работает и пришлось откатиться. Таймер считает
# единицу нормой, двойку — поломкой.
set -uo pipefail

APP_DIR=${APP_DIR:-/opt/claude-telegram}
SUB_FILE=${SUB_FILE:-/etc/claude-telegram/subscription.url}
BACKUP_DIR=${BACKUP_DIR:-/root/claude-telegram-backups}
STATE_FILE=${STATE_FILE:-/var/lib/claude-telegram/refresh-proxy.state}
# Страна в том виде, в каком её пишет провайдер в названиях серверов.
COUNTRY=${COUNTRY:-Germany}
# Больше десяти копий конфига никто не откатывает, а ключи в них живые.
KEEP_BACKUPS=${KEEP_BACKUPS:-10}
NETWORK=${NETWORK:-claude-telegram}
CONTAINER=${CONTAINER:-claude-telegram}

# Отправка владельцу общая со сторожем и автовыкаткой.
# shellcheck source=scripts/notify-owner.sh
source "$APP_DIR/scripts/notify-owner.sh"

cd "$APP_DIR" || exit 1
mkdir -p "$(dirname "$STATE_FILE")"

# Пробуем через тот же образ, что и бот: curl в нём уже есть, тянуть чужой
# образ ради одной команды незачем. Имя берём у живого контейнера, чтобы не
# гадать, как compose назвал сборку.
PROBE_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null)
[ -z "$PROBE_IMAGE" ] && PROBE_IMAGE=claude-telegram-bot

# Живой канал — тот, что доносит запрос до Anthropic. 401 значит «дошли, но
# без ключа», ровно как в пробе самого бота (src/proxy.ts).
probe_port() {
  docker run --rm --network "$NETWORK" "$PROBE_IMAGE" \
    curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -x "http://claude-proxy:$1" https://api.anthropic.com/v1/models 2>/dev/null
}

count_alive() {
  local port alive=0
  for port in $1; do
    [ "$(probe_port "$port")" = "401" ] && alive=$((alive + 1))
  done
  echo "$alive"
}

ports_of() {
  # Порты берём из самого конфига, а не из счёта серверов: так их число и
  # порядок всегда совпадают с тем, что слушает xray.
  python3 -c 'import json,sys; print(" ".join(str(i["port"]) for i in json.load(open(sys.argv[1]))["inbounds"]))' "$1"
}

# Тревожим один раз за поломку, а не на каждый запуск таймера: иначе при
# долгой аварии у провайдера чат превратится в ленту одинаковых сообщений.
remember() { echo "$1" > "$STATE_FILE"; }
last_state() { [ -f "$STATE_FILE" ] && cat "$STATE_FILE" || echo ok; }

config=$APP_DIR/proxy/xray.json

# ── Страны ──────────────────────────────────────────────────────────────────
#
# Германия основная: серверов в подписке пять, и латентность до Anthropic там
# лучшая. Польша запасная — сервер всего один, поэтому уходим туда только когда
# от Германии не осталось ничего.
#
# Правило простое. Легла вся Германия — переключаемся на Польшу немедленно,
# бот не должен лежать. Дальше каждые полчаса пробуем Германию снова. Ожила за
# сутки — возвращаемся. Не ожила — Польша становится основной, и метания
# прекращаются: провайдер явно увёл немецкие адреса надолго, и дёргать канал
# каждые полчаса значит рвать живые соединения агента без всякой пользы.
FALLBACK_COUNTRY=${FALLBACK_COUNTRY:-Poland}
GRACE_SEC=${GRACE_SEC:-86400}
PRIMARY_FILE=${PRIMARY_FILE:-/var/lib/claude-telegram/proxy-primary}
RUNNING_FILE=${RUNNING_FILE:-/var/lib/claude-telegram/proxy-running}
DOWN_FILE=${DOWN_FILE:-/var/lib/claude-telegram/proxy-primary-down-since}

read_state() { [ -f "$1" ] && cat "$1" || echo "$2"; }
PRIMARY=$(read_state "$PRIMARY_FILE" "$COUNTRY")
RUNNING=$(read_state "$RUNNING_FILE" "$PRIMARY")

if [ ! -f "$SUB_FILE" ]; then
  echo "нет ссылки на подписку в $SUB_FILE — чинить нечем"
  exit 2
fi
SUBSCRIPTION_URL=$(grep -vE '^[[:space:]]*(#|$)' "$SUB_FILE" | head -1 | tr -d '[:space:]')
export SUBSCRIPTION_URL
if [ -z "$SUBSCRIPTION_URL" ]; then
  echo "файл $SUB_FILE пуст"
  exit 2
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
mkdir -p "$BACKUP_DIR"

apply_config() {
  cp "$1" "$config" || return 1
  chmod 400 "$config"
  chown 65532:65532 "$config"
  docker compose restart proxy > /dev/null 2>&1 || return 1
  sleep 8
}

# Пул в .env — единственное место, откуда бот узнаёт о портах. Если их число
# изменилось, старый пул либо не увидит новых каналов, либо будет ходить в те,
# которых уже нет.
sync_pool() {
  local report=$1
  local pool current
  pool=$(grep -oE '^PROXY_POOL=.*' "$report" | head -1)
  current=$(grep -E '^PROXY_POOL=' "$APP_DIR/.env" | head -1)
  if [ -n "$pool" ] && [ "$pool" != "$current" ]; then
    cp -a "$APP_DIR/.env" "$BACKUP_DIR/.env.bak-$(date +%F-%H%M%S)"
    # Пишем через awk, а не sed: в адресах есть слэши, и любой разделитель sed
    # рано или поздно встретится внутри значения.
    awk -v line="$pool" '/^PROXY_POOL=/ {print line; next} {print}' "$APP_DIR/.env" > "$TMP_DIR/env" \
      && cat "$TMP_DIR/env" > "$APP_DIR/.env"
    echo "пул портов изменился, пересоздаю бота"
    # Именно up -d: restart не перечитывает env_file, и бот остался бы со
    # старым пулом до следующей выкатки.
    docker compose up -d bot > /dev/null 2>&1
  else
    # Пул прежний, но бот сейчас сидит без канала и сам перепроверится только
    # через десять минут. Рвать нечего — поэтому будим сразу.
    docker compose restart bot > /dev/null 2>&1
  fi
}

# Собирает конфиг для страны и применяет, если хоть один канал ожил.
# Возвращает 0 и оставляет страну работающей; 1 — конфиг откатан.
try_country() {
  local country=$1
  local dir=$TMP_DIR/$country
  local report=$TMP_DIR/report-$country
  mkdir -p "$dir"

  if ! OUT_DIR="$dir" python3 "$APP_DIR/scripts/make-proxy-config.py" "$country" > "$report" 2>&1; then
    echo "подписка не разобралась для страны $country:"
    cat "$report"
    return 1
  fi
  cat "$report"

  local backup
  backup=$BACKUP_DIR/xray.json.bak-$(date +%F-%H%M%S)
  cp -a "$config" "$backup" || return 1
  chmod 600 "$backup"

  if ! apply_config "$dir/xray.json"; then
    echo "не удалось применить конфиг страны $country"
    apply_config "$backup"
    return 1
  fi

  local ports alive
  ports=$(ports_of "$config")
  alive=$(count_alive "$ports")
  if [ "$alive" -eq 0 ]; then
    echo "страна $country не отвечает — откатываюсь"
    apply_config "$backup"
    return 1
  fi

  sync_pool "$report"
  echo "$country" > "$RUNNING_FILE"
  echo "страна $country: живых каналов $alive из $(echo "$ports" | wc -w)"
  return 0
}

old_ports=$(ports_of "$config")
alive_before=$(count_alive "$old_ports")

if [ "$alive_before" -gt 0 ]; then
  echo "каналов живо: $alive_before из $(echo "$old_ports" | wc -w)"

  # Работаем на основной стране — всё в порядке, подписку не трогаем.
  if [ "$RUNNING" = "$PRIMARY" ]; then
    rm -f "$DOWN_FILE"
    [ "$(last_state)" != "ok" ] && notify "✅ Каналы VPN снова живы: $alive_before из $(echo "$old_ports" | wc -w)."
    remember ok
    exit 0
  fi

  # Сидим на запасной. Раз в полчаса проверяем, не ожила ли основная.
  echo "сейчас на запасной стране $RUNNING, пробую вернуться на $PRIMARY"
  if try_country "$PRIMARY"; then
    rm -f "$DOWN_FILE"
    notify "🇩🇪 $PRIMARY снова отвечает — вернул основной канал."
    remember ok
    exit 0
  fi

  # Не ожила. Если ждём дольше суток, перестаём дёргать канал каждые полчаса.
  down_since=$(read_state "$DOWN_FILE" "$(date +%s)")
  echo "$down_since" > "$DOWN_FILE"
  waited=$(( $(date +%s) - down_since ))
  if [ "$waited" -ge "$GRACE_SEC" ]; then
    echo "$RUNNING" > "$PRIMARY_FILE"
    rm -f "$DOWN_FILE"
    notify "🇵🇱 $PRIMARY не поднялась за сутки. Делаю $RUNNING основной страной — переключения прекращаю."
  else
    echo "жду $PRIMARY ещё $(( (GRACE_SEC - waited) / 3600 )) ч"
  fi
  remember ok
  exit 0
fi

echo "живых каналов не осталось, пересобираю конфиг из подписки"

# Сперва основная страна: адреса у провайдера ротируются, и чаще всего
# достаточно взять свежие из подписки.
if try_country "$PRIMARY"; then
  rm -f "$DOWN_FILE"
  notify "🌍 Каналы VPN легли, пересобрал их из подписки ($PRIMARY)."
  remember ok
  exit 0
fi

# Основная не поднялась. Отмечаем начало аварии и немедленно уходим на
# запасную: сутки без бота - недопустимо, ждать будем уже на живом канале.
[ -f "$DOWN_FILE" ] || date +%s > "$DOWN_FILE"

if [ "$PRIMARY" != "$FALLBACK_COUNTRY" ] && try_country "$FALLBACK_COUNTRY"; then
  notify "🇵🇱 $PRIMARY легла целиком, ушёл на $FALLBACK_COUNTRY. Буду пробовать вернуться каждые полчаса; если за сутки не выйдет, $FALLBACK_COUNTRY станет основной."
  remember ok
  exit 0
fi

if [ "$(last_state)" != "broken" ]; then
  notify "‼️ Не отвечает ни $PRIMARY, ни $FALLBACK_COUNTRY. Похоже, дело в подписке или в сети сервера — нужен человек."
fi
remember broken
exit 2
