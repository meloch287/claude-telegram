import importlib.util, pathlib, tempfile, unittest
spec=importlib.util.spec_from_file_location('dialog_files',pathlib.Path(__file__).with_name('dialog-files.py'))
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
A='11111111-1111-4111-8111-111111111111'; B='22222222-2222-4222-8222-222222222222'
class Files(unittest.TestCase):
 def test_delete_removes_only_selected_dialog(self):
  with tempfile.TemporaryDirectory() as d:
   home=pathlib.Path(d)/'home';work=pathlib.Path(d)/'workspace';home.mkdir();work.mkdir()
   for tid in [A,B]:
    module.prepare(home,work,tid)
    (work/'.dialogs'/tid/'result.txt').write_text(tid)
    (home/'dialogs'/tid/'.codex'/'history.jsonl').write_text(tid)
   (work/'.dialogs'/A/'link').symlink_to(work/'.dialogs'/B,target_is_directory=True)
   module.erase(home,work,A)
   self.assertFalse((work/'.dialogs'/A).exists());self.assertFalse((home/'dialogs'/A).exists())
   self.assertEqual((work/'.dialogs'/B/'result.txt').read_text(),B)
   self.assertTrue((home/'dialogs'/B/'.codex'/'history.jsonl').exists())
   module.erase(home,work,A)
 def test_parent_symlink_is_rejected_and_no_data_is_deleted(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);home=root/'home';work=root/'work';other=root/'other';home.mkdir();work.mkdir();other.mkdir()
   (other/A).mkdir();(other/A/'keep').write_text('keep');(work/'.dialogs').symlink_to(other)
   with self.assertRaises(OSError):module.erase(home,work,A)
   self.assertTrue((other/A/'keep').exists())
 def test_rejects_path_instead_of_id(self):
  with self.assertRaises(ValueError): module.validate_id('../another-user')
if __name__=='__main__': unittest.main()
