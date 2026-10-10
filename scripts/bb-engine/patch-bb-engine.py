"""Переключатель движка Claude | GPT в рабочей зоне bb — правка собранного фронта.

Запуск: python3 patch-bb-engine.py <frontend-dir> <out-dir> <bb-engine.js> [suffix]

Правит три чанка, остальное делает bb-engine.js:
  * карта хуков плагинов: experimental_useSidebarThreads проходит через __bbEngine.useSidebar;
  * PluginThreadList: над списком диалогов рисуется __bbEngine.Switch;
  * текст передачи: «Продолжи диалог @thread» вместо «Continue from», шапка «…со сводкой».
Изменённые чанки и все, кто их импортирует, получают новые имена (суффикс -engine1):
ассеты кэшируются навсегда. В out-dir пишутся только новые файлы и index.html.
"""
import hashlib, json, re, sys
from pathlib import Path

root, out, engine_js = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
suffix = sys.argv[4] if len(sys.argv) > 4 else '-engine1'
assets = {p.name: p.read_text() for p in (root / 'assets').glob('*.js')}
pattern = re.compile(r'[a-zA-Z0-9_.-]+\.js')
refs = lambda s: {n for n in pattern.findall(s) if n in assets}
index = (root / 'index.html').read_text()
reach = refs(index)
while True:
    nxt = reach | set().union(*(refs(assets[n]) for n in reach))
    if nxt == reach:
        break
    reach = nxt
patched = {}


def one(rx, flags=0):
    """Ровно одно совпадение среди достижимых чанков: (имя, match)."""
    hits = [(n, m) for n in sorted(reach) for m in re.finditer(rx, patched.get(n, assets[n]), flags)]
    assert len(hits) == 1, f'{rx!r}: {len(hits)} совпадений {[h[0] for h in hits][:5]}'
    return hits[0]


def edit(name, match, new):
    s = patched.get(name, assets[name])
    patched[name] = s[:match.start()] + new + s[match.end():]


# 1. Хук списка диалогов для плагинов.
name, m = one(r'experimental_useSidebarThreads:([A-Za-z_$][\w$]*),')
hook = m.group(1)
edit(name, m, f'experimental_useSidebarThreads:e=>{{let t={hook}(e),n=globalThis.__bbEngine;return n?n.useSidebar(t,e):t}},')

# 2. Переключатель над списком: дети PluginSlotMount — фрагмент [Switch, List].
name, m = one(r'(\w+)=\(0,(\w+)\.jsx\)\((\w+),\{activeThreadId:(\w+),activeProjectId:(\w+),isCompactViewport:(\w+),onNavigate:(\w+),searchQuery:``\}\)')
var, J, List, b = m.group(1), m.group(2), m.group(3), m.group(4)
original = m.group(0)[len(var) + 1:]
edit(name, m, f'{var}=(0,{J}.jsxs)({J}.Fragment,{{children:[globalThis.__bbEngine?(0,{J}.jsx)(globalThis.__bbEngine.Switch,{{activeThreadId:{b}}}):null,{original}]}})')

# 3. Текст передачи, который видят человек и агент.
# Минификатор встроил длину префикса в позицию упоминания: 14 → 16.
prefix = 'Продолжи диалог '
name, m = one(r'text:`Continue from \$\{([\w$]+)\}`,mentions:\[\{start:14,end:14\+')
edit(name, m, f'text:`{prefix}${{{m.group(1)}}}`,mentions:[{{start:{len(prefix)},end:{len(prefix)}+')

# 4. Шапка поля ввода в режиме передачи.
name, m = one(r'children:`Передать в новый диалог`(?=\}\),\(0,[\w$]+\.jsx\)\([\w$]+,\{type:`button`,size:`icon`,variant:`ghost`,[^}]{0,120}onClick:[\w$.]+\.handoff\.onExit)')
edit(name, m, 'children:`Передать в новый диалог со сводкой`')

# Каскад: всё, что импортирует изменённое, тоже меняет имя.
changed = set(patched)
while True:
    nxt = changed | {n for n in reach if refs(patched.get(n, assets[n])) & changed}
    if nxt == changed:
        break
    changed = nxt
renames = {n: re.sub(r'-(?:reasoning|ru|route|engine)\d+$', '', n[:-3]) + suffix + '.js' for n in changed}
for old, new in renames.items():
    assert new not in assets, f'имя занято: {new}'
rewrite = lambda s: pattern.sub(lambda mm: renames.get(mm[0], mm[0]), s)

engine = engine_js.read_text()
engine_name = f'bb-engine-{hashlib.sha256(engine.encode()).hexdigest()[:10]}.js'
(out / 'assets').mkdir(parents=True, exist_ok=True)
for n in changed:
    (out / 'assets' / renames[n]).write_text(rewrite(patched.get(n, assets[n])))
(out / 'assets' / engine_name).write_text(engine)

html = rewrite(index)
entry = re.search(r'<script type="module" crossorigin src="/assets/(index-[^"]+\.js)"></script>', html)
assert entry and entry.group(1) in renames.values(), 'точка входа не найдена'
tag = f'<script type="module" crossorigin src="/assets/{engine_name}"></script>'
html = html.replace(entry.group(0), tag + entry.group(0), 1)
(out / 'index.html').write_text(html)
manifest = {'engine': engine_name, 'entry': entry.group(1), 'changed': sorted(renames.values()), 'patched': sorted(renames[n] for n in patched)}
(out / f'patch-manifest{suffix}.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
print(f'patched {len(patched)} chunks, renamed {len(changed)}, entry {entry.group(1)}, engine {engine_name}')
