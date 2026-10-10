"""Служебные задачи хоста бота (запускаются от root таймерами systemd).

  python3 ops.py backup     — ночной бэкап (ai-bot-backup.timer, 03:20 UTC):
      core-<дата>.tar.zst  — базы (снимок через SQLite backup), data/, Claude-дома,
                             .env, прокси и юниты; хранится 14 последних;
      full-<дата>.tar.zst  — папки пользователей (tenants, диалоги) без кэшей и
                             плагинов bb; хранится 3 последних.
  python3 ops.py cleanup    — чистка releases/ (ai-bot-cleanup.timer, раз в сутки):
      удаляет релизы старше 14 дней, кроме текущего фронта bb, 10 свежих и всего,
      на что ссылаются откаты оставшихся.
  python3 ops.py watchdog   — сторож (ai-bot-watchdog.timer, каждые 2 минуты):
      службы, healthz, место на диске, упавшие ai-* юниты. Пишет владельцу в
      Telegram при поломке (если она держится две проверки подряд) и при починке.
  python3 ops.py status     — что сторож видит сейчас (без отправки).
"""
import json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(os.environ.get('AI_BOT_ROOT', '/opt/ai-bot'))
APP, DATA, RELEASES = ROOT / 'app', ROOT / 'data', ROOT / 'releases'
BACKUPS = ROOT / 'backups' / 'nightly'
STATE = DATA / 'ops-state.json'
ADMIN_ID = 1057399602
KEEP_CORE, KEEP_FULL, KEEP_RELEASES, RELEASE_DAYS = 14, 3, 10, 14
MIN_FREE = 10 * 1024 ** 3
SERVICES = ['ai-bot', 'ai-gpt-backend', 'ai-bot-proxy', 'caddy', 'docker']
FULL_EXCLUDE = ['*/node_modules', '*/.cache', '*/.npm', '*/.bb/plugins', '*/.bun/install/cache', '*.sock']


def log(message):
    print(time.strftime('%F %T'), message, flush=True)


def run(cmd, timeout=600, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)


def env_value(name):
    try:
        for line in (APP / '.env').read_text().splitlines():
            if line.startswith(name + '='):
                return line.split('=', 1)[1].strip().strip('"')
    except OSError:
        pass
    return ''


def notify(text):
    token, proxy = env_value('BOT_TOKEN'), env_value('TELEGRAM_PROXY')
    if not token:
        return False
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({'https': proxy, 'http': proxy} if proxy else {}))
    data = urllib.parse.urlencode({'chat_id': ADMIN_ID, 'text': text, 'disable_web_page_preview': 'true'}).encode()
    try:
        opener.open(f'https://api.telegram.org/bot{token}/sendMessage', data, timeout=20).read()
        return True
    except Exception as error:
        log(f'не смог отправить сообщение: {error}')
        return False


def load_state():
    try:
        return json.loads(STATE.read_text())
    except (OSError, ValueError):
        return {}


def save_state(state):
    temp = STATE.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=1))
    os.chmod(temp, 0o600)
    temp.replace(STATE)


# ---------- бэкап ----------

def snapshot_databases(target):
    """Согласованные копии SQLite без остановки бота (backup API, WAL учитывается)."""
    for db in sorted(DATA.glob('*.db')):
        source = sqlite3.connect(f'file:{db}?mode=ro', uri=True, timeout=30)
        dest = sqlite3.connect(target / db.name)
        with dest:
            source.backup(dest)
        dest.close()
        source.close()


def prune(pattern, keep):
    for old in sorted(BACKUPS.glob(pattern))[:-keep]:
        old.unlink()
        log(f'удалён старый бэкап {old.name}')


def tar(out, sources, exclude=(), base='/'):
    temp = out.with_name(out.name + '.part')
    cmd = ['nice', '-n', '15', 'ionice', '-c3', 'tar', '--zstd', '-cf', str(temp), '-C', base,
           '--ignore-failed-read', '--warning=no-file-changed', '--warning=no-file-removed']
    cmd += [f'--exclude={pattern}' for pattern in exclude]
    cmd += [str(Path(s).relative_to(base)) for s in sources if Path(s).exists()]
    result = run(cmd, timeout=6 * 3600)
    if result.returncode not in (0, 1):  # 1 — файл изменился во время чтения, это нормально
        temp.unlink(missing_ok=True)
        raise RuntimeError(f'tar {out.name}: {result.stderr.strip()[-300:]}')
    os.chmod(temp, 0o600)
    temp.replace(out)
    return out.stat().st_size


def backup():
    BACKUPS.mkdir(parents=True, exist_ok=True)
    os.chmod(BACKUPS, 0o700)
    if shutil.disk_usage(BACKUPS).free < MIN_FREE:
        raise RuntimeError('на диске меньше 10 ГБ — бэкап не делаю')
    day = time.strftime('%Y-%m-%d')
    with tempfile.TemporaryDirectory(dir=BACKUPS) as temp:
        dbs = Path(temp) / 'databases'
        dbs.mkdir()
        snapshot_databases(dbs)
        core_sources = [dbs, DATA / 'claude-workers.json', DATA / 'claude-preferences.json', DATA / 'engine-access.json',
                        DATA / 'engine-modes.json', DATA / 'team-access.json', DATA / 'web-access.json', DATA / 'claude-dialogs',
                        Path('/var/lib/ai-claude'), APP / '.env', Path('/etc/ai-bot-proxy'), ROOT / 'deployment']
        core_sources += sorted(Path('/etc/systemd/system').glob('ai-*'))
        core = tar(BACKUPS / f'core-{day}.tar.zst', core_sources, exclude=['*.sock', '*/.cache'])
    full = tar(BACKUPS / f'full-{day}.tar.zst', [ROOT / 'tenants', ROOT / 'unused-controller-workspaces'], exclude=FULL_EXCLUDE)
    prune('core-*.tar.zst', KEEP_CORE)
    prune('full-*.tar.zst', KEEP_FULL)
    check = run(['tar', '--zstd', '-tf', str(BACKUPS / f'core-{day}.tar.zst')])
    if check.returncode != 0 or 'databases/bot.db' not in check.stdout:
        raise RuntimeError('архив core не читается или в нём нет bot.db')
    state = load_state()
    state['backup'] = {'at': int(time.time()), 'core': core, 'full': full}
    save_state(state)
    log(f'бэкап готов: core {core / 1e6:.1f} МБ, full {full / 1e9:.2f} ГБ')


# ---------- чистка релизов ----------

def cleanup(now=None, dry=False):
    now = now or time.time()
    releases = sorted((p for p in RELEASES.iterdir() if p.is_dir() and not p.is_symlink()), key=lambda p: p.stat().st_mtime)
    keep = set(releases[-KEEP_RELEASES:])
    current = (ROOT / 'bb-ru-dist').resolve()
    keep |= {p for p in releases if current == p or p in current.parents}
    keep |= {p for p in releases if now - p.stat().st_mtime < RELEASE_DAYS * 86400}
    # Откаты оставшихся ссылаются на прежние фронты и файлы — их не трогаем.
    for kept in list(keep):
        for script in list(kept.glob('rollback*.sh')) + list(kept.glob('*deploy*.py')):
            for name in re.findall(r'/opt/ai-bot/releases/([A-Za-z0-9._-]+)', script.read_text(errors='ignore')):
                keep.add(RELEASES / name)
    removed = []
    for release in releases:
        if release in keep:
            continue
        removed.append(release.name)
        if not dry:
            shutil.rmtree(release)
    log(('удалил бы: ' if dry else 'удалено: ') + (', '.join(removed) or 'ничего'))
    return removed


# ---------- сторож ----------

def problems():
    found = []
    for service in SERVICES:
        if run(['systemctl', 'is-active', '--quiet', service]).returncode != 0:
            found.append(f'служба {service} не работает')
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open('http://127.0.0.1:8788/healthz', timeout=10) as r:
            if r.status != 200:
                found.append(f'healthz отвечает {r.status}')
    except Exception:
        found.append('бот не отвечает на healthz')
    usage = shutil.disk_usage('/')
    if usage.used / usage.total > 0.9:
        found.append(f'диск занят на {usage.used / usage.total:.0%}')
    failed = run(['systemctl', 'list-units', '--failed', '--plain', '--no-legend', 'ai-*']).stdout.split()
    for unit in failed:
        if unit.startswith('ai-') and unit.endswith(('.service', '.timer')):
            found.append(f'упал юнит {unit}')
    found += sync_problems()
    backup_at = load_state().get('backup', {}).get('at')
    if backup_at and time.time() - backup_at > 36 * 3600:
        found.append('ночной бэкап не делался больше полутора суток')
    return sorted(set(found))


SYNC_ERROR = re.compile(r'\[(claude-bb|bb-sync)\][^0-9]*(\d{5,15})\s+(.*)')


def sync_problems(lines=None):
    """Синхронизация с bb падает у человека 3+ раз за 15 минут — без этого она ломается молча."""
    if lines is None:
        out = run(['journalctl', '-u', 'ai-gpt-backend', '--since', '-15min', '-o', 'cat', '--no-pager'], timeout=30)
        lines = out.stdout.splitlines() if out.returncode == 0 else []
    errors = {}
    for line in lines:
        match = SYNC_ERROR.search(line)
        if match:
            errors.setdefault(match.group(2), []).append(match.group(3).strip())
    # Текст стабильный: одна и та же поломка — одна тревога, а не сообщение на каждую ошибку.
    for uid, texts in errors.items():
        if len(texts) >= 3:
            log(f'синхронизация с bb у {uid}: {texts[-1][:300]}')
    return [f'синхронизация чатов с bb падает у {uid} (подробности: journalctl -u ai-gpt-backend | grep {uid})' for uid, texts in sorted(errors.items()) if len(texts) >= 3]


def watchdog():
    state = load_state()
    now_problems = problems()
    seen = state.get('watch', {})
    previous = set(seen.get('problems', []))
    pending = set(seen.get('pending', []))
    # Поломка должна продержаться две проверки: выкатка перезапускает бота на секунды.
    confirmed = previous | (set(now_problems) & pending)
    new = sorted(confirmed - previous)
    fixed = sorted(previous - set(now_problems))
    message = []
    if new:
        message.append('🚨 Проблема на сервере бота:\n' + '\n'.join('• ' + p for p in new))
    if fixed:
        message.append('✅ Починилось:\n' + '\n'.join('• ' + p for p in fixed))
    unsent = seen.get('unsent', [])
    if message:
        unsent.append('\n\n'.join(message))
    if unsent and notify('\n\n'.join(unsent)):
        unsent = []
    state['watch'] = {'problems': sorted(confirmed - set(fixed)), 'pending': sorted(set(now_problems) - confirmed),
                      'unsent': unsent[-10:], 'at': int(time.time())}
    save_state(state)
    if now_problems:
        log('проблемы: ' + '; '.join(now_problems))


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command == 'backup':
        try:
            backup()
        except Exception as error:
            notify(f'🚨 Ночной бэкап бота не получился: {error}')
            raise
    elif command == 'cleanup':
        cleanup(dry='--dry' in sys.argv)
    elif command == 'watchdog':
        watchdog()
    elif command == 'status':
        print(json.dumps({'problems': problems(), 'state': load_state()}, ensure_ascii=False, indent=1))
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
