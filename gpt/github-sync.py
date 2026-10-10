"""Bridge one tenant's GitHub identity into that same tenant's Claude home."""
import importlib.util,json,os,re,stat,subprocess,sys
from pathlib import Path


def read_secure(path, owners, limit=32768):
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        parts=Path(path).parts[1:]
        for part in parts[:-1]:
            nxt=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=nxt
        file=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=fd)
        try:
            info=os.fstat(file)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid not in owners or info.st_size>limit:
                raise ValueError('Unsafe source')
            return os.read(file,limit+1)
        finally:os.close(file)
    finally:os.close(fd)


def sync(uid, tenant_root='/opt/ai-bot/tenants', claude_root='/var/lib/ai-claude'):
    if not re.fullmatch(r'[1-9][0-9]*',uid):raise ValueError('Invalid user')
    mapping=dict(entry.split(':') for entry in os.environ.get('CLAUDE_WORKER_UID_MAP','').split(',') if entry)
    worker=int(mapping.get(uid,'0'))
    if worker<1000 or sum(int(v)==worker for v in mapping.values())!=1:raise ValueError('Invalid worker')
    source=Path(tenant_root)/uid/'home'
    try:key=read_secure(source/'.ssh/gpt-github/id_ed25519',{0,1000})
    except FileNotFoundError:return {'claude':'not_configured'}
    if b'BEGIN OPENSSH PRIVATE KEY' not in key or len(key)>16384:raise ValueError('Invalid key')
    author={}
    try:
        config=read_secure(source/'.gitconfig',{0,1000})
        for name in ['name','email']:
            p=subprocess.run(['git','config','--no-includes','--file','-','--get','user.'+name],input=config,capture_output=True,timeout=5)
            author[name]=p.stdout.decode().strip()
    except FileNotFoundError:pass
    account=None
    try:
        data=json.loads(read_secure(source/'.ssh/gpt-github/account.json',{0,1000}))
        account={k:data.get(k) for k in ['connection','login','checkedAt']}
    except FileNotFoundError:pass
    home=Path(claude_root)/uid
    fd=os.open(home,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        info=os.fstat(fd)
        if info.st_uid!=worker or info.st_gid!=worker or info.st_mode&0o027:raise ValueError('Unsafe Claude home')
    finally:os.close(fd)
    spec=importlib.util.spec_from_file_location('github_keys',Path(__file__).with_name('github-keys.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    if os.getuid()==0:os.setgroups([]);os.setgid(worker);os.setuid(worker)
    if os.getuid()!=worker:raise ValueError('Wrong worker')
    os.environ['HOME']=str(home)
    ssh=home/'.ssh';module.directory(ssh)
    folder=ssh/'gpt-github';module.directory(folder)
    dest=folder/'id_ed25519';module.regular(dest)
    if dest.exists():
        if dest.read_bytes()!=key:raise ValueError('Different Claude identity')
    else:
        file=os.open(dest,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(file,'wb') as stream:stream.write(key)
    action='author' if author.get('name') and author.get('email') else 'key'
    module.main(action,uid,str(home),author)
    if account is not None:module.write(folder/'account.json',json.dumps(account))
    return {'claude':'ready'}

if __name__=='__main__':
    try:print(json.dumps(sync(sys.argv[1])))
    except Exception:
        print('GitHub Claude sync failed',file=sys.stderr);sys.exit(1)
