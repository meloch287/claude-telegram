# node:24 — ради встроенного node:sqlite без экспериментального флага.
FROM node:24-slim

# git нужен самому Claude Code, ripgrep — его поиску по проекту,
# ca-certificates — для HTTPS через прокси.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Отдельным слоем, чтобы правка исходников не переустанавливала зависимости.
COPY package.json package-lock.json ./
# --include=optional обязателен: нативный бинарь Claude Code приезжает
# опциональной зависимостью, без него SDK не найдёт исполняемый файл.
RUN npm ci --include=optional

COPY . .

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/index.ts"]
