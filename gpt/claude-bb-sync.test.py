"""Синхронизация Claude-чатов bb ↔ бот на настоящей схеме bb (gpt/bb-schema.sql).

Регрессии 2026-10-10 (Али):
  * тред зеркала удалили в bb, а окружение осталось — сверка падала на уникальности
    environments(project_id, host_id, path) и вставала для всех чатов;
  * чат, начатый в bb на «Claude Code» контейнера, не попадал в бота.
python3 gpt/claude-bb-sync.test.py
"""
import importlib.util, json, sqlite3, tempfile, unittest, uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('cbs', HERE / 'claude-bb-sync.py')
cbs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cbs)


def bb(root):
    home, work = root / 'home', root / 'work'
    (home / '.bb').mkdir(parents=True)
    work.mkdir()
    db = sqlite3.connect(home / '.bb/bb.db')
    db.executescript((HERE / 'bb-schema.sql').read_text())
    db.execute("insert into projects(id,name,created_at,updated_at) values('prj','Мой',1,1)")
    db.execute("insert into hosts(id,name,type,created_at,updated_at) values('hst','box','local',1,1)")
    db.execute("insert into project_sources(id,project_id,host_id,type,path,created_at,updated_at) values('src','prj','hst','local_path',?,1,1)", (str(work),))
    db.commit()
    return home, work, db


def session(sid, title='Курсовая', texts=('Привет', 'Здравствуй')):
    return {'id': sid, 'mtime': 1, 'title': title, 'createdAt': 1000, 'updatedAt': 2000,
            'messages': [{'key': f'm{i}', 'role': 'user' if i % 2 == 0 else 'assistant', 'body': t, 'at': 1000 + i} for i, t in enumerate(texts)]}


def payload(rows, **extra):
    return {'sessions': rows, 'ids': [r['id'] for r in rows], 'complete': True, 'provider': cbs.BRIDGE, **extra}


class OrphanEnvironment(unittest.TestCase):
    def test_deleted_mirror_with_leftover_environment_comes_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            home, work, db = bb(Path(tmp))
            sid = str(uuid.uuid4())
            first = cbs.sync('5', home, work, payload([session(sid)]))
            self.assertEqual(first['threads'][0]['status'], 'idle')
            bid = cbs.bb_id(sid)
            # bb удалил тред сам, без нашей чистки: связь и окружение остались
            db.execute('pragma foreign_keys=on')
            db.execute('delete from events where thread_id=?', (bid,))
            db.execute('delete from threads where id=?', (bid,))
            db.commit()
            self.assertTrue(db.execute("select 1 from environments where path like ?", ('%claude-' + sid,)).fetchone())
            again = cbs.sync('5', home, work, payload([session(sid)]))  # раньше: IntegrityError
            self.assertEqual(again['threads'][0]['bb_id'], bid)
            self.assertTrue(db.execute('select 1 from threads where id=? and deleted_at is null', (bid,)).fetchone())
            texts = [json.loads(r[0]).get('input', [{}])[0].get('text') for r in db.execute("select data from events where thread_id=? and type='client/turn/requested'", (bid,))]
            self.assertIn('Привет', texts, 'история вернулась, а не пустой тред')


class Adoption(unittest.TestCase):
    def test_claude_code_thread_moves_to_bot_without_duplicates(self):
        with tempfile.TemporaryDirectory() as tmp:
            home, work, db = bb(Path(tmp))
            db.execute("insert into environments(id,project_id,host_id,path,status,created_at,updated_at) values('env_n','prj','hst',?,'ready',1,1)", (str(work) + '/proj',))
            db.execute("insert into threads(id,project_id,environment_id,provider_id,title,status,latest_attention_at,created_at,updated_at) values('thr_native1','prj','env_n','claude-code','IngCheckUp','idle',1,1,5)")
            turn = {'initiator': 'user', 'input': [{'type': 'text', 'text': 'Проверь курсовую'}, {'type': 'text', 'text': 'скрыто', 'visibility': 'agent-only'}]}
            db.execute("insert into events(id,thread_id,environment_id,scope_kind,turn_id,sequence,type,data,created_at) values('evt_a','thr_native1','env_n','turn','t1',1,'client/turn/requested',?,2)", (json.dumps(turn),))
            db.execute("insert into events(id,thread_id,environment_id,scope_kind,turn_id,sequence,type,item_kind,data,created_at) values('evt_b','thr_native1','env_n','turn','t1',2,'item/completed','agentMessage',?,3)", (json.dumps({'item': {'text': 'Проверил'}}),))
            db.commit()
            found = cbs.sync('5', home, work, payload([], adopt=2))
            self.assertEqual([n['bb_id'] for n in found['native']], ['thr_native1'])
            self.assertEqual([m['body'] for m in found['native'][0]['messages']], ['Проверь курсовую', 'Проверил'], 'agent-only не уходит в историю')
            sid = str(uuid.uuid4())  # диалог, созданный ботом (bb-bridge /adopt)
            marked = cbs.sync('5', home, work, {'mark': [{'bb_id': 'thr_native1', 'session': sid}], 'sessions': [], 'ids': [], 'complete': False, 'provider': cbs.BRIDGE})
            self.assertEqual(marked['marked'], ['thr_native1'])
            self.assertEqual(db.execute("select provider_id from threads where id='thr_native1'").fetchone()[0], cbs.BRIDGE)
            before = db.execute("select count(*) from events where thread_id='thr_native1'").fetchone()[0]
            transfer = session(sid, 'IngCheckUp', ('Это перенос диалога…', 'Сводка…'))
            linked = cbs.sync('5', home, work, payload([transfer], adopt=2))
            self.assertEqual(db.execute('select bb_id from claude_telegram_links where session_id=?', (sid,)).fetchone()[0], 'thr_native1')
            self.assertFalse(db.execute('select 1 from threads where id=?', (cbs.bb_id(sid),)).fetchone(), 'лишнего зеркала нет')
            self.assertEqual(linked['native'], [], 'повторно не переносится')
            after = db.execute("select count(*) from events where thread_id='thr_native1'").fetchone()[0]
            self.assertLessEqual(after - before, 1, 'служебный ход переноса в bb не дублируется')
            cbs.sync('5', home, work, payload([transfer], adopt=2))
            self.assertEqual(db.execute("select count(*) from events where thread_id='thr_native1'").fetchone()[0], after, 'повторная сверка ничего не добавляет')


class ProjectDefaults(unittest.TestCase):
    def test_claude_code_defaults_move_to_bridge(self):
        with tempfile.TemporaryDirectory() as tmp:
            home, work, db = bb(Path(tmp))
            if not db.execute("select 1 from sqlite_master where name='project_execution_defaults'").fetchone():
                db.execute('create table project_execution_defaults(project_id text primary key,provider_id text not null,model text not null,service_tier text not null,reasoning_level text not null,permission_mode text not null,updated_at integer not null)')
            db.execute("insert into project_execution_defaults values('prj','claude-code','claude-opus-5-5','default','xhigh','auto',1)")
            db.commit()
            cbs.sync('5', home, work, payload([]))
            row = db.execute("select provider_id,model,permission_mode,reasoning_level from project_execution_defaults").fetchone()
            self.assertEqual(row, (cbs.BRIDGE, 'default', 'full', 'xhigh'), 'режим auto Claude бота не принимает — стал full')


if __name__ == '__main__':
    unittest.main()
