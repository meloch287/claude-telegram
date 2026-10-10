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
   s.clean(str(root),'other')
   self.assertTrue((root/'home/.codex/auth.json').exists());self.assertTrue((root/'workspace/.dialogs/a/file').exists())
   self.assertTrue((other/'secret').exists())
 def test_reject_tenant_symlink(self):
  with tempfile.TemporaryDirectory() as base:
   root=Path(base)/'202';root.symlink_to(base,target_is_directory=True)
   with self.assertRaises(OSError):s.scan(str(root),lambda *_:[],sync=False)
if __name__=='__main__':unittest.main()
