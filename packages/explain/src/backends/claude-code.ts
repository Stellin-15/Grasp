import { spawn } from "node:child_process";
import {
  BackendError,
  type CompletionRequest,
  type CompletionResult,
  type LlmBackend,
} from "../backend.js";

const TIMEOUT_MS = 5 * 60 * 1000;

interface ClaudeJson {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, unknown>;
  api_error_status?: number | null;
}

/** Quotes one argument for cmd.exe, needed only when falling back to an npm `claude.cmd` shim. */
function winQuote(arg: string): string {
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[], input: string, shell: boolean): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, shell ? args.map(winQuote) : args, {
      shell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new BackendError("Claude Code did not answer within 5 minutes", true));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input, "utf8");
  });
}

export interface ClaudeCodeOptions {
  /** Model alias or id (`sonnet`, `opus`, `haiku`, `claude-opus-5-5`). Omit to use your Claude Code default. */
  model?: string | undefined;
  /** Hard spend cap per call, passed to `--max-budget-usd`. */
  maxBudgetUsd?: number | undefined;
  command?: string | undefined;
}

/**
 * Uses the Claude Code CLI the user already has, so explanations run on their
 * Claude plan with no API key. Every built-in tool is disabled (`--tools ""`):
 * the model sees only what Grasp sends and cannot read or change files.
 */
export class ClaudeCodeBackend implements LlmBackend {
  readonly id = "claude-code";
  readonly label = "Claude Code";
  readonly billing = "your Claude plan (via the claude CLI)";
  // Measured: about 3.6k input tokens per call once the default system prompt is replaced.
  readonly overheadTokens = 3600;
  readonly model: string;
  private readonly command: string;
  private useShell = false;

  constructor(private readonly opts: ClaudeCodeOptions = {}) {
    this.model = opts.model ?? "default";
    this.command = opts.command ?? process.env.GRASP_CLAUDE_BIN ?? "claude";
  }

  private async exec(args: string[], input: string): Promise<RunResult> {
    try {
      return await run(this.command, args, input, this.useShell);
    } catch (err) {
      // npm installs on Windows provide `claude.cmd`, which only runs through a shell.
      if (
        (err as NodeJS.ErrnoException).code === "ENOENT" &&
        process.platform === "win32" &&
        !this.useShell
      ) {
        this.useShell = true;
        return run(this.command, args, input, true);
      }
      throw err;
    }
  }

  async available(): Promise<boolean> {
    try {
      const r = await this.exec(["--version"], "");
      return r.code === 0 && /claude/i.test(r.stdout);
    } catch {
      return false;
    }
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const args = [
      "-p",
      "--output-format",
      "json",
      "--tools",
      "",
      "--no-session-persistence",
      "--system-prompt",
      req.system,
      "--json-schema",
      JSON.stringify(req.schema),
    ];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.opts.maxBudgetUsd) args.push("--max-budget-usd", String(this.opts.maxBudgetUsd));

    let r: RunResult;
    try {
      r = await this.exec(args, req.prompt);
    } catch (err) {
      if (err instanceof BackendError) throw err;
      throw new BackendError(
        `could not start Claude Code (${(err as Error).message}). Is \`claude\` installed and on PATH?`,
      );
    }
    let json: ClaudeJson;
    try {
      json = JSON.parse(r.stdout) as ClaudeJson;
    } catch {
      const detail = (r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ");
      throw new BackendError(
        `Claude Code returned no JSON (exit ${r.code}): ${detail.slice(0, 300)}`,
        true,
      );
    }
    if (json.is_error || json.structured_output === undefined) {
      const status = json.api_error_status ?? 0;
      throw new BackendError(
        `Claude Code reported an error${status ? ` (${status})` : ""}: ${(json.result ?? "no structured output").slice(0, 300)}`,
        status === 429 || status >= 500,
      );
    }
    const u = json.usage ?? {};
    return {
      data: json.structured_output,
      model: Object.keys(json.modelUsage ?? {})[0] ?? this.model,
      inputTokens:
        (u.input_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) +
        (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
      costUsd: json.total_cost_usd,
    };
  }
}
