#!/bin/sh
set -eu
umask 077
cd /opt/ai-bot/app
if [ "$(id -u)" != 0 ]; then
  echo 'Run on the GPT server as root.' >&2
  exit 1
fi
test -f .env
test -f gpt/main.mjs
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
mkdir -p dist/miniapp/public
cp -a src/miniapp/public/. dist/miniapp/public/
docker build -f gpt/Dockerfile.worker -t ai-worker:0.159.3 gpt
npm prune --omit=dev --ignore-scripts --no-audit --no-fund
install -m 644 gpt/ai-bot.service /etc/systemd/system/ai-bot.service
systemctl daemon-reload
systemctl enable --now ai-bot
systemctl restart ai-bot
systemctl is-active ai-bot
