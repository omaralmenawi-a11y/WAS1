#!/usr/bin/env bash
# Smoke test for the custom server (server.ts): boots it in dev and in production mode on a
# random port and expects GET /login to return 200. Catches regressions such as the socket
# layer importing next/headers before next().prepare(), which crashed the first page request.
# Dev runs first because Next dev mode rewrites .next; the build afterwards restores it.
set -euo pipefail
cd "$(dirname "$0")/.."

PID=""
LOG="$(mktemp)"
# Each server runs in its own process group (setsid), so killing -PID also stops any child processes it started.
stop() { [[ -n "$PID" ]] || return 0; kill -- "-$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=""; }
cleanup() { stop; rm -f "$LOG"; }
trap cleanup EXIT
trap "exit 130" INT TERM

free_port() { node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})"; }

check() { # label, then the command that starts the server
  local label="$1"; shift
  local port; port="$(free_port)"
  : > "$LOG"
  PORT="$port" setsid "$@" > "$LOG" 2>&1 &
  PID=$!
  for _ in $(seq 1 90); do
    grep -q 'WASL ready' "$LOG" && break
    kill -0 "$PID" 2>/dev/null || { echo "[$label] server exited before ready"; cat "$LOG"; exit 1; }
    sleep 1
  done
  grep -q 'WASL ready' "$LOG" || { echo "[$label] server not ready after 90s"; cat "$LOG"; exit 1; }
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 120 "http://127.0.0.1:$port/login" || true)"
  sleep 1
  if [[ "$code" != "200" ]] || ! kill -0 "$PID" 2>/dev/null || grep -q 'AsyncLocalStorage accessed' "$LOG"; then
    echo "[$label] FAIL: GET /login -> $code"; cat "$LOG"; exit 1
  fi
  echo "[$label] OK: GET /login -> 200"
  stop
}

check dev env NODE_ENV=development node_modules/.bin/tsx server.ts
npm run build
check prod env NODE_ENV=production node dist/server.js
echo "smoke: all OK"
