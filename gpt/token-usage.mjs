export function normalizeUsage(value = {}) {
  const out = {};
  for (const key of ["input_tokens", "cached_input_tokens", "output_tokens"]) {
    const n = value[key] ?? 0;
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Некорректный счётчик токенов Codex");
    out[key] = n;
  }
  if (out.cached_input_tokens > out.input_tokens) throw new Error("Кеш превышает входные токены");
  return out;
}
// Codex exec resume reports session totals, not the cost of the latest task.
export function usageDelta(current, previous) {
  const a = normalizeUsage(current),
    b = normalizeUsage(previous),
    out = {};
  for (const key of Object.keys(a)) {
    if (a[key] < b[key])
      throw new Error("Счётчик Codex сбросился: расход задачи нельзя подтвердить");
    out[key] = a[key] - b[key];
  }
  return normalizeUsage(out);
}
