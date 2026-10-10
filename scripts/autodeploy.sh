#!/usr/bin/env bash
#
# Автовыкатка на сервере: замечает новый коммит в main, прогоняет те же
# проверки, что и CI, и выкатывает только зелёное.
#
# Зачем на сервере, а не в GitHub Actions: у токена бота нет права workflow,
# поэтому положить файл в .github/workflows он не может — GitHub отклоняет
# такой путь для OAuth-приложений, и через ssh-ключ развёртывания тоже
# (ключ наследует ограничение приложения, которым создан). Когда право
# появится, этот таймер можно выключить:
#
#   systemctl disable --now claude-telegram-autodeploy.timer
#
# Проверки идут в одноразовом контейнере node:24-slim — той же версии, что и
# рабочий образ: node:sqlite и его поведение зависят от версии.
set -uo pipefail

APP_DIR=${APP_DIR:-/opt/claude-telegram}
BRANCH=${BRANCH:-main}
STATE_FILE=${STATE_FILE:-/var/lib/claude-telegram/autodeploy.state}
WORK_DIR=${WORK_DIR:-/tmp/claude-telegram-checks}
NODE_IMAGE=${NODE_IMAGE:-node:24-slim}
# Вне репозитория: см. комментарий у check_authors.
AUTHORS_FILE=${AUTHORS_FILE:-/etc/claude-telegram/deploy-authors}

# shellcheck source=scripts/notify-owner.sh
source "$APP_DIR/scripts/notify-owner.sh"

mkdir -p "$(dirname "$STATE_FILE")"
cd "$APP_DIR" || exit 1

# Файлы в /opt принадлежат чужому uid — их залили с макбука. Под systemd у
# службы нет HOME, поэтому глобальный ~/.gitconfig не читается и git отказывает
# с «dubious ownership». Объявляем каталог доверенным на время своих вызовов.
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$APP_DIR"

git fetch --prune -q origin "$BRANCH" || { echo "fetch не прошёл"; exit 1; }

current=$(git rev-parse HEAD)
target=$(git rev-parse "origin/$BRANCH")
[ "$current" = "$target" ] && exit 0

# Один и тот же коммит не проверяем по кругу: упал — значит упал, пока не
# запушат следующий. Иначе таймер молотил бы сборку каждые три минуты.
[ -f "$STATE_FILE" ] && [ "$(cat "$STATE_FILE")" = "$target" ] && exit 0
echo "$target" > "$STATE_FILE"

# ── Кто имеет право выкатываться ────────────────────────────────────────────
#
# Список лежит ВНЕ репозитория намеренно: держи его внутри — и тот, кто получил
# доступ к main, первым делом допишет себя. Файла нет — не выкатываем вовсе:
# лучше остановиться, чем пропустить что попало.
#
# Проверяется каждый коммит от текущего HEAD до цели, а не только верхний:
# иначе чужое можно было бы спрятать под своим последним коммитом.
check_authors() {
  if [ ! -f "$AUTHORS_FILE" ]; then
    echo "нет списка авторов $AUTHORS_FILE — выкатка остановлена"
    notify "🛑 Выкатка ${short} остановлена: на сервере нет списка авторов ${AUTHORS_FILE}.

Пока файла нет, автовыкатка не работает — это защита, а не сбой."
    return 1
  fi

  local allowed strangers author
  # Пустые строки и комментарии выкидываем, регистр не важен: почта к нему
  # нечувствительна.
  allowed=$(grep -vE '^[[:space:]]*(#|$)' "$AUTHORS_FILE" | tr -d '[:blank:]' | tr '[:upper:]' '[:lower:]' | sort -u)
  strangers=""

  while IFS= read -r author; do
    [ -z "$author" ] && continue
    if ! printf '%s\n' "$allowed" | grep -qxF "$(printf '%s' "$author" | tr '[:upper:]' '[:lower:]')"; then
      strangers=$(printf '%s\n%s' "$strangers" "$author")
    fi
  done < <(git log --format='%ae' "$current..$target")

  # Остаётся ведущий перевод строки от накопления — он же служит признаком,
  # что список пуст: пустая строка и есть «все свои».
  strangers=$(printf '%s' "$strangers" | grep -v '^$' || true)

  if [ -n "$strangers" ]; then
    echo "среди новых коммитов есть авторы не из списка:"
    printf '%s\n' "$strangers"
    notify "🛑 Выкатка остановлена: среди новых коммитов есть автор не из списка.

Цель: ${short} — ${subject}

Авторы не из списка:
${strangers}

Если это свой человек, добавь почту в ${AUTHORS_FILE} на сервере."
    return 1
  fi
  return 0
}

subject=$(git log --format=%s -1 "$target")
short=$(git rev-parse --short "$target")
echo "новый коммит $short: $subject"

# Проверка авторов идёт до сборки: чужой код не должен даже запускаться в
# контейнере — npm ci выполняет скрипты пакетов из package.json цели.
check_authors || exit 1

# Проверяем ровно то дерево, которое поедет, а не рабочую папку сервера.
rm -rf "$WORK_DIR"
git worktree prune
git worktree add -q --detach "$WORK_DIR" "$target" || { echo "worktree не создан"; exit 1; }

log=$(mktemp)
code=0
# Две попытки: npm ci ходит в сеть, и обрыв там означает «не повезло», а не
# «код плохой». Без повтора один такой обрыв вешал коммит до следующего пуша —
# на этом уже дважды спотыкались.
for attempt in 1 2; do
  docker run --rm \
    -v "$WORK_DIR:/проверка" -w /проверка \
    -e NODE_ENV=development \
    "$NODE_IMAGE" \
    bash -lc "npm ci --include=optional && npm run format:check && npm run lint && npm run lint:sh && npm run typecheck && npm test" \
    > "$log" 2>&1
  code=$?
  [ "$code" -eq 0 ] && break
  # Повторяем только сетевое: провал самих проверок со второго раза не пройдёт,
  # а время и токены на него тратить незачем.
  if grep -qiE "npm error network|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up" "$log"; then
    echo "попытка $attempt: сеть подвела, пробую ещё раз"
    sleep 15
    continue
  fi
  break
done

git worktree remove --force "$WORK_DIR" 2>/dev/null

if [ "$code" -ne 0 ]; then
  echo "проверки провалены (код $code)"
  notify "🔴 Проверки не прошли на ${short}: ${subject}

Не выкатываю. Последние строки:
$(tail -n 20 "$log" | head -c 1500 | iconv -f UTF-8 -t UTF-8 -c)"
  rm -f "$log"
  exit 1
fi

echo "проверки зелёные, выкатываю"
rm -f "$log"

deploy_log=$(mktemp)
bash "$APP_DIR/scripts/deploy.sh" > "$deploy_log" 2>&1
deploy_code=$?

if [ "$deploy_code" -eq 0 ]; then
  notify "🟢 Выкачено ${short}: ${subject}

Проверки зелёные, контейнер здоров."
else
  notify "‼️ Проверки прошли, но выкатка ${short} провалилась.

$(tail -n 20 "$deploy_log" | head -c 1500 | iconv -f UTF-8 -t UTF-8 -c)"
fi
rm -f "$deploy_log"
exit "$deploy_code"
