"""Ночное автообновление движков бота.

Claude (Agent SDK со встроенным Claude Code) обновляется сам:
  1. есть новая версия в npm → копия приложения в releases/auto-sdk-<версия>;
  2. там npm install новой версии, сборка (tsc проверяет типы) и тесты —
     без .env, чтобы тесты не трогали боевые данные; новых падений быть не должно;
  3. проверка бинаря Claude Code (--version);
  4. ждём тишины (нет задач Claude и GPT), подменяем node_modules и package*.json,
     перезапускаем ai-bot и ai-gpt-backend, healthz; любая ошибка → откат.
Новые модели Claude после этого подтянутся сами (каталог берётся из Claude Code).

Codex (GPT) обновляется сам через scripts/worker-update.py: новый образ ai-worker,
проверочный ход в отдельном контейнере, переключение в тишине со снимками баз и откатом.
bb — только уведомление админу (раз на версию): его фронт — пропатченная русская сборка.
Каталог моделей GPT обновляется без этого скрипта (gpt-models.mjs).

Отчёт — сообщением админу в Telegram. Запуск: python3 auto-update.py [--check]
"""
import json, os, shutil, sqlite3, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

APP = Path('/opt/ai-bot/app')
RELEASES = Path('/opt/ai-bot/releases')
DATA = Path('/opt/ai-bot/data')
STATE = DATA / 'auto-update.json'
SDK = '@anthropic-ai/claude-agent-sdk'
ADMIN_ID = 1057399602
CHECK = '--check' in sys.argv


def log(message):
    print(time.strftime('%F %T'), message, flush=True)


def run(cmd, cwd=None, env=None, timeout=1800):
    result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
    return result.returncode, (result.stdout + result.stderr)


def latest(package):
    code, out = run(['npm', 'view', package, 'version'], cwd='/tmp', timeout=120)
    version = out.strip().splitlines()[-1] if out.strip() else ''
    return version if code == 0 and version[:1].isdigit() else None


def installed_sdk(app=APP):
    return json.loads((app / 'node_modules' / SDK / 'package.json').read_text())['version']


def newer(candidate, current):
    as_tuple = lambda v: tuple(int(x) for x in v.split('-')[0].split('.') if x.isdigit())
    return candidate and as_tuple(candidate) > as_tuple(current)


def env_value(name):
    for line in (APP / '.env').read_text().splitlines():
        if line.startswith(name + '='):
            return line.split('=', 1)[1].strip().strip('"')
    return ''


def notify(text):
    """Сообщение админу через Bot API (через прокси Telegram, как сам бот)."""
    token, proxy = env_value('BOT_TOKEN'), env_value('TELEGRAM_PROXY')
    if not token:
        return
    handlers = [urllib.request.ProxyHandler({'https': proxy, 'http': proxy} if proxy else {})]
    data = urllib.parse.urlencode({'chat_id': ADMIN_ID, 'text': text, 'disable_web_page_preview': 'true'}).encode()
    try:
        urllib.request.build_opener(*handlers).open(f'https://api.telegram.org/bot{token}/sendMessage', data, timeout=20).read()
    except Exception as error:  # уведомление не должно ронять обновление
        log(f'не смог отправить уведомление: {error}')


def load_state():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {}


def save_state(state):
    temp = STATE.with_suffix('.tmp')
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=1))
    os.chmod(temp, 0o600)
    temp.replace(STATE)


def failing_tests(app):
    """Имена упавших тестов; без .env, чтобы конфиг не указал на боевые данные."""
    env_file, hidden = app / '.env', app / '.env.auto-update-off'
    moved = env_file.exists()
    if moved:
        env_file.rename(hidden)
    try:
        env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': '/root', 'LANG': 'C.UTF-8'}
        code, out = run(['node', '--test', *sorted(str(p.relative_to(app)) for p in (app / 'gpt').glob('*.test.mjs'))], cwd=app, env=env, timeout=1800)
    finally:
        if moved:
            hidden.rename(env_file)
    return {line.split(' - ', 1)[1].strip() for line in out.splitlines() if line.startswith('not ok ') and ' - ' in line}, out


def idle(rounds=4, pause=30, deadline_hours=6):
    deadline, quiet = time.time() + deadline_hours * 3600, 0
    while quiet < rounds:
        with sqlite3.connect('file:/opt/ai-bot/data/bot.db?mode=ro', uri=True) as db:
            busy = db.execute("select count(*) from gpt_jobs where state='running'").fetchone()[0] + db.execute('select count(*) from running_tasks').fetchone()[0]
        quiet = quiet + 1 if busy == 0 else 0
        if time.time() > deadline:
            return False
        if quiet < rounds:
            time.sleep(pause)
    return True


def healthy():
    for _ in range(40):
        time.sleep(2)
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open('http://127.0.0.1:8788/healthz', timeout=5) as r:
                if r.status == 200 and run(['systemctl', 'is-active', '--quiet', 'ai-bot'])[0] == 0 and run(['systemctl', 'is-active', '--quiet', 'ai-gpt-backend'])[0] == 0:
                    return True
        except Exception:
            pass
    return False


class Deferred(Exception):
    """Не ошибка версии, а неудачный момент: повторим следующей ночью."""


def update_sdk(version, current):
    stage = RELEASES / f'auto-sdk-{version}'
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(mode=0o700, parents=True)
    staged = stage / 'app'
    log(f'копирую приложение для сборки {SDK}@{version}')
    shutil.copytree(APP, staged, symlinks=True)
    # Базовые падения меряем на копии до обновления: живое приложение не трогаем.
    baseline_failures, _ = failing_tests(staged)
    code, out = run(['npm', 'install', f'{SDK}@^{version}', '--no-audit', '--no-fund'], cwd=staged)
    if code != 0:
        raise RuntimeError('npm install не прошёл: ' + out[-400:])
    if installed_sdk(staged) != version:
        raise RuntimeError(f'встала версия {installed_sdk(staged)}, а не {version}')
    code, out = run(['npm', 'run', 'build'], cwd=staged)
    if code != 0:
        raise RuntimeError('сборка с новой версией не прошла: ' + out[-600:])
    failures, out = failing_tests(staged)
    fresh = failures - baseline_failures
    if fresh:
        raise RuntimeError('новые падения тестов: ' + '; '.join(sorted(fresh))[:600])
    binary = staged / 'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude'
    code, out = run([str(binary), '--version'], timeout=60)
    if code != 0:
        raise RuntimeError('Claude Code из новой версии не запускается: ' + out[-300:])
    cli = out.strip().splitlines()[-1]
    if CHECK:
        return f'готово к подмене (Claude Code {cli}), проверка без подмены'
    log('сборка и тесты прошли; жду тишины для подмены')
    if not idle():
        raise Deferred('6 часов без тишины — подмену перенёс на следующую ночь')
    backup = stage / 'previous'
    backup.mkdir()
    swap = ['node_modules', 'package.json', 'package-lock.json']
    run(['systemctl', 'stop', 'ai-bot'])
    try:
        for name in swap:
            (APP / name).rename(backup / name)
            (staged / name).rename(APP / name)
        run(['systemctl', 'start', 'ai-bot'])
        run(['systemctl', 'restart', 'ai-gpt-backend'])
        if not healthy():
            raise RuntimeError('после подмены бот не поднялся')
    except BaseException:
        run(['systemctl', 'stop', 'ai-bot'])
        failed = stage / 'failed'
        failed.mkdir(exist_ok=True)
        for name in swap:
            if (backup / name).exists():
                if (APP / name).exists():
                    (APP / name).rename(failed / name)
                (backup / name).rename(APP / name)
        run(['systemctl', 'start', 'ai-bot'])
        run(['systemctl', 'restart', 'ai-gpt-backend'])
        raise
    shutil.rmtree(staged, ignore_errors=True)
    return f'обновлён: {current} → {version} (Claude Code {cli}). Откат: вернуть {backup} на место.'


def main():
    state = load_state()
    report = []
    current = installed_sdk()
    target = latest(SDK)
    if newer(target, current) and state.get('sdk_failed') != target:
        try:
            report.append('🟢 Claude ' + update_sdk(target, current))
            state.pop('sdk_failed', None)
        except Deferred as error:
            report.append(f'⏳ Claude {target}: {error}')
        except Exception as error:
            state['sdk_failed'] = target
            report.append(f'🔴 Claude {target} не встал, остаётся {current}: {error}')
    image = __import__('re').search(r'ai-worker:([0-9.]+)-bb([0-9.]+)', (APP / 'gpt/web-runtime.mjs').read_text())
    codex_now, bb_now = (image.group(1), image.group(2)) if image else ('0', '0')
    # Codex (GPT) — сам: новый образ, проверка ходом, переключение в тишине, откат (worker-update.py).
    codex = latest('@openai/codex')
    if image and newer(codex, codex_now) and state.get('codex_failed') != codex:
        args = ['python3', str(APP / 'scripts/worker-update.py'), '--to', codex] + (['--check'] if CHECK else [])
        try:
            done = subprocess.run(args, capture_output=True, text=True, timeout=8 * 3600)
            result = json.loads((done.stdout.strip().splitlines() or ['{}'])[-1])
        except Exception as error:
            result = {'status': 'failed', 'error': str(error)}
        if result.get('status') == 'updated':
            state.pop('codex_failed', None)
            report.append(f'🟢 Codex (GPT) обновлён: {codex_now} → {codex}. Контейнеры пересозданы, проверочный ход прошёл. Откат: sh {result.get("rollback")}')
        elif result.get('status') == 'checked':
            report.append(f'🧪 Codex {codex}: образ собран и проверен, без переключения (--check).')
        elif result.get('status') == 'deferred':
            report.append(f'⏳ Codex {codex}: {result.get("error")}')
        elif result.get('status') != 'current':
            state['codex_failed'] = codex
            report.append(f'🔴 Codex {codex} не встал, остаётся {codex_now}: {str(result.get("error"))[:500]}')
    # bb — только сообщение: фронт собран из русской сборки исходников и пропатчен,
    # каждый патч сверяет точный код — на новой версии их нужно переносить руками.
    version = latest('bb-app')
    if newer(version, bb_now) and state.get('bb-app') != version:
        state['bb-app'] = version
        report.append(f'🆕 bb: вышла {version}, у нас {bb_now}. Сам не ставлю: фронт bb — русская сборка с патчами, их надо переносить на новую версию. Скажи Claude «обнови bb», когда будет удобно.')
    if not CHECK:
        save_state(state)
    if report:
        text = '🔄 Автообновление\n\n' + '\n\n'.join(report)
        log(text)
        if not CHECK:
            notify(text)
    else:
        log('обновлений нет')


if __name__ == '__main__':
    main()
