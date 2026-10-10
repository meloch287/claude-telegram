"""Обновление Codex CLI в контейнерах пользователей (образ ai-worker).

  python3 worker-update.py --check [--to X]   — собрать образ и проверить, ничего не переключая;
  python3 worker-update.py --to X             — собрать, проверить, переключить в тишине, откат при сбое.

Шаги:
  1. Образ: FROM текущего ai-worker + npm i -g @openai/codex@X (через прокси хоста).
     bb, русская сборка и Claude в образе те же — меняется только Codex.
  2. Проверка в отдельном контейнере с теми же ограничениями, что у боевых, на КОПИИ
     настроек Codex владельца: версия; протокол app-server, которым ходит бот
     (initialize → thread/start → turn/start); один короткий ход с командой
     (тратит немного лимита); файл состояния остаётся state_5.sqlite (на нём
     держится синхронизация с bb).
  3. Переключение — только когда тихо: нет задач Claude и GPT и ни один диалог
     bb не работает. Снимки баз Codex/bb всех людей → стоп ai-gpt-backend →
     удалить контейнеры (данные в томах) → новый тег в коде → старт; контейнеры
     создаются заново из нового образа при первом обращении.
  4. Любая ошибка после остановки — прежний код, прежние базы, прежний образ.
Старый образ не удаляется (откат вручную: rollback.sh в releases/codex-<X>).
"""
import json, os, re, shutil, sqlite3, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

ROOT = Path(os.environ.get('AI_BOT_ROOT', '/opt/ai-bot'))
APP, DATA, RELEASES, TENANTS = ROOT / 'app', ROOT / 'data', ROOT / 'releases', ROOT / 'tenants'
OWNER = 1057399602
PROXY = 'http://127.0.0.1:10809'
CHECK = '--check' in sys.argv
IMAGE_FILES = {
    'gpt/web-runtime.mjs': r'(BB_IMAGE = ")(ai-worker:[^"]+)(")',
    'gpt/policy.mjs': r'(image = ")(ai-worker:[^"]+)(")',
}
AGENT_FILES = ['gpt/inference-gateway.mjs', 'gpt/team-providers.mjs']  # user-agent codex_cli_rs/<версия>
ACTIVE = ('active', 'error-recovering', 'waiting', 'running', 'starting', 'pending', 'stopping', 'provisioning')


def log(message):
    print(time.strftime('%F %T'), message, flush=True)


def run(cmd, timeout=900, check=True, **kw):
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)
    if check and result.returncode != 0:
        raise RuntimeError(f'{" ".join(cmd[:3])}: {(result.stdout + result.stderr).strip()[-500:]}')
    return result


def current_image():
    text = (APP / 'gpt/web-runtime.mjs').read_text()
    match = re.search(IMAGE_FILES['gpt/web-runtime.mjs'], text)
    if not match:
        raise RuntimeError('не нашёл BB_IMAGE в web-runtime.mjs')
    image = match.group(2)
    policy = re.search(IMAGE_FILES['gpt/policy.mjs'], (APP / 'gpt/policy.mjs').read_text())
    if not policy or policy.group(2) != image:
        raise RuntimeError('образы в web-runtime.mjs и policy.mjs расходятся — сначала свести вручную')
    return image


def codex_of(image):
    match = re.match(r'ai-worker:([0-9][0-9.]*)', image)
    if not match:
        raise RuntimeError(f'не понял версию Codex в {image}')
    return match.group(1)


def latest():
    out = run(['npm', 'view', '@openai/codex', 'version'], cwd='/tmp', timeout=120).stdout.strip().splitlines()[-1]
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', out):
        raise RuntimeError(f'странная версия в npm: {out}')
    return out


def build(base, version):
    image = re.sub(r'^ai-worker:[0-9][0-9.]*', f'ai-worker:{version}', base)
    if run(['docker', 'image', 'inspect', image], check=False).returncode == 0:
        log(f'образ {image} уже собран')
        return image
    with tempfile.TemporaryDirectory() as context:
        Path(context, 'Dockerfile').write_text(
            f'FROM {base}\nUSER root\n'
            f'RUN npm install -g @openai/codex@{version} && npm cache clean --force\n'
            f'LABEL ai-bot.codex="{version}" ai-bot.codex-base="{base}"\nUSER 1000:1000\n')
        proxy = [f'--build-arg={k}={PROXY}' for k in ('HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy')]
        run(['docker', 'build', '--network', 'host', *proxy, '-t', image, context], timeout=1800)
    log(f'собран {image}')
    return image


def rpc_turn(container, model='gpt-6-luna'):
    """Тот же протокол, что у бота (gpt/live-turn.mjs): один ход с командой."""
    proc = subprocess.Popen(['docker', 'exec', '-i', '-w', '/tmp', container, 'codex', 'app-server',
                             '-c', f'model="{model}"', '-c', 'sandbox_mode="danger-full-access"',
                             '-c', 'model_reasoning_effort="low"', '-c', 'approval_policy="never"'],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    seen, counter = {'command': False, 'answer': '', 'usage': False, 'status': None}, [0]

    def send(message):
        proc.stdin.write(json.dumps(message) + '\n')
        proc.stdin.flush()

    def call(method, params):
        counter[0] += 1
        send({'id': counter[0], 'method': method, 'params': params})
        return counter[0]

    deadline = time.time() + 180
    waiting = {call('initialize', {'clientInfo': {'name': 'gpt_telegram', 'title': 'GPT Telegram', 'version': '1.0'}, 'capabilities': {'experimentalApi': True}}): 'initialize'}
    thread = None
    try:
        for line in proc.stdout:
            if time.time() > deadline:
                raise RuntimeError('ход не завершился за 3 минуты')
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if 'id' in m and m['id'] in waiting:
                step = waiting.pop(m['id'])
                if m.get('error'):
                    raise RuntimeError(f'{step}: {m["error"].get("message")}')
                if step == 'initialize':
                    send({'method': 'initialized', 'params': {}})
                    waiting[call('thread/start', {'model': model, 'cwd': '/tmp', 'approvalPolicy': 'never', 'sandbox': 'danger-full-access', 'config': {'model_reasoning_effort': 'low'}})] = 'thread/start'
                elif step == 'thread/start':
                    thread = m['result']['thread']['id']
                    prompt = 'Это автоматическая проверка. Выполни команду `echo SMOKE_OK_7` и ответь ровно: SMOKE_OK_7'
                    waiting[call('turn/start', {'threadId': thread, 'input': [{'type': 'text', 'text': prompt, 'text_elements': []}], 'model': model, 'effort': 'low', 'approvalPolicy': 'never', 'sandboxPolicy': {'type': 'dangerFullAccess'}})] = 'turn/start'
                continue
            if 'id' in m:  # запрос от сервера — бот такие отклоняет, и мы тоже
                send({'id': m['id'], 'error': {'code': -32601, 'message': 'noninteractive'}})
                continue
            p = m.get('params') or {}
            if m.get('method') == 'thread/tokenUsage/updated' and (p.get('tokenUsage') or {}).get('total'):
                seen['usage'] = True
            if m.get('method') == 'item/completed':
                item = p.get('item') or {}
                if item.get('type') == 'commandExecution':
                    seen['command'] = True
                if item.get('type') == 'agentMessage':
                    seen['answer'] += item.get('text') or ''
            if m.get('method') == 'turn/completed':
                seen['status'] = (p.get('turn') or {}).get('status')
                break
    finally:
        proc.kill()
    if seen['status'] != 'completed':
        raise RuntimeError(f'ход не завершился: {seen["status"]}')
    if not seen['command'] or 'SMOKE_OK_7' not in seen['answer'] or not seen['usage']:
        raise RuntimeError(f'ход неполный: команда {seen["command"]}, ответ «{seen["answer"][:80]}», расход {seen["usage"]}')
    return thread


def smoke(image, version):
    out = run(['docker', 'run', '--rm', '--entrypoint', 'codex', image, '--version']).stdout
    if version not in out:
        raise RuntimeError(f'в образе не та версия: {out.strip()}')
    with tempfile.TemporaryDirectory(prefix='codex-smoke-') as temp:
        home = Path(temp) / 'home'
        (home / '.codex').mkdir(parents=True)
        source = TENANTS / str(OWNER) / 'home/.codex'
        for name in ('auth.json', 'config.toml', 'models_cache.json'):
            if (source / name).is_file():
                shutil.copy2(source / name, home / '.codex' / name)
        run(['chown', '-R', '1000:1000', str(home)])
        name = 'ai-update-check'
        run(['docker', 'rm', '-f', name], check=False)
        run(['docker', 'run', '-d', '--name', name, '--init', '--user', '1000:1000', '--read-only', '--cap-drop=ALL',
             '--security-opt=no-new-privileges:true', '--pids-limit=512', '--cpus=1', '--network=ai-workers', '--ipc=private',
             '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777', '--env', 'HOME=/home/agent', '--env', 'CODEX_HOME=/home/agent/.codex',
             '--mount', f'type=bind,src={home},dst=/home/agent', image, 'sleep', 'infinity'])
        try:
            rpc_turn(name)
        finally:
            run(['docker', 'rm', '-f', name], check=False)
        states = sorted(p.name for p in (home / '.codex').glob('state_*.sqlite'))
        if states and 'state_5.sqlite' not in states:
            raise RuntimeError(f'Codex сменил файл состояния ({", ".join(states)}) — синхронизацию с bb надо обновить')
    log('проверка пройдена: версия, протокол app-server, ход с командой, state_5.sqlite')


def quiet():
    with sqlite3.connect('file:/opt/ai-bot/data/bot.db?mode=ro', uri=True) as db:
        if db.execute("select count(*) from gpt_jobs where state='running'").fetchone()[0]:
            return False
        if db.execute('select count(*) from running_tasks').fetchone()[0]:
            return False
    # Диалоги bb идут внутри контейнеров — их бот в своих таблицах не видит.
    names = run(['docker', 'ps', '--filter', 'label=ai-bot.managed=v1', '--format', '{{.Names}}']).stdout.split()
    query = "import sqlite3,sys;db=sqlite3.connect('file:/home/agent/.bb/bb.db?mode=ro',uri=True,timeout=5);print(db.execute('select count(*) from threads where deleted_at is null and status in (%s)'%','.join('?'*len(sys.argv[1:])),sys.argv[1:]).fetchone()[0])"
    for name in names:
        if not name.startswith('ai-user-'):
            continue
        result = run(['docker', 'exec', name, 'python3', '-c', query, *ACTIVE], check=False, timeout=30)
        if result.returncode == 0 and result.stdout.strip() not in ('', '0'):
            return False
    return True


def wait_quiet(hours=6):
    deadline, calm = time.time() + hours * 3600, 0
    while calm < 4:
        calm = calm + 1 if quiet() else 0
        if time.time() > deadline:
            return False
        if calm < 4:
            time.sleep(30)
    return True


def snapshot_states(target):
    """Новый Codex и bb мигрируют базы вперёд — без снимков отката нет."""
    count = 0
    for tenant in TENANTS.iterdir():
        home = tenant / 'home'
        files = list(home.glob('.codex/state_*.sqlite')) + list(home.glob('.bb-codex/state_*.sqlite')) + \
            list(home.glob('dialogs/*/.codex/state_*.sqlite')) + list(home.glob('.bb/bb.db'))
        for file in files:
            if file.is_symlink():
                continue
            dest = target / file.relative_to(TENANTS)
            dest.parent.mkdir(parents=True, exist_ok=True)
            src = sqlite3.connect(f'file:{file}?mode=ro', uri=True, timeout=30)
            out = sqlite3.connect(dest)
            with out:
                src.backup(out)
            out.close(); src.close()
            shutil.copystat(file, dest)
            count += 1
    return count


def restore_states(source):
    for dest_backup in source.rglob('*'):
        if dest_backup.is_file():
            original = TENANTS / dest_backup.relative_to(source)
            stat = original.stat() if original.exists() else None
            for suffix in ('-wal', '-shm'):
                Path(str(original) + suffix).unlink(missing_ok=True)
            shutil.copyfile(dest_backup, original)
            if stat:
                os.chown(original, stat.st_uid, stat.st_gid)


def rewrite_code(old_image, new_image, old_version, new_version):
    changed = {}
    for rel, pattern in IMAGE_FILES.items():
        text = (APP / rel).read_text()
        new_text, n = re.subn(pattern, lambda m: m.group(1) + new_image + m.group(3), text)
        if n != 1:
            raise RuntimeError(f'{rel}: тег образа найден {n} раз')
        changed[rel] = new_text
    for rel in AGENT_FILES:
        text = (APP / rel).read_text()
        if f'codex_cli_rs/{old_version}' not in text:
            raise RuntimeError(f'{rel}: нет codex_cli_rs/{old_version}')
        changed[rel] = text.replace(f'codex_cli_rs/{old_version}', f'codex_cli_rs/{new_version}')
    return changed


def write_files(files):
    for rel, text in files.items():
        target = APP / rel
        temp = target.with_name(target.name + '.codex-update')
        temp.write_text(text)
        shutil.copymode(target, temp)
        temp.replace(target)


def remove_containers():
    names = run(['docker', 'ps', '-a', '--filter', 'label=ai-bot.managed=v1', '--format', '{{.Names}}']).stdout.split()
    for name in names:
        if name.startswith(('ai-user-', 'ai-read-')):
            run(['docker', 'rm', '-f', name], check=False, timeout=120)
    return names


def healthy():
    for _ in range(45):
        time.sleep(2)
        if run(['systemctl', 'is-active', '--quiet', 'ai-gpt-backend'], check=False).returncode == 0 and \
                run(['systemctl', 'is-active', '--quiet', 'ai-bot'], check=False).returncode == 0:
            try:
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open('http://127.0.0.1:8788/healthz', timeout=5) as r:
                    if r.status == 200:
                        return True
            except Exception:
                pass
    return False


def switch(old_image, new_image, old_version, new_version):
    stage = RELEASES / f'codex-{new_version}'
    stage.mkdir(mode=0o700, parents=True, exist_ok=True)
    files = rewrite_code(old_image, new_image, old_version, new_version)
    backup = {rel: (APP / rel).read_text() for rel in files}
    (stage / 'previous-files.json').write_text(json.dumps(backup, ensure_ascii=False))
    (stage / 'rollback.sh').write_text(f'''#!/bin/sh
# Откат Codex {new_version} → {old_version}: прежний код и прежние базы Codex/bb, контейнеры пересоздаются из {old_image}.
set -eu
systemctl stop ai-gpt-backend
docker ps -a --filter label=ai-bot.managed=v1 --format '{{{{.Names}}}}' | grep -E '^ai-(user|read)-' | xargs -r docker rm -f
python3 -c "import json;from pathlib import Path;[Path('/opt/ai-bot/app',k).write_text(v) for k,v in json.load(open('{stage}/previous-files.json')).items()]"
python3 - <<'PY'
import importlib.util
s=importlib.util.spec_from_file_location('w','/opt/ai-bot/app/scripts/worker-update.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
from pathlib import Path;m.restore_states(Path('{stage}/states'))
PY
systemctl start ai-gpt-backend
echo "Откат выполнен"
''')
    log('жду тишины (нет задач Claude, GPT и диалогов bb)')
    if not wait_quiet():
        raise TimeoutError('6 часов без тишины — переключение перенесено')
    count = snapshot_states(stage / 'states')
    log(f'снимки баз: {count}; останавливаю ai-gpt-backend и пересоздаю контейнеры')
    run(['systemctl', 'stop', 'ai-gpt-backend'])
    try:
        remove_containers()
        write_files(files)
        run(['systemctl', 'start', 'ai-gpt-backend'])
        if not healthy():
            raise RuntimeError('после переключения бот не ответил')
    except BaseException:
        run(['systemctl', 'stop', 'ai-gpt-backend'], check=False)
        remove_containers()
        write_files(backup)
        restore_states(stage / 'states')
        run(['systemctl', 'start', 'ai-gpt-backend'], check=False)
        raise
    return stage


def main():
    target = sys.argv[sys.argv.index('--to') + 1] if '--to' in sys.argv else latest()
    old_image = current_image()
    old_version = codex_of(old_image)
    if target == old_version:
        print(json.dumps({'status': 'current', 'version': old_version}))
        return
    image = build(old_image, target)
    smoke(image, target)
    if CHECK:
        print(json.dumps({'status': 'checked', 'image': image}))
        return
    stage = switch(old_image, image, old_version, target)
    print(json.dumps({'status': 'updated', 'from': old_version, 'to': target, 'image': image, 'rollback': str(stage / 'rollback.sh')}))


if __name__ == '__main__':
    try:
        main()
    except TimeoutError as error:
        print(json.dumps({'status': 'deferred', 'error': str(error)}, ensure_ascii=False))
        sys.exit(3)
    except Exception as error:
        print(json.dumps({'status': 'failed', 'error': str(error)}, ensure_ascii=False))
        sys.exit(1)
