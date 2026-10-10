export const meta = {
  name: 'fix-until-green',
  description: 'Чинить до зелёного: запускает проверку (тесты, сборку, типы, линтер), устраняет причины падений и повторяет, пока не пройдёт или не перестанет продвигаться',
  whenToUse: 'Падают тесты, сборка, проверка типов или линтер, и нужно довести до зелёного. Агенты правят файлы и запускают команды — в Telegram удобнее режим «Сам правит файлы» или «Без подтверждений».',
  phases: [
    { title: 'Команда', detail: 'какой проверкой меряем' },
    { title: 'Проверка', detail: 'запуск и разбор падений' },
    { title: 'Починка', detail: 'устранение причин' },
    { title: 'Контроль', detail: 'не заглушены ли ошибки' },
  ],
}

// args: строка с командой или { command?, maxRounds? }
const input = typeof args === 'string' ? { command: args } : (args ?? {})
let command = String(input.command ?? '').trim()
const maxRounds = Math.min(Math.max(Number(input.maxRounds) || 4, 1), 8)

const DETECT = {
  type: 'object',
  required: ['command', 'why'],
  properties: { command: { type: 'string' }, why: { type: 'string' } },
}
const CHECK = {
  type: 'object',
  required: ['passed', 'total', 'failures'],
  properties: {
    passed: { type: 'boolean' },
    total: { type: 'integer', description: 'сколько всего падений/ошибок' },
    failures: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        required: ['what', 'message'],
        properties: {
          what: { type: 'string', description: 'тест, файл или правило' },
          file: { type: 'string' },
          message: { type: 'string', description: 'суть ошибки, до 300 символов' },
        },
      },
    },
  },
}
const FIX = {
  type: 'object',
  required: ['changed', 'summary'],
  properties: {
    changed: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string', description: 'что было причиной и что изменено' },
    blocked: { type: 'string', description: 'если не удалось — почему' },
  },
}

if (!command) {
  phase('Команда')
  const found = await agent(
    'Цель: найти команду проверки проекта. Посмотри КАРТА.md, scripts/verify.sh, package.json (test/typecheck/lint/build), Makefile, pyproject/pytest, cargo, go.mod. ' +
      'Выбери одну команду, которая лучше всего показывает, что проект в порядке. Ничего не запускай и не меняй.',
    { label: 'поиск команды проверки', effort: 'low', schema: DETECT },
  )
  if (!found) throw new Error('Не нашёл команду проверки — передай её: args = { command: "npm test" }')
  command = found.command
  log(`Проверка: ${command} — ${found.why}`)
}

const rounds = []
let best = Infinity, stale = 0, last = null
for (let round = 1; round <= maxRounds; round++) {
  const runCheck = attempt => agent(
    `Запусти \`${command}\` в рабочей папке и разбери вывод. Ничего не меняй.\n` +
      'Верни: прошла ли проверка, сколько всего падений, и до 20 самых показательных (сначала те, что похожи на первопричину, а не на следствия).',
    { label: `проверка, круг ${round}${attempt > 1 ? ' (повтор)' : ''}`, phase: 'Проверка', effort: 'low', schema: CHECK },
  )
  last = (await runCheck(1)) ?? (await runCheck(2))
  if (!last) {
    log('Проверка не запустилась дважды — останавливаюсь')
    return { report: `## Не удалось запустить проверку \`${command}\`\n\nАгент проверки дважды завершился с ошибкой. Кругов починки до этого: ${rounds.length}.`, passed: false, command, rounds: rounds.length, changed: [...new Set(rounds.flatMap(r => r.fix?.changed ?? []))], remaining: [] }
  }
  if (last.passed) { log(`Круг ${round}: зелёное ✅`); break }
  log(`Круг ${round}: падений ${last.total}`)
  if (last.total < best) { best = last.total; stale = 0 } else if (++stale >= 2) { log('Два круга без продвижения — останавливаюсь'); break }
  if (round === maxRounds) break
  const fix = await agent(
    `Цель: устранить причины падений проверки \`${command}\`.\nПадения:\n` +
      last.failures.map(f => `- ${f.what}${f.file ? ` (${f.file})` : ''}: ${f.message}`).join('\n') +
      '\n\nПравила: чини первопричину в коде, а не симптом. Нельзя ослаблять, пропускать или удалять тесты и проверки, менять ожидаемые значения под неверный результат, отключать правила линтера. ' +
      'Начни с падений, которые похожи на причину остальных. Перед возвратом сам запусти проверку и убедись, что стало лучше. Если упёрся в то, что требует решения человека (секрет, внешний сервис, спорное поведение) — остановись и опиши в blocked.',
    { label: `починка, круг ${round}`, phase: 'Починка', schema: FIX },
  )
  rounds.push({ round, failures: last.total, fix })
  if (fix?.blocked) { log(`Нужно решение человека: ${fix.blocked}`); break }
}

const changed = [...new Set(rounds.flatMap(r => r.fix?.changed ?? []))]
const AUDIT = { type: 'object', required: ['honest', 'concerns'], properties: { honest: { type: 'boolean' }, concerns: { type: 'array', items: { type: 'string' } } } }
let audit = null
if (last?.passed && changed.length) {
  audit = await agent(
    `Ты контролёр. Проверка \`${command}\` стала зелёной после правок в файлах: ${changed.join(', ')}. Посмотри изменения (git diff) и убедись, что исправлены причины, а не заглушены симптомы: ` +
      'не ослаблены и не пропущены тесты, не изменены ожидаемые значения под неверный результат, не отключены правила, не добавлены try/catch, проглатывающие ошибки. Ничего не меняй.',
    { label: 'контроль честности починки', phase: 'Контроль', schema: AUDIT },
  )
}
const report = last?.passed
  ? `## Проверка \`${command}\` проходит ✅\n\nКругов починки: ${rounds.length}.` + (changed.length ? `\nИзменены файлы: ${changed.join(', ')}.` : '') +
    (rounds.length ? `\n\n${rounds.map(r => `- Круг ${r.round} (было падений: ${r.failures}): ${r.fix?.summary ?? '—'}`).join('\n')}` : '')
  : `## Проверка \`${command}\` всё ещё падает\n\nОсталось падений: ${last?.total ?? '?'}.` +
    (rounds.length ? `\n\n${rounds.map(r => `- Круг ${r.round} (было падений: ${r.failures}): ${r.fix?.summary ?? '—'}${r.fix?.blocked ? ` — нужно решение: ${r.fix.blocked}` : ''}`).join('\n')}` : '') +
    (last?.failures?.length ? `\n\nЧто осталось:\n${last.failures.slice(0, 8).map(f => `- ${f.what}: ${f.message}`).join('\n')}` : '')

const warning = audit && !audit.honest ? `\n\n⚠️ Контролёр сомневается в честности починки:\n${audit.concerns.map(c => `- ${c}`).join('\n')}` : ''
return { report: report + warning, passed: !!last?.passed, honest: audit ? audit.honest : null, command, rounds: rounds.length, changed, remaining: last?.passed ? [] : (last?.failures ?? []) }
