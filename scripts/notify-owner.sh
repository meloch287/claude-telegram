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
  # Сперва напрямую. Telegram из России отвечает через раз, и тревога, которая
  # не дошла, - это то же самое, что её нет. Поэтому при неудаче повторяем через
  # локальный прокси: он для того и поднят.
  local args=(-sS --max-time 15 -o /dev/null
    -X POST "https://api.telegram.org/${token:+bot}${token}/sendMessage"
    --data-urlencode "chat_id=${owner}"
    --data-urlencode "text=$1")

  curl "${args[@]}" && return
  echo "напрямую не ушло, пробую через прокси" >&2
  curl -x "${NOTIFY_PROXY:-http://127.0.0.1:10809}" "${args[@]}" \
    || echo "не удалось отправить сообщение" >&2
}
