"""Файл от Claude бота — в рабочую зону bb человека, чтобы bb мог его показать и отдать.

python3 bb-save-file.py <корень рабочей зоны> <имя>  (байты — на stdin) → печатает имя сохранённого файла.
Запускается от root (ai-bot), а папку держит пользователь контейнера: поэтому каждая
часть пути открывается без перехода по ссылкам (O_NOFOLLOW), файл создаётся заново
(O_EXCL) и отдаётся владельцу контейнера (uid 1000). Подменить папку ссылкой на чужое нельзя.
"""
import os, sys

FOLDER = 'Файлы Claude'
OWNER = 1000
MAXIMUM = 49 * 1024 * 1024


def clean(name):
    name = name.replace('\\', '/').split('/')[-1]
    name = ''.join(ch for ch in name if ch >= ' ' and ch not in '<>:"|?*').strip(' .')
    return name[:150] or 'файл'


def save(root, name, data):
    if len(data) > MAXIMUM:
        raise ValueError('Файл больше 49 МиБ')
    fd = os.open('/', os.O_PATH | os.O_DIRECTORY)
    try:
        for part in root.strip('/').split('/'):
            nxt = os.open(part, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd); os.close(fd); fd = nxt
        try:
            os.mkdir(FOLDER, 0o750, dir_fd=fd)
            made = True
        except FileExistsError:
            made = False
        nxt = os.open(FOLDER, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd); os.close(fd); fd = nxt
        if made:
            os.fchown(fd, OWNER, OWNER)
        base, dot, ext = clean(name).rpartition('.')
        stem, ext = (base, '.' + ext) if dot and base else (clean(name), '')
        for n in range(1, 1000):
            candidate = stem + ext if n == 1 else f'{stem} ({n}){ext}'
            try:
                out = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640, dir_fd=fd)
            except FileExistsError:
                continue
            try:
                os.fchown(out, OWNER, OWNER)
                view = memoryview(data)
                while view:
                    view = view[os.write(out, view):]
            finally:
                os.close(out)
            return candidate
        raise ValueError('Слишком много файлов с таким именем')
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        print(f'{FOLDER}/' + save(sys.argv[1], sys.argv[2], sys.stdin.buffer.read()))
    except Exception as e:
        print(str(e) if isinstance(e, ValueError) else 'Не удалось сохранить файл для bb', file=sys.stderr)
        sys.exit(1)
