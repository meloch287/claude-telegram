"""Дополняет русский перевод и правит мелочи в собранной рабочей зоне bb.

Запуск: python3 patch-bb-ru.py <frontend-dir> <dict.json> [suffix]
  * меняет только модули, достижимые из index.html;
  * сначала точечные правки кода (code), затем строковые литералы интерфейса (literals);
  * ассеты bb immutable на год, поэтому изменённые модули и всё, что на них ссылается,
    получают новые имена (суффикс -ru4); старые файлы остаются для открытых вкладок;
  * отчёт: сколько раз сработала каждая строка; строки без совпадений перечисляются.
"""
import json, re, sys
from pathlib import Path

root, cfg = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text())
suffix = sys.argv[3] if len(sys.argv) > 3 else '-ru4'
A = root / 'assets'
assets = {p.name: p.read_text() for p in A.glob('*.js')}
pattern = re.compile(r'[a-zA-Z0-9_.-]+\.js')


def refs(text):
    return {n for n in pattern.findall(text) if n in assets}


index = (root / 'index.html').read_text()
reach = refs(index)
while True:
    nxt = reach | set().union(*(refs(assets[n]) for n in reach))
    if nxt == reach:
        break
    reach = nxt

work = {n: assets[n] for n in reach}
for c in cfg['code']:
    total = sum(t.count(c['old']) for t in work.values())
    assert total == c['count'], f"{c['why']}: ожидалось {c['count']}, найдено {total}"
    for n, t in work.items():
        if c['old'] in t:
            work[n] = t.replace(c['old'], c['new'])

report, quoted = [], []
for en, ru in cfg['literals']:
    total = 0
    for q in ('`', '"'):
        old = q + en + q
        new = q + (ru if q == '`' else json.dumps(ru, ensure_ascii=False)[1:-1]) + q
        for n, t in work.items():
            k = t.count(old)
            if k:
                if q == '"':
                    i = t.find(old)
                    quoted.append((en, n, t[max(0, i - 40):i]))
                work[n] = t.replace(old, new)
                total += k
    report.append((en, total))

changed = {n for n in reach if work[n] != assets[n]}
while True:
    nxt = changed | {n for n in reach if refs(work[n]) & changed}
    if nxt == changed:
        break
    changed = nxt


def renamed(name):
    return re.sub(r'-(?:reasoning|ru|route|engine)\d+$', '', name[:-3]) + suffix + '.js'


renames = {n: renamed(n) for n in changed}
for new in renames.values():
    assert not (A / new).exists(), f'{new} уже существует'


def rewrite(text):
    return pattern.sub(lambda m: renames.get(m[0], m[0]), text)


for n in changed:
    (A / renames[n]).write_text(rewrite(work[n]))
new_index = rewrite(index)
tmp = root / ('index.html' + suffix)
tmp.write_text(new_index)
tmp.replace(root / 'index.html')
(root / f'patch-manifest{suffix}.json').write_text(json.dumps({'files': sorted(renames.values()), 'report': report}, ensure_ascii=False, indent=1))
print(f'reachable={len(reach)} changed+cascade={len(changed)}')
print('литералов сработало:', sum(1 for _, t in report if t), 'из', len(report), '| замен всего:', sum(t for _, t in report))
for en, t in report:
    if not t:
        print('  НЕ НАЙДЕНО:', en)
for en, n, ctx in quoted:
    print('  в кавычках "…":', en, '←', n[:30], ctx)
