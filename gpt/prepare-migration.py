#!/usr/bin/env python3
"""Prepare isolated workspaces and a complete, owner-indexed history inventory."""
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess

os.umask(0o077)
source = Path('/opt/gpt-migration/original')
target = Path('/opt/ai-bot')
history = Path('/opt/gpt-migration/history')
history.mkdir(exist_ok=True)
(target/'data').mkdir(exist_ok=True)
db_path = target/'data/bot.db'
if not db_path.exists():
    src = sqlite3.connect(source/'data/bot.db')
    dst = sqlite3.connect(db_path)
    src.backup(dst)
    src.close()
    dst.close()
db = sqlite3.connect(db_path)
db.row_factory = sqlite3.Row
users = {str(r[0]) for r in db.execute('SELECT user_id FROM users')}
chats = [dict(r) for r in db.execute('SELECT * FROM chats')]
groups = {}
inventory = []
for file in sorted((source/'claude-home/.claude/projects').rglob('*.jsonl')):
    relative = file.relative_to(source/'claude-home/.claude/projects')
    match = re.fullmatch(r'-app-workspaces-(\d+)-(.+)', relative.parts[0])
    uid = match.group(1) if match and match.group(1) in users else None
    session = relative.parts[1] if len(relative.parts) > 2 else file.stem
    project = match.group(2) if match else 'maintenance'
    rows, seen, cwd_owners, first_user = [], set(), set(), ''
    digest = hashlib.sha256()
    line_count = malformed = 0
    with file.open('rb') as stream:
        for raw in stream:
            digest.update(raw)
            line_count += 1
            try:
                record = json.loads(raw)
            except (ValueError, UnicodeDecodeError):
                malformed += 1
                continue
            cwd_match = re.match(r'/app/workspaces/(\d+)(?:/|$)', record.get('cwd', ''))
            if cwd_match:
                cwd_owners.add(cwd_match.group(1))
                if uid == cwd_match.group(1):
                    actual = record['cwd'].split('/')[4:]
                    if actual:
                        project = actual[0]
            kind = record.get('type')
            if kind not in ('user', 'assistant', 'summary'):
                continue
            msg = record.get('message') or {}
            content = msg.get('content', []) if isinstance(msg, dict) else str(msg)
            if isinstance(content, str):
                content = [{'type': 'text', 'text': content}]
            parts = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                if block.get('type') == 'text':
                    parts.append(block.get('text', ''))
                elif block.get('type') == 'tool_use':
                    data = json.dumps(block.get('input', {}), ensure_ascii=False)
                    parts.append('[Tool action: ' + block.get('name', '') + '] ' + data[:1800] + (' [full input in raw history]' if len(data)>1800 else ''))
                elif block.get('type') == 'tool_result' and block.get('is_error'):
                    parts.append('[Tool error] ' + str(block.get('content', ''))[:6000])
            if kind == 'summary':
                parts.append(record.get('summary', ''))
            text = '\n'.join(x for x in parts if x).strip()
            identity = record.get('uuid') or hashlib.sha256((kind+text).encode()).hexdigest()
            if not text or identity in seen:
                continue
            seen.add(identity)
            if not first_user and kind == 'user' and not text.startswith('[Tool'):
                first_user = re.sub(r'\s+', ' ', text)[:100]
            rows.append({'role': kind, 'at': record.get('timestamp'), 'text': text,
                         'source': str(relative), 'line': line_count})
    # Ambiguous provenance never gets automatically granted to a tenant.
    if cwd_owners and cwd_owners != {uid}:
        uid = None
    item = {'path': str(relative), 'sha256': digest.hexdigest(), 'size': file.stat().st_size,
            'lines': line_count, 'malformed': malformed, 'owner': uid, 'session': session,
            'project': project, 'messages': len(rows)}
    inventory.append(item)
    group = groups.setdefault((uid, session), {'owner': uid, 'session': session, 'project': project, 'title': first_user or 'История Claude', 'files': [], 'messages': []})
    group['files'].append(item)
    group['messages'].extend(rows)
    if len(relative.parts) == 2:
        group['title'] = first_user or group['title']
    destination = (target/'tenants'/uid/'home/legacy-history'/relative) if uid else history/'unassigned'/relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.exists():
        shutil.copyfile(file, destination)
    destination.chmod(0o600)

for uid in sorted(users):
    tenant = target/'tenants'/uid
    (tenant/'home/.codex').mkdir(parents=True, exist_ok=True)
    workspace = tenant/'workspace'
    if not workspace.exists():
        original = source/'workspaces'/uid
        if original.is_dir():
            subprocess.run(['cp', '-a', '--reflink=auto', str(original), str(workspace)], check=True)
        else:
            workspace.mkdir()
    (workspace/'default').mkdir(exist_ok=True)
    subprocess.run(['chown', '-hR', '1000:1000', str(tenant/'home'), str(workspace)], check=True)
    tenant.chmod(0o700)

for (uid, session), group in groups.items():
    group['messages'].sort(key=lambda row: row.get('at') or '')
    out = history/(uid or 'unassigned-inputs')
    out.mkdir(exist_ok=True)
    (out/(session+'.json')).write_text(json.dumps(group, ensure_ascii=False))

present = {session for uid, session in groups if uid}
missing = [c for c in chats if c['session_id'] and c['session_id'] not in present]
report = {'files': inventory, 'groups': len(groups), 'assigned_groups': sum(uid is not None for uid, _ in groups),
          'known_users': sorted(users), 'missing_chats': missing,
          'unassigned_files': [x['path'] for x in inventory if not x['owner']]}
(history/'inventory.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
db.execute("UPDATE users SET model=CASE WHEN model LIKE '%haiku%' THEN 'gpt-6-luna' WHEN model LIKE '%opus%' OR model LIKE '%fable%' THEN 'gpt-6-astra' ELSE 'gpt-6-sol' END")
# Old encrypted Claude secrets remain in the immutable archive, not in the GPT service database.
db.execute('UPDATE users SET api_key_enc=NULL, auth_kind=NULL')
db.execute('DELETE FROM rate_limits')
db.commit()
print(json.dumps({k:v for k,v in report.items() if k!='files'},ensure_ascii=False,indent=2))
