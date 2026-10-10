// Split before the Telegram character/block limits; never cut a surrogate pair.
export function splitText(text: string, limit: number, maxLines = 140): string[] {
  const pieces = [];
  while (text.length) {
    let cut = Math.min(limit, text.length),
      lines = 0;
    for (let i = 0; i < cut; i++)
      if (text[i] === "\n" && ++lines === maxLines) {
        cut = i + 1;
        break;
      }
    if (cut < text.length) {
      const line = text.lastIndexOf("\n", cut - 1);
      if (line > cut / 2) cut = line + 1;
    }
    if (cut < text.length && /[\uD800-\uDBFF]/.test(text[cut - 1]!)) cut--;
    pieces.push(text.slice(0, cut));
    text = text.slice(cut);
  }
  return pieces;
}
export function splitRichMarkdown(text: string, limit = 28000): string[] {
  if (limit < 256) throw new Error("Rich chunk limit too small");
  const lines = text.split("\n"),
    blocks = [];
  for (let i = 0; i < lines.length;) {
    const disclosure = lines[i]!.match(/^\s*<details(?: open)?><summary>[^\n]*<\/summary>\s*$/);
    if (disclosure && lines[i]!.length < Math.min(512, limit / 4)) {
      const opening = lines[i++]!, body: string[] = [];
      let depth = 1;
      while (i < lines.length) {
        const line = lines[i++]!;
        if (/^\s*<details(?: open)?[>\s]/.test(line)) depth++;
        if (/^\s*<\/details>\s*$/.test(line) && --depth === 0) break;
        body.push(line);
      }
      const content = body.join("\n").trim();
      const parts = content ? splitRichMarkdown(content, limit - opening.length - 16) : [""];
      for (const part of parts) blocks.push(`${opening}\n\n${part}\n\n</details>`);
      continue;
    }
    const match = lines[i]!.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (match && lines[i]!.length < 128) {
      const fence = match[1]!,
        opening = lines[i++]!,
        content = [];
      while (
        i < lines.length &&
        !new RegExp(`^\\s{0,3}${fence[0]}{${fence.length},}\\s*$`).test(lines[i]!)
      )
        content.push(lines[i++]);
      if (i < lines.length) i++;
      for (const part of splitText(content.join("\n"), limit - opening.length - fence.length - 2))
        blocks.push(`${opening}\n${part}\n${fence}`);
      if (!content.length) blocks.push(`${opening}\n${fence}`);
    } else if (
      lines[i]!.length + (lines[i + 1]?.length || 0) < limit / 2 &&
      lines[i]!.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1]!)
    ) {
      const header = lines[i++]! + "\n" + lines[i++]!;
      let block = header,
        rows = 0;
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        const row = lines[i++]!;
        if (block.length + row.length + 1 > limit || rows >= 140) {
          blocks.push(block);
          block = header;
          rows = 0;
        }
        if (header.length + row.length + 1 > limit) {
          blocks.push(...splitText(row, limit));
          continue;
        }
        block += "\n" + row;
        rows++;
      }
      blocks.push(block);
    } else {
      const line = lines[i++]!;
      blocks.push(...(line ? splitText(line, limit) : [""]));
    }
  }
  const pieces = [];
  let current = "",
    count = 0;
  for (const block of blocks) {
    const size = block.split("\n").length;
    if (current && (current.length + block.length + 1 > limit || count + size > 160)) {
      pieces.push(current);
      current = "";
      count = 0;
    }
    current += (current ? "\n" : "") + block;
    count += size;
  }
  if (current) pieces.push(current);
  return pieces;
}
