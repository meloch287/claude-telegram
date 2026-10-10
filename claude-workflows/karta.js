export const meta = {
  name: 'karta',
  description: 'Составить или обновить КАРТА.md проекта: шесть разведчиков (доступ, настройки и секреты, выкатка и откат, проверки, логи, внешние сервисы), проверка фактов, короткая шпаргалка',
  whenToUse: 'В проекте нет КАРТА.md или она устарела; перед передачей проекта другому человеку; после переезда, смены способа выкатки или новых сервисов.',
  phases: [
    { title: 'Разведка', detail: 'шесть независимых разведчиков' },
    { title: 'Проверка', detail: 'каждый факт сверяется с файлами' },
    { title: 'Запись', detail: 'КАРТА.md в корне проекта' },
  ],
}

// args: { path? } или строка с путём
const input = typeof args === 'string' ? { path: args } : (args ?? {})
const root = String(input.path ?? '.').trim() || '.'

const FACTS = {
  type: 'object',
  required: ['facts'],
  properties: {
    facts: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        required: ['fact', 'evidence'],
        properties: {
          fact: { type: 'string', description: 'одной строкой, без значений секретов' },
          evidence: { type: 'string', description: 'файл (и строка), команда или «предположение»' },
        },
      },
    },
  },
}
const VERIFIED = {
  type: 'object',
  required: ['keep', 'dropped'],
  properties: {
    keep: { type: 'array', items: { type: 'object', required: ['topic', 'fact'], properties: { topic: { type: 'string' }, fact: { type: 'string' } } } },
    dropped: { type: 'array', items: { type: 'string' }, description: 'что выброшено и почему' },
  },
}

const SCOUTS = [
  { topic: 'Доступ', ask: 'где работает проект и как туда попасть: сервер/хостинг, адреса, домены, SSH-хосты и пользователи (без паролей и ключей), окружения dev/prod' },
  { topic: 'Настройки и секреты', ask: 'где лежат настройки и секреты: пути к .env, конфигам, хранилищам секретов, переменные окружения по именам. ЗНАЧЕНИЯ СЕКРЕТОВ НЕ ВЫПИСЫВАТЬ' },
  { topic: 'Выкатка и откат', ask: 'как выкатывать и как откатываться: скрипты деплоя, CI, Docker/compose, systemd-юниты, релизные папки, порядок шагов' },
  { topic: 'Проверки', ask: 'какой командой проверить, что всё в порядке: scripts/verify.sh, тесты, сборка, линтер, проверка здоровья (health-check URL)' },
  { topic: 'Логи', ask: 'где смотреть логи и состояние: journalctl-юниты, файлы логов, мониторинг, алерты' },
  { topic: 'Связи и внешние сервисы', ask: 'кто кого вызывает и что внешнее: базы, очереди, API, платёжки, почта, CDN, прокси; что из этого может отвалиться' },
]

phase('Разведка')
const scouted = await pipeline(SCOUTS, s => agent(
  `Цель: собрать факты для КАРТА.md проекта в «${root}» по теме «${s.topic}»: ${s.ask}.\n` +
    'Смотри README, КАРТА.md (если есть), docs, конфиги, Dockerfile, compose, CI, systemd-файлы, скрипты, package.json и т. п. Только чтение, команды не запускай. ' +
    'К каждому факту — откуда он (файл:строка). Не нашёл — не выдумывай. Пиши по-русски.',
  { label: s.topic, phase: 'Разведка', schema: FACTS },
).then(r => r && { topic: s.topic, facts: r.facts }))
const found = scouted.filter(Boolean)
const total = found.reduce((n, s) => n + s.facts.length, 0)
log(`Разведчики принесли фактов: ${total}`)
if (!total) return { report: 'Не нашёл в проекте ничего, из чего можно собрать КАРТУ.' }

phase('Проверка')
const verified = await agent(
  'Ты проверяющий. Сверь каждый факт с указанным источником (прочитай файлы). Оставь только подтверждённые; выбрось догадки и всё, что содержит значения секретов (пароли, токены, ключи) — пути и имена переменных оставь. ' +
    'Объедини дубли. Пиши по-русски.\n\n' +
    found.map(s => `## ${s.topic}\n` + s.facts.map(f => `- ${f.fact} [${f.evidence}]`).join('\n')).join('\n\n'),
  { label: 'проверка фактов', phase: 'Проверка', schema: VERIFIED },
)
if (!verified || !verified.keep.length) return { report: 'После проверки не осталось подтверждённых фактов — КАРТУ не трогаю.', dropped: verified?.dropped ?? [] }

phase('Запись')
const written = await agent(
  `Запиши файл КАРТА.md в корне «${root}». Если файл уже есть — обнови: сохрани ручные заметки, исправь устаревшее, добавь новое.\n` +
    'Формат — короткая шпаргалка на русском, а не документация: разделы «Где и как зайти», «Настройки и секреты (пути, не значения)», «Выкатка и откат», «Проверки», «Логи», «Связи и внешние сервисы (что может отвалиться)». ' +
    'Схему связей — словами или списком. Никаких значений секретов. Пустые разделы не выдумывай — пиши «не найдено».\n\nПроверенные факты:\n' +
    verified.keep.map(k => `- [${k.topic}] ${k.fact}`).join('\n') +
    '\n\nВ ответ верни 3–5 строк: что записано и что стоит уточнить у человека.',
  { label: 'КАРТА.md', phase: 'Запись' },
)

return { report: written, facts: verified.keep.length, dropped: verified.dropped }
