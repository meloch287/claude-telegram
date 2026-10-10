FROM ai-worker:0.159.3
USER root
RUN npm install -g bb-app@0.45.0 && npm cache clean --force && usermod -d /home/agent node
USER 1000:1000
ENV BB_TELEMETRY=false BB_SERVER_BIND_HOST=0.0.0.0 BB_SERVER_PORT=38886 BB_DATA_DIR=/home/agent/.bb
CMD ["bb-app", "--server-bind-host", "0.0.0.0"]
