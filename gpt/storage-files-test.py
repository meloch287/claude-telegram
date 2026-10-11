import importlib.util,unittest,tempfile,os,struct
from pathlib import Path
spec=importlib.util.spec_from_file_location('storage',Path(__file__).with_name('storage-files.py'))
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
class StorageTest(unittest.TestCase):
 def test_shared_compressed_extents_count_once(self):
  a=s.Accounting()
  a.add([('extent:42',4096)],100000,'projects','a')
  a.add([('extent:42',4096)],100000,'cache','b')
  r=a.result()
  self.assertEqual(r['bytes'],4096)
  self.assertEqual(r['referencedBytes'],200000)
  self.assertEqual(r['categories']['shared'],4096)
  self.assertEqual(r['dialogs']['a'],4096)
 def test_extent_parse_compressed_sparse_inline(self):
  data=struct.pack('<QQBBHBQQQQ',1,65536,3,0,0,1,4096,8192,0,65536)
  self.assertEqual(s.parse_extent(data,11,0),('extent:4096',8192))
  self.assertIsNone(s.parse_extent(data[:21]+struct.pack('<QQQQ',0,0,0,65536),11,0))
  inline=struct.pack('<QQBBHB',1,100,3,0,0,0)+b'abc'
  self.assertEqual(s.parse_extent(inline,11,0),('inline:11:0',3))
 def test_scan_and_cleanup_never_follow_links_or_touch_auth_or_sibling(self):
  with tempfile.TemporaryDirectory() as base:
   root=Path(base)/'202';other=Path(base)/'303';root.mkdir();other.mkdir();(other/'secret').write_text('keep')
   for p in ['home/.codex','home/dialogs/a/.cache','home/dialogs/a/tmp','workspace/.dialogs/a']:(root/p).mkdir(parents=True,exist_ok=True)
   (root/'home/.codex/auth.json').write_text('auth');(root/'home/dialogs/a/.cache/link').symlink_to(other,target_is_directory=True)
   (root/'home/dialogs/a/tmp/x').write_text('tmp');(root/'workspace/.dialogs/a/file').write_text('keep')
   (root/'workspace/escape').symlink_to(other,target_is_directory=True)
   paths=[]
   def measure(fd,st):paths.append(st.st_ino);return [('inode:'+str(st.st_ino),st.st_size)]
   r=s.scan(str(root),measure,sync=False)
   self.assertFalse((other/'secret').stat().st_ino in paths)
   s.clean(str(root),'cache')
   self.assertTrue((other/'secret').exists());self.assertFalse((root/'home/dialogs/a/tmp/x').exists())
   s.clean(str(root),'bb_copies')
   self.assertTrue((root/'home/.codex/auth.json').exists());self.assertTrue((root/'workspace/.dialogs/a/file').exists())
   self.assertTrue((other/'secret').exists())
   with self.assertRaises(ValueError):s.clean(str(root),'other')  # опасная «прочие файлы» убрана
 def test_bb_project_copy_visible_deletable_and_service_not_counted(self):
  # случай Али: bb скопировал проект для треда (4,8 ГБ) — было в «Прочих», удалить нельзя
  with tempfile.TemporaryDirectory() as base:
   root=Path(base)/'tenants'/'7';homes=Path(base)/'claude';work=Path(base)/'work'
   copy=root/'home/.bb/plugins/environment-personal-workspace/host-data/workspaces/thr_x/Проект'
   for p in [copy/'data','home/.bb/plugins/automations','home/.local/lib','workspace/my']:((root/p) if not str(p).startswith('/') else p).mkdir(parents=True,exist_ok=True)
   (copy/'data/big.bin').write_bytes(b'x'*5000);(copy/'notes.txt').write_text('old')
   (root/'home/.bb/bb.db').write_bytes(b'd'*700);(root/'home/.local/lib/tool').write_bytes(b't'*300)
   (root/'workspace/my/project.txt').write_bytes(b'p'*100)
   ch=homes/'7';(ch/'.mamba/env').mkdir(parents=True);(ch/'.mamba/env/lib.so').write_bytes(b'm'*800);(ch/'.claude').mkdir();(ch/'.claude/s.jsonl').write_text('h');(ch/'.gitconfig').write_text('[user]')
   (ch/'ing').mkdir();(ch/'ing/x').write_bytes(b'i'*40)
   measure=lambda fd,st:[('inode:'+str(st.st_ino),st.st_size)]
   acc=s.Accounting()
   s.scan(str(root),measure,sync=False,account=acc)
   s.scan(str(ch),measure,sync=False,account=acc,prefix=['claude-home'])
   r=acc.result()
   self.assertEqual(r['categories']['bb_copies'],5003)
   self.assertEqual(r['categories']['service'],1000)
   self.assertEqual(r['categories']['claude_env'],840)
   self.assertNotIn('other',r['categories'],'ничего непонятного не осталось')
   self.assertEqual(r['bytes'],r['physicalBytes']-1000,'служебное bb не в квоте')
   self.assertEqual(r['dialogs']['bb:thr_x'],5003)
   pv=s.preview(str(root),str(homes),'7')
   self.assertEqual([x['name'] for x in pv['bb_copies']],['thr_x']);self.assertEqual(pv['bb_copies'][0]['items'],['Проект'])
   self.assertEqual(sorted(x['name'] for x in pv['claude_env']),['.mamba','ing'],'настройки входа и GitHub не предлагаем удалять')
   s.clean(str(root),'bb_copies')
   self.assertTrue(copy.is_dir() and not any(copy.iterdir()),'папка треда остаётся пустой — bb её ждёт')
   self.assertTrue((root/'home/.bb/bb.db').exists() and (root/'workspace/my/project.txt').exists(),'база bb и проекты целы')
   s.clean_claude_env(str(homes),'7')
   self.assertEqual(sorted(os.listdir(ch)),['.claude','.gitconfig'])
 def test_bb_copies_cleanup_does_not_follow_links(self):
  with tempfile.TemporaryDirectory() as base:
   root=Path(base)/'7';outside=Path(base)/'outside';outside.mkdir();(outside/'keep').write_text('k')
   ws=root/'home/.bb/plugins/environment-personal-workspace/host-data/workspaces';ws.mkdir(parents=True)
   (ws/'thr_evil').symlink_to(outside,target_is_directory=True)
   (ws/'thr_ok').mkdir();(ws/'thr_ok/p').symlink_to(outside,target_is_directory=True)
   s.clean(str(root),'bb_copies')
   self.assertTrue((outside/'keep').exists())
   # .bb — ссылка наружу: тоже не идём
   r2=Path(base)/'8';(r2/'home').mkdir(parents=True);ev=Path(base)/'ev'/'plugins/environment-x/host-data/workspaces/t';ev.mkdir(parents=True);(ev/'f').write_text('k')
   (r2/'home/.bb').symlink_to(Path(base)/'ev',target_is_directory=True)
   s.clean(str(r2),'bb_copies');self.assertTrue((ev/'f').exists())
 def test_reject_tenant_symlink(self):
  with tempfile.TemporaryDirectory() as base:
   root=Path(base)/'202';root.symlink_to(base,target_is_directory=True)
   with self.assertRaises(OSError):s.scan(str(root),lambda *_:[],sync=False)
if __name__=='__main__':unittest.main()
