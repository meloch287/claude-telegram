#!/usr/bin/env bash
#
# Сторож каналов выхода: проверяет прокси и пересобирает их из VPN-подписок.
#
# Защита в несколько эшелонов (с 25.09.2026):
#   1. xray: балансировщик основной подписки сам исключает упавшие серверы;
#   2. xray: если мертвы все основные, главный вход 10800 сам уводит трафик на
#      резервную подписку (выход loopback → резервный балансировщик 10830);
#   3. бот: проверяет свой канал раз в минуту, падение засчитывает после трёх
#      неудачных проб подряд и перебирает пул до трёх раз (src/proxy.ts);
#   4. этот скрипт: раз в 10 минут пробует все порты, мёртвые — до трёх раз, и
#      пересобирает конфиг из обеих подписок (каждую качает с трёх попыток,
#      при недоступности берёт кэш).
#
# Решения:
#   • главный вход жив и живых основных серверов не меньше MIN_ALIVE — порядок;
#   • вход жив, но основных мало (или работаем уже на резерве) — пересобираем
#     заранее, не чаще раза в COOLDOWN, и раз в сутки предупреждаем владельца;
#   • вход мёртв — пересобираем сразу.
# Новый конфиг сперва проверяет сам xray; если с ним стало хуже — откат. Пул
# портов у бота постоянный, поэтому бот при пересборке не перезапускается.
#
# Коды возврата: 0 — порядок; 1 — временная неудача (подписки не ответили);
# 2 — нужен человек. Таймер считает единицу нормой.
set -uo pipefail

APP_DIR=${APP_DIR:-/opt/claude-telegram}
SUB_FILE=${SUB_FILE:-/etc/claude-telegram/subscription.url}
BACKUP_SUB_FILE=${BACKUP_SUB_FILE:-/etc/claude-telegram/subscription-backup.url}
BACKUP_DIR=${BACKUP_DIR:-/root/claude-telegram-backups}
STATE_DIR=${STATE_DIR:-/var/lib/claude-telegram}
NETWORK=${NETWORK:-claude-telegram}
CONTAINER=${CONTAINER:-claude-telegram}
PROXY_HOST=${PROXY_HOST:-claude-proxy}
XRAY_IMAGE=${XRAY_IMAGE:-ghcr.io/xtls/xray-core:latest}
MIN_ALIVE=${MIN_ALIVE:-4}
COOLDOWN=${COOLDOWN:-7200}
KEEP_BACKUPS=${KEEP_BACKUPS:-10}
ATTEMPTS=${ATTEMPTS:-3}
ENTRY_PORT=10800
BACKUP_PORT=10830

# shellcheck source=scripts/notify-owner.sh
source "$APP_DIR/scripts/notify-owner.sh"

cd "$APP_DIR" || exit 1
mkdir -p "$STATE_DIR" "$BACKUP_DIR"
config=$APP_DIR/proxy/xray.json
state_file=$STATE_DIR/refresh-proxy.state
rebuilt_file=$STATE_DIR/proxy-rebuilt-at
warned_file=$STATE_DIR/proxy-low-warned-at

now=$(date +%s)
read_num() { [ -f "$1" ] && cat "$1" || echo 0; }
last_state() { [ -f "$state_file" ] && cat "$state_file" || echo ok; }
remember() { echo "$1" > "$state_file"; }
first_line() { [ -f "$1" ] && grep -vE '^[[:space:]]*(#|$)' "$1" | head -1 | tr -d '[:space:]'; }

PROBE_IMAGE=$(docker inspect --format '{{.Config.Image}}' "$CONTAINER" 2>/dev/null)
[ -z "$PROBE_IMAGE" ] && PROBE_IMAGE=claude-telegram-bot

# «порт тег» по входам конфига: по тегу видно, чья это подписка (s-p… / s-b…).
ports_of() {
  python3 -c 'import json,sys
for i in json.load(open(sys.argv[1]))["inbounds"]:
    print(i["port"], i["tag"])' "$1"
}

# Все пробы одним контейнером; порт, не ответивший 401, пробуем ещё до
# ATTEMPTS раз с паузой — единичный сбой не повод считать сервер мёртвым.
# Печатает «порт код».
probe_all() {
  docker run --rm --network "$NETWORK" "$PROBE_IMAGE" sh -c '
    for p in '"$1"'; do
      c=000
      for try in $(seq 1 '"$ATTEMPTS"'); do
        c=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 -x "http://'"$PROXY_HOST"':$p" https://api.anthropic.com/v1/models)
        [ "$c" = 401 ] && break
        [ "$try" -lt '"$ATTEMPTS"' ] && sleep 3
      done
      echo "$p $c"
    done' 2>/dev/null
}

# $1 — «порт тег», $2 — вывод probe_all. Заполняет entry, backup_in,
# p_alive/p_total (основная), b_alive/b_total (резервная).
summarize() {
  local joined
  joined=$(join <(echo "$1" | sort) <(echo "$2" | sort))
  entry=$(echo "$joined" | awk -v e="$ENTRY_PORT" '$1 == e {print $3}')
  backup_in=$(echo "$joined" | awk -v b="$BACKUP_PORT" '$1 == b {print $3}')
  p_total=$(echo "$joined" | awk '$2 ~ /^s-p/' | wc -l)
  p_alive=$(echo "$joined" | awk '$2 ~ /^s-p/ && $3 == "401"' | wc -l)
  b_total=$(echo "$joined" | awk '$2 ~ /^s-b/' | wc -l)
  b_alive=$(echo "$joined" | awk '$2 ~ /^s-b/ && $3 == "401"' | wc -l)
  entry=${entry:-none}
  backup_in=${backup_in:-none}
}

describe() {
  echo "вход ${entry}, резерв ${backup_in}; основная $p_alive из $p_total, резервная $b_alive из $b_total"
}

apply_config() {
  cp "$1" "$config" || return 1
  chmod 400 "$config"
  chown 65532:65532 "$config"
  docker compose restart proxy > /dev/null 2>&1 || return 1
  # Балансировщику нужна минута на замеры; отдельные порты отвечают сразу.
  sleep 70
}

# Пул в .env — единственное место, откуда бот знает порты. С постоянной
# раскладкой он меняется только при смене схемы; тогда же снимается
# требование страны: выход выбирает балансировщик, годность проверяет проба.
sync_env() {
  local report=$1 pool current country
  pool=$(grep -oE '^PROXY_POOL=.*' "$report" | head -1)
  current=$(grep -E '^PROXY_POOL=' .env | head -1)
  country=$(grep -E '^PROXY_REQUIRE_COUNTRY=.+' .env | head -1)
  if { [ -n "$pool" ] && [ "$pool" != "$current" ]; } || [ -n "$country" ]; then
    cp -a .env "$BACKUP_DIR/.env.bak-$(date +%F-%H%M%S)"
    awk -v line="$pool" '
      /^PROXY_POOL=/ { print line; next }
      /^PROXY_REQUIRE_COUNTRY=/ { print "PROXY_REQUIRE_COUNTRY="; next }
      { print }' .env > "$TMP_DIR/env" && cat "$TMP_DIR/env" > .env
    echo "пул портов обновлён, пересоздаю бота"
    # up -d, а не restart: только так бот перечитает env_file.
    docker compose up -d bot > /dev/null 2>&1
  fi
}

prune_backups() {
  find "$BACKUP_DIR" -maxdepth 1 -name "xray.json.bak-*" -printf "%T@ %p\\n" | sort -rn |
    tail -n +"$((KEEP_BACKUPS + 1))" | cut -d" " -f2- | xargs -r rm -f
}

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

layout=$(ports_of "$config")
before=$(probe_all "$(echo "$layout" | cut -d" " -f1 | tr '\n' ' ')")
summarize "$layout" "$before"
old_entry=$entry
old_p_alive=$p_alive
old_alive=$((p_alive + b_alive))
echo "сейчас: $(describe)"

layout_old=true
echo "$layout" | grep -q "^$BACKUP_PORT " && layout_old=false

if ! $layout_old && [ "$entry" = "401" ] && [ "$p_alive" -ge "$MIN_ALIVE" ]; then
  [ "$(last_state)" != "ok" ] && notify "✅ Каналы VPN в порядке: основная подписка $p_alive из $p_total, резервная $b_alive из $b_total."
  rm -f "$warned_file"
  remember ok
  exit 0
fi

since=$((now - $(read_num "$rebuilt_file")))
if ! $layout_old && [ "$entry" = "401" ] && [ "$since" -lt "$COOLDOWN" ]; then
  echo "основных серверов мало ($p_alive), но пересборка была $((since / 60)) мин назад — жду"
  if [ $((now - $(read_num "$warned_file"))) -gt 86400 ]; then
    if [ "$p_alive" -eq 0 ]; then
      notify "⚠️ Основная VPN-подписка не отвечает — бот работает через резервную ($b_alive из $b_total живы). Похоже, основную пора продлить или сменить."
    else
      notify "⚠️ В основной VPN-подписке мало живых серверов: $p_alive из $p_total. Бот работает, резерв наготове ($b_alive из $b_total)."
    fi
    echo "$now" > "$warned_file"
  fi
  remember ok
  exit 0
fi

SUBSCRIPTION_URL=$(first_line "$SUB_FILE")
BACKUP_SUBSCRIPTION_URL=$(first_line "$BACKUP_SUB_FILE")
export SUBSCRIPTION_URL BACKUP_SUBSCRIPTION_URL
if [ -z "$SUBSCRIPTION_URL" ] && [ -z "$BACKUP_SUBSCRIPTION_URL" ]; then
  echo "нет ни основной ($SUB_FILE), ни резервной ($BACKUP_SUB_FILE) подписки"
  exit 2
fi

echo "пересобираю каналы из подписок"
if ! OUT_DIR="$TMP_DIR/new" STATE_DIR="$STATE_DIR" \
  python3 "$APP_DIR/scripts/make-proxy-config.py" > "$TMP_DIR/report" 2>&1; then
  cat "$TMP_DIR/report"
  if [ "$old_entry" != "401" ] && [ "$old_alive" -eq 0 ] && [ "$(last_state)" != "broken" ]; then
    notify "‼️ Все каналы VPN мертвы, а подписки не разбираются: $(tail -1 "$TMP_DIR/report" | head -c 300)"
    remember broken
  fi
  exit 1
fi
cat "$TMP_DIR/report"

# Битый конфиг уронил бы прокси целиком — сперва его проверяет сам xray.
chmod 444 "$TMP_DIR/new/xray.json"
if ! docker run --rm -v "$TMP_DIR/new/xray.json:/c.json:ro" "$XRAY_IMAGE" run -test -c /c.json > "$TMP_DIR/test" 2>&1; then
  echo "xray не принял новый конфиг:"
  tail -5 "$TMP_DIR/test"
  notify "‼️ Новый конфиг VPN не прошёл проверку xray — оставил старый. $(tail -1 "$TMP_DIR/test" | head -c 200)"
  exit 2
fi

backup=$BACKUP_DIR/xray.json.bak-$(date +%F-%H%M%S)
cp -a "$config" "$backup" && chmod 600 "$backup"

if ! apply_config "$TMP_DIR/new/xray.json"; then
  echo "не удалось применить — откатываюсь"
  apply_config "$backup"
  exit 2
fi
echo "$now" > "$rebuilt_file"

layout=$(ports_of "$config")
after=$(probe_all "$(echo "$layout" | cut -d" " -f1 | tr '\n' ' ')")
summarize "$layout" "$after"
echo "после пересборки: $(describe)"

# Хуже, чем было, — откат: вход молчит, а до пересборки что-то работало.
if [ "$entry" != "401" ] && [ "$((p_alive + b_alive))" -le "$old_alive" ] && [ "$old_alive" -gt 0 ]; then
  echo "с новым конфигом не лучше — откатываюсь"
  apply_config "$backup"
  notify "⚠️ Пересобрал VPN из подписок, но стало не лучше — вернул прежний конфиг."
  exit 2
fi

sync_env "$TMP_DIR/report"
prune_backups

if [ "$entry" = "401" ]; then
  if $layout_old || [ "$old_entry" != "401" ] || [ "$p_alive" -lt "$old_p_alive" ] || [ "$(last_state)" != "ok" ]; then
    notify "🔁 Каналы VPN пересобраны: основная $p_alive из $p_total, резервная $b_alive из $b_total."
  fi
  remember ok
  exit 0
fi

[ "$(last_state)" != "broken" ] && notify "‼️ После пересборки главный вход VPN не отвечает (основная $p_alive, резервная $b_alive). Похоже, кончились обе подписки — нужна новая ссылка."
remember broken
exit 2
