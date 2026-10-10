"""Экспорт истории bb для команды ИИ не тащит скрытые от человека вставки (agent-only).
python3 gpt/team-history.test.py"""
import importlib.util, json, sqlite3, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('team_history', Path(__file__).with_name('team-history.py'))
team_history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(team_history)


class AgentOnlyHidden(unittest.TestCase):
    def test_bb_export_skips_agent_only_input(self):
        with tempfile.TemporaryDirectory() as home:
            (Path(home) / '.bb').mkdir()
            db = sqlite3.connect(Path(home) / '.bb/bb.db')
            db.executescript('''
              create table threads(id text, provider_id text, title text, updated_at int, deleted_at int, storage_deleted_at int);
              create table events(thread_id text, sequence int, type text, item_kind text, data text, created_at int);
            ''')
            db.execute("insert into threads values('thr_x','claude-code','Проверка',2,null,null)")
            request = {'initiator': 'user', 'input': [
                {'type': 'text', 'text': 'Продолжи диалог @thread:thr_a\n\nпривет', 'mentions': []},
                {'type': 'text', 'text': '[Справка о другом диалоге] секретная сводка', 'mentions': [], 'visibility': 'agent-only'},
            ]}
            db.execute("insert into events values('thr_x',1,'client/turn/requested',null,?,1)", (json.dumps(request),))
            db.execute("insert into events values('thr_x',2,'item/completed','agentMessage',?,2)", (json.dumps({'item': {'text': 'ответ'}}),))
            db.commit(); db.close()
            chats = team_history.bb(home)
            self.assertEqual(len(chats), 1)
            self.assertEqual(chats[0]['engine'], 'Claude_BOT')
            bodies = [m['body'] for m in chats[0]['messages']]
            self.assertEqual(bodies, ['Продолжи диалог @thread:thr_a\n\nпривет', 'ответ'])


if __name__ == '__main__':
    unittest.main()
