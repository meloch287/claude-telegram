#!/usr/bin/env bash
#
# Выкатка на сервер. Запускается по ssh с раннера GitHub Actions, стандартный
# ввод — сам этот файл, поэтому здесь нельзя читать stdin.
#
# Что переживает выкатку: .env, data/, workspaces/, claude-home/, proxy/.
# Все они вне git, и git reset --hard их не трогает — он работает только с тем,
# что под версией.
set -euo pipefail

APP_DIR=/opt/claude-telegram
BRANCH=main
CONTAINER=claude-telegram

cd "$APP_DIR"

# Куда возвращаться, если новая версия не поднимется. Считаем до fetch: после
# reset прошлый коммит уже не найти по имени ветки.
PREVIOUS=$(git rev-parse HEAD)
echo "▶ Сейчас на $PREVIOUS"

echo "▶ Забираю $BRANCH"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"
git --no-pager log --oneline -1

# Ждём, пока контейнер станет здоровым. Сборка сессии и проба каналов занимают
# время: healthcheck задан со start_period 60s, поэтому ждём с запасом.
wait_healthy() {
  for _ in $(seq 1 60); do
    state=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "нет контейнера")
    case "$state" in
      healthy) return 0 ;;
      unhealthy) return 1 ;;
      *) sleep 5 ;;
    esac
  done
  return 1
}

# Сборка отдельным шагом: пока она идёт, работает прежний контейнер. Так
# опечатка в Dockerfile или отвалившийся npm не оставят чат без бота.
echo "▶ Собираю образ"
docker compose build

echo "▶ Поднимаю"
docker compose up -d

echo "▶ Жду, пока контейнер станет здоровым"
if wait_healthy; then
  echo "✅ Здоров"
  exit 0
fi

echo "❌ Не поднялся. Последние строки лога:"
docker logs --tail 50 "$CONTAINER" || true

echo "▶ Откатываюсь на $PREVIOUS"
git reset --hard "$PREVIOUS"
docker compose build
docker compose up -d
if wait_healthy; then
  echo "↩️  Откатился, бот жив на прошлой версии. Выкатка провалена."
else
  echo "‼️  Откат тоже не поднялся — нужен человек."
fi
exit 1
