"""Bounded file listing/read/ZIP. Every path component is opened without symlinks."""
import os, sys, json, stat, base64, zipfile, tempfile, time, mimetypes

LIMIT = 49 * 1024 * 1024
MAX_FILES = 5000
SKIP = {'node_modules', '__pycache__', 'venv', 'env', 'vendor', 'cache', 'coverage', 'target'}
def allowed(name):
    lower = name.lower()
    return (not name.startswith('.') or name == '.uploads') and lower not in SKIP and not lower.endswith(('.pem','.key','.p12','.pfx')) and lower not in {'credentials.json','auth.json','secrets.json','id_rsa','id_ed25519'}
def parts(path):
    p = path.split('/')
    if not path or any(x in ('', '.', '..') or '\\' in x or '\x00' in x or not allowed(x) for x in p):
        raise ValueError('Недопустимый путь')
    return p
def directory(path):
    fd = os.open('/', os.O_PATH | os.O_DIRECTORY)
    try:
        for name in path.strip('/').split('/'):
            nxt = os.open(name, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = nxt
        result = os.open('.', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        return result
    finally: os.close(fd)
def read_at(root, path, cap=LIMIT):
    p=parts(path); fd=os.dup(root)
    try:
        for name in p[:-1]:
            nxt=os.open(name, os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=nxt
        leaf=os.open(p[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
        with os.fdopen(leaf,'rb') as f:
            s=os.fstat(f.fileno())
            if not stat.S_ISREG(s.st_mode) or s.st_nlink != 1: raise ValueError('Файл недоступен')
            if s.st_size>cap: raise ValueError('Файл больше допустимого размера')
            b=f.read(cap+1)
            if len(b)>cap: raise ValueError('Файл больше допустимого размера')
            return b
    finally: os.close(fd)
def listing(root):
    result=[]; count=0; truncated=False; end=time.monotonic()+10
    def walk(fd, prefix='', depth=0):
        nonlocal count,truncated
        if depth>14: truncated=True;return
        for name in sorted(os.listdir(fd)):
            count+=1
            if count>MAX_FILES or time.monotonic()>end: truncated=True;return
            if not allowed(name): continue
            try:
                s=os.stat(name,dir_fd=fd,follow_symlinks=False)
                path=prefix+name
                if stat.S_ISREG(s.st_mode) and s.st_nlink==1:
                    result.append({'path':path,'size':s.st_size,'modified':int(s.st_mtime*1000),'type':mimetypes.guess_type(name)[0] or 'application/octet-stream'})
                elif stat.S_ISDIR(s.st_mode):
                    child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
                    try: walk(child,path+'/',depth+1)
                    finally: os.close(child)
            except (OSError,ValueError): continue
    walk(root)
    return {'files':sorted(result,key=lambda x:x['modified'],reverse=True),'truncated':truncated}
def main():
    root=directory(sys.argv[1]); request=json.loads(sys.argv[2]); action=request['action']
    try:
        if action=='list': return listing(root)
        if action=='read':
            path=request['path'];b=read_at(root,path)
            return {'name':path.split('/')[-1],'data':base64.b64encode(b).decode(),'type':mimetypes.guess_type(path)[0] or 'application/octet-stream'}
        if action=='zip':
            inventory=listing(root)
            if inventory['truncated']: raise ValueError('Слишком много файлов. Выбери и скачай нужные по отдельности.')
            rows=inventory['files']
            if not rows: raise ValueError('В диалоге пока нет файлов')
            if sum(x['size'] for x in rows)>200*1024*1024: raise ValueError('Файлы занимают больше 200 МиБ. Скачай нужные по отдельности.')
            with tempfile.TemporaryFile() as out:
                with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                    for row in rows:
                        b=read_at(root,row['path'],200*1024*1024)
                        archive.writestr(row['path'],b)
                        if out.tell()>LIMIT: raise ValueError('Архив больше 49 МиБ. Скачай нужные файлы по отдельности.')
                if out.tell()>LIMIT: raise ValueError('Архив больше 49 МиБ')
                out.seek(0)
                return {'name':'files.zip','type':'application/zip','data':base64.b64encode(out.read()).decode(),'count':len(rows)}
        raise ValueError('Неизвестное действие')
    finally: os.close(root)
if __name__=='__main__':
    try: print(json.dumps(main(),ensure_ascii=False))
    except (ValueError,OSError,KeyError) as e: print(json.dumps({'error':str(e)},ensure_ascii=False));sys.exit(0)
