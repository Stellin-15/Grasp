import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram, VERSION } from "./index.js";

const fixture = fileURLToPath(new URL("../../../fixtures/js-app", import.meta.url));

/** Runs the CLI in-process and captures stdout. */
async function run(...args: string[]): Promise<string> {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    out += String(chunk);
    return true;
  });
  try {
    await createProgram()
      .exitOverride()
      .parseAsync(["node", "grasp", ...args]);
  } finally {
    spy.mockRestore();
  }
  return out;
}

afterEach(() => {
  process.exitCode = undefined;
});

describe("grasp CLI", () => {
  it("prints the version", async () => {
    let output = "";
    const program = createProgram()
      .exitOverride()
      .configureOutput({ writeOut: (s) => (output += s) });
    // Gotcha: exitOverride makes commander throw instead of calling process.exit.
    await expect(program.parseAsync(["node", "grasp", "--version"])).rejects.toThrow();
    expect(output.trim()).toBe(VERSION);
  });

  it("scans into the workspace and never writes into the repo", async () => {
    const ws = await mkdtemp(join(tmpdir(), "grasp-cli-"));
    const before = await readdir(fixture);
    const json = JSON.parse(
      await run("scan", fixture, "--json", "--no-git", "--workspace", ws),
    ) as {
      entryPoints: { path: string }[];
      summary: { sourceFiles: number };
    };
    expect(json.entryPoints.map((e) => e.path)).toContain("src/index.ts");
    expect(json.summary.sourceFiles).toBeGreaterThan(5);
    for (const f of ["facts.json", "report.json", "report.md", "report.html"]) {
      expect((await stat(join(ws, f))).isFile()).toBe(true);
    }
    expect(await readdir(fixture)).toEqual(before);
  });

  it("shows a symbol with callers and a file with its importers", async () => {
    const ws = await mkdtemp(join(tmpdir(), "grasp-cli-"));
    const sym = JSON.parse(
      await run("show", "TokenService.verify", fixture, "--json", "--no-git", "--workspace", ws),
    ) as {
      symbols: { id: string; callers: { from: string }[] }[];
    };
    expect(sym.symbols[0]?.callers.map((c) => c.from)).toEqual(["src/server.ts#createServer"]);
    const text = await run("show", "src/utils/math.ts", fixture, "--no-git", "--workspace", ws);
    expect(text).toContain("Imported by");
  });

  it("reports an unknown symbol as a user error", async () => {
    const ws = await mkdtemp(join(tmpdir(), "grasp-cli-"));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await run("show", "doesNotExist", fixture, "--no-git", "--workspace", ws);
    stderr.mockRestore();
    expect(process.exitCode).toBe(1);
  });

  it("builds Markdown docs", async () => {
    const ws = await mkdtemp(join(tmpdir(), "grasp-cli-"));
    const out = JSON.parse(
      await run(
        "docs",
        "build",
        fixture,
        "--json",
        "--no-git",
        "--format",
        "md",
        "--workspace",
        ws,
      ),
    ) as {
      pages: number;
    };
    expect(out.pages).toBeGreaterThan(10);
    const page = await readFile(join(ws, "docs", "files", "src", "server.ts.md"), "utf8");
    expect(page).toContain("createServer");
  });

  it("prints stack, pipelines, onboarding, and reading order as Markdown", async () => {
    const ws = await mkdtemp(join(tmpdir(), "grasp-cli-"));
    const common = [fixture, "--md", "--no-git", "--workspace", ws];
    expect(await run("stack", ...common)).toContain("### Express");
    expect(await run("pipelines", ...common)).toContain("```mermaid");
    expect(await run("onboard", ...common)).toContain("pnpm test");
    expect(await run("order", ...common)).toContain("src/index.ts");
  });
});

describe("grasp CLI with Claude Code explanations (fake backend)", () => {
  /** Runs a command with the fake backend and stderr (plan and progress) captured. */
  async function runFake(...args: string[]): Promise<{ out: string; err: string }> {
    process.env.GRASP_BACKEND = "fake";
    let err = "";
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        err += String(chunk);
        return true;
      });
    try {
      const out = await run(...args);
      // eslint-disable-next-line no-control-regex
      return { out, err: err.replace(/\x1b\[[0-9;]*m/g, "") };
    } finally {
      spy.mockRestore();
      delete process.env.GRASP_BACKEND;
    }
  }

  it("dry-runs, explains, checks, and explains a single function", async () => {
    const ws = await mkdtemp(join(tmpdir(), "grasp-cli-ex-"));
    const common = [fixture, "--no-git", "--workspace", ws, "--format", "md"];

    const dry = await runFake("docs", "build", ...common, "--explain", "--dry-run");
    expect(dry.err).toMatch(/to generate/);
    await expect(stat(join(ws, "explanations"))).rejects.toThrow();

    const built = await runFake(
      "docs",
      "build",
      ...common,
      "--explain",
      "--yes",
      "--for",
      "beginner",
    );
    expect(built.err).toMatch(/Explained \d+ new, 0 cached/);
    const page = await readFile(join(ws, "docs", "files", "src", "auth", "token.ts.md"), "utf8");
    expect(page).toContain("**How it works**");

    const check = await runFake(
      "docs",
      "check",
      fixture,
      "--no-git",
      "--workspace",
      ws,
      "--for",
      "beginner",
      "--json",
    );
    expect((JSON.parse(check.out) as { completeness: number }).completeness).toBe(1);

    const again = await runFake(
      "docs",
      "build",
      ...common,
      "--explain",
      "--yes",
      "--for",
      "beginner",
    );
    expect(again.err).toMatch(/Explained 0 new, \d+ cached/);

    const one = await runFake(
      "explain",
      "TokenService.issue",
      fixture,
      "--no-git",
      "--workspace",
      ws,
      "--md",
    );
    expect(one.out).toContain("## How it works");
    expect(one.out).toContain("`src/auth/token.ts:11`");
  });

  it("asks for --yes before large runs when there is no terminal", async () => {
    const ws = await mkdtemp(join(tmpdir(), "grasp-cli-ex-"));
    const { err } = await runFake(
      "docs",
      "build",
      fixture,
      "--no-git",
      "--workspace",
      ws,
      "--explain",
    );
    expect(err).toMatch(/Rerun with --yes/);
    expect(process.exitCode).toBe(1);
  });
});

describe("grasp docs update", () => {
  it("re-explains only what changed", async () => {
    process.env.GRASP_BACKEND = "fake";
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const ws = await mkdtemp(join(tmpdir(), "grasp-cli-up-"));
      const common = [fixture, "--no-git", "--workspace", ws, "--format", "md", "--yes"];
      await run("docs", "update", ...common);
      const check = JSON.parse(
        await run("docs", "check", fixture, "--no-git", "--workspace", ws, "--json"),
      ) as {
        completeness: number;
      };
      expect(check.completeness).toBe(1);
    } finally {
      stderr.mockRestore();
      delete process.env.GRASP_BACKEND;
    }
  });
});
