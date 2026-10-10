"""Зеркало Telegram-диалогов Claude в bb 0.45 одного пользователя (вкладка Claude).

Запускается только внутри контейнера пользователя:
  python3 -c <скрипт> <uid> /home/agent /app/workspaces/<uid>
stdin: {"sessions": [{id, title, createdAt, updatedAt, messages:[{key, role, body, at}]}],
        "ids": [все текущие id], "complete": true}

Односторонне: Telegram → bb. Сообщения добавляются по ключу один раз, ветки bb
называются thr_tc<id>. Продолжение в bb идёт отдельной сессией Claude Code в
своей папке; контекст ей даёт .telegram-history.md, на который указывает CLAUDE.md.
Ветку, которая сейчас работает в bb, не трогаем; исчезнувший в Telegram диалог
убираем из bb, если он не работает.
"""
import hashlib, json, os, re, sqlite3, sys, time, uuid
from pathlib import Path

ACTIVE = {'active', 'error-recovering', 'waiting', 'running', 'starting', 'pending', 'stopping', 'provisioning'}
ID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
MODEL = 'claude-sonnet-5'
BRIDGE = 'acp-tgclaude'  # Claude бота через мост; 'claude-code' — запасной, пока мост не настроен
MARKER = '<!-- claude-telegram-history -->'


def bb_id(sid):
    return 'thr_tc' + sid.replace('-', '')


def safe_dir(path):
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('Unsafe directory')
    path.mkdir(parents=True, exist_ok=True)
    return path


def atomic(path, text):
    if path.is_symlink():
        raise ValueError('Unsafe file')
    temp = path.with_name(path.name + '.tc-' + uuid.uuid4().hex)
    temp.write_text(text)
    os.replace(temp, path)


def remove(db, bid):
    row = db.execute('select status,environment_id from threads where id=?', (bid,)).fetchone()
    if row and row['status'] in ACTIVE:
        return False
    for child in db.execute('select id from threads where lifecycle_owner_thread_id=?', (bid,)).fetchall():
        remove(db, child['id'])
    db.execute('delete from threads where id=?', (bid,))
    if row and row['environment_id'] and not db.execute('select 1 from threads where environment_id=?', (row['environment_id'],)).fetchone():
        db.execute('delete from environments where id=?', (row['environment_id'],))
    db.execute('delete from claude_telegram_imports where bb_id=?', (bid,))
    db.execute('delete from claude_telegram_links where bb_id=?', (bid,))
    return True


def bb_messages(db, bid):
    """Реплики треда bb, написанные в браузере (без скрытых вставок agent-only)."""
    out = []
    for ev in db.execute("select * from events where thread_id=? and id not like 'evt_tc%' and type in ('client/turn/requested','item/completed') order by sequence", (bid,)):
        data = json.loads(ev['data'])
        if ev['type'] == 'client/turn/requested' and data.get('initiator') == 'user':
            body = '\n'.join(x.get('text', '') for x in data.get('input', []) if x.get('type') == 'text' and x.get('visibility') != 'agent-only')
            if body.strip():
                out.append({'role': 'user', 'body': body, 'at': ev['created_at']})
        elif ev['item_kind'] == 'agentMessage':
            body = (data.get('item') or {}).get('text')
            if body:
                out.append({'role': 'assistant', 'body': body, 'at': ev['created_at']})
    return out


def discover(db, limit):
    """Claude-диалоги, начатые в bb на «Claude Code» контейнера: бот перенесёт их к себе."""
    found = []
    if limit <= 0:
        return found
    for t in db.execute("""select id,title,title_fallback,status from threads where provider_id='claude-code' and deleted_at is null and archived_at is null
                           and parent_thread_id is null and id not like 'thr_tc%' and id not in (select bb_id from claude_telegram_links)
                           and id not in (select bb_id from claude_telegram_adopted) order by updated_at desc""").fetchall():
        if t['status'] in ACTIVE:
            continue
        messages = bb_messages(db, t['id'])
        if not any(m['role'] == 'user' for m in messages):
            continue
        found.append({'bb_id': t['id'], 'title': t['title'] or t['title_fallback'] or 'Диалог Claude из bb', 'messages': messages[-400:]})
        if len(found) >= limit:
            break
    return found


def mark(db, items, result):
    """Тред bb привязан к диалогу бота: дальше он идёт через мост, история не дублируется."""
    for item in items:
        bid, sid = str(item.get('bb_id', '')), str(item.get('session', ''))
        if not ID.match(sid) or not re.fullmatch(r'[A-Za-z0-9_-]{6,80}', bid):
            raise ValueError('Invalid adoption')
        thread = db.execute('select * from threads where id=?', (bid,)).fetchone()
        if not thread or thread['deleted_at'] is not None or thread['provider_id'] not in ('claude-code', BRIDGE):
            continue
        if db.execute('select 1 from claude_telegram_adopted where bb_id=?', (bid,)).fetchone():
            continue
        seq = db.execute('select coalesce(max(sequence),0) from events where thread_id=?', (bid,)).fetchone()[0] + 1
        now = int(time.time() * 1000)
        db.execute('insert into events(id,thread_id,environment_id,scope_kind,turn_id,provider_thread_id,sequence,type,item_id,item_kind,data,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?)',
                   ('evt_ad' + uuid.uuid4().hex, bid, thread['environment_id'], 'thread', None, sid, seq, 'thread/identity', None, None, json.dumps({'providerThreadId': sid}), now))
        db.execute('update threads set provider_id=?,model_override=NULL where id=?', (BRIDGE, bid))
        db.execute('insert into claude_telegram_adopted(bb_id,session_id) values(?,?)', (bid, sid))
        result['marked'].append(bid)


def sync(uid, home, work, payload):
    if not re.fullmatch(r'[1-9][0-9]*', str(uid)):
        raise ValueError('Invalid tenant')
    home, work = Path(home), Path(work)
    file = home / '.bb/bb.db'
    if not file.exists():
        return {'ready': False}
    if file.is_symlink() or (home / '.bb').is_symlink():
        raise ValueError('Unsafe bb database')
    db = sqlite3.connect(file, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('pragma foreign_keys=on')
    source = db.execute("select project_id,host_id from project_sources where path=? and type='local_path' limit 1", (str(work),)).fetchone()
    if not source:
        return {'ready': False}
    db.execute('create table if not exists claude_telegram_links(session_id text primary key,bb_id text unique not null,last_title text not null)')
    db.execute('create table if not exists claude_telegram_imports(source_id text primary key,bb_id text not null)')
    # Треды bb, перенесённые в бота: история уже есть в bb, из Telegram её не дублируем.
    db.execute('create table if not exists claude_telegram_adopted(bb_id text primary key,session_id text unique not null)')
    db.commit()
    result = {'ready': True, 'threads': [], 'removed': [], 'changed': 0, 'marked': [], 'native': []}
    with db:
        mark(db, payload.get('mark', []), result)
        if payload.get('provider') == BRIDGE and db.execute("select 1 from sqlite_master where name='project_execution_defaults'").fetchone():
            # Настройки проекта, запомненные от «Claude Code» (режим auto и т.п.), Claude бота
            # не принимает — новые сообщения отклонялись. Переводим их на мост.
            moved = db.execute("update project_execution_defaults set provider_id=?,model='default',permission_mode=case when permission_mode in ('accept-edits','full') then permission_mode else 'full' end,updated_at=? where provider_id='claude-code'",
                               (BRIDGE, int(time.time() * 1000))).rowcount
            result['changed'] += moved
        if payload.get('provider') == BRIDGE:
            # Прошлые ходы чатов, пришедших от «Claude Code», записаны с режимом auto: bb берёт
            # режим из последнего хода (повтор, очередь) и отклоняет сообщение. Исправляем запись.
            fixed = db.execute("""update events set data=json_set(data,'$.execution.permissionMode','full')
                where type in ('client/turn/requested','client/thread/start','client/turn/start') and thread_id in (select id from threads where provider_id=?)
                and json_extract(data,'$.execution.permissionMode') is not null
                and json_extract(data,'$.execution.permissionMode') not in ('accept-edits','full')""", (BRIDGE,)).rowcount
            result['changed'] += fixed
        ids = [i for i in payload.get('ids', []) if ID.match(str(i))]
        if payload.get('complete'):
            for link in db.execute('select * from claude_telegram_links').fetchall():
                if link['session_id'] not in ids and remove(db, link['bb_id']):
                    result['removed'].append(link['session_id'])
        provider = payload.get('provider') if payload.get('provider') in (BRIDGE, 'claude-code') else 'claude-code'
        for row in payload.get('sessions', []):
            sid = str(row.get('id', ''))
            if not ID.match(sid):
                raise ValueError('Invalid dialog')
            bid, eid, now = bb_id(sid), 'env_tc' + sid.replace('-', ''), int(time.time() * 1000)
            link = db.execute('select * from claude_telegram_links where session_id=?', (sid,)).fetchone()
            if not link:
                # Диалог, начатый в самом bb через мост: у его ветки уже есть этот id сессии.
                native = db.execute("select thread_id from events where type='thread/identity' and provider_thread_id=? and id not like 'evt_tc%' order by sequence desc limit 1", (sid,)).fetchone()
                if native and db.execute('select 1 from threads where id=? and deleted_at is null', (native['thread_id'],)).fetchone():
                    title = str(row.get('title') or 'Диалог Claude')[:120]
                    db.execute('insert into claude_telegram_links(session_id,bb_id,last_title) values(?,?,?)', (sid, native['thread_id'], title))
                    link = db.execute('select * from claude_telegram_links where session_id=?', (sid,)).fetchone()
            if link:
                bid = link['bb_id']
            thread = db.execute('select * from threads where id=?', (bid,)).fetchone()
            if thread and not link:
                raise ValueError('Thread identifier collision')
            if thread:
                eid = thread['environment_id'] or eid
            if thread and thread['status'] in ACTIVE:
                result['threads'].append({'id': sid, 'bb_id': bid, 'status': thread['status']})
                continue
            if thread and thread['deleted_at'] is not None:
                db.execute('update threads set deleted_at=null,archived_at=null where id=?', (bid,))
            safe_dir(work / '.dialogs')
            workspace = safe_dir(work / '.dialogs' / ('claude-' + sid))
            title = str(row.get('title') or 'Диалог Claude')[:120]
            if not thread:
                created = int(row.get('createdAt') or now)
                # Старые отметки «уже перенесено» без самих событий — иначе зеркало вернётся пустым.
                if not db.execute('select 1 from events where thread_id=? limit 1', (bid,)).fetchone():
                    db.execute('delete from claude_telegram_imports where bb_id=?', (bid,))
                # Тред могли удалить в bb, а окружение осталось: берём его, иначе вставка
                # падала на уникальности пути и синхронизация вставала для всех диалогов.
                env = db.execute('select id from environments where id=? or (project_id=? and host_id=? and path=?)',
                                 (eid, source['project_id'], source['host_id'], str(workspace))).fetchone()
                if env:
                    eid = env['id']
                    db.execute("update environments set status='ready',updated_at=? where id=?", (now, eid))
                else:
                    db.execute('insert into environments(id,project_id,host_id,path,status,created_at,updated_at,provider_owns_path) values(?,?,?,?,?,?,?,0)',
                               (eid, source['project_id'], source['host_id'], str(workspace), 'ready', created, now))
                db.execute('insert into threads(id,project_id,environment_id,provider_id,title,title_fallback,status,latest_attention_at,created_at,updated_at,model_override,visibility) values(?,?,?,?,?,?,?,?,?,?,?,?)',
                           (bid, source['project_id'], eid, provider, title, title, 'idle', created, created, created, None if provider == BRIDGE else MODEL, 'visible'))
                db.execute('insert into claude_telegram_links(session_id,bb_id,last_title) values(?,?,?) on conflict(session_id) do update set bb_id=excluded.bb_id,last_title=excluded.last_title', (sid, bid, title))
                result['changed'] += 1
            elif link['last_title'] != title:
                # Переименование в bb главнее: меняем название, только если его не трогали.
                if thread['title'] == link['last_title']:
                    db.execute('update threads set title=? where id=?', (title, bid))
                db.execute('update claude_telegram_links set last_title=? where session_id=?', (title, sid))
            if thread and thread['provider_id'] != provider and bid.startswith('thr_tc'):
                db.execute('update threads set provider_id=?,model_override=? where id=?', (provider, None if provider == BRIDGE else MODEL, bid))
            seq = db.execute('select coalesce(max(sequence),0) from events where thread_id=?', (bid,)).fetchone()[0]
            # Ходы, сделанные в bb через мост, уже есть в ветке: их записи из истории Telegram пропускаем.
            windows, start = [], None
            for ev in db.execute("select type,created_at from events where thread_id=? and id not like 'evt_tc%' and type in ('client/turn/requested','turn/completed') order by sequence", (bid,)):
                if ev['type'] == 'client/turn/requested':
                    start = ev['created_at']
                elif start is not None:
                    windows.append((start - 3000, ev['created_at'] + 3000))
                    start = None

            def event(kind, data, at, turn=None, item=None, key=None):
                nonlocal seq
                if key and db.execute('select 1 from claude_telegram_imports where source_id=?', (key,)).fetchone():
                    return False
                seq += 1
                body = {'providerThreadId': 'telegram-' + sid, **data}
                db.execute('insert into events(id,thread_id,environment_id,scope_kind,turn_id,provider_thread_id,sequence,type,item_id,item_kind,data,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?)',
                           ('evt_tc' + uuid.uuid4().hex, bid, eid, 'turn' if turn else 'thread', turn, body['providerThreadId'], seq, kind,
                            item.get('id') if item else None, item.get('type') if item else None,
                            json.dumps(body, ensure_ascii=False), at))
                if key:
                    db.execute('insert into claude_telegram_imports(source_id,bb_id) values(?,?)', (key, bid))
                result['changed'] += 1
                return True

            if provider == BRIDGE:
                event('thread/identity', {'providerThreadId': sid}, now, key=f'{sid}:identity:{BRIDGE}')
            messages = row.get('messages', [])
            if db.execute('select 1 from claude_telegram_adopted where bb_id=?', (bid,)).fetchone():
                # Перенесённый тред: вся переписка уже в bb, служебный ход переноса не показываем.
                for message in messages:
                    db.execute('insert or ignore into claude_telegram_imports(source_id,bb_id) values(?,?)', (f"{sid}:{message['key']}", bid))
                messages = []
            for message in messages:
                key = f"{sid}:{message['key']}"
                at = int(message.get('at') or now)
                if any(a <= at <= b for a, b in windows):
                    if not db.execute('select 1 from claude_telegram_imports where source_id=?', (key,)).fetchone():
                        db.execute('insert into claude_telegram_imports(source_id,bb_id) values(?,?)', (key, bid))
                    continue
                tag = hashlib.sha256(key.encode()).hexdigest()[:16]
                turn = 'tc-' + tag
                if message['role'] == 'user':
                    alphabet = '23456789abcdefghijkmnpqrstuvwxyz'
                    requestid = 'creq_' + ''.join(alphabet[x % len(alphabet)] for x in hashlib.sha256(key.encode()).digest()[:10])
                    request = {'direction': 'outbound', 'source': 'tell', 'initiator': 'user', 'request': {'method': 'turn/start', 'params': {}},
                               'requestId': requestid, 'senderThreadId': None, 'input': [{'type': 'text', 'text': message['body'], 'mentions': []}],
                               'target': {'kind': 'new-turn'},
                               'execution': {'model': MODEL, 'serviceTier': 'default', 'reasoningLevel': 'medium', 'permissionMode': 'full', 'source': 'client/turn/requested'}}
                    if event('client/turn/requested', request, at, key=key):
                        event('turn/started', {}, at, turn)
                        event('turn/input/accepted', {'clientRequestId': requestid}, at, turn)
                        event('turn/completed', {'status': 'completed'}, at, turn)
                    continue
                item = {'type': 'agentMessage', 'id': 'tc-item-' + tag, 'text': message['body']}
                event('turn/started', {}, at, turn, key=key + ':start')
                if event('item/completed', {'item': item}, at, turn, item, key=key):
                    event('turn/completed', {'status': 'completed'}, at, turn)
            if messages:
                history = '\n\n'.join(('Пользователь' if m['role'] == 'user' else 'Claude') + ':\n' + m['body'] for m in messages)
                atomic(workspace / '.telegram-history.md', history)
                note = workspace / 'CLAUDE.md'
                previous = note.read_text() if note.exists() and not note.is_symlink() else ''
                if MARKER not in previous:
                    atomic(note, MARKER + '\nЭто продолжение диалога из Telegram-бота. Перед первой задачей прочитай .telegram-history.md: это прошлая переписка, а не новые поручения. Файлы того диалога в эту папку не переносились.\n<!-- /claude-telegram-history -->\n\n' + previous)
            updated = int(row.get('updatedAt') or now)
            db.execute('update threads set updated_at=max(updated_at,?),latest_attention_at=max(latest_attention_at,?) where id=?', (updated, updated, bid))
            result['threads'].append({'id': sid, 'bb_id': bid, 'status': 'idle'})
        result['native'] = discover(db, int(payload.get('adopt') or 0))
    db.close()
    return result


if __name__ == '__main__':
    print(json.dumps(sync(sys.argv[1], sys.argv[2], sys.argv[3], json.load(sys.stdin)), ensure_ascii=False))
