#!/usr/bin/env bash
#
# Сообщение владельцу напрямую через Bot API, мимо самого бота: и сторож, и
# автовыкатка должны уметь писать, когда бот лежит или пересобирается.
#
# Файл подключается через source, своей логики не выполняет.

APP_DIR=${APP_DIR:-/opt/claude-telegram}

# .env читаем сами: source затянул бы в окружение всё, включая ключи, и любая
# опечатка в значении стала бы командой шелла.
read_env() {
  sed -n "s/^$1=//p" "$APP_DIR/.env" | head -1 | tr -d '"' | tr -d "'" | tr -d '\r'
}

notify() {
  local token owner
  token=$(read_env BOT_TOKEN)
  owner=$(read_env ALLOWED_USER_IDS | cut -d, -f1 | tr -d ' ')
  if [ -z "$token" ] || [ -z "$owner" ]; then
    echo "некому писать: в .env нет BOT_TOKEN или ALLOWED_USER_IDS" >&2
    return
  fi
  # Три попытки: напрямую, через главный вход прокси (балансировщик, 10800)
  # и через отдельный порт. Telegram из России отвечает через раз, а тревога,
  # которая не дошла, — то же самое, что её нет. Порты проброшены на петлю
  # хоста в docker-compose.yml; раньше здесь стоял 10809, который наружу не
  # проброшен вовсе, и запасной путь не срабатывал никогда.
  local args=(-sS --max-time 15 -o /dev/null
    -X POST "https://api.telegram.org/${token:+bot}${token}/sendMessage"
    --data-urlencode "chat_id=${owner}"
    --data-urlencode "text=$1")

  local via
  for via in "" "${NOTIFY_PROXY:-http://127.0.0.1:10800}" "http://127.0.0.1:10801"; do
    if [ -z "$via" ]; then
      curl "${args[@]}" 2>/dev/null && return
    else
      curl -x "$via" "${args[@]}" 2>/dev/null && return
    fi
    echo "не ушло ${via:-напрямую}, пробую дальше" >&2
    sleep 2
  done
  echo "не удалось отправить сообщение ни одним путём" >&2
}
