# node:24 — ради встроенного node:sqlite без экспериментального флага.
FROM node:24-slim


# git нужен самому Claude Code, ripgrep — его поиску по проекту,
# ca-certificates — для HTTPS через прокси, curl — для установки gh.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl gnupg \
 && rm -rf /var/lib/apt/lists/*

# gh — чтобы агент мог смотреть репозитории, issues и pull requests, а не
# только клонировать по прямой ссылке.
# Проверено: cli.github.com с этого сервера открывается напрямую, в отличие
# от api.anthropic.com и самого github.com. Прокси здесь не нужен, а попытка
# ходить через него в сборке только ломала её — buildkit не видит хост.
RUN set -eux; \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg; \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends gh; \
    rm -rf /var/lib/apt/lists/*

# Работаем не от root: Claude Code отказывается запускаться без запроса
# разрешений под root — «--dangerously-skip-permissions cannot be used with
# root/sudo privileges for security reasons». Под обычным пользователем режим
# «без вопросов» доступен, и заодно агент не хозяйничает в контейнере от root.
RUN useradd --create-home --uid 10001 claude

WORKDIR /app
RUN chown claude:claude /app
USER claude

# Отдельным слоем, чтобы правка исходников не переустанавливала зависимости.
COPY --chown=claude:claude package.json package-lock.json ./
# --include=optional обязателен: нативный бинарь Claude Code приезжает
# опциональной зависимостью, без него SDK не найдёт исполняемый файл.
RUN npm ci --include=optional

COPY --chown=claude:claude . .

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
