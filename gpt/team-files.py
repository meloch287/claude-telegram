import os,sys,re,json,uuid,stat,base64
DIR=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW

def folder(root,parts):
 fd=os.open(root,DIR)
 try:
  for name in parts:
   if not re.fullmatch(r'[A-Za-z0-9_.-]+',name) or name in ('.','..'):raise ValueError('Unsafe path')
   try:os.mkdir(name,0o770,dir_fd=fd)
   except FileExistsError:pass
   nxt=os.open(name,DIR,dir_fd=fd);os.close(fd);fd=nxt
  return fd
 except BaseException:os.close(fd);raise

def write(fd,name,data,mode=0o660):
 if not re.fullmatch(r'[A-Za-z0-9_.-]+',name) or name in ('.','..'):raise ValueError('Unsafe name')
 temp='.tmp-'+uuid.uuid4().hex
 out=os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,mode,dir_fd=fd)
 with os.fdopen(out,'wb') as f:f.write(data if isinstance(data,bytes) else data.encode())
 os.replace(temp,name,src_dir_fd=fd,dst_dir_fd=fd)

def main(uid,action,data,base='/app/workspaces'):
 if not re.fullmatch(r'[1-9][0-9]*',uid):raise ValueError('Invalid user')
 root=base+'/'+uid;parts=['AI-bot','User'+uid];fd=folder(root,parts)
 try:
  if action=='prepare':
   for group in ['GPT_BOT','Claude_BOT','Shared']:
    child=folder(root,parts+[group]);os.close(child)
   write(fd,'ai-team.py',data['client'])
   write(fd,'.ai-team.json',json.dumps({'userId':int(uid),'token':data['token'],'url':'http://172.30.0.1:8790/team'}))
   write(fd,'README.md',data['readme'])
   for configdir,filename,context in [('.claude','CLAUDE.md',data['instructions']),('.bb-codex','AGENTS.md',data['gptInstructions'])]:
    home=folder('/home/agent',[configdir])
    try:
     try:
      old=os.open(filename,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=home)
      with os.fdopen(old) as f:content=f.read(1024*1024+1)
      if len(content)>1024*1024:raise ValueError('Instructions too large')
     except FileNotFoundError:content=''
     content=re.sub(r'\n?<!-- ai-team -->.*?<!-- /ai-team -->','',content,flags=re.S).replace(context,'')
     write(home,filename,content+'\n<!-- ai-team -->\n'+context+'\n<!-- /ai-team -->\n')
    finally:os.close(home)
  elif action=='history':
   for engine in ['GPT_BOT','Claude_BOT']:
    out=folder(root,parts+[engine,'Chats'])
    try:
     records=[r for r in data['chats'] if r['engine']==engine];keep={'index.json'}
     for record in records:
      name=record['id']+'.md';keep.add(name);write(out,name,record['markdown'])
     write(out,'index.json',json.dumps([{k:v for k,v in r.items() if k!='markdown'} for r in records],ensure_ascii=False))
     for name in os.listdir(out):
      if name not in keep and (name.endswith('.md') or name.endswith('.json')):
       os.unlink(name,dir_fd=out)
    finally:os.close(out)
  elif action=='note':
   out=folder(root,parts+['Shared','Consultations'])
   try:write(out,data['id']+'.md',data['text'])
   finally:os.close(out)
  elif action=='image':
   did=data['dialog'];validate_id(did)
   source=folder(root,['.dialogs',did]);dest=folder(root,parts+['Shared','Images']);found=[]
   try:
    names=['result.png']+[n for n in os.listdir(source) if n.endswith(('.png','.webp','.jpg','.jpeg')) and n!='result.png']
    for name in names:
     try:f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=source)
     except FileNotFoundError:continue
     try:
      st=os.fstat(f)
      if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or not 32<=st.st_size<=49*1024*1024:continue
      b=b''
      while len(b)<st.st_size:
       c=os.read(f,min(1024*1024,st.st_size-len(b)))
       if not c:break
       b+=c
      ext='.png' if b.startswith(b'\x89PNG\r\n\x1a\n') else '.jpg' if b.startswith(b'\xff\xd8\xff') else '.webp' if b[:4]==b'RIFF' and b[8:12]==b'WEBP' else None
      if not ext:continue
      result=data['id']+ext;write(dest,result,b);found.append('Shared/Images/'+result);break
     finally:os.close(f)
   finally:os.close(source);os.close(dest)
   return {'files':found}
  else:raise ValueError('Unknown action')
  return {'ok':True}
 finally:os.close(fd)

def validate_id(value):
 if not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',value):raise ValueError('Invalid dialog')
if __name__=='__main__':
 try:print(json.dumps(main(*sys.argv[1:3],json.load(sys.stdin)),ensure_ascii=False))
 except Exception:print('Team file operation failed',file=sys.stderr);sys.exit(1)
