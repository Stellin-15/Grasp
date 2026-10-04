/**
 * Secret patterns removed from source before it is sent to any model.
 * Why: secret files are never read, but secrets also get hardcoded in normal
 * source files. Better to explain `[REDACTED]` than to ship a live key.
 */
const PATTERNS: [string, RegExp][] = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g],
  ["Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["OpenAI key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/g],
  ["Stripe key", /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}/g],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ["URL credentials", /(?<=[a-z+]+:\/\/)[^\s:/@]+:[^\s@/]{3,}(?=@)/gi],
];

/** `password = "hunter2xyz"`-style assignments with a long literal value. */
const ASSIGNMENT =
  /\b([A-Za-z_]*(?:secret|password|passwd|api[_-]?key|token|private[_-]?key|access[_-]?key)[A-Za-z_]*)(\s*[:=]\s*)(["'])([^"'\s]{8,})\3/gi;

export interface RedactResult {
  text: string;
  redactions: { kind: string; count: number }[];
}

export function redactSecrets(input: string): RedactResult {
  const counts = new Map<string, number>();
  let text = input;
  for (const [kind, re] of PATTERNS) {
    text = text.replace(re, (m) => {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      // Keep line breaks so cited line numbers stay correct.
      return "[REDACTED]" + "\n".repeat((m.match(/\n/g) ?? []).length);
    });
  }
  text = text.replace(ASSIGNMENT, (_m, name: string, sep: string, q: string, value: string) => {
    // Placeholders and env lookups are not secrets.
    if (/^(changeme|example|your[_-]|xxx|<|\$\{)/i.test(value))
      return `${name}${sep}${q}${value}${q}`;
    counts.set("hardcoded credential", (counts.get("hardcoded credential") ?? 0) + 1);
    return `${name}${sep}${q}[REDACTED]${q}`;
  });
  return { text, redactions: [...counts].map(([kind, count]) => ({ kind, count })) };
}
