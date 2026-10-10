"""Run only inside the owner's container. All mutable path components use openat/no-follow."""
import json,os,re,shutil,sys,uuid,stat
from pathlib import Path
FLAGS=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
def validate_id(value):
 if not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',value): raise ValueError('Invalid dialog ID')
 return value
def directory(root,parts,create=False):
 fd=os.open(str(root),FLAGS)
 try:
  for part in parts:
   if create:
    try:os.mkdir(part,0o700,dir_fd=fd)
    except FileExistsError:pass
   child=os.open(part,FLAGS,dir_fd=fd);os.close(fd);fd=child
  return fd
 except BaseException:os.close(fd);raise
def prepare(home,work,tid):
 validate_id(tid)
 for root,parts in [(work,['.dialogs',tid]),(home,['dialogs',tid,'.codex']),(home,['dialogs',tid,'.cache']),(home,['dialogs',tid,'tmp'])]:
  os.close(directory(root,parts,True))
def remove_at(root,parts,tid):
 try:fd=directory(root,parts)
 except FileNotFoundError:return
 try:
  try:
   if not stat.S_ISDIR(os.stat(tid,dir_fd=fd,follow_symlinks=False).st_mode):
    os.unlink(tid,dir_fd=fd)
   else:shutil.rmtree(tid,dir_fd=fd)
  except FileNotFoundError:pass
 finally:os.close(fd)
def erase(home,work,tid):
 validate_id(tid)
 # Validate both parent chains before removing anything.
 for root,parts in [(home,['dialogs']),(work,['.dialogs'])]:
  try:os.close(directory(root,parts))
  except FileNotFoundError:pass
 remove_at(work,['.dialogs'],tid);remove_at(home,['dialogs'],tid)
def read_auth(fd):
 try:
  file=os.open('auth.json',os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
  with os.fdopen(file,'rb') as stream:return json.load(stream)
 except FileNotFoundError:return None
def write_auth(fd,data):
 name='.auth-'+uuid.uuid4().hex
 file=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=fd)
 with os.fdopen(file,'w') as stream:json.dump(data,stream)
 os.replace(name,'auth.json',src_dir_fd=fd,dst_dir_fd=fd)
def auth(home,tid,sync=False):
 validate_id(tid);account=directory(home,['.codex']);dialog=directory(home,['dialogs',tid,'.codex'])
 try:
  current=read_auth(account);temporary=read_auth(dialog)
  if sync:
   if temporary and current and str(temporary.get('last_refresh',''))>str(current.get('last_refresh','')):write_auth(account,temporary)
   try:os.unlink('auth.json',dir_fd=dialog)
   except FileNotFoundError:pass
  else:
   # Recover a newer refresh after a crash before preparing the next turn.
   if temporary and current and str(temporary.get('last_refresh',''))>str(current.get('last_refresh','')):
    write_auth(account,temporary);current=temporary
   if not current:raise ValueError('ChatGPT is not connected')
   write_auth(dialog,current)
 finally:os.close(account);os.close(dialog)
if __name__=='__main__':
 action,uid,tid=sys.argv[1:4]
 if not uid.isdigit():raise ValueError('Invalid user ID')
 home=Path('/home/agent');work=Path('/app/workspaces')/uid
 if action=='prepare':prepare(home,work,tid)
 elif action=='erase':erase(home,work,tid)
 elif action=='auth':auth(home,tid)
 elif action=='auth-sync':auth(home,tid,True)
 else:raise ValueError('Unknown action')
 print(json.dumps({'ok':True}))
