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

# То же исключение, что и в autodeploy.sh: выкатку зовут и по ssh с раннера, и
# из службы systemd, у которой нет HOME и глобального конфига git.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$APP_DIR"

# Куда возвращаться, если новая версия не поднимется. Считаем до fetch: после
# reset прошлый коммит уже не найти по имени ветки.
PREVIOUS=$(git rev-parse HEAD)
echo "▶ Сейчас на $PREVIOUS"

# Спасение того, что не уехало в origin.
#
# Ниже стоит git reset --hard, и однажды он молча снёс правку, сделанную прямо
# на сервере: она была закоммичена локально, но не отправлена, а выкатка по
# таймеру приехала раньше пуша. Работа исчезла без следа и без слова. Теперь
# всё, чего нет в origin, сначала уходит в ветку-слепок — reset её не трогает,
# и вернуться к ней можно одной командой.
DIRTY=$(git status --porcelain)
AHEAD=$(git log --oneline "origin/$BRANCH..HEAD" 2>/dev/null || true)
if [ -n "$DIRTY" ] || [ -n "$AHEAD" ]; then
  SNAPSHOT="rescue/$(date +%Y%m%d-%H%M%S)"
  if [ -n "$DIRTY" ]; then
    git add -A
    git -c user.name=deploy -c user.email=deploy@localhost commit -q -m "Слепок перед выкаткой"
  fi
  git branch "$SNAPSHOT" HEAD
  echo "⚠ НЕОТПРАВЛЕННОЕ сохранено в ветке $SNAPSHOT — вернуть: git reset --hard $SNAPSHOT"
fi

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
