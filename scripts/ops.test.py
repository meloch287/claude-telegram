"""Тесты ops.py: чистка релизов и сторож (без systemd и Telegram). python3 scripts/ops.test.py"""
import importlib.util, os, sqlite3, tempfile, time, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(root):
    os.environ['AI_BOT_ROOT'] = str(root)
    spec = importlib.util.spec_from_file_location('ops', HERE / 'ops.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Cleanup(unittest.TestCase):
    def test_keeps_current_recent_and_rollback_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            releases = root / 'releases'
            old = time.time() - 30 * 86400
            for i in range(14):
                d = releases / f'old-{i:02d}'
                (d / 'frontend').mkdir(parents=True)
                os.utime(d, (old + i, old + i))
            (releases / 'fresh').mkdir()
            # текущий фронт — в старом релизе
            (root / 'bb-ru-dist').symlink_to(releases / 'old-00' / 'frontend')
            # откат свежего релиза ссылается на old-01
            (releases / 'fresh' / 'rollback.sh').write_text('ln -sfn /opt/ai-bot/releases/old-01/frontend x\n')
            os.utime(releases / 'fresh', None)
            ops = load(root)
            removed = ops.cleanup(dry=True)
            self.assertNotIn('old-00', removed)   # текущий фронт
            self.assertNotIn('old-01', removed)   # нужен откату
            self.assertNotIn('fresh', removed)
            self.assertNotIn('old-13', removed)   # среди 10 последних
            self.assertIn('old-02', removed)
            ops.cleanup()
            self.assertFalse((releases / 'old-02').exists())
            self.assertTrue((releases / 'old-00').exists())


class Watchdog(unittest.TestCase):
    def test_alert_after_two_checks_and_recovery(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            ops = load(root)
            sent, now = [], []
            ops.notify = lambda text: sent.append(text) or True
            ops.problems = lambda: list(now)
            now[:] = ['служба ai-bot не работает']
            ops.watchdog()
            self.assertEqual(sent, [])          # одна проверка — ещё не тревога
            ops.watchdog()
            self.assertEqual(len(sent), 1)
            self.assertIn('ai-bot', sent[0])
            ops.watchdog()
            self.assertEqual(len(sent), 1)      # без повторов
            now[:] = []
            ops.watchdog()
            self.assertIn('Починилось', sent[-1])

    def test_unsent_messages_wait_for_telegram(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            ops = load(root)
            online, sent = [False], []
            ops.notify = lambda text: (sent.append(text) or True) if online[0] else False
            ops.problems = lambda: ['служба ai-bot-proxy не работает']
            ops.watchdog(); ops.watchdog()      # прокси лёг — Telegram недоступен
            self.assertEqual(sent, [])
            online[0] = True
            ops.problems = lambda: []
            ops.watchdog()
            self.assertEqual(len(sent), 1)
            self.assertIn('Проблема', sent[0])
            self.assertIn('Починилось', sent[0])


class SyncErrors(unittest.TestCase):
    def test_repeated_sync_failures_become_a_problem(self):
        with tempfile.TemporaryDirectory() as tmp:
            ops = load(Path(tmp))
            line = '[claude-bb] 844820548 docker завершился с кодом 1: UNIQUE constraint failed: environments.path'
            self.assertEqual(ops.sync_problems([line, line]), [], 'два сбоя — ещё не тревога')
            found = ops.sync_problems([line] * 3 + ['[bb-sync] 5 ok-ish', '[claude-bb] мост: 1057399602 timeout'])
            self.assertEqual(len(found), 1)
            self.assertIn('844820548', found[0])
            self.assertEqual(found, ops.sync_problems([line] * 5), 'текст стабильный — без повторных тревог')


class Backup(unittest.TestCase):
    def test_database_snapshot_is_consistent(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').mkdir()
            db = sqlite3.connect(root / 'data' / 'bot.db')
            db.execute('pragma journal_mode=wal')
            db.execute('create table t(x)'); db.execute('insert into t values (42)'); db.commit()
            ops = load(root)
            out = root / 'snap'; out.mkdir()
            ops.snapshot_databases(out)
            self.assertEqual(sqlite3.connect(out / 'bot.db').execute('select x from t').fetchone()[0], 42)
            db.close()


if __name__ == '__main__':
    unittest.main()
