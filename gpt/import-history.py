#!/usr/bin/env python3
"""Idempotent import: preserve original session titles and owner boundaries."""
import datetime
import json
import hashlib
from pathlib import Path
import sqlite3
import time
import uuid

if Path('/opt/ai-bot/data/dialog-layout-v2.json').exists():
    raise SystemExit('History import closed after dialog storage migration')

root=Path('/opt/gpt-migration/history')
db=sqlite3.connect('/opt/ai-bot/data/bot.db',timeout=30)
db.row_factory=sqlite3.Row
original=sqlite3.connect('/opt/gpt-migration/original/data/bot.db')
original.row_factory=sqlite3.Row
old_chats=[dict(r) for r in original.execute('SELECT * FROM chats')]
titles_path=root/'original-titles.json'
if titles_path.exists():
    titles=json.loads(titles_path.read_text())
else:
    titles={}
    for p in Path('/opt/gpt-migration/original/claude-home/.claude/projects').glob('*/*.jsonl'):
        custom=automatic=None
        for line in p.open():
            try:r=json.loads(line)
            except ValueError:continue
            if r.get('type')=='custom-title' and r.get('customTitle'):custom=r['customTitle']
            if r.get('type')=='ai-title' and r.get('aiTitle'):automatic=r['aiTitle']
        fallback=next((c['title'] for c in old_chats if c['session_id']==p.stem and c['title']),None)
        titles[p.stem]={'title':custom or automatic or fallback,'source':'custom' if custom else 'ai' if automatic else 'chat'}
    titles_path.write_text(json.dumps(titles,ensure_ascii=False,indent=2))

ready=pending=0
for p in sorted(root.glob('*/*.json')):
    if not p.parent.name.isdigit():continue
    data=json.loads(p.read_text())
    uid=int(data['owner']);session=data['session']
    sid=str(uuid.uuid5(uuid.NAMESPACE_URL,f'gpt-migration:{uid}:{session}'))
    final=root/'summaries'/str(uid)/session/'summary.txt'
    coverage=final.parent/'coverage.json'
    # A one-part conversation is already complete as soon as its atomic checkpoint exists.
    part=final.parent/'part-001.txt'
    length=sum(len(f"\n[{r['role']} {r.get('at') or ''}; {r['source']}:{r['line']}]\n{r['text']}\n") for r in data['messages'])
    if not coverage.exists() and part.exists() and length<=120_000:
        final.write_text(part.read_text())
        coverage.write_text(json.dumps({'owner':uid,'session':session,'project':data['project'],'title':data['title'],
            'source_files':[f['path'] for f in data['files']],'source_messages':len(data['messages']),
            'chunks':1,'input_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'summary':str(final)},ensure_ascii=False))
    summary=final.read_text() if final.exists() and coverage.exists() else None
    if summary:
        sources='\n'.join('/home/agent/legacy-history/'+f['path'] for f in data['files'])
        summary+='\n\nПолные исходные транскрипты этого диалога (только для справки):\n'+sources
    if summary:ready+=1
    else:pending+=1
    title=titles.get(session,{}).get('title') or data['title'] or 'Диалог Claude'
    timestamps=[]
    for r in data['messages']:
        try:timestamps.append(int(datetime.datetime.fromisoformat(r['at'].replace('Z','+00:00')).timestamp()*1000))
        except (TypeError,ValueError,KeyError):pass
    created=min(timestamps) if timestamps else int(time.time()*1000)
    updated=max(timestamps) if timestamps else created
    db.execute('''INSERT INTO gpt_threads(id,user_id,project,title,summary,legacy_id,created_at,updated_at)
                  VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(user_id,legacy_id) WHERE legacy_id IS NOT NULL
                  DO UPDATE SET summary=COALESCE(excluded.summary,gpt_threads.summary)''',
               (sid,uid,data['project'],title,summary,session,created,updated))
    # Preserve titles a user has renamed in GPT; initial import uses exact original metadata.

for chat in old_chats:
    uid=chat['user_id'];session=chat['session_id']
    current=db.execute('SELECT id FROM gpt_threads WHERE user_id=? AND legacy_id=?',(uid,session)).fetchone() if session else None
    if not current:
        legacy=session or f'empty-chat-{chat["chat_id"]}'
        sid=str(uuid.uuid5(uuid.NAMESPACE_URL,f'gpt-migration:{uid}:{legacy}'))
        summary=('В исходном архиве отсутствует текст этого диалога. Сохранились только название и запись чата. Не восстанавливай содержание догадками.' if session else 'Этот чат существовал в старом боте, но сохранённой сессии и переписки у него нет.')
        db.execute('INSERT OR IGNORE INTO gpt_threads(id,user_id,project,title,summary,legacy_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                   (sid,uid,chat['project'],chat['title'] or 'Новый диалог',summary,legacy,chat['updated_at'],chat['updated_at']))
    else:sid=current['id']
    db.execute('INSERT OR IGNORE INTO gpt_active(user_id,thread_id) VALUES(?,?)',(uid,sid))
db.commit()
print(json.dumps({'summarized':ready,'pending':pending,'original_names':sum(bool(v['title']) for v in titles.values()),'total_imported':db.execute('SELECT count(*) FROM gpt_threads WHERE legacy_id IS NOT NULL').fetchone()[0]}))
