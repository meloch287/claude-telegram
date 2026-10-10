import json,os,re,shutil,stat,sys
DIR=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
UUID=re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$',re.I)
def remove(fd,name):
 try:
  st=os.stat(name,dir_fd=fd,follow_symlinks=False)
  if stat.S_ISDIR(st.st_mode):shutil.rmtree(name,dir_fd=fd)
  else:os.unlink(name,dir_fd=fd)
 except FileNotFoundError:pass
def erase(base,uid,home,sid):
 if not uid.isdigit() or int(uid)<=0 or not UUID.fullmatch(sid):raise ValueError('Invalid owner or session')
 if not shutil.rmtree.avoids_symlink_attacks:raise RuntimeError('Safe rmtree required')
 root=os.open(base,os.O_PATH|os.O_DIRECTORY|os.O_NOFOLLOW)
 try:user=os.open(uid,DIR,dir_fd=root)
 finally:os.close(root)
 try:
  remove(user,'dialog-'+sid)
  # Old attachment aliases point into the dialog; remove only matching links.
  for project in os.listdir(user):
   if project.startswith('dialog-'):continue
   try:pfd=os.open(project,DIR,dir_fd=user)
   except (NotADirectoryError,OSError):continue
   try:
    try:uploads=os.open('вложения',DIR,dir_fd=pfd)
    except OSError:continue
    try:
     for name in os.listdir(uploads):
      if stat.S_ISLNK(os.stat(name,dir_fd=uploads,follow_symlinks=False).st_mode):
       target=os.readlink(name,dir_fd=uploads)
       if target.startswith(os.path.join(base,uid,'dialog-'+sid)+os.sep):os.unlink(name,dir_fd=uploads)
    finally:os.close(uploads)
   finally:os.close(pfd)
 finally:os.close(user)
 h=os.open(home,DIR)
 try:
  try:cl=os.open('.claude',DIR,dir_fd=h)
  except FileNotFoundError:return
  try:
   project=re.sub(r'[^a-zA-Z0-9]','-',os.path.join(base,uid,'dialog-'+sid))
   for group,names in [('projects',[project]),('file-history',[sid]),('session-env',[sid]),('tasks',[sid]),('debug',[sid+'.txt'])]:
    try:fd=os.open(group,DIR,dir_fd=cl)
    except FileNotFoundError:continue
    try:
     for n in names:remove(fd,n)
    finally:os.close(fd)
  finally:os.close(cl)
 finally:os.close(h)
if __name__=='__main__':
 erase(*sys.argv[1:]);print(json.dumps({'deleted':True}))
