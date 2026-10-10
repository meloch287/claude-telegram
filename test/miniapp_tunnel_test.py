import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('tunnel', pathlib.Path(__file__).parents[1] / 'scripts/miniapp-tunnel.py')
tunnel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tunnel)

class FakeTelegram:
    def __init__(self):
        self.calls = []
        self.fail_default = False
    def open(self, request, timeout):
        method = request.full_url.rsplit('/', 1)[1]
        body = json.loads(request.data)
        self.calls.append((method, body))
        uid = body.get('chat_id')
        if uid == 3 or (uid is None and self.fail_default):
            raise HTTPError('redacted', 403, 'blocked', {}, None)
        result = {'type': 'default'} if uid == 1 else {'type': 'commands'}
        return io.BytesIO(json.dumps({'ok': True, 'result': result}).encode())

class TunnelTests(unittest.TestCase):
    def test_default_and_explicit_menus_follow_new_tunnel_without_messages(self):
        api = FakeTelegram()
        with patch.object(tunnel, 'user_ids', return_value=[1,2,3]):
            changed = tunnel.publish_menu(api, {'BOT_TOKEN':'test'}, 'https://demo.trycloudflare.com')
        updates = [data for method,data in api.calls if method == 'setChatMenuButton']
        self.assertEqual(changed, 3)
        self.assertEqual([d.get('chat_id') for d in updates], [None,1,2])
        self.assertTrue(all(d['menu_button']['web_app']['url'] == 'https://demo.trycloudflare.com/modes.html' for d in updates))
        self.assertTrue(all(method in ('getChatMenuButton','setChatMenuButton') for method,_ in api.calls))
    def test_failed_global_update_retries_instead_of_claiming_success(self):
        api = FakeTelegram(); api.fail_default = True
        with patch.object(tunnel, 'user_ids', return_value=[]):
            with self.assertRaises(HTTPError):
                tunnel.publish_menu(api, {'BOT_TOKEN':'test'}, 'https://demo.trycloudflare.com')
    def test_url_replacement_is_private_and_has_no_leftover_temporary_file(self):
        with tempfile.TemporaryDirectory() as path:
            file = pathlib.Path(path) / 'url'
            with patch.object(tunnel, 'URL_FILE', file):
                tunnel.write_url('https://first.trycloudflare.com')
                tunnel.write_url('https://second.trycloudflare.com')
            self.assertEqual(file.read_text(), 'https://second.trycloudflare.com\n')
            self.assertEqual(file.stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(list(pathlib.Path(path).iterdir())), 1)

if __name__ == '__main__': unittest.main()
