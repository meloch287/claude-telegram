"""Тесты worker-update.py без Docker: правка тега и user-agent, снимки и возврат баз. python3 scripts/worker-update.test.py"""
import importlib.util, os, sqlite3, tempfile, unittest
from pathlib import Path


def load(root):
    os.environ['AI_BOT_ROOT'] = str(root)
    spec = importlib.util.spec_from_file_location('wu', Path(__file__).resolve().parent / 'worker-update.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def app(root, image='ai-worker:0.159.3-bb0.45.0-r33-claude', policy=None):
    gpt = root / 'app' / 'gpt'
    gpt.mkdir(parents=True)
    (gpt / 'web-runtime.mjs').write_text(f'export const BB_IMAGE = "{image}";\n')
    (gpt / 'policy.mjs').write_text(f'export function workerArgs(uid, base, image = "{policy or image}") {{}}\n')
    for name in ('inference-gateway.mjs', 'team-providers.mjs'):
        (gpt / name).write_text('const h={"user-agent": "codex_cli_rs/0.159.3"};\n')


class Code(unittest.TestCase):
    def test_tag_and_user_agent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); app(root); wu = load(root)
            old = wu.current_image()
            self.assertEqual(wu.codex_of(old), '0.159.3')
            files = wu.rewrite_code(old, 'ai-worker:0.162.1-bb0.45.0-r33-claude', '0.159.3', '0.162.1')
            self.assertIn('ai-worker:0.162.1-bb0.45.0-r33-claude', files['gpt/web-runtime.mjs'])
            self.assertIn('image = "ai-worker:0.162.1-bb0.45.0-r33-claude"', files['gpt/policy.mjs'])
            self.assertIn('codex_cli_rs/0.162.1', files['gpt/team-providers.mjs'])
            wu.write_files(files)
            self.assertEqual(wu.current_image(), 'ai-worker:0.162.1-bb0.45.0-r33-claude')

    def test_mismatched_tags_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); app(root, policy='ai-worker:0.1.0-bb0.45.0'); wu = load(root)
            with self.assertRaises(RuntimeError):
                wu.current_image()


class States(unittest.TestCase):
    def test_snapshot_and_restore(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); app(root)
            home = root / 'tenants' / '5' / 'home'
            (home / '.codex').mkdir(parents=True); (home / '.bb').mkdir()
            for f in (home / '.codex/state_5.sqlite', home / '.bb/bb.db'):
                db = sqlite3.connect(f); db.execute('create table t(v)'); db.execute("insert into t values ('old')"); db.commit(); db.close()
            wu = load(root)
            self.assertEqual(wu.snapshot_states(root / 'snap'), 2)
            db = sqlite3.connect(home / '.codex/state_5.sqlite'); db.execute("update t set v='migrated'"); db.commit(); db.close()
            wu.restore_states(root / 'snap')
            self.assertEqual(sqlite3.connect(home / '.codex/state_5.sqlite').execute('select v from t').fetchone()[0], 'old')


if __name__ == '__main__':
    unittest.main()
