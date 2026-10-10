import os,sys,re,stat,subprocess
DIR=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW

def directory(path,create=False,owner=None):
 fd=os.open('/',DIR)
 try:
  for part in path.strip('/').split('/'):
   made=False
   if create:
    try:os.mkdir(part,0o700,dir_fd=fd);made=True
    except FileExistsError:pass
   nxt=os.open(part,DIR,dir_fd=fd);os.close(fd);fd=nxt
   if made and owner is not None:os.fchown(fd,owner,owner)
  return fd
 except BaseException:os.close(fd);raise

def acl(path,spec,owner=None,create=False):
 fd=directory(path,create,owner)
 try:
  if owner is not None and os.fstat(fd).st_uid not in (0,owner):raise ValueError('Wrong directory owner')
  subprocess.run(['setfacl','-m',spec,'--','/proc/self/fd/'+str(fd)],pass_fds=(fd,),check=True,capture_output=True)
 finally:os.close(fd)

def main(uid):
 if not re.fullmatch(r'[1-9][0-9]*',uid):raise ValueError('Invalid user')
 mapping=dict(x.split(':') for x in os.environ.get('CLAUDE_WORKER_UID_MAP','').split(',') if x)
 worker=int(mapping.get(uid,'0'))
 if worker and (worker<1000 or sum(int(v)==worker for v in mapping.values())!=1):raise ValueError('Unknown worker')
 peer=worker or 1000
 base='/opt/ai-bot/tenants';work=f'{base}/{uid}/workspace'
 if worker:
  for p in [base,base+'/'+uid,work]:acl(p,f'u:{worker}:--x')
 acl(work+'/AI-bot',f'u:{peer}:--x',1000,True)
 root=work+'/AI-bot/User'+uid
 worker=peer
 acl(root,f'u:1000:rwx,u:{worker}:rwx,d:u:1000:rwx,d:u:{worker}:rwx,d:u::rwx,d:g::---,d:o::---,d:m::rwx',1000,True)
 # Repair defaults on existing managed directories; use file descriptors, never symlinks.
 def repair(fd):
  st=os.fstat(fd)
  if st.st_uid not in (0,1000,worker):return
  isdir=stat.S_ISDIR(st.st_mode)
  if not isdir and (not stat.S_ISREG(st.st_mode) or st.st_nlink!=1):return
  spec=f'u:1000:rw'+('x' if isdir else '-')+f',u:{worker}:rw'+('x' if isdir else '-')
  if isdir:spec+=f',d:u:1000:rwx,d:u:{worker}:rwx,d:u::rwx,d:g::---,d:o::---,d:m::rwx'
  subprocess.run(['setfacl','-m',spec,'--','/proc/self/fd/'+str(fd)],pass_fds=(fd,),check=True,capture_output=True)
  if isdir:
   for name in os.listdir(fd):
    try:child=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
    except OSError:continue
    try:repair(child)
    finally:os.close(child)
 rootfd=directory(root)
 try:repair(rootfd)
 finally:os.close(rootfd)
 fd=directory('/opt/AI-bot',True)
 try:
  if os.fstat(fd).st_uid!=0:raise ValueError('Unsafe AI-bot directory')
  os.fchmod(fd,0o711);name='User'+uid
  try:os.symlink(root,name,dir_fd=fd)
  except FileExistsError:
   if os.readlink(name,dir_fd=fd)!=root:raise ValueError('Unexpected user mapping')
 finally:os.close(fd)
 print('ok')
if __name__=='__main__':
 try:main(sys.argv[1])
 except Exception:print('Team workspace setup failed',file=sys.stderr);sys.exit(1)
