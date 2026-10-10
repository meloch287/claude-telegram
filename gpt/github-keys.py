"""Runs as the tenant's UID inside its container. Never returns a private key."""
import fcntl,json,os,re,shlex,stat,subprocess,sys,uuid,time
from pathlib import Path
# GitHub's published Ed25519 host key: https://api.github.com/meta
HOST_KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'

def regular(path):
    if path.is_symlink(): raise ValueError('Unsafe symlink')
    if path.exists() and (not stat.S_ISREG(path.stat().st_mode) or path.stat().st_nlink != 1):
        raise ValueError('Unsafe file')

def directory(path):
    if path.is_symlink(): raise ValueError('Unsafe directory')
    path.mkdir(mode=0o700,exist_ok=True)
    if not path.is_dir(): raise ValueError('Unsafe directory')
    os.chmod(path,0o700)

def write(path,text,mode=0o600):
    regular(path)
    tmp=path.with_name(path.name+'.'+uuid.uuid4().hex)
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode)
    with os.fdopen(fd,'w') as f:f.write(text)
    os.replace(tmp,path)

def run(args,timeout=15):
    return subprocess.run(args,capture_output=True,text=True,timeout=timeout,stdin=subprocess.DEVNULL)

def main(action,uid,root,data):
    if not re.fullmatch(r'[1-9][0-9]*',uid):raise ValueError('Invalid user')
    root=Path(root).resolve(strict=True)
    ssh=root/'.ssh';directory(ssh)
    folder=ssh/'gpt-github';directory(folder)
    lock=folder/'lock';regular(lock)
    fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as stream:
        fcntl.flock(stream,fcntl.LOCK_EX)
        key=folder/'id_ed25519';regular(key)
        if not key.exists():
            tmp=folder/('key-'+uuid.uuid4().hex)
            result=run(['ssh-keygen','-q','-t','ed25519','-N','','-C','ai-bot-'+uid,'-f',str(tmp)])
            if result.returncode:raise ValueError('Key generation failed')
            os.replace(tmp,key);tmp.with_suffix('.pub').unlink()
        os.chmod(key,0o600)
        public=run(['ssh-keygen','-y','-P','','-f',str(key)])
        if public.returncode or not public.stdout.startswith('ssh-ed25519 '):raise ValueError('Cannot read SSH key')
        public=' '.join(public.stdout.split()[:2])+' ai-bot-'+uid
        write(folder/'id_ed25519.pub',public+'\n',0o644)
        write(folder/'known_hosts','github.com,ssh.github.com,[ssh.github.com]:443 '+HOST_KEY+'\n',0o644)
        config=folder/'config'
        hosts=folder/'hosts'
        write(hosts,f'''Host github.com ssh.github.com
    HostName ssh.github.com
    Port 443
    User git
    IdentityFile "{key}"
    IdentitiesOnly yes
    IdentityAgent none
    BatchMode yes
    PasswordAuthentication no
    StrictHostKeyChecking yes
    HostKeyAlgorithms ssh-ed25519
    UserKnownHostsFile "{folder / 'known_hosts'}"
    ConnectTimeout 8
''')
        personal=ssh/'config';regular(personal)
        include=f'Include "{hosts}"\n'
        previous=personal.read_text() if personal.exists() else ''
        if include not in previous:write(personal,include+'Host *\n'+previous)
        write(config,f'Include "{hosts}"\nHost *\n    Include "{personal}"\n')
        gitfile=root/'.gitconfig';regular(gitfile)
        def git(*args):
            result=run(['git','config','--file',str(gitfile),*args])
            if result.returncode not in (0,1):raise ValueError('Git configuration failed')
            return result.stdout.strip()
        git('--replace-all','core.sshCommand','ssh -F '+shlex.quote(str(config)))
        # Public HTTPS repository links also work for private clone/push, using SSH.
        git('--replace-all','url.git@github.com:.insteadOf','https://github.com/')
        if action in ('author','autoauthor'):
            name=data.get('name','');email=data.get('email','')
            if not isinstance(name,str) or not 1<=len(name)<=100 or re.search(r'[\x00-\x1f\x7f<>]',name):raise ValueError('Invalid author')
            if not isinstance(email,str) or len(email)>254 or not re.fullmatch(r'[^\s<>\x00-\x1f\x7f@]+@[^\s<>\x00-\x1f\x7f@]+\.[^\s<>\x00-\x1f\x7f@]+',email):raise ValueError('Invalid email')
            for setting,value in [('user.name',name),('user.email',email)]:
                if action=='author' or not git('--get',setting):git('--replace-all',setting,value)
        claude=root/'.claude';directory(claude)
        guide=claude/'CLAUDE.md';regular(guide)
        old=guide.read_text() if guide.exists() else ''
        start='<!-- ai-bot-github -->';end='<!-- /ai-bot-github -->'
        old=re.sub(re.escape(start)+r'[\s\S]*?'+re.escape(end), '', old).rstrip()
        context=f"{start}\nGitHub подключается через /github и общий личный SSH-ключ {key}. Используй GIT_CONFIG_GLOBAL={gitfile} во всех проектах. Проверка: ssh -T git@github.com; successfully authenticated означает успех даже с кодом 1. gh auth status проверяет отдельный OAuth; не проси повторный вход без проверки SSH/git. Не показывай приватный ключ.\n{end}"
        write(guide,(old+'\n\n' if old else '')+context+'\n')
        result={'publicKey':public,'author':{'name':git('--get','user.name'),'email':git('--get','user.email')}}
        if action=='check':
            try:
                response=run(['ssh','-F',str(config),'-T','git@github.com'],timeout=12)
                output=response.stdout+response.stderr
                match=re.search(r"Hi ([A-Za-z0-9_-]+(?:/[A-Za-z0-9_.-]+)?)! You've successfully authenticated",output)
                if match:result.update(connection='connected',login=match[1])
                elif 'Permission denied (publickey)' in output:result['connection']='not_added'
                elif 'Host key verification failed' in output or 'REMOTE HOST IDENTIFICATION' in output:result['connection']='host_key_error'
                else:result['connection']='unavailable'
            except subprocess.TimeoutExpired:result['connection']='unavailable'
            write(folder/'account.json',json.dumps({'connection':result['connection'],'login':result.get('login'),'checkedAt':int(time.time()*1000)}))
        elif action not in ('key','author','autoauthor'):raise ValueError('Invalid action')
        return result

if __name__=='__main__':
    try:print(json.dumps(main(*sys.argv[1:4],json.loads(sys.argv[4])),ensure_ascii=False))
    except Exception:
        # Do not leak command arguments, tenant files or credentials through bot errors.
        print('GitHub setup failed',file=sys.stderr);sys.exit(1)
