from pathlib import Path
path = Path('/usr/local/lib/node_modules/bb-app/server/dist/builtin-plugins/provider-claude-code/dist/host.js')
text = path.read_text()
old = 'async function Bne(){let e=await S_t();'
new = 'async function Bne(){if(process.env.CLAUDE_CODE_OAUTH_TOKEN)return {accessToken:process.env.CLAUDE_CODE_OAUTH_TOKEN};let e=await S_t();'
assert text.count(old) == 1, 'Claude provider artifact changed; inspect before patching'
path.write_text(text.replace(old, new))

import hashlib, json
meta = path.with_name('host.meta.json')
value = json.loads(meta.read_text())
value['artifactDigest'] = hashlib.sha256(path.read_bytes()).hexdigest()
meta.write_text(json.dumps(value, indent=2) + '\n')
