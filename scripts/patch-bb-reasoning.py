import json, re, sys
from pathlib import Path
root = Path(sys.argv[1])
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
assets = {p.name: p.read_text() for p in (root / 'assets').glob('*.js')}
pattern = re.compile(r'[a-zA-Z0-9_.-]+\.js')
def refs(s):
    return {name for name in pattern.findall(s) if name in assets}
index = (root / 'index.html').read_text()
reachable = refs(index)
while True:
    expanded = reachable | set().union(*(refs(assets[n]) for n in reachable))
    if expanded == reachable:
        break
    reachable = expanded
menus = [n for n in reachable if n.startswith('ModelReasoningMenu-')]
assert len(menus) == 1, menus
name = menus[0]
s = assets[name]
a = s.index('(0,M.jsx)(ce,{type:`single`,"aria-label":')
b = s.index('})]})]}):null', a) + 2
old = s[a:b]
assert 'value:L' in old and 'children:R.map' in old and 't&&z(t.value)' in old, old
# Ultracode — служебный уровень рабочей зоны, пользователю бота не нужен: в меню его нет.
new = '''(0,M.jsxs)(`select`,{"aria-label":`Reasoning`,value:L===`ultracode`?`xhigh`:L,onChange:e=>{let t=R.find(t=>t.value===e.target.value);t&&z(t.value)},disabled:P,style:{height:44,minHeight:44,appearance:`none`,WebkitAppearance:`none`,backgroundImage:`linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%)`,backgroundPosition:`calc(100% - 17px) 19px,calc(100% - 12px) 19px`,backgroundSize:`5px 5px`,backgroundRepeat:`no-repeat`,width:`100%`,minWidth:0,borderRadius:12,border:`1px solid var(--border)`,backgroundColor:`var(--background)`,color:`var(--foreground)`,padding:`0 12px`,fontSize:16,outlineOffset:3},children:[!L?(0,M.jsx)(`option`,{value:``,disabled:!0,children:`Default`}):null,...R.filter(e=>e.value!==`ultracode`).map(e=>(0,M.jsx)(`option`,{value:e.value,children:({none:`None`,low:`Low`,medium:`Medium`,high:`High`,xhigh:`Extra High`,max:`Max`,ultra:`Ultra`})[e.value]??e.label},e.value))]})'''
assets[name] = s[:a] + new + s[b:]
assets[name] = assets[name].replace('children:`Глубина рассуждений `', 'children:`Reasoning`').replace('children:`Reasoning `', 'children:`Reasoning`')
changed = {name}
while True:
    expanded = changed | {n for n in reachable if refs(assets[n]) & changed}
    if expanded == changed:
        break
    changed = expanded
renames = {n: n[:-3] + '-reasoning2.js' for n in changed}
def rewrite(s):
    return pattern.sub(lambda m: renames.get(m[0], m[0]), s)
(out / 'assets').mkdir(exist_ok=True)
for name in changed:
    (out / 'assets' / renames[name]).write_text(rewrite(assets[name]))
(out / 'index.html').write_text(rewrite(index))
(out / 'patch-manifest.json').write_text(json.dumps({'menu': menus[0], 'files': sorted(renames.values())}))
print('Patched reasoning menu; cache-versioned assets:', len(changed))
