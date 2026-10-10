"""Уровни рассуждений в рабочей зоне bb: без Ultracode, у Claude — без Max.

Ultracode — служебный режим оркестрации, пользователю в меню глубины не нужен.
Max у Claude по замерам Anthropic почти не лучше XHigh, а думает вдвое дольше —
скрываем. У GPT Max остаётся (это другой движок).

Правка в общем хуке списка уровней (его читают и меню модели, и композер):
уровень просто не попадает в список, а сохранённый Max/Ultracode bb сам сводит
к ближайшему доступному (reconcileReasoningLevel → XHigh).

Изменённый чанк и всё, что на него ссылается (до index.html), получают новые
имена с суффиксом (по умолчанию -engine3): ассеты bb кэшируются на год.

Запуск: python3 patch-bb-levels.py <frontend-dir> <out-dir> [suffix]
В <out-dir> — только новые файлы (assets/ и index.html) и манифест.
"""
import json, re, sys
from pathlib import Path

root, out = Path(sys.argv[1]), Path(sys.argv[2])
suffix = sys.argv[3] if len(sys.argv) > 3 else '-engine3'
assets = {p.name: p.read_text() for p in (root / 'assets').glob('*.js')}
pattern = re.compile(r'[a-zA-Z0-9_.-]+\.js')


def refs(text):
    return {name for name in pattern.findall(text) if name in assets}


index = (root / 'index.html').read_text()
reachable = refs(index)
while True:
    expanded = reachable | set().union(*(refs(assets[n]) for n in reachable))
    if expanded == reachable:
        break
    reachable = expanded

HIDE = 'function bbHiddenLevel(l,m){return l===`ultracode`||l===`max`&&!/gpt/i.test(m?.model??``)}'
LOOP = 'for(let e of d?.supportedReasoningEfforts??[])p.has(e.reasoningEffort)||('
LIST = 'let n=e?.supportedReasoningEfforts.map(e=>e.reasoningEffort)??[];'
hosts = [n for n in reachable if LOOP in assets[n]]
assert len(hosts) == 1, hosts
host = hosts[0]
src = assets[host]
assert 'bbHiddenLevel' not in src, 'уже пропатчено'
assert src.count(LOOP) == 1 and src.count(LIST) == 1, 'хук уровней не найден'
src = src.replace(LOOP, 'for(let e of d?.supportedReasoningEfforts??[])bbHiddenLevel(e.reasoningEffort,d)||p.has(e.reasoningEffort)||(')
# Выбранный уровень сводится к списку без скрытых: сохранённый Max у Claude станет XHigh.
src = src.replace(LIST, 'let n=(e?.supportedReasoningEfforts.map(e=>e.reasoningEffort)??[]).filter(t=>!bbHiddenLevel(t,e));')
anchor = 'var LO={none:'
assert src.count(anchor) == 1, 'таблица подписей уровней не найдена'
src = src.replace(anchor, HIDE + anchor)
assets[host] = src

changed = {host}
while True:
    expanded = changed | {n for n in reachable if refs(assets[n]) & changed}
    if expanded == changed:
        break
    changed = expanded
renames = {n: re.sub(r'-(?:reasoning|ru|route|engine)\d+$', '', n[:-3]) + suffix + '.js' for n in changed}
for new in renames.values():
    assert not (root / 'assets' / new).exists(), f'{new} уже есть'


def rewrite(text):
    return pattern.sub(lambda m: renames.get(m[0], m[0]), text)


(out / 'assets').mkdir(parents=True, exist_ok=True)
for name in changed:
    (out / 'assets' / renames[name]).write_text(rewrite(assets[name]))
new_index = rewrite(index)
assert new_index != index, 'index.html не изменился'
(out / 'index.html').write_text(new_index)
entry = [renames[n] for n in changed if n.startswith('index-')]
(out / f'patch-manifest{suffix}.json').write_text(json.dumps({'host': host, 'entry': entry[0] if entry else None, 'changed': sorted(renames.values())}, ensure_ascii=False, indent=1))
print(f'host={host} renamed={len(renames)}')
