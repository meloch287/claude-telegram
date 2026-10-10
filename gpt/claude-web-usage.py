import json,os,sys,stat,datetime,time
from pathlib import Path

def collect(home):
 root=Path(home)/'.claude/projects'
 if not root.exists():return []
 if any(p.is_symlink() for p in [root,*root.parents]):raise ValueError('Unsafe path')
 events={};cutoff=time.time()-7*86400
 for project in root.iterdir():
  if project.is_symlink() or not project.is_dir():continue
  for file in project.glob('*.jsonl'):
   fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
   try:
    st=os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_size>100*1024*1024:raise ValueError('Unsafe transcript')
    if st.st_mtime<cutoff:continue
    with os.fdopen(os.dup(fd),encoding='utf-8') as stream:
     for line in stream:
      if len(line)>4*1024*1024:continue
      try:
       row=json.loads(line);m=row.get('message',{});u=m.get('usage',{});eid=m.get('id')
       if row.get('type')!='assistant' or not eid or not u:continue
       at=int(datetime.datetime.fromisoformat(row['timestamp'].replace('Z','+00:00')).timestamp()*1000)
       if at<cutoff*1000:continue
       tokens=int(u.get('input_tokens',0))+int(u.get('output_tokens',0))
       if eid not in events or events[eid]['tokens']<tokens:events[eid]={'id':eid,'at':at,'tokens':tokens}
      except (ValueError,TypeError,KeyError):continue
   finally:os.close(fd)
 return list(events.values())
if __name__=='__main__':print(json.dumps(collect(sys.argv[1])))
