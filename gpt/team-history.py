import json,os,stat,sqlite3,sys,hashlib
from pathlib import Path

def safe_root(path):
 p=Path(path)
 if any(x.is_symlink() for x in [p,*p.parents]):raise ValueError('Unsafe history path')
 return p

def text_content(content):
 if isinstance(content,str):return content
 if not isinstance(content,list):return ''
 return '\n'.join(b.get('text','') for b in content if isinstance(b,dict) and b.get('type')=='text')

def claude(home):
 base=safe_root(Path(home)/'.claude/projects');chats=[]
 if not base.exists():return []
 for project in base.iterdir():
  if project.is_symlink() or not project.is_dir():continue
  for file in project.glob('*.jsonl'):
   fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
   try:
    st=os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_size>100*1024*1024:continue
    messages=[]
    with os.fdopen(os.dup(fd),encoding='utf-8') as stream:
     for line in stream:
      if len(line)>4*1024*1024:continue
      try:r=json.loads(line)
      except ValueError:continue
      if r.get('type') not in ('user','assistant') or r.get('isMeta'):continue
      m=r.get('message',{});body=text_content(m.get('content'))
      if body:messages.append({'role':r['type'],'body':body[:64000],'at':r.get('timestamp')})
    if messages:chats.append({'id':'claude-'+file.stem,'engine':'Claude_BOT','title':messages[0]['body'][:90],'source':'Claude Telegram','messages':messages,'updatedAt':int(st.st_mtime*1000)})
   finally:os.close(fd)
 return chats

def bb(home):
 file=safe_root(Path(home)/'.bb/bb.db')
 if not file.exists():return []
 db=sqlite3.connect('file:'+str(file)+'?mode=ro',uri=True,timeout=5);db.row_factory=sqlite3.Row
 chats=[]
 # Усыновлённые ботом диалоги bb уже есть в истории Telegram — не дублируем.
 linked=" and id not in (select bb_id from gpt_telegram_links)" if db.execute("select 1 from sqlite_master where name='gpt_telegram_links'").fetchone() else ""
 for row in db.execute("select id,provider_id,title,updated_at from threads where deleted_at is null and storage_deleted_at is null and id not like 'thr_tg%' and id not like 'thr_tc%'"+linked+" order by updated_at desc limit 500"):
  engine='Claude_BOT' if 'claude' in row['provider_id'] else 'GPT_BOT' if 'codex' in row['provider_id'] else None
  if not engine:continue
  messages=[]
  for ev in db.execute("select type,item_kind,data,created_at from events where thread_id=? and type in ('client/turn/requested','item/completed') order by sequence",(row['id'],)):
   try:data=json.loads(ev['data'])
   except ValueError:continue
   role=None;body=''
   if ev['type']=='client/turn/requested' and data.get('initiator')=='user':
    body='\n'.join(x.get('text','') for x in data.get('input',[]) if x.get('type')=='text' and x.get('visibility')!='agent-only');role='user'
   elif ev['item_kind']=='agentMessage':body=data.get('item',{}).get('text','');role='assistant'
   if body:messages.append({'role':role,'body':body[:64000],'at':ev['created_at']})
  if messages:chats.append({'id':'bb-'+row['id'],'engine':engine,'title':row['title'] or messages[0]['body'][:90],'source':'bb','messages':messages,'updatedAt':row['updated_at']})
 return chats
if __name__=='__main__':
 try:
  result=(claude if sys.argv[1]=='claude' else bb)(sys.argv[2]);print(json.dumps(result,ensure_ascii=False))
 except Exception:print('History export failed',file=sys.stderr);sys.exit(1)
