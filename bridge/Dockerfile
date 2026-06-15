FROM denoland/deno:2.3.1

RUN apt-get update && apt-get install -y --no-install-recommends git gettext-base ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 https://github.com/vrtmrz/livesync-bridge.git .

# Cache Deno dependencies
RUN deno install --allow-scripts 2>/dev/null || deno cache --allow-import src/main.ts 2>/dev/null || true

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
