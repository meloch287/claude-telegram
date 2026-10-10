FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git openssh-client ca-certificates curl python3 python3-venv python3-pip build-essential ripgrep jq unzip zip procps tini && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex@0.159.3 && npm cache clean --force
RUN mkdir -p /app/workspaces /home/agent && chown 1000:1000 /home/agent
ENV HOME=/home/agent CODEX_HOME=/home/agent/.codex PATH=/home/agent/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
USER 1000:1000
WORKDIR /home/agent
CMD ["sleep", "infinity"]
