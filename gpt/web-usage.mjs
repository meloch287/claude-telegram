const iso = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
const window = (label, usedPercent, resetsAt) => ({ label, usedPercent, resetsAt: iso(resetsAt), cost: null });
function provider(id, providerId, displayName, windows, stale = false, personal = false) {
  return { id, providerId, accountLabel: personal ? 'Мой лимит' : 'Общая подписка', displayName,
    logoUrl: null, icon: null, strings: { iconTint: null },
    signInHint: 'Доступ настраивает администратор бота.', expiredHint: 'Обратитесь к администратору бота.',
    usage: windows.length ? { status: 'ok', accountEmail: null, planLabel: (personal ? 'Личная квота' : 'Общая подписка') + (stale ? ' · данные устарели' : ''), windows }
      : { status: 'error', message: 'Подписка пока не передала лимиты. Повтори обновление позже.' } };
}
export function usageSnapshot({ hosts, gpt, claude, quota, claudeQuota }, filter = {}) {
  const providers = [];
  const bucket = gpt?.buckets?.find(b => b.id === 'codex') || gpt?.buckets?.[0];
  const gptWindows = [bucket?.primary, bucket?.secondary].filter(w => Number.isFinite(w?.usedPercent)).map(w =>
    window(w.windowDurationMins === 10080 ? 'Неделя' : w.windowDurationMins ? `${w.windowDurationMins / 60} ч` : 'Период OpenAI', w.usedPercent, w.resetsAt));
  providers.push(provider('codex-shared', 'codex', 'GPT', gptWindows, gpt?.stale));
  const personal = quota?.subscription;
  if (personal && personal.limit !== null && Number.isFinite(personal.limit) && Number.isFinite(personal.used))
    providers.push(provider('codex-personal', 'codex', 'GPT · мой лимит', [window(`Неделя · ≈${personal.used.toFixed(2)}% из ${personal.limit}% подписки`, personal.limit === 0 ? 100 : personal.used / personal.limit * 100, personal.resetsAt)], false, true));
  if (claude) {
    providers.push(provider('claude-shared', 'claude-code', 'Claude Code', (claude.windows || []).filter(w => Number.isFinite(w.used)).map(w => window(w.title, w.used, w.resetsAt)), claude.stale));
    const share = claudeQuota?.subscription;
    const windows = share && Number.isFinite(share.limit) && Number.isFinite(share.used) ? [window(`Неделя · ≈${share.used}% из ${share.limit}% подписки`, share.limit === 0 ? 100 : share.used / share.limit * 100, share.resetsAt)] : [];
    windows.push(...[['Сутки', claudeQuota?.daily], ['7 дней', claudeQuota?.weekly]].filter(([, w]) => w && Number.isFinite(w.limit) && Number.isFinite(w.used)).map(([label, w]) => window(`${label} · ${w.used.toLocaleString('ru-RU')} / ${w.limit.toLocaleString('ru-RU')} токенов`, w.limit === 0 ? 100 : w.used / w.limit * 100, w.resetsAt)));
    if (windows.length) providers.push(provider('claude-personal', 'claude-code', 'Claude · мой лимит', windows, false, true));
  }
  return { machines: hosts.filter(h => !filter.machineIds || filter.machineIds.includes(h.id)).map(h => ({
    id: h.id, displayName: 'Моя рабочая зона', status: h.status === 'connected' ? 'connected' : 'disconnected', error: null,
    providers: providers.filter(p => !filter.providerId || p.providerId === filter.providerId),
  })) };
}
export function createWebUsage({ subscription, claudeUsage, credential, payer, quota, claudeQuota }) {
  return async (uid, target, filter) => {
    const [hostsResponse, gpt, claude] = await Promise.all([
      fetch(target + '/api/v1/hosts', { signal: AbortSignal.timeout(8000) }),
      subscription.get(),
      credential(uid) ? claudeUsage(payer(uid)).catch(() => ({ stale: true, windows: [] })) : null,
    ]);
    if (!hostsResponse.ok) throw Error('Не удалось получить окружение bb');
    return usageSnapshot({ hosts: await hostsResponse.json(), gpt, claude, quota: quota(uid), claudeQuota: claudeQuota(uid) }, filter);
  };
}
