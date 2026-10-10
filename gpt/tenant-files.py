"""Controller-only cleanup. Delete a numeric tenant entry without following symlinks."""
import os,re,shutil,stat,sys
FLAGS=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
def erase(root,uid):
 if not re.fullmatch(r'[1-9][0-9]*',uid) or uid=='1057399602':raise ValueError('Invalid deletion target')
 if not os.path.isabs(root):raise ValueError('Absolute root required')
 # Reject symlinks in all ancestors as well as the entry's parent.
 fd=os.open('/',FLAGS)
 try:
  for part in root.strip('/').split('/'):
   if part in ('','.','..'):raise ValueError('Invalid root')
   try:child=os.open(part,FLAGS,dir_fd=fd)
   except FileNotFoundError:return
   os.close(fd);fd=child
  try:mode=os.stat(uid,dir_fd=fd,follow_symlinks=False).st_mode
  except FileNotFoundError:return
  if stat.S_ISDIR(mode):shutil.rmtree(uid,dir_fd=fd)
  else:os.unlink(uid,dir_fd=fd)
 finally:os.close(fd)
if __name__=='__main__':
 erase(sys.argv[1],sys.argv[2])
