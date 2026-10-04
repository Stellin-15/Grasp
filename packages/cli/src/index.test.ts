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
