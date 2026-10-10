export const meta = {
  name: 'plan',
  description: 'План сложной задачи: три независимых подхода, судьи сравнивают, итог — лучший план с рисками и проверками',
  whenToUse: 'Нетривиальная доработка, переезд, архитектурное решение или проект, где есть несколько разумных путей и цена ошибки высока. Не для мелких правок и не для вопросов, на которые есть один очевидный ответ.',
  phases: [
    { title: 'Разведка', detail: 'факты о проекте и задаче' },
    { title: 'Подходы', detail: 'три независимых плана с разных сторон' },
    { title: 'Оценка', detail: 'судьи сравнивают планы' },
    { title: 'Итог', detail: 'лучший план с прививкой идей' },
  ],
}

// args: строка с задачей или { task, constraints?, thorough? }
const input = typeof args === 'string' ? { task: args } : (args ?? {})
const task = String(input.task ?? input.goal ?? '').trim()
if (!task) throw new Error('Нужна задача: args = { task: "…" } или просто строка')
const constraints = String(input.constraints ?? '').trim()
const thorough = input.thorough === true

const CONTEXT = {
  type: 'object',
  required: ['facts', 'unknowns'],
  properties: {
    facts: { type: 'array', items: { type: 'string' }, description: 'Факты, важные для плана, с путём к файлу где уместно' },
    unknowns: { type: 'array', items: { type: 'string' }, description: 'Чего не удалось выяснить' },
  },
}
const PLAN = {
  type: 'object',
  required: ['title', 'summary', 'steps', 'risks', 'cost'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string', description: '2–3 предложения: суть подхода' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        required: ['step', 'check'],
        properties: { step: { type: 'string' }, check: { type: 'string', description: 'как понять, что шаг сделан правильно' } },
      },
    },
    risks: {
      type: 'array',
      items: { type: 'object', required: ['risk', 'mitigation'], properties: { risk: { type: 'string' }, mitigation: { type: 'string' } } },
    },
    cost: { type: 'string', description: 'объём работы и время, честная оценка' },
  },
}
const JUDGMENT = {
  type: 'object',
  required: ['scores', 'best', 'graft'],
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        required: ['plan', 'score', 'reason'],
        properties: { plan: { type: 'integer' }, score: { type: 'integer', minimum: 1, maximum: 10 }, reason: { type: 'string' } },
      },
    },
    best: { type: 'integer', description: 'номер лучшего плана (с 1)' },
    graft: { type: 'array', items: { type: 'string' }, description: 'сильные идеи проигравших планов, которые стоит взять' },
  },
}

phase('Разведка')
const context = await agent(
  `Цель: собрать факты для планирования задачи «${task}».\n` +
    'Изучи рабочую папку: КАРТА.md, README, CLAUDE.md, структуру, ключевые модули и всё, что связано с задачей. Только чтение — ничего не меняй и не запускай долгих команд.\n' +
    'Если задача не про код или контекста в папке нет — так и напиши в unknowns.\n' +
    'Верни коротко: факты (не больше 15) и пробелы.',
  { label: 'разведка', schema: CONTEXT },
)
const facts = context ? context.facts.map(f => `- ${f}`).join('\n') : '(разведка не удалась)'

phase('Подходы')
const ANGLES = [
  'быстрый результат: минимальный путь к работающему решению, что можно отложить без вреда',
  'надёжность: что может сломаться, как откатиться, как проверить, как не потерять данные',
  'люди и эксплуатация: удобство пользователей, простота поддержки, стоимость владения',
]
const plans = (await parallel(ANGLES.map((angle, i) => () =>
  agent(
    `Цель: составить план для задачи «${task}» с позиции «${angle}».\n` +
      (constraints ? `Ограничения пользователя: ${constraints}\n` : '') +
      `Известные факты:\n${facts}\n` +
      'Работай независимо: других планов ты не видишь. Можно читать файлы проекта, ничего не меняй.\n' +
      'Верни 4–9 конкретных шагов, у каждого — проверку; главные риски с мерами; честную оценку объёма. Пиши по-русски.',
    { label: `подход ${i + 1}`, phase: 'Подходы', schema: PLAN },
  ),
))).map((p, i) => p && { ...p, n: i + 1, angle: ANGLES[i] }).filter(Boolean)
if (!plans.length) throw new Error('Ни один план не получился')

phase('Оценка')
const listing = plans.map(p =>
  `ПЛАН ${p.n} (${p.angle}) — ${p.title}\n${p.summary}\nШаги: ${p.steps.map(s => s.step).join('; ')}\nРиски: ${p.risks.map(r => r.risk).join('; ')}\nОбъём: ${p.cost}`,
).join('\n\n')
const JUDGES = thorough ? ['корректность и полнота', 'риски и обратимость', 'скорость и простота'] : ['корректность и риски', 'скорость и простота поддержки']
const judgments = (await parallel(JUDGES.map(lens => () =>
  agent(
    `Ты судья. Задача: «${task}». Оцени планы по критерию «${lens}» от 1 до 10, выбери лучший и назови сильные идеи остальных, которые стоит привить победителю.\n\n${listing}`,
    { label: `судья: ${lens}`, phase: 'Оценка', schema: JUDGMENT },
  ),
))).filter(Boolean)

const totals = plans.map(p => ({
  n: p.n,
  score: judgments.reduce((s, j) => s + (j.scores.find(x => x.plan === p.n)?.score ?? 0), 0),
}))
totals.sort((a, b) => b.score - a.score)
const winner = plans.find(p => p.n === totals[0].n)
const grafts = [...new Set(judgments.flatMap(j => j.graft))].slice(0, 6)
log(`Лучший план: ${winner.n} (${winner.angle}), баллы: ${totals.map(t => `${t.n}→${t.score}`).join(', ')}`)

phase('Итог')
const final = await agent(
  `Собери итоговый план задачи «${task}» на основе победителя и привитых идей. Пиши по-русски, коротко и конкретно, в Markdown:\n` +
    '«## План» — нумерованные шаги, у каждого «Проверка: …»; «## Риски» — риск → мера; «## Что решить до старта» — открытые вопросы; «## Объём» — оценка.\n\n' +
    `Победитель:\n${JSON.stringify(winner)}\n\nПривить идеи:\n${grafts.map(g => `- ${g}`).join('\n') || '- нет'}\n\nФакты:\n${facts}`,
  { label: 'итоговый план' },
)

return {
  plan: final,
  chosen: { n: winner.n, angle: winner.angle, title: winner.title },
  scores: totals,
  unknowns: context?.unknowns ?? [],
}
