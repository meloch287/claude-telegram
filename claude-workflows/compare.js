export const meta = {
  name: 'compare',
  description: 'Сравнить варианты и выбрать: исследует каждый вариант в интернете по критериям, проверяет ключевые факты, двое судей выносят рекомендацию',
  whenToUse: 'Выбор между сервисами, библиотеками, хостингами, тарифами, технологиями или товарами; «что лучше для моей задачи». Нужен веб-поиск. Для одного факта или короткой справки не нужен.',
  phases: [
    { title: 'Варианты', detail: 'что сравниваем и по каким критериям' },
    { title: 'Исследование', detail: 'отдельный исследователь на вариант' },
    { title: 'Проверка', detail: 'перепроверка решающих фактов' },
    { title: 'Решение', detail: 'двое судей' },
  ],
}

// args: строка-вопрос или { question, options?: string[], criteria?: string[] }
const input = typeof args === 'string' ? { question: args } : (args ?? {})
const question = String(input.question ?? input.task ?? '').trim()
if (!question) throw new Error('Нужен вопрос: args = { question: "…", options?: [...] }')
let options = Array.isArray(input.options) ? input.options.map(String).filter(Boolean) : []
let criteria = Array.isArray(input.criteria) ? input.criteria.map(String).filter(Boolean) : []

const SETUP = {
  type: 'object',
  required: ['options', 'criteria'],
  properties: {
    options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
    criteria: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 6 },
  },
}
const FACTS = {
  type: 'object',
  required: ['option', 'facts', 'summary'],
  properties: {
    option: { type: 'string' },
    summary: { type: 'string', description: '2 предложения: кому подходит' },
    facts: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        required: ['criterion', 'claim', 'source'],
        properties: {
          criterion: { type: 'string' },
          claim: { type: 'string', description: 'конкретный факт: цифра, ограничение, условие' },
          source: { type: 'string', description: 'URL источника или «нет источника»' },
          decisive: { type: 'boolean', description: 'сильно влияет на выбор' },
        },
      },
    },
  },
}
const CHECKED = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'ok', 'note'],
        properties: { claim: { type: 'string' }, ok: { type: 'boolean' }, note: { type: 'string' } },
      },
    },
  },
}
const JUDGE = {
  type: 'object',
  required: ['ranking', 'recommendation'],
  properties: {
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        required: ['option', 'score', 'why'],
        properties: { option: { type: 'string' }, score: { type: 'integer', minimum: 1, maximum: 10 }, why: { type: 'string' } },
      },
    },
    recommendation: { type: 'string', description: 'что выбрать и при каких условиях передумать' },
  },
}

if (options.length < 2 || criteria.length < 3) {
  phase('Варианты')
  const setup = await agent(
    `Вопрос пользователя: «${question}».\n` +
      (options.length ? `Варианты пользователя: ${options.join(', ')}\n` : 'Предложи 2–4 самых разумных варианта (можно быстро поискать в интернете).\n') +
      (criteria.length ? `Критерии пользователя: ${criteria.join(', ')}\n` : 'Предложи 3–6 критериев, которые реально решают выбор в этой ситуации (цена, ограничения, надёжность, удобство и т. п.).\n') +
      'Пиши по-русски.',
    { label: 'варианты и критерии', effort: 'low', schema: SETUP },
  )
  if (!setup) throw new Error('Не удалось определить варианты')
  if (options.length < 2) options = setup.options
  if (criteria.length < 3) criteria = setup.criteria
}
options = options.slice(0, 4)
log(`Сравниваю: ${options.join(' · ')}; критерии: ${criteria.join(', ')}`)

const researched = await pipeline(
  options,
  option => agent(
    `Цель: собрать проверяемые факты о варианте «${option}» для вопроса «${question}».\nКритерии: ${criteria.join(', ')}.\n` +
      'Ищи через WebSearch; WebFetch — только если без страницы не обойтись. Предпочитай официальные сайты, документацию, прайсы, свежие обзоры. ' +
      'Для каждого критерия — конкретный факт с URL. Не выдумывай: не нашёл — так и напиши. Отметь decisive у фактов, которые решают выбор. Пиши по-русски.',
    { label: option, phase: 'Исследование', schema: FACTS },
  ),
  async (facts, option) => {
    if (!facts) return null
    const decisive = facts.facts.filter(f => f.decisive && f.source !== 'нет источника').slice(0, 3)
    if (!decisive.length) return { ...facts, checked: [] }
    const check = await agent(
      `Ты проверяющий. Найди независимое подтверждение или опровержение каждого утверждения о «${option}» (WebSearch, при необходимости WebFetch). ` +
        'ok=false, если источник устарел, противоречит или не подтверждается.\n' +
        decisive.map(f => `- ${f.claim} (источник: ${f.source})`).join('\n'),
      { label: `проверка: ${option}`, phase: 'Проверка', schema: CHECKED },
    )
    return { ...facts, checked: check?.results ?? [] }
  },
)
const dossiers = researched.filter(Boolean)
if (!dossiers.length) throw new Error('Исследование не удалось')

phase('Решение')
const brief = dossiers.map(d => {
  const bad = new Set(d.checked.filter(c => !c.ok).map(c => c.claim))
  return `ВАРИАНТ «${d.option}»: ${d.summary}\n` + d.facts.map(f => `- [${f.criterion}] ${f.claim}${bad.has(f.claim) ? ' (НЕ ПОДТВЕРДИЛОСЬ при проверке)' : ''}`).join('\n')
}).join('\n\n')
const verdicts = (await parallel(['что лучше для задачи пользователя прямо сейчас', 'риски и цена ошибки на горизонте года'].map(lens => () =>
  agent(
    `Ты судья. Вопрос: «${question}». Оцени варианты с позиции «${lens}» по фактам ниже (неподтверждённые факты не учитывай). Пиши по-русски.\n\n${brief}`,
    { label: `судья: ${lens}`, phase: 'Решение', schema: JUDGE },
  ),
))).filter(Boolean)

const totals = options.map(o => ({
  option: o,
  score: verdicts.reduce((s, v) => s + (v.ranking.find(r => r.option === o)?.score ?? 0), 0),
})).sort((a, b) => b.score - a.score)

const table = ['| Критерий | ' + dossiers.map(d => d.option).join(' | ') + ' |', '|---|' + dossiers.map(() => '---').join('|') + '|']
for (const c of criteria) {
  table.push(`| ${c} | ` + dossiers.map(d => (d.facts.find(f => f.criterion === c)?.claim ?? '—').replace(/\|/g, '/').slice(0, 90)).join(' | ') + ' |')
}
const sources = [...new Set(dossiers.flatMap(d => d.facts.map(f => f.source)).filter(s => /^https?:/.test(s)))].slice(0, 12)
const report = `## ${question}\n\n${table.join('\n')}\n\n**Итог судей:** ${totals.map(t => `${t.option} — ${t.score}`).join(', ')}\n\n` +
  verdicts.map(v => `- ${v.recommendation}`).join('\n') +
  (sources.length ? `\n\nИсточники:\n${sources.map(s => `- ${s}`).join('\n')}` : '')

return { report, ranking: totals, options, criteria }
