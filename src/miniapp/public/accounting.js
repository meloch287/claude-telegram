const make = (tag, className, text) => {
  const n = document.createElement(tag);
  n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
};
export const units = (n) => Number(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const date = (n) =>
  n
    ? new Date(n).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "не указан";
export function quotaCaption(q) {
  const unit = q.mode === "weighted" ? "ед." : "токенов";
  const line = (w) => `${units(w.used)} / ${w.limit === null ? "∞" : units(w.limit)} ${unit}`;
  const p = q.subscription;
  const primary = p
    ? `Pro за неделю: ≈${units(p.used)}% / ${p.limit === null ? "без личного ограничения" : units(p.limit) + "%"}. `
    : "";
  return primary || `Сегодня: ${line(q.daily)} · Неделя: ${line(q.weekly)}`;
}
export function renderPersonalQuota(container, q) {
  container.replaceChildren();
  container.hidden = false;
  container.append(make("h3", "", "Мой лимит"));
  if (q.subscription) {
    const p = q.subscription;
    const row = make("div", "quota-window");
    row.append(
      make("span", "", "Pro · оценка за неделю"),
      make(
        "strong",
        "",
        p.limit === null ? "Без личного лимита" : `${units(p.used)}% из ${units(p.limit)}%`,
      ),
    );
    container.append(row);
    if (p.limit !== null) {
      const bar = make("progress", "quota-progress");
      bar.max = 100;
      bar.value = p.percent;
      bar.setAttribute("aria-label", "Использовано личной недельной квоты Pro");
      container.append(bar);
    }
    container.append(
      make(
        "p",
        "note",
        `Сброс: ${date(p.resetsAt)}. ${p.exceeded ? "Новые запросы заблокированы до сброса." : ""}`,
      ),
    );
    container.append(
      make(
        "p",
        "note",
        `Оценка с ${date(p.startedAt)}: общий расход OpenAI распределяется между активными задачами по подтверждённому расходу, пока его нет — поровну. Округление и использование аккаунта вне бота влияют на оценку. Начатый запрос может превысить лимит.${p.pending ? " Расход текущей задачи уточняется." : ""}`,
      ),
    );
  }
  const windows = [
    ["Сегодня", q.daily],
    ["Неделя", q.weekly],
  ].filter(([, w]) => !q.subscription || w.limit !== null);
  for (const [title, w] of windows) {
    const row = make("div", "quota-window");
    row.append(
      make("span", "", title),
      make(
        "strong",
        "",
        `${units(w.used)} / ${w.limit === null ? "∞" : units(w.limit)} ${q.mode === "weighted" ? "ед." : "токенов"}`,
      ),
    );
    container.append(row);
    if (w.limit !== null) {
      const bar = make("progress", "quota-progress");
      bar.max = 100;
      bar.value = w.percent;
      bar.setAttribute("aria-label", title);
      container.append(bar);
    }
  }
  if (windows.length)
    container.append(
      make(
        "p",
        "note",
        q.exceeded
          ? "Лимит достигнут. Можно дождаться сброса или обратиться к администратору."
          : `Сброс суток: ${date(q.daily.resetsAt)} · недели: ${date(q.weekly.resetsAt)}.`,
      ),
    );
  if (windows.length && q.mode === "weighted")
    container.append(
      make(
        "p",
        "note",
        "Единицы учитывают модель, новый вход, кеш и выход. Это личная квота бота.",
      ),
    );
}
export function renderAccounting(container, data) {
  container.replaceChildren();
  const sub = data.subscription || { buckets: [], stale: true };
  const card = make("section", "account-card");
  const header = make("div", "account-heading");
  header.append(
    make(
      "h3",
      "",
      "ChatGPT " + (sub.buckets.find((b) => b.id === "codex")?.plan || "ChatGPT").toUpperCase(),
    ),
  );
  header.append(make("span", "account-source", sub.stale ? "Устарело" : "OpenAI"));
  card.append(header);
  const buckets = [...sub.buckets].sort((a, b) => (b.id === "codex") - (a.id === "codex"));
  if (!buckets.length)
    card.append(make("p", "note", "Лимиты сейчас недоступны. Это не означает, что осталось 0%."));
  const extra = make("details", "account-rates");
  extra.append(make("summary", "", "Другие лимиты"));
  for (const bucket of buckets) {
    const block = make("div", "account-bucket");
    const name =
      bucket.id === "codex"
        ? "Основной лимит"
        : bucket.id === "base_model_inference"
          ? "Резерв OpenAI"
          : bucket.name;
    if (bucket.id !== "codex") block.append(make("h4", "", name));
    let known = false;
    for (const w of [bucket.primary, bucket.secondary].filter(Boolean)) {
      known = true;
      const row = make("div", "quota-window");
      const period =
        w.windowDurationMins === 10080
          ? "Неделя"
          : w.windowDurationMins === 1440
            ? "Сутки"
            : w.windowDurationMins
              ? `${units(w.windowDurationMins / 60)} ч`
              : "Период OpenAI";
      row.append(
        make("span", "", period),
        make("strong", "", `${units(w.remainingPercent)}% осталось`),
      );
      block.append(row);
      const progress = make("progress", "quota-progress");
      progress.max = 100;
      progress.value = Math.min(100, w.usedPercent);
      progress.setAttribute("aria-label", name + " · использовано");
      block.append(progress);
      block.append(make("p", "note", `Сброс ${date(w.resetsAt)}`));
    }
    if (!known) block.append(make("p", "note", "OpenAI не передал окно лимита."));
    if (bucket.credits && (bucket.credits.unlimited || Number(bucket.credits.balance) > 0))
      block.append(
        make(
          "p",
          "note",
          `Дополнительные кредиты: ${bucket.credits.unlimited ? "без ограничений" : (bucket.credits.balance ?? "неизвестно")}`,
        ),
      );
    (bucket.id === "codex" ? card : extra).append(block);
  }
  if (extra.children.length > 1) card.append(extra);
  if (sub.ordinaryUsageAllowed === false)
    card.append(make("p", "account-warning", "OpenAI сообщил об ограничении обычных задач."));
  card.append(
    make(
      "p",
      "note",
      sub.fetchedAt
        ? "Обновлено " +
            new Date(sub.fetchedAt).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })
        : "Ожидаем данные OpenAI",
    ),
  );
  container.append(card);
  const meter = make("details", "account-card accounting-details");
  meter.append(make("summary", "", "Статистика расхода"));
  const facts = make("div", "account-facts");
  for (const [label, value] of [
    ["Сегодня, ед.", units(data.today.units)],
    ["Неделя, ед.", units(data.week.units)],
    ["Кеш", units(data.today.cachePercent) + "%"],
  ]) {
    const fact = make("div", "");
    fact.append(make("span", "", label), make("strong", "", value));
    facts.append(fact);
  }
  meter.append(facts);
  const table = make("table", "usage-table"),
    head = make("thead", ""),
    hr = make("tr", "");
  for (const t of ["Модель", "Новый вход", "Кеш", "Выход", "Единицы"]) hr.append(make("th", "", t));
  head.append(hr);
  table.append(head);
  const body = make("tbody", "");
  for (const r of data.today.models) {
    const row = make("tr", "");
    for (const t of [
      r.model.replace("gpt-6-", ""),
      units(r.input - r.cached),
      units(r.cached),
      units(r.output),
      units(r.units),
    ])
      row.append(make("td", "", t));
    body.append(row);
  }
  table.append(body);
  if (data.today.models.length) {
    const wrap = make("div", "usage-table-wrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("aria-label", "Расход по моделям, прокрутка по горизонтали");
    wrap.append(table);
    meter.append(wrap);
  } else meter.append(make("p", "note", "После включения нового учёта запросов ещё не было."));
  const history = make("details", "account-rates");
  history.append(make("summary", "", "Расход за последние 14 дней"));
  for (const d of data.days || [])
    history.append(
      make("p", "note", `${d.day} · ${units(d.units)} ед. · ${units(d.tokens)} токенов`),
    );
  if (!data.days?.length)
    history.append(make("p", "note", "История появится после первых запросов."));
  meter.append(history);
  const details = make("details", "account-rates");
  details.append(make("summary", "", "Как считаются единицы"));
  for (const [model, r] of Object.entries(data.rates))
    details.append(
      make(
        "p",
        "note",
        `${model.replace("gpt-6-", "").toUpperCase()}: новый вход ×${units(r.input / data.scale)}, кеш ×${units(r.cached / data.scale)}, выход ×${units(r.output / data.scale)}.`,
      ),
    );
  details.append(
    make(
      "p",
      "note",
      "Вход уже включает кеш: сначала вычитаем кеш, затем применяем коэффициенты. Коэффициенты основаны на относительных тарифах Standard. Усиленное рассуждение влияет через фактические выходные токены.",
    ),
  );
  details.append(
    make(
      "p",
      "note",
      `Версия ${data.version}. Учёт единиц с ${date(data.startedAt)}. Предыдущие токены сохранены отдельно; они не пересчитаны в единицы. Процент подписки из единиц не выводится.`,
    ),
  );
  meter.append(details);
  container.append(meter);
}

export function renderClaudeAccounting(container, data) {
  container.replaceChildren();
  const card = make("section", "account-card");
  const header = make("div", "account-heading");
  header.append(make("h3", "", "Claude Code"), make("span", "account-source", data.stale ? "Устарело" : "Anthropic"));
  card.append(header);
  for (const w of data.windows || []) {
    const block = make("div", "account-bucket"), row = make("div", "quota-window");
    row.append(make("span", "", w.title), make("strong", "", Number.isFinite(w.used) ? `${units(Math.max(0, 100 - w.used))}% осталось` : "Нет данных"));
    block.append(row);
    if (Number.isFinite(w.used)) {
      const bar = make("progress", "quota-progress"); bar.max = 100; bar.value = w.used;
      bar.setAttribute("aria-label", "Claude · " + w.title + " · использовано"); block.append(bar);
    }
    if (w.resetsAt) block.append(make("p", "note", `Сброс ${date(w.resetsAt)}`));
    card.append(block);
  }
  if (data.stale) card.append(make("p", "note", data.notice || "Свежие лимиты временно недоступны."));
  container.append(card);
}
