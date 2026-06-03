#!/usr/bin/env bash
# Launch SimWilayah dev server fully detached (own session) so it survives the
# parent shell exiting. macOS lacks `setsid`, so we daemonize via Python's
# os.setsid + double-fork, then exec pnpm dev.
cd "$(dirname "$0")" || exit 1
LOG=/tmp/simwilayah-dev.log
: > "$LOG"
/usr/bin/python3 - "$LOG" <<'PY'
import os, sys
log = sys.argv[1]
if os.fork() > 0: os._exit(0)        # parent returns to shell
os.setsid()                          # new session — detach from controlling tty/pgrp
if os.fork() > 0: os._exit(0)        # ensure not a session leader (can't reacquire tty)
fd = os.open(log, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
os.dup2(fd, 1); os.dup2(fd, 2)
os.open("/dev/null", os.O_RDONLY)    # stdin
os.execvp("pnpm", ["pnpm", "dev", "-p", "3001", "-H", "0.0.0.0"])
PY
echo "daemon launched -> log: $LOG"
