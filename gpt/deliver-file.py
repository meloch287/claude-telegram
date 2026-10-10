import os,sys,stat

def read_file(root,name,maximum=49*1024*1024):
 if not name or '\x00' in name or name.startswith('/') or any(p in ('','..','.') for p in name.split('/')):raise ValueError('Недопустимый путь')
 fd=os.open('/',os.O_PATH|os.O_DIRECTORY)
 try:
  for part in root.strip('/').split('/')+name.split('/')[:-1]:
   nxt=os.open(part,os.O_PATH|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd);os.close(fd);fd=nxt
  src=os.open(name.split('/')[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
  try:
   info=os.fstat(src)
   if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1:raise ValueError('Нужен обычный файл без ссылок')
   if info.st_size>maximum:raise ValueError('Файл больше 49 МиБ')
   chunks=[];size=0
   while True:
    data=os.read(src,min(1024*1024,maximum+1-size))
    if not data:break
    chunks.append(data);size+=len(data)
    if size>maximum:raise ValueError('Файл больше 49 МиБ')
   return b''.join(chunks)
  finally:os.close(src)
 finally:os.close(fd)

if __name__=='__main__':
 try:sys.stdout.buffer.write(read_file(sys.argv[1],sys.argv[2]))
 except Exception as e:print(str(e) if isinstance(e,ValueError) else 'Файл недоступен в твоей папке',file=sys.stderr);sys.exit(1)
