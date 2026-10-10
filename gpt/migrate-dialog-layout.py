#!/usr/bin/env python3
"""One-time offline migration; staging must be an independently mounted Btrfs tree."""
import hashlib,json,os,sqlite3,stat,subprocess,uuid
from pathlib import Path
ROOT=Path('/mnt/gpt-tenants-next');DATA=Path('/opt/ai-bot/data');HISTORY=Path('/opt/gpt-migration/history')
assert (DATA/'maintenance').exists()
assert subprocess.run(['mountpoint','-q',str(ROOT)]).returncode==0
assert not (DATA/'dialog-layout-v2.json').exists()
db=sqlite3.connect(DATA/'bot.db');db.row_factory=sqlite3.Row
rows=list(db.execute('SELECT * FROM gpt_threads ORDER BY user_id,id'))
assert not any(r['codex_id'] for r in rows),'Existing Codex sessions need explicit relocation'
manifest=[]
def physical(p):
 assert p.resolve()==p, f'Symlink in source path: {p}'
 return p
def snapshot(src,dest):
 physical(src);physical(dest.parent)
 dest.mkdir(mode=0o700)
 subprocess.run(['cp','-a','--reflink=always',str(src)+'/.',str(dest)+'/'],check=True)
 # cp --reflink=always fails on unsupported or incomplete copies. Verify the complete
 # tree inventory, sizes, modes, link targets and independent regular-file inodes.
 count=0
 for parent,dirs,files in os.walk(src,followlinks=False):
  for name in dirs+files:
   a=Path(parent)/name;b=dest/a.relative_to(src);sa=a.lstat();sb=b.lstat()
   assert stat.S_IFMT(sa.st_mode)==stat.S_IFMT(sb.st_mode)
   if stat.S_ISLNK(sa.st_mode):assert os.readlink(a)==os.readlink(b)
   if stat.S_ISREG(sa.st_mode):assert sa.st_size==sb.st_size and sa.st_ino!=sb.st_ino;count+=1
 return count
for r in rows:
 uid=str(r['user_id']);tid=r['id'];assert str(uuid.UUID(tid))==tid
 tenant=physical(ROOT/uid);work=physical(tenant/'workspace');home=physical(tenant/'home')
 (work/'.dialogs').mkdir(exist_ok=True);(home/'dialogs').mkdir(exist_ok=True)
 dest=work/'.dialogs'/tid;dh=home/'dialogs'/tid
 assert not dest.exists() and not dh.exists(),'Staging already migrated; inspect before retry'
 src=work/r['project'];assert src.parent==work and src.is_dir(),str(src)
 count=snapshot(src,dest);dh.mkdir(mode=0o700)
 for name in ['.codex','.cache','tmp']: (dh/name).mkdir(mode=0o700)
 history=[];p=HISTORY/uid/(str(r['legacy_id'])+'.json')
 if p.exists():
  d=json.loads(p.read_text());assert str(d['owner'])==uid and d['session']==r['legacy_id']
  for f in d['files']:
   rel=Path(f['path']);assert not rel.is_absolute() and '..' not in rel.parts
   original=physical(home/'legacy-history'/rel);target=dh/'legacy-history'/rel;target.parent.mkdir(parents=True,exist_ok=True)
   assert hashlib.sha256(original.read_bytes()).hexdigest()==f['sha256']
   subprocess.run(['cp','--reflink=always','--preserve=mode,timestamps',str(original),str(target)],check=True)
   assert hashlib.sha256(target.read_bytes()).hexdigest()==f['sha256'];history.append({'path':str(rel),'sha256':f['sha256']})
 elif r['summary'] and '/home/agent/legacy-history/' in r['summary']:raise RuntimeError('History index missing')
 subprocess.run(['chown','-hR','1000:1000',str(dest),str(dh)],check=True)
 for p in [work/'.dialogs',home/'dialogs']:os.chown(p,1000,1000)
 manifest.append({'user_id':r['user_id'],'thread_id':tid,'project':r['project'],'files':count,'history':history})
 print(json.dumps({'thread':tid,'files':count,'history_files':len(history)}),flush=True)
(ROOT/'dialog-layout-manifest.json').write_text(json.dumps({'version':2,'dialogs':manifest},indent=2))
print('VERIFIED',len(manifest),'dialogs',sum(len(x['history']) for x in manifest),'history files',flush=True)
