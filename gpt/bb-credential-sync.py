import json, os, signal, sys, time
from pathlib import Path
expected = json.load(sys.stdin).get('token') or ''
processes = {}
roots = []
for directory in Path('/proc').iterdir():
    if not directory.name.isdigit():
        continue
    try:
        argv = (directory / 'cmdline').read_bytes().split(b'\0')
        ppid = int(next(line.split()[1] for line in (directory / 'status').read_text().splitlines() if line.startswith('PPid:')))
        pid = int(directory.name)
        processes[pid] = ppid
        if b'/usr/local/bin/bb-app' in argv:
            env = dict(item.split(b'=', 1) for item in (directory / 'environ').read_bytes().split(b'\0') if b'=' in item)
            if env.get(b'CLAUDE_CODE_OAUTH_TOKEN', b'').decode() != expected:
                roots.append(pid)
    except (OSError, ValueError, StopIteration):
        continue
victims = set(roots)
while True:
    children = {pid for pid, parent in processes.items() if parent in victims}
    if children.issubset(victims):
        break
    victims |= children
for sig in (signal.SIGTERM, signal.SIGKILL):
    for pid in victims:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass
    if victims and sig == signal.SIGTERM:
        time.sleep(1)
print('restarted' if victims else 'ready')
