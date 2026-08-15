#!/usr/bin/env bash
#
# Сторож бота. Живёт на хосте, а не в контейнере: упавший контейнер о себе
# сообщить не может, а docker-сокет внутрь пробрасывать незачем — это root
# на машине, где стоят и чужие проекты.
#
# Что делает: по таймеру systemd смотрит health контейнера. Если тот нездоров
# несколько проверок подряд — пишет владельцу в Telegram и перезапускает.
# Когда бот вернётся, присылает об этом одну строку.
#
# Сообщение шлётся напрямую в Bot API, мимо самого бота: если бот лежит,
# отправлять через него нечего.
set -uo pipefail

APP_DIR=${APP_DIR:-/opt/claude-telegram}
CONTAINER=${CONTAINER:-claude-telegram}
STATE_FILE=${STATE_FILE:-/var/lib/claude-telegram/watchdog.state}
# Сколько проверок подряд должно провалиться до тревоги. Одна осечка бывает
# на пересборке и на старте, поднимать по ней панику незачем.
THRESHOLD=${THRESHOLD:-3}
RESTART=${RESTART:-1}

mkdir -p "$(dirname "$STATE_FILE")"

# .env читаем сами: source затянул бы в окружение всё, включая ключи, и любая
# опечатка в значении стала бы командой шелла.
read_env() {
  sed -n "s/^$1=//p" "$APP_DIR/.env" | head -1 | tr -d '"' | tr -d "'" | tr -d '\r'
}

BOT_TOKEN=$(read_env BOT_TOKEN)
OWNER=$(read_env ALLOWED_USER_IDS | cut -d, -f1 | tr -d ' ')

notify() {
  if [ -z "$BOT_TOKEN" ] || [ -z "$OWNER" ]; then
    echo "некому писать: в .env нет BOT_TOKEN или ALLOWED_USER_IDS" >&2
    return
  fi
  curl -sS --max-time 15 -o /dev/null \
    -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${OWNER}" \
    --data-urlencode "text=$1" \
    || echo "не удалось отправить сообщение" >&2
}

health=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "нет контейнера")

state=ok
fails=0
if [ -f "$STATE_FILE" ]; then
  # Формат простой: «состояние число». Портится — начинаем с чистого листа.
  read -r state fails < "$STATE_FILE" 2>/dev/null || { state=ok; fails=0; }
  [[ "$fails" =~ ^[0-9]+$ ]] || fails=0
fi

if [ "$health" = "healthy" ]; then
  if [ "$state" = "down" ]; then
    notify "✅ Бот снова отвечает. Сторож видит контейнер здоровым."
  fi
  echo "ok 0" > "$STATE_FILE"
  exit 0
fi

fails=$((fails + 1))
echo "проверка провалена ($fails из $THRESHOLD): состояние «$health»"

if [ "$fails" -lt "$THRESHOLD" ]; then
  echo "$state $fails" > "$STATE_FILE"
  exit 0
fi

# Порог взят. Тревожим один раз за падение, иначе сторож завалит чат.
if [ "$state" != "down" ]; then
  notify "⚠️ Бот не отвечает: состояние контейнера «${health}». Перезапускаю."
fi
echo "down $fails" > "$STATE_FILE"

if [ "$RESTART" != "1" ]; then
  echo "перезапуск отключён (RESTART=$RESTART)"
  exit 1
fi

cd "$APP_DIR" || exit 1
if docker compose up -d --force-recreate bot; then
  echo "перезапуск выполнен"
else
  notify "‼️ Перезапустить бота не удалось. Нужен человек: ssh на сервер, docker compose logs."
fi
exit 1
