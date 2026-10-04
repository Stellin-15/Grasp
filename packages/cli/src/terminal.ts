import pc from "picocolors";

/** Visible width, ignoring ANSI color codes. */
function width(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/``([^`]+)``|`([^`]+)`/g, (_m, a: string | undefined, b: string | undefined) =>
      pc.cyan(a ?? b ?? ""),
    )
    .replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => pc.bold(t))
    .replace(
      /(^|[\s(])_([^_]+)_(?=[\s.,)]|$)/g,
      (_m, pre: string, t: string) => `${pre}${pc.dim(t)}`,
    )
    .replace(
      /(^|[\s(])\*([^*]+)\*(?=[\s.,)]|$)/g,
      (_m, pre: string, t: string) => `${pre}${pc.italic(t)}`,
    )
    .replace(/<a id="[^"]*"><\/a>/g, "")
    .replace(/\\\|/g, "|");
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cur += "\\|";
      i++;
    } else if (body[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += body[i];
  }
  cells.push(cur.trim());
  return cells;
}

function truncate(s: string, max: number): string {
  if (width(s) <= max) return s;
  // eslint-disable-next-line no-control-regex
  const plain = s.replace(/\x1b\[[0-9;]*m/g, "");
  return plain.slice(0, Math.max(1, max - 1)) + "…";
}

function renderTable(lines: string[], cols: number): string[] {
  const rows = lines
    .filter((l) => !/^\|\s*-{3}/.test(l.trim()))
    .map((l) => splitRow(l).map(inline));
  const n = Math.max(...rows.map((r) => r.length));
  const widths = Array.from({ length: n }, (_, i) =>
    Math.max(...rows.map((r) => width(r[i] ?? ""))),
  );
  // Shrink the widest columns until the table fits the terminal.
  const budget = Math.max(40, cols - 2 - 2 * (n - 1));
  while (widths.reduce((a, b) => a + b, 0) > budget) {
    const max = Math.max(...widths);
    const i = widths.indexOf(max);
    if (max <= 8) break;
    widths[i] = max - 1;
  }
  return rows.map((r, ri) => {
    const line = r.map((c, i) => {
      const t = truncate(c, widths[i] ?? 0);
      return t + " ".repeat(Math.max(0, (widths[i] ?? 0) - width(t)));
    });
    const text = "  " + line.join("  ").trimEnd();
    return ri === 0 ? pc.bold(text) : text;
  });
}

/** Renders Grasp's Markdown for a terminal: colors, aligned tables, no link syntax. */
export function mdToTerminal(md: string, cols = process.stdout.columns || 100): string {
  const out: string[] = [];
  const lines = md.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(pc.dim("    " + line));
      continue;
    }
    if (line.trim().startsWith("|")) {
      const block: string[] = [];
      while (i < lines.length && (lines[i] ?? "").trim().startsWith("|"))
        block.push(lines[i++] ?? "");
      i--;
      out.push(...renderTable(block, cols));
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const text = inline(h[2] ?? "");
      out.push(
        h[1] === "#"
          ? pc.bold(pc.magenta(text))
          : h[1] === "##"
            ? "\n" + pc.bold(text)
            : pc.bold(pc.dim("› ") + text),
      );
      continue;
    }
    if (line.startsWith("> ")) {
      out.push(pc.dim("  │ " + inline(line.slice(2))));
      continue;
    }
    out.push(inline(line));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}
