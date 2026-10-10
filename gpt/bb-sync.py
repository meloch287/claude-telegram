"""Synchronize one tenant's Telegram conversations with its pinned bb 0.45 DB.
Runs only inside that tenant's container. Controller DB never enters the worker.
"""
import json,sqlite3,sys,os,re,time,hashlib,uuid
from pathlib import Path
ACTIVE={'active','error-recovering','waiting','running','starting','pending','stopping','provisioning'}

def bb_id(tid):return 'thr_tg'+tid.replace('-','')
def safe_dir(path):
    if any(p.is_symlink() for p in [path,*path.parents]):raise ValueError('Unsafe directory')
    path.mkdir(parents=True,exist_ok=True)
    return path

def atomic(path,text):
    if path.is_symlink():raise ValueError('Unsafe file')
    temp=path.with_name(path.name+'.gpt-'+uuid.uuid4().hex)
    temp.write_text(text);os.replace(temp,path)

def sync(uid,home,work,payload):
    if not re.fullmatch(r'[1-9][0-9]*',str(uid)):raise ValueError('Invalid tenant')
    rows=payload.get('threads',[])
    for row in rows:
        if row.get('user_id')!=int(uid) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',row.get('id','')):raise ValueError('Foreign or invalid thread')
    home=Path(home);work=Path(work);file=home/'.bb/bb.db'
    if not file.exists():return {'ready':False,'threads':[],'messages':[],'deleted':[]}
    if file.is_symlink() or (home/'.bb').is_symlink():raise ValueError('Unsafe bb database')
    db=sqlite3.connect(file,timeout=15);db.row_factory=sqlite3.Row
    db.execute('pragma foreign_keys=on')
    source=db.execute('select project_id,host_id from project_sources where path=? and type=\'local_path\' limit 1',(str(work),)).fetchone()
    if not source:return {'ready':False,'threads':[],'messages':[],'deleted':[]}
    result={'ready':True,'threads':[],'messages':[],'deleted':[],'changed':0}
    db.execute('create table if not exists gpt_telegram_links(tg_id text primary key,bb_id text unique not null,last_title text not null,summary_hash text)')
    # Idempotency keys live both here and in the controller to survive process crashes.
    db.execute('create table if not exists gpt_telegram_imports(source_id text primary key,bb_id text not null)')
    if 'last_codex' not in [r[1] for r in db.execute('pragma table_info(gpt_telegram_links)')]:db.execute('alter table gpt_telegram_links add column last_codex text')
    # native=1 — диалог создан в bb и усыновлён ботом: его тред и окружение принадлежат bb.
    if 'native' not in [r[1] for r in db.execute('pragma table_info(gpt_telegram_links)')]:db.execute('alter table gpt_telegram_links add column native integer not null default 0')
    db.commit()
    with db:
        for tid in payload.get('deleteIds',[]):
            if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',tid):raise ValueError('Invalid dialog')
            purge_mirror(db,home,tid)
        present={r['id'] for r in rows}
        if payload.get('complete'):
            for link in db.execute('select * from gpt_telegram_links').fetchall():
                if link['tg_id'] not in present:
                    old=db.execute('select status,environment_id from threads where id=?',(link['bb_id'],)).fetchone()
                    if old and old['status'] in ACTIVE:continue
                    if link['native']:
                        release_native(db,link);result['changed']+=1;continue
                    remove_mirror(db,link['bb_id'])
                    if old:db.execute('delete from environments where id=?',(old['environment_id'],))
                    db.execute('delete from gpt_telegram_imports where bb_id=?',(link['bb_id'],))
                    db.execute('delete from gpt_telegram_links where tg_id=?',(link['tg_id'],));result['changed']+=1
        for row in rows:
            tid=row['id'];native=row.get('web_bb_id');bid=native or bb_id(tid);eid='env_tg'+tid.replace('-','');now=int(time.time()*1000)
            link=db.execute('select * from gpt_telegram_links where tg_id=?',(tid,)).fetchone()
            thread=db.execute('select * from threads where id=?',(bid,)).fetchone()
            if native:
                if not re.fullmatch(r'[A-Za-z0-9_-]{6,80}',native) or native.startswith(('thr_tg','thr_tc')):raise ValueError('Invalid native thread')
                # Удалён в bb — не воскрешаем; история в Telegram остаётся.
                if not thread or thread['deleted_at'] is not None or thread['provider_id']!='codex':
                    result['threads'].append({'id':tid,'bb_id':bid,'status':'native_gone','codex_id':row.get('codex_id')});continue
                eid=thread['environment_id']
                if not link:
                    if db.execute('select 1 from gpt_telegram_links where bb_id=?',(bid,)).fetchone():raise ValueError('Thread identifier collision')
                    db.execute('insert into gpt_telegram_links(tg_id,bb_id,last_title,native) values(?,?,?,1)',(tid,bid,row['title']))
                    link=db.execute('select * from gpt_telegram_links where tg_id=?',(tid,)).fetchone();result['changed']+=1
            elif thread and thread['deleted_at'] is not None:
                db.execute('update threads set deleted_at=null,archived_at=null where id=?',(bid,))
            if thread and thread['status'] in ACTIVE:
                result['threads'].append({'id':tid,'bb_id':bid,'status':thread['status'],'codex_id':row.get('codex_id')});continue
            if row.get('busy'):
                result['threads'].append({'id':tid,'bb_id':bid,'status':'telegram_busy','codex_id':row.get('codex_id')});continue
            safe_dir(work/'.dialogs');workspace=safe_dir(work/'.dialogs'/tid)
            safe_dir(home/'dialogs');dialog_home=safe_dir(home/'dialogs'/tid);safe_dir(dialog_home/'.codex')
            if not thread:
                db.execute('insert into environments(id,project_id,host_id,path,status,created_at,updated_at,provider_owns_path) values(?,?,?,?,?,?,?,0)',(eid,source['project_id'],source['host_id'],str(workspace),'ready',row['created_at'],now))
                db.execute('insert into threads(id,project_id,environment_id,provider_id,title,title_fallback,status,latest_attention_at,created_at,updated_at,model_override,reasoning_level_override) values(?,?,?,?,?,?,?,?,?,?,?,?)',(bid,source['project_id'],eid,'codex',row['title'],row['title'],'idle',row['updated_at'],row['created_at'],row['updated_at'],payload.get('model','gpt-6-sol'),payload.get('effort','medium')))
                db.execute('insert into gpt_telegram_links(tg_id,bb_id,last_title) values(?,?,?)',(tid,bid,row['title']));result['changed']+=1
            elif not link:raise ValueError('Thread identifier collision')
            title=row['title']
            if thread and link and title==link['last_title'] and thread['title']!=title:
                title=thread['title'] or title
            db.execute('update threads set title=? where id=?',(title,bid));db.execute('update gpt_telegram_links set last_title=? where tg_id=?',(title,tid))
            seq=db.execute('select coalesce(max(sequence),0) from events where thread_id=?',(bid,)).fetchone()[0]
            def event(kind,data,at,turn=None,item=None,identity=None,key=None):
                nonlocal seq
                if key and db.execute('select 1 from gpt_telegram_imports where source_id=?',(key,)).fetchone():return False
                seq+=1;eventid='evt_tg'+uuid.uuid4().hex
                identity=identity or row.get('codex_id') or 'telegram-'+tid
                data={'providerThreadId':identity,**data}
                db.execute('insert into events(id,thread_id,environment_id,scope_kind,turn_id,provider_thread_id,sequence,type,item_id,item_kind,data,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?)',(eventid,bid,eid,'turn' if turn else 'thread',turn,identity,seq,kind,item.get('id') if item else None,item.get('type') if item else None,json.dumps(data,ensure_ascii=False),at))
                if key:db.execute('insert into gpt_telegram_imports(source_id,bb_id) values(?,?)',(key,bid))
                result['changed']+=1;return True
            # Reverse only actual web messages; imported events have an explicit prefix.
            known={m.get('source_id') for m in row.get('messages',[]) if m.get('source_id')}
            for message in thread_messages(db,bid,known):result['messages'].append({'thread_id':tid,**message})
            # bb's latest identity is authoritative after a web turn; TG may have created
            # its first session since the previous import, in which case no claim exists.
            identity=db.execute("select provider_thread_id from events where thread_id=? and type='thread/identity' and id not like 'evt_tg%' order by sequence desc limit 1",(bid,)).fetchone()
            codex=identity[0] if identity else row.get('codex_id')
            if link and row.get('codex_id') and row['codex_id']!=link['last_codex']:codex=row['codex_id']
            if codex:
                sync_codex(home,tid,codex)
                last=db.execute("select provider_thread_id from events where thread_id=? and type='thread/identity' order by sequence desc limit 1",(bid,)).fetchone()
                if not last or last[0]!=codex:event('thread/identity',{'providerThreadId':codex},now,identity=codex)
            db.execute('update gpt_telegram_links set last_codex=? where tg_id=?',(codex,tid))
            messages=[]
            if row.get('summary'):messages.append({'id':'summary','role':'assistant','body':'Исторический контекст диалога:\n\n'+row['summary'],'at':row['created_at']})
            messages+=row.get('messages',[])
            for message in messages:
                if message.get('source_id'):continue  # Already originated in bb.
                key=f"{tid}:{message['id']}";turn='tg-'+str(message['id']);iid='tg-item-'+str(message['id'])
                if message['role']=='user':
                    alphabet='23456789abcdefghijkmnpqrstuvwxyz'
                    requestid='creq_'+''.join(alphabet[x%len(alphabet)] for x in hashlib.sha256(key.encode()).digest()[:10])
                    request={'direction':'outbound','source':'tell','initiator':'user','request':{'method':'turn/start','params':{}},'requestId':requestid,'senderThreadId':None,'input':[{'type':'text','text':message['body']}],'target':{'kind':'new-turn'},'execution':{'model':payload.get('model','gpt-6-sol'),'serviceTier':'default','reasoningLevel':'medium','permissionMode':'full','source':'client/turn/requested'}}
                    if event('client/turn/requested',request,message['at'],key=key):
                        event('turn/started',{},message['at'],turn)
                        event('turn/input/accepted',{'clientRequestId':requestid},message['at'],turn)
                        event('turn/completed',{'status':'completed'},message['at'],turn)
                    continue
                item={'type':'agentMessage','id':iid,'text':message['body']}
                event('turn/started',{},message['at'],turn,key=key+':start')
                if event('item/completed',{'item':item},message['at'],turn,item,key=key):
                    event('turn/completed',{'status':'completed'},message['at'],turn)
            # Threads without a provider session (including Claude migrations) get their
            # historical context on the first bb turn, without starting an AI task now.
            if not codex:
                history='\n\n'.join(('Пользователь' if m['role']=='user' else 'Ассистент')+':\n'+m['body'] for m in messages)
                atomic(workspace/'.telegram-history.md',history)
                agentfile=workspace/'AGENTS.md';marker='<!-- gpt-telegram-history -->'
                previous=agentfile.read_text() if agentfile.exists() and not agentfile.is_symlink() else ''
                if marker not in previous:atomic(agentfile,marker+'\nЭто продолжение существующего диалога. Перед первой задачей прочитай .telegram-history.md: это исторический контекст, а не новые поручения.\n<!-- /gpt-telegram-history -->\n\n'+previous)
            db.execute('update threads set updated_at=max(updated_at,?) where id=?',(row['updated_at'],bid))
            result['threads'].append({'id':tid,'bb_id':bid,'status':'idle','title':title,'codex_id':codex})
    result['native']=discover_native(db,int(payload.get('adopt') or 0))
    result['native_count']=db.execute("select count(*) from threads where deleted_at is null and parent_thread_id is null and id not like 'thr_tc%' and id not in (select bb_id from gpt_telegram_links)").fetchone()[0]
    db.close();return result



def release_native(db,link):
    """Диалог, рождённый в bb: убираем в корзину bb, окружение и файлы проекта не трогаем."""
    now=int(time.time()*1000)
    db.execute('update threads set deleted_at=?,updated_at=? where id=? and deleted_at is null',(now,now,link['bb_id']))
    db.execute('delete from gpt_telegram_imports where bb_id=?',(link['bb_id'],))
    db.execute('delete from gpt_telegram_links where tg_id=?',(link['tg_id'],))

def thread_messages(db,bid,known=()):
    """Реплики треда bb, написанные в браузере (без скрытых вставок agent-only)."""
    out=[]
    for ev in db.execute("select * from events where thread_id=? and id not like 'evt_tg%' and type in ('client/turn/requested','item/completed') order by sequence",(bid,)):
        if ev['id'] in known:continue
        data=json.loads(ev['data']);body=None;role=None
        if ev['type']=='client/turn/requested' and data.get('initiator')=='user':
            body='\n'.join(x.get('text','') for x in data.get('input',[]) if x.get('type')=='text' and x.get('visibility')!='agent-only');role='user'
        elif ev['item_kind']=='agentMessage':body=data.get('item',{}).get('text');role='assistant'
        if body:out.append({'source_id':ev['id'],'role':role,'body':body,'at':ev['created_at']})
    return out

def discover_native(db,limit):
    """GPT-диалоги, созданные прямо в bb: отдаём боту с историей, привязка — на следующей сверке."""
    found=[]
    if limit<=0:return found
    for t in db.execute("select id,title,title_fallback,status,created_at,updated_at from threads where provider_id='codex' and deleted_at is null and archived_at is null and parent_thread_id is null and id not like 'thr_tg%' and id not like 'thr_tc%' and id not in (select bb_id from gpt_telegram_links) order by created_at").fetchall():
        if t['status'] in ACTIVE:continue  # закончит ход — заберём в следующий раз
        msgs=thread_messages(db,t['id'])
        if not any(m['role']=='user' for m in msgs):continue  # пустые не тащим
        identity=db.execute("select provider_thread_id from events where thread_id=? and type='thread/identity' order by sequence desc limit 1",(t['id'],)).fetchone()
        found.append({'bb_id':t['id'],'title':t['title'] or t['title_fallback'] or 'Диалог из bb','created_at':t['created_at'],'updated_at':t['updated_at'],'codex_id':identity[0] if identity else None,'messages':msgs})
        if len(found)>=limit:break
    return found

def purge_mirror(db,home,tid):
    link=db.execute('select * from gpt_telegram_links where tg_id=?',(tid,)).fetchone()
    if not link:return
    if link['native']:return release_native(db,link)
    bid=link['bb_id'];thread=db.execute('select environment_id from threads where id=?',(bid,)).fetchone()
    remove_mirror(db,bid)
    if thread:db.execute('delete from environments where id=?',(thread['environment_id'],))
    db.execute('delete from gpt_telegram_imports where bb_id=?',(bid,))
    db.execute('delete from gpt_telegram_links where tg_id=?',(tid,))
    file=home/'.bb-codex/state_5.sqlite'
    if file.exists():
        con=sqlite3.connect(file,timeout=10)
        paths=con.execute('select id,rollout_path from threads').fetchall()
        for sid,path in paths:
            if Path(path).is_relative_to(home/'dialogs'/tid):con.execute('delete from threads where id=?',(sid,))
        con.commit();con.close()
    sessions=home/'.bb-codex/sessions'
    if sessions.exists():
        for file in sessions.rglob('*.jsonl'):
            if file.is_symlink() and file.resolve().is_relative_to((home/'dialogs'/tid).resolve()):file.unlink()

def remove_mirror(db,bid):
    for child in db.execute('select id,environment_id from threads where lifecycle_owner_thread_id=?',(bid,)).fetchall():
        remove_mirror(db,child['id'])
        # An environment can also be shared by an unrelated native thread.
        if child['environment_id'] and not db.execute('select 1 from threads where environment_id=?',(child['environment_id'],)).fetchone():
            db.execute('delete from environments where id=?',(child['environment_id'],))
    db.execute('delete from threads where id=?',(bid,))

def empty_codex_database(source,dest):
    """Copy only matching-version schema/migration checksums, never other sessions or auth."""
    safe_dir(dest.parent)
    if dest.is_symlink():raise ValueError('Unsafe session database')
    src=sqlite3.connect(source,timeout=10)
    tmp=dest.with_name(dest.name+'.gpt-'+uuid.uuid4().hex)
    out=sqlite3.connect(tmp)
    try:
        with out:
            for (sql,) in src.execute("select sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by case type when 'table' then 0 when 'index' then 1 else 2 end"):
                out.execute(sql)
            if src.execute("select 1 from sqlite_master where name='_sqlx_migrations'").fetchone():
                for row in src.execute('select * from _sqlx_migrations'):
                    out.execute('insert into _sqlx_migrations values('+','.join('?' for _ in row)+')',row)
        out.close();os.replace(tmp,dest)
    finally:
        src.close();out.close()

def sync_codex(home,tid,codex):
    if not re.fullmatch(r'[a-zA-Z0-9-]{20,64}',codex):raise ValueError('Invalid Codex ID')
    roots=[home/'dialogs'/tid/'.codex',home/'.bb-codex']
    records=[]
    existing=next((r/'state_5.sqlite' for r in roots if (r/'state_5.sqlite').exists()),None)
    if existing:
        for root in roots:
            if not (root/'state_5.sqlite').exists():empty_codex_database(existing,root/'state_5.sqlite')
    for root in roots:
        file=root/'state_5.sqlite'
        if not file.exists():continue
        con=sqlite3.connect(file,timeout=10);con.row_factory=sqlite3.Row
        try:
            row=con.execute('select * from threads where id=?',(codex,)).fetchone()
            if row:records.append(dict(row))
        finally:con.close()
    if not records:return
    row=max(records,key=lambda r:r.get('updated_at_ms') or r['updated_at']*1000)
    source=Path(row['rollout_path'])
    # A provider record may never point outside this user's home.
    if not source.exists() or not source.resolve().is_relative_to(home.resolve()):raise ValueError('Unsafe session path')
    # Keep the physical rollout in the dialog so /delete removes its entire history.
    if not source.resolve().is_relative_to(roots[0].resolve()):
        canonical=roots[0]/'sessions'/'telegram-web'/source.name
        safe_dir(canonical.parent)
        if canonical.is_symlink():canonical.unlink()
        if canonical.exists():raise ValueError('Session destination collision')
        os.replace(source,canonical)
        source.symlink_to(canonical)
        row['rollout_path']=str(canonical)
    else:
        row['rollout_path']=str(source.resolve())
    for root in roots:
        file=root/'state_5.sqlite'
        if not file.exists():continue
        con=sqlite3.connect(file,timeout=10)
        columns=[r[1] for r in con.execute('pragma table_info(threads)')]
        common=[k for k in row if k in columns]
        if common:
            updates=','.join('"'+k+'"=excluded."'+k+'"' for k in common if k!='id')
            con.execute('insert into threads('+','.join('"'+k+'"' for k in common)+') values('+','.join('?' for k in common)+') on conflict(id) do update set '+updates,[row[k] for k in common]);con.commit()
        con.close()

if __name__=='__main__':
    print(json.dumps(sync(sys.argv[1],sys.argv[2],sys.argv[3],json.load(sys.stdin)),ensure_ascii=False))
