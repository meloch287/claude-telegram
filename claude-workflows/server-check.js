export const meta = {
  name: 'server-check',
  description: 'Проверка сервера только чтением: службы и порты, ресурсы, безопасность, ошибки в журналах, бэкапы и сертификаты; каждую находку перепроверяют',
  whenToUse: 'Просят проверить здоровье или безопасность сервера, «что с сервером», до или после выкатки. Ничего не меняет, только читающие команды; в Telegram удобнее режим «Автопроверка».',
  phases: [
    { title: 'Осмотр', detail: 'пять независимых проверок' },
    { title: 'Перепроверка', detail: 'каждая находка проверяется заново' },
  ],
}

// args: строка с целью ('local' или 'user@host') или { target?, focus? }
const input = typeof args === 'string' ? { target: args } : (args ?? {})
const target = String(input.target ?? 'local').trim() || 'local'
const focus = String(input.focus ?? '').trim()
const RUN = target === 'local'
  ? 'Команды запускай на этой машине.'
  : `Команды запускай на сервере через \`ssh -o BatchMode=yes -o ConnectTimeout=10 ${target} '<команда>'\`. Если доступа нет — сразу верни одну находку об этом.`
const RULES = 'Только читающие команды: никаких перезапусков, правок, установки пакетов, удаления и записи в файлы. Не выводи значения секретов. Если команде нужен sudo и его нет — так и отметь. Пиши по-русски.'

const FINDINGS = {
  type: 'object',
  required: ['ok', 'findings'],
  properties: {
    ok: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'что в порядке, коротко' },
    findings: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['severity', 'title', 'evidence', 'fix'],
        properties: {
          severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
          title: { type: 'string' },
          evidence: { type: 'string', description: 'команда и что она показала' },
          fix: { type: 'string', description: 'что сделать (не делать самому)' },
        },
      },
    },
  },
}
const VERDICT = { type: 'object', required: ['real', 'reason'], properties: { real: { type: 'boolean' }, reason: { type: 'string' } } }

const LENSES = [
  { name: 'Службы и порты', ask: 'упавшие и перезапускающиеся службы (systemctl --failed, рестарты), слушающие порты и что открыто наружу, контейнеры docker' },
  { name: 'Ресурсы', ask: 'место на дисках и inode, память и swap, нагрузка CPU, крупнейшие потребители, рост логов' },
  { name: 'Безопасность', ask: 'настройки sshd (вход root, пароли), файрвол, доступные обновления безопасности, лишние пользователи с sudo, права на чувствительные файлы' },
  { name: 'Журналы', ask: 'ошибки за последние сутки: journalctl -p err, dmesg, падения служб, OOM, повторяющиеся сбои' },
  { name: 'Бэкапы и сертификаты', ask: 'когда были последние бэкапы и где они лежат, сроки TLS-сертификатов, cron/таймеры обслуживания' },
]

const results = await pipeline(
  LENSES,
  lens => agent(
    `Цель: осмотр сервера (${target}) по теме «${lens.name}»: ${lens.ask}.\n` +
      (focus ? `Пользователь просит обратить внимание: ${focus}\n` : '') +
      `${RUN}\n${RULES}\nНаходки — только реальные проблемы с доказательством из вывода команды.`,
    { label: lens.name, phase: 'Осмотр', schema: FINDINGS },
  ),
  async (res, lens) => {
    if (!res) return { lens: lens.name, ok: [], findings: [] }
    const order = { critical: 0, major: 1, minor: 2 }
    const top = [...res.findings].sort((a, b) => order[a.severity] - order[b.severity])
    const checked = top.slice(0, 2), rest = top.slice(2)
    const verdicts = await parallel(checked.map(f => () => agent(
      `Ты скептик. Перепроверь находку осмотра сервера (${target}) заново, своей командой. ${RUN}\n${RULES}\n` +
        `Находка: ${f.title}\nДоказательство было: ${f.evidence}\nreal=true, только если проблема подтверждается сейчас.`,
      { label: `перепроверка: ${f.title.slice(0, 36)}`, phase: 'Перепроверка', effort: 'low', schema: VERDICT },
    )))
    return {
      lens: lens.name,
      ok: res.ok,
      findings: [
        ...checked.map((f, i) => ({ ...f, status: verdicts[i] == null ? 'unverified' : verdicts[i].real ? 'confirmed' : 'refuted' })),
        ...rest.map(f => ({ ...f, status: 'unverified' })),
      ],
    }
  },
)

const sections = results.filter(Boolean)
const findings = sections.flatMap(s => s.findings.filter(f => f.status !== 'refuted').map(f => ({ ...f, lens: s.lens })))
const order = { critical: 0, major: 1, minor: 2 }
findings.sort((a, b) => order[a.severity] - order[b.severity])
const SEV = { critical: '🔴 Критично', major: '🟠 Важно', minor: '🟡 Мелочь' }
const report = `## Сервер ${target}: ${findings.length ? `${findings.length} ${findings.length === 1 ? 'проблема' : 'проблем'}` : 'серьёзных проблем нет'}\n\n` +
  (findings.length ? findings.map(f => `- ${SEV[f.severity]} — **${f.title}** (${f.lens}${f.status === 'unverified' ? '; не перепроверено' : ''})\n  ${f.evidence}\n  Что сделать: ${f.fix}`).join('\n') + '\n\n' : '') +
  '**В порядке:**\n' + sections.map(s => `- ${s.lens}: ${s.ok.length ? s.ok.join('; ') : '—'}`).join('\n')

return { report, findings, target }
