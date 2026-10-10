"""Выгрузка Telegram-диалогов Claude владельца для зеркала в bb.

Запускается ОТ ИМЕНИ пользователя (uid его Claude Code) на хосте:
  python3 claude-bb-export.py <home> <workspace-root>
stdin: {"known": {"<session-id>": <mtime_ms>}} — уже выгруженные версии.
stdout: [{id, mtime, title, cwd, createdAt, updatedAt, messages}]; неизменённые
диалоги приходят как {id, mtime, unchanged: true} без чтения файла. Диалог — сессия, чья папка лежит прямо в workspace-root,
как в /resume бота. Берутся только тексты человека и ответов, без служебных записей.
"""
import json, os, re, stat, sys
from datetime import datetime
from pathlib import Path

ID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
REMINDER = re.compile(r'<system-reminder>.*?</system-reminder>', re.S)
MAX_MESSAGES, MAX_BODY = 400, 20000


def ms(value):
    try:
        return int(datetime.fromisoformat(str(value).replace('Z', '+00:00')).timestamp() * 1000)
    except ValueError:
        return None


def text_of(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ''
    return '\n'.join(b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text')


def read(file, root, full):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_size > 200 * 1024 * 1024:
            return None
        info = {'id': file.stem, 'mtime': int(st.st_mtime * 1000), 'cwd': None, 'createdAt': None}
        custom = ai = first = None
        messages = []
        with os.fdopen(os.dup(fd), encoding='utf-8', errors='replace') as stream:
            for line in stream:
                if len(line) > 8 * 1024 * 1024:
                    continue
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                kind = r.get('type')
                if kind == 'custom-title' and r.get('customTitle'):
                    custom = r['customTitle']
                elif kind == 'ai-title' and r.get('aiTitle'):
                    ai = r['aiTitle']
                if kind not in ('user', 'assistant') or r.get('isMeta') or r.get('isSidechain') or r.get('isCompactSummary'):
                    continue
                if info['cwd'] is None and r.get('cwd'):
                    info['cwd'] = r['cwd']
                at = ms(r.get('timestamp'))
                if info['createdAt'] is None:
                    info['createdAt'] = at
                body = REMINDER.sub('', text_of((r.get('message') or {}).get('content'))).strip()
                if not body:
                    continue
                if kind == 'user' and first is None:
                    first = body
                if full:
                    messages.append({'key': str(r.get('uuid') or len(messages)), 'role': kind, 'body': body[:MAX_BODY], 'at': at or info['mtime']})
        if not info['cwd'] or os.path.dirname(os.path.realpath(info['cwd'])) != root:
            return None
        if first is None:
            return None
        info['title'] = (custom or ai or first.split('\n', 1)[0])[:120]
        info['createdAt'] = info['createdAt'] or info['mtime']
        info['updatedAt'] = max(info['mtime'], messages[-1]['at'] if messages else 0)
        if full:
            info['messages'] = messages[-MAX_MESSAGES:]
        return info
    finally:
        os.close(fd)


def export(home, root, known):
    base = Path(home) / '.claude/projects'
    if base.is_symlink() or not base.is_dir():
        return []
    root = os.path.realpath(root)
    out = []
    for project in base.iterdir():
        if project.is_symlink() or not project.is_dir():
            continue
        for file in project.glob('*.jsonl'):
            if not ID.match(file.stem) or file.is_symlink():
                continue
            mtime = int(file.stat().st_mtime * 1000)
            if known.get(file.stem) == mtime:
                out.append({'id': file.stem, 'mtime': mtime, 'unchanged': True})
                continue
            row = read(file, root, True)
            if row:
                out.append(row)
    return out


if __name__ == '__main__':
    job = json.loads(sys.stdin.read() or '{}')
    print(json.dumps(export(sys.argv[1], sys.argv[2], job.get('known') or {}), ensure_ascii=False))
