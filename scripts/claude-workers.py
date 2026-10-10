"""Создаёт изолированный Claude Code каждому, кому открыт доступ (allowed_users или gpt_user_policy.allowed).

Запускается от root службой ai-bot-claude-workers: по запросу бота
(data/claude-workers.request, path-юнит) и раз в 5 минут (таймер).

На каждого человека без исполнителя:
  * Linux-пользователь claude-<id> со своей группой, uid = gid из 61001+
    (gid 1000 и прочие занятые номера не берём — 1000 у контейнеров);
  * домашняя папка /var/lib/ai-claude/<id> (750);
  * запись в data/claude-workers.json — бот читает её на лету;
  * team-provision.py <id> — права на личную команду ИИ, если она уже есть.
Существующего claude-<id> переиспользует, только если у него gid = uid.
Никого не удаляет: отзыв доступа решает бот.

python3 claude-workers.py [--check]   (--check — только показать, что сделал бы)
"""
import fcntl, grp, json, os, pwd, re, sqlite3, subprocess, sys, time
from pathlib import Path

DATA = Path(os.environ.get('AI_BOT_DATA', '/opt/ai-bot/data'))
APP = Path(os.environ.get('AI_BOT_APP', '/opt/ai-bot/app'))
HOMES = Path(os.environ.get('CLAUDE_HOMES', '/var/lib/ai-claude'))
FILE = DATA / 'claude-workers.json'
REQUEST = DATA / 'claude-workers.request'
FIRST_UID = 61001
CHECK = '--check' in sys.argv


def log(message):
    print(time.strftime('%F %T'), message, flush=True)


def env_map():
    for line in (APP / '.env').read_text().splitlines():
        if line.startswith('CLAUDE_WORKER_UID_MAP='):
            value = line.split('=', 1)[1].strip().strip('"')
            return {int(a): int(b) for a, b in (x.split(':') for x in value.split(',') if x)}
    return {}


def file_map():
    try:
        raw = json.loads(FILE.read_text())
        return {int(k): int(v) for k, v in raw.items() if re.fullmatch(r'[1-9][0-9]*', k) and isinstance(v, int)}
    except (OSError, ValueError, AttributeError):
        return {}


def wanted():
    with sqlite3.connect(f'file:{DATA}/bot.db?mode=ro', uri=True) as db:
        ids = {r[0] for r in db.execute('select user_id from allowed_users')}
        # Открытый в админке доступ (gpt_user_policy) — тоже повод для Claude Code.
        if db.execute("select 1 from sqlite_master where name='gpt_user_policy'").fetchone():
            ids |= {r[0] for r in db.execute('select user_id from gpt_user_policy where allowed=1')}
        return sorted(ids)


def taken(number, used):
    for lookup in (pwd.getpwuid, grp.getgrgid):
        try:
            lookup(number)
            return True
        except KeyError:
            pass
    return number in used


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f'{cmd[0]}: {(result.stdout + result.stderr).strip()[-300:]}')


def create(user_id, used):
    name, home = f'claude-{user_id}', HOMES / str(user_id)
    try:
        existing = pwd.getpwnam(name)
    except KeyError:
        existing = None
    if existing:
        if existing.pw_gid != existing.pw_uid or existing.pw_uid < FIRST_UID:
            raise RuntimeError(f'{name} уже есть, но uid {existing.pw_uid} / gid {existing.pw_gid} — нужна ручная проверка')
        uid = existing.pw_uid
    else:
        uid = FIRST_UID
        while taken(uid, used):
            uid += 1
        if CHECK:
            return uid
        try:
            grp.getgrnam(name)
            raise RuntimeError(f'группа {name} уже есть без пользователя — нужна ручная проверка')
        except KeyError:
            pass
        run(['groupadd', '-g', str(uid), name])
        run(['useradd', '-u', str(uid), '-g', str(uid), '-d', str(home), '-m', '-s', '/usr/sbin/nologin', name])
    if CHECK:
        return uid
    home.mkdir(mode=0o750, exist_ok=True)
    os.chown(home, uid, uid)
    os.chmod(home, 0o750)
    check = pwd.getpwnam(name)
    if (check.pw_uid, check.pw_gid) != (uid, uid):
        raise RuntimeError(f'{name}: после создания uid/gid {check.pw_uid}/{check.pw_gid}, а не {uid}')
    return uid


def save(mapping):
    temp = FILE.with_suffix('.tmp')
    temp.write_text(json.dumps({str(k): v for k, v in sorted(mapping.items())}, indent=1) + '\n')
    os.chmod(temp, 0o644)
    temp.replace(FILE)


def main():
    lock = open(DATA / '.claude-workers.lock', 'w')
    fcntl.flock(lock, fcntl.LOCK_EX)
    REQUEST.unlink(missing_ok=True)
    from_env, from_file = env_map(), file_map()
    known = {**from_file, **from_env}
    missing = [u for u in wanted() if u not in known]
    if not missing:
        return
    used = set(known.values())
    for user_id in missing:
        try:
            uid = create(user_id, used)
        except Exception as error:
            log(f'ОШИБКА {user_id}: {error}')
            continue
        used.add(uid)
        if CHECK:
            log(f'создал бы claude-{user_id} с uid {uid}')
            continue
        from_file[user_id] = uid
        save(from_file)
        log(f'создан Claude Code для {user_id}: claude-{user_id}, uid {uid}')
        if (Path('/opt/ai-bot/tenants') / str(user_id) / 'workspace').is_dir():
            team = subprocess.run(['python3', str(APP / 'gpt/team-provision.py'), str(user_id)], capture_output=True, text=True, timeout=30)
            if team.returncode != 0:
                log(f'team-provision {user_id}: {(team.stdout + team.stderr).strip()[-200:]}')


if __name__ == '__main__':
    main()
