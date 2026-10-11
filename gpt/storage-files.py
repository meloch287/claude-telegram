"""Host-side Btrfs data accounting. Every tenant-controlled directory uses openat/no-follow.
Counts compressed extents once per tenant, including reflinked copies. Filesystem
metadata and the shared container image are not charged to an individual user.
"""
import os,sys,json,stat,struct,fcntl,ctypes,shutil,errno,re
DIR=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
FILE=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK
SEARCH_V2=0xc0709411
U64=(1<<64)-1
FALLBACK_BLOCKS=False
class Accounting:
 def __init__(self):
  self.extents={};self.referenced=0;self.cats={};self.owners={}
 def add(self,extents,logical,category,dialog):
  self.referenced+=logical
  cat=1<<self.cats.setdefault(category,len(self.cats))
  owner=1<<self.owners.setdefault(dialog,len(self.owners)) if dialog else 0
  for key,size in extents:
   item=self.extents.get(key)
   if item is None:self.extents[key]=[size,cat,owner]
   else:item[1]|=cat;item[2]|=owner
 def result(self):
  categories={};dialogs={};total=0;cats=list(self.cats);owners=list(self.owners)
  for size,mask,owner_mask in self.extents.values():
   total+=size;cat=cats[mask.bit_length()-1] if mask&(mask-1)==0 else 'shared'
   categories[cat]=categories.get(cat,0)+size
   while owner_mask:
    bit=owner_mask&-owner_mask;owner=owners[bit.bit_length()-1]
    dialogs[owner]=dialogs.get(owner,0)+size;owner_mask-=bit
  # Служебное bb в квоту не идёт: человек не может ни увидеть, ни удалить его.
  counted=max(0,total-categories.get('service',0))
  return dict(bytes=counted,physicalBytes=total,referencedBytes=self.referenced,categories=categories,dialogs=dialogs,method='allocated-blocks-by-inode' if FALLBACK_BLOCKS else 'btrfs-unique-compressed-extents')
def parse_extent(data,inode,offset):
 if len(data)<21:raise ValueError('Invalid extent header')
 kind=data[20]
 if kind==0:return ('inline:%s:%s'%(inode,offset),len(data)-21)
 if kind not in (1,2) or len(data)!=53:raise ValueError('Invalid regular extent')
 physical,size=struct.unpack_from('<QQ',data,21)
 return ('extent:'+str(physical),size) if physical else None
def measure_file(fd,st):
 result=[];offset=0
 while True:
  # Linux btrfs_ioctl_search_args_v2: 104-byte key + 8-byte buffer size.
  buf=bytearray(112+65536)
  struct.pack_into('=7Q4I5Q',buf,0,0,st.st_ino,st.st_ino,offset,U64,0,U64,108,108,0xffffffff,0,0,0,0,0,65536)
  try:fcntl.ioctl(fd,SEARCH_V2,buf,True)
  except OSError as error:
   if error.errno not in (errno.ENOTTY,errno.EOPNOTSUPP,errno.EINVAL):raise
   global FALLBACK_BLOCKS
   FALLBACK_BLOCKS=True
   return [('inode:%s:%s'%(st.st_dev,st.st_ino),st.st_blocks*512)]
  count=struct.unpack_from('=I',buf,64)[0]
  if count==0:break
  pos=112
  for _ in range(count):
   _,inode,offset,kind,size=struct.unpack_from('=QQQII',buf,pos);pos+=32
   if inode!=st.st_ino or kind!=108 or pos+size>len(buf):raise ValueError('Invalid Btrfs search result')
   item=parse_extent(buf[pos:pos+size],inode,offset);pos+=size
   if item:result.append(item)
  # At most 512 maximum-size metadata items fit well below our 64 KiB buffer.
  if count<=512 or offset==U64:break
  offset+=1
 return result
# В домашней папке Claude не трогаем настройки входа и GitHub — только окружения и программы.
CLAUDE_KEEP={'.claude','.claude.json','.gitconfig','.ssh','.config','.bashrc','.profile','.bash_logout'}
def bb_copy(parts):
 """Копия проекта, которую bb сделал для треда (окружение «личная рабочая папка» и т. п.):
 home/.bb/plugins/environment-*/host-data/workspaces/<тред>/…"""
 return len(parts)>7 and parts[0]=='home' and parts[1]=='.bb' and parts[2]=='plugins' and parts[3].startswith('environment-') and parts[4]=='host-data' and parts[5]=='workspaces'
def classify(parts):
 dialog=None
 if parts[0]=='claude-work':
  if len(parts)>1 and re.fullmatch(r'dialog-[0-9a-f-]{36}',parts[1]):dialog='claude-'+parts[1][7:]
  return ('cache' if any(p in ('.cache','.npm','.tmp','__pycache__') for p in parts) else 'uploads' if 'вложения' in parts else 'projects'),dialog
 if parts[0]=='claude-home':
  if re.fullmatch(r'[0-9a-f-]{36}\.(jsonl|txt)',parts[-1]):dialog='claude-'+parts[-1].split('.')[0]
  # Окружения и программы, которые Claude ставил по просьбе человека (.mamba, .local, venv…):
  # видны отдельной строкой и удаляются кнопкой — Claude поставит их снова.
  return ('cache' if any(p in ('.cache','.npm','tmp') for p in parts) else 'claude_history' if '.claude' in parts or len(parts)==2 and parts[1] in CLAUDE_KEEP else 'claude_env'),dialog
 if bb_copy(parts):return 'bb_copies','bb:'+parts[6]
 if len(parts)>2 and ((parts[0]=='home' and parts[1]=='dialogs') or (parts[0]=='workspace' and parts[1]=='.dialogs')):dialog=parts[2]
 if parts[0]=='home' and ((len(parts)>1 and parts[1] in ('.cache','.npm','tmp')) or (len(parts)>3 and parts[1]=='dialogs' and parts[3] in ('.cache','.npm','tmp'))):cat='cache'
 elif '.uploads' in parts:cat='uploads'
 elif '.codex' in parts:cat='history'
 elif parts[0]=='workspace':cat='projects'
 # Остальное в домашней папке контейнера — сам bb и его программы (база, плагины,
 # Claude Code, npm). Человек на это не влияет, в квоту не идёт (см. counted).
 elif parts[0]=='home':cat='service'
 else:cat='other'
 return cat,dialog
def scan(root,measure=measure_file,sync=True,account=None,prefix=None):
 fd=os.open(root,DIR)
 try:
  if sync:
   libc=ctypes.CDLL(None,use_errno=True)
   if libc.syncfs(fd)!=0:raise OSError(ctypes.get_errno(),'syncfs')
  device=os.fstat(fd).st_dev;account=account or Accounting();seen={}
  def walk(parent,parts):
   for name in os.listdir(parent):
    try:
     st=os.stat(name,dir_fd=parent,follow_symlinks=False)
     if st.st_dev!=device or stat.S_ISLNK(st.st_mode):continue
     if stat.S_ISDIR(st.st_mode):
      child=os.open(name,DIR,dir_fd=parent)
      try:walk(child,parts+[name])
      finally:os.close(child)
     elif stat.S_ISREG(st.st_mode):
      child=os.open(name,FILE,dir_fd=parent)
      try:
       actual=os.fstat(child)
       if not stat.S_ISREG(actual.st_mode) or actual.st_dev!=device:continue
       key=(actual.st_dev,actual.st_ino)
       extents=seen.get(key)
       if extents is None:
        extents=measure(child,actual)
        if actual.st_nlink>1:seen[key]=extents
       category,dialog=classify(parts+[name])
       account.add([(str(actual.st_dev)+":"+key,size) for key,size in extents],actual.st_size,category,dialog)
      finally:os.close(child)
    except FileNotFoundError:continue
  walk(fd,prefix or [])
  return account.result()
 finally:os.close(fd)
def directory(root,parts):
 fd=os.open(root,DIR)
 try:
  for name in parts:
   child=os.open(name,DIR,dir_fd=fd);os.close(fd);fd=child
  return fd
 except BaseException:os.close(fd);raise
def remove(parent,name):
 try:
  st=os.stat(name,dir_fd=parent,follow_symlinks=False)
  if stat.S_ISDIR(st.st_mode):shutil.rmtree(name,dir_fd=parent)
  else:os.unlink(name,dir_fd=parent)
 except FileNotFoundError:pass
def clean(root,action):
 if action not in ('cache','bb_copies'):raise ValueError('Invalid cleanup')
 if not shutil.rmtree.avoids_symlink_attacks:raise RuntimeError('Safe rmtree required')
 # The controller stops this user's entire process tree before calling clean.
 for top in ('home','workspace'):
  try:fd=directory(root,[top])
  except FileNotFoundError:continue
  try:
   if action=='bb_copies':
    if top=='home':clean_bb_copies(fd)
   elif top=='home':
    for name in ('.cache','.npm','tmp'):remove(fd,name)
    try:dialogs=os.open('dialogs',DIR,dir_fd=fd)
    except FileNotFoundError:continue
    try:
     for name in os.listdir(dialogs):
      # Symlinks are unlinked, never traversed.
      if not stat.S_ISDIR(os.stat(name,dir_fd=dialogs,follow_symlinks=False).st_mode):continue
      dialog=os.open(name,DIR,dir_fd=dialogs)
      try:
       for cache in ('.cache','.npm','tmp'):remove(dialog,cache)
      finally:os.close(dialog)
    finally:os.close(dialogs)
  finally:os.close(fd)
def bb_copy_threads(home_fd):
 """(плагин, тред, fd папки треда) для копий проектов bb; ссылки не обходятся."""
 try:plugins=directory_at(home_fd,['.bb','plugins'])
 except (FileNotFoundError,NotADirectoryError):return
 try:
  for plugin in os.listdir(plugins):
   if not plugin.startswith('environment-'):continue
   try:ws=directory_at(plugins,[plugin,'host-data','workspaces'])
   except (FileNotFoundError,NotADirectoryError):continue
   try:
    for thread in os.listdir(ws):
     try:t=os.open(thread,DIR,dir_fd=ws)
     except (FileNotFoundError,NotADirectoryError):continue
     try:yield plugin,thread,t
     finally:os.close(t)
   finally:os.close(ws)
 finally:os.close(plugins)
def directory_at(fd,parts):
 fd=os.dup(fd)
 try:
  for name in parts:
   child=os.open(name,DIR,dir_fd=fd);os.close(fd);fd=child
  return fd
 except BaseException:os.close(fd);raise
def clean_bb_copies(home_fd):
 # Папки самих тредов (и папку проекта внутри) оставляем пустыми: bb проверяет, что они есть.
 for _,_,t in bb_copy_threads(home_fd):
  for name in os.listdir(t):
   st=os.stat(name,dir_fd=t,follow_symlinks=False)
   if stat.S_ISDIR(st.st_mode):
    inner=os.open(name,DIR,dir_fd=t)
    try:
     for item in os.listdir(inner):remove(inner,item)
    finally:os.close(inner)
   else:remove(t,name)
def clean_claude_env(homebase,uid):
 try:fd=os.open(os.path.join(homebase,uid),DIR)
 except FileNotFoundError:return
 try:
  for name in os.listdir(fd):
   if name not in CLAUDE_KEEP:remove(fd,name)
 finally:os.close(fd)
def tree_size(fd):
 total=0
 for name in os.listdir(fd):
  try:
   st=os.stat(name,dir_fd=fd,follow_symlinks=False)
   if stat.S_ISDIR(st.st_mode):
    child=os.open(name,DIR,dir_fd=fd)
    try:total+=tree_size(child)
    finally:os.close(child)
   elif stat.S_ISREG(st.st_mode):total+=st.st_blocks*512
  except FileNotFoundError:continue
 return total
def preview(root,homebase,uid):
 """Что удалит кнопка — показать человеку до подтверждения."""
 out={'bb_copies':[],'claude_env':[]}
 try:home=directory(root,['home'])
 except FileNotFoundError:home=None
 if home is not None:
  try:
   for plugin,thread,t in bb_copy_threads(home):
    size=tree_size(t)
    if size:out['bb_copies'].append({'name':thread,'bytes':size,'items':sorted(os.listdir(t))[:3]})
  finally:os.close(home)
 try:fd=os.open(os.path.join(homebase,uid),DIR)
 except FileNotFoundError:fd=None
 if fd is not None:
  try:
   for name in sorted(os.listdir(fd)):
    if name in CLAUDE_KEEP:continue
    st=os.stat(name,dir_fd=fd,follow_symlinks=False)
    if stat.S_ISDIR(st.st_mode):
     child=os.open(name,DIR,dir_fd=fd)
     try:size=tree_size(child)
     finally:os.close(child)
    else:size=st.st_blocks*512
    if size:out['claude_env'].append({'name':name,'bytes':size})
  finally:os.close(fd)
 for k in out:out[k].sort(key=lambda x:-x['bytes'])
 return out
def extra_cache(base,uid,homebase):
 for root,is_work in [(os.path.join(base,uid),True),(os.path.join(homebase,uid),False)]:
  try:fd=os.open(root,DIR)
  except FileNotFoundError:continue
  try:
   if not is_work:
    for name in ('.cache','.npm','tmp'):remove(fd,name)
   else:
    for name in os.listdir(fd):
     if not re.fullmatch(r'dialog-[0-9a-f-]{36}',name):continue
     try:child=os.open(name,DIR,dir_fd=fd)
     except (FileNotFoundError,NotADirectoryError):continue
     try:
      for cache in ('.cache','.npm','.tmp'):remove(child,cache)
     finally:os.close(child)
  finally:os.close(fd)
if __name__=='__main__':
 os.nice(10)
 base,uid,action=sys.argv[1:4];extra=sys.argv[4:]
 if not uid.isdigit() or int(uid)<=0:raise ValueError('Invalid user ID')
 root=os.path.join(base,uid)
 if action=='scan':
  account=Accounting()
  for path,prefix in [(root,[])]+([(os.path.join(extra[0],uid),['claude-work']),(os.path.join(extra[1],uid),['claude-home'])] if len(extra)==2 else []):
   try:scan(path,account=account,prefix=prefix)
   except FileNotFoundError:pass
  result=account.result()
 elif action in ('cache','bb_copies'):
  clean(root,action)
  if action=='cache' and len(extra)==2:extra_cache(extra[0],uid,extra[1])
  result={'ok':True}
 elif action=='claude_env':
  if len(extra)!=2:raise ValueError('Claude home required')
  clean_claude_env(extra[1],uid)
  result={'ok':True}
 elif action=='preview':
  result=preview(root,extra[1] if len(extra)==2 else '/nonexistent',uid)
 else:raise ValueError('Invalid action')
 print(json.dumps(result))
