#!/bin/sh
set -e
envsubst < /app/dat/config.json.template > /app/dat/config.json
echo "livesync-bridge: config generated, starting..."
exec deno task run
