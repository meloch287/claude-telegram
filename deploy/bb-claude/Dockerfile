FROM ai-worker:0.159.3-bb0.45.0-r32-ru
USER root
COPY claude /usr/local/bin/claude
COPY patch-provider.py /tmp/patch-provider.py
RUN chmod 755 /usr/local/bin/claude && python3 /tmp/patch-provider.py && rm /tmp/patch-provider.py
USER 1000:1000
