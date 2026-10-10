#!/usr/bin/env python3
"""Proxy-only Quick Tunnel and live Telegram menu publication. Never sends messages."""
import json
import os
import pathlib
import re
import signal
import sqlite3
import subprocess
import threading
import urllib.error
import urllib.request

APP = pathlib.Path('/opt/ai-bot/app')
DATA = pathlib.Path('/opt/ai-bot/data')
URL_FILE = DATA / 'miniapp-public-url'
ORIGIN = 'aiapp.200-165-236-8.sslip.io'
PROXY = 'http://127.0.0.1:10809'
URL_PATTERN = re.compile(r'https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b')


def env_values():
    values = {}
    for raw in (APP / '.env').read_text().splitlines():
        line = raw.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            values[key.strip()] = value.strip().strip('\"').strip("'")
    return values


def user_ids(values):
    ids = {int(x) for x in values.get('ALLOWED_USER_IDS', '').split(',') if x.strip().isdigit()}
    # Read SQLite directly; importing the bot store would interrupt active jobs.
    conn = sqlite3.connect('file:/opt/ai-bot/data/bot.db?mode=ro', uri=True, timeout=5)
    try:
        for table in ('users', 'allowed_users', 'gpt_user_policy'):
            columns = {row[1] for row in conn.execute('pragma table_info(' + table + ')')}
            if 'user_id' in columns:
                ids.update(row[0] for row in conn.execute('select user_id from ' + table))
    finally:
        conn.close()
    return sorted(uid for uid in ids if isinstance(uid, int) and uid > 0)


def publish_menu(opener, values, origin):
    def api(method, payload):
        req = urllib.request.Request(
            'https://api.telegram.org/bot' + values['BOT_TOKEN'] + '/' + method,
            data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
        with opener.open(req, timeout=15) as response:
            result = json.load(response)
        if not result.get('ok'):
            raise RuntimeError('Telegram menu update failed')
        return result['result']

    desired = {'type': 'web_app', 'text': 'Мой бот',
               'web_app': {'url': origin + '/modes.html'}}
    changes = 0
    for uid in [None, *user_ids(values)]:
        payload = {} if uid is None else {'chat_id': uid}
        try:
            current = api('getChatMenuButton', payload)
            # iOS can retain the previous global default. A per-chat update
            # refreshes the menu even for users who previously inherited it.
            if current == desired:
                continue
            api('setChatMenuButton', {**payload, 'menu_button': desired})
            changes += 1
        except urllib.error.HTTPError as error:
            if uid is not None and error.code in (400, 403):
                continue  # Deleted/blocked users must not prevent the default menu update.
            raise
    return changes


def write_url(origin):
    temp = URL_FILE.with_suffix('.tmp')
    temp.write_text(origin + '\n')
    temp.chmod(0o600)
    temp.replace(URL_FILE)


def main():
    stopped = threading.Event()
    candidate = ['']
    child = subprocess.Popen([
        '/usr/local/bin/cloudflared', 'tunnel', '--no-autoupdate',
        '--protocol', 'http2', '--url', 'https://127.0.0.1:443',
        '--origin-server-name', ORIGIN, '--http-host-header', ORIGIN,
        '--metrics', '127.0.0.1:49312', '--loglevel', 'info',
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
       env={**os.environ, 'HTTPS_PROXY': PROXY, 'HTTP_PROXY': PROXY,
            'NO_PROXY': '127.0.0.1,localhost'})

    def stop(signum=None, frame=None):
        stopped.set()
        child.terminate()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    def publisher():
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({'https': PROXY}))
        published = ''
        while not stopped.is_set():
            url = candidate[0]
            delay = 5
            if url:
                try:
                    if url != published:
                        # Publish only after DNS, TLS, tunnel and origin all answer successfully.
                        with opener.open(url + '/healthz', timeout=15) as response:
                            if response.status != 200:
                                raise RuntimeError('Mini App health check failed')
                            response.read(4096)
                        write_url(url)
                    changed = publish_menu(opener, env_values(), url)
                    if url != published or changed:
                        print('Mini App ready; Telegram menu synchronized: ' + url, flush=True)
                    published = url
                    delay = 60
                except Exception as error:
                    # Do not log exception text: urllib exceptions may contain the bot token.
                    print('Mini App publication will retry: ' + type(error).__name__, flush=True)
            stopped.wait(delay)

    worker = threading.Thread(target=publisher, daemon=True)
    worker.start()
    try:
        for line in child.stdout:
            print(line.rstrip(), flush=True)
            match = URL_PATTERN.search(line)
            if match:
                candidate[0] = match.group(0)
        return child.wait()
    finally:
        stop()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
        worker.join(timeout=2)


if __name__ == '__main__':
    raise SystemExit(main())
