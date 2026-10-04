import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, listFiles, scanRepo, type BlameLine } from "@grasp/core";
import { buildOnboarding } from "@grasp/contribute";
import { detectInfra } from "@grasp/infra";
import { defaultPacks } from "@grasp/langs";
import { Lexer, type Token } from "marked";
import { describe, expect, it } from "vitest";
import { pagesToHtml } from "./html.js";
import { renderReport } from "./markdown.js";
import { buildReference, type DocPage } from "./reference.js";
import { buildReport } from "./report.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

async function analyze(name: string) {
  const root = fixture(name);
  const { facts } = await scanRepo(root, {
    packs: defaultPacks(),
    config: DEFAULT_CONFIG,
    toolVersion: "test",
    useGit: false,
  });
  const { files } = await listFiles(root, { useGit: false });
  const repo = {
    files,
    readText: (p: string) => readFile(join(root, p), "utf8").catch(() => undefined),
  };
  const infra = await detectInfra(repo, facts.imports);
  const onboarding = await buildOnboarding(repo, infra);
  return { facts, report: buildReport({ facts, infra, onboarding, config: DEFAULT_CONFIG }) };
}

/** Every relative link in every page must point at an existing page and anchor. */
function brokenLinks(pages: DocPage[]): string[] {
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const broken: string[] = [];
  const visit = (tokens: Token[], page: DocPage) => {
    for (const t of tokens) {
      if (t.type === "link" && !/^(https?:|mailto:)/.test(t.href)) {
        const [file = "", hash] = t.href.split("#");
        const target = file
          ? posix.normalize(posix.join(posix.dirname(page.path), file))
          : page.path;
        const targetPage = byPath.get(target);
        if (!targetPage) broken.push(`${page.path} -> ${t.href}`);
        else if (hash && !targetPage.markdown.includes(`id="${hash}"`))
          broken.push(`${page.path} -> ${t.href} (anchor)`);
      }
      const nested = (t as { tokens?: Token[] }).tokens;
      if (nested) visit(nested, page);
      if (t.type === "table") {
        for (const cell of [...t.header, ...t.rows.flat()]) visit(cell.tokens, page);
      }
      if (t.type === "list") for (const item of t.items) visit(item.tokens, page);
    }
  };
  for (const p of pages) visit(Lexer.lex(p.markdown, { gfm: true }), p);
  return broken;
}

describe("js-app docs", async () => {
  const { facts, report } = await analyze("js-app");
  const blame = new Map<string, (BlameLine | undefined)[]>([
    [
      "src/auth/token.ts",
      Array.from({ length: 40 }, (_, i) => ({
        hash: i < 10 ? "a".repeat(40) : "b".repeat(40),
        author: "Ada",
        date: i < 10 ? "2024-01-01T00:00:00Z" : "2024-03-01T00:00:00Z",
        subject: i < 10 ? "add token service" : "harden token verification",
      })),
    ],
  ]);
  const pages = buildReference(facts, report, { blame });
  const page = (p: string) => pages.find((x) => x.path === p)?.markdown ?? "";

  it("renders the golden report", async () => {
    await expect(renderReport(report)).toMatchFileSnapshot("./__golden__/js-app.report.md");
  });

  it("renders golden folder and file pages", async () => {
    await expect(page("files/src/auth/token.ts.md")).toMatchFileSnapshot(
      "./__golden__/js-app.token.ts.md",
    );
    await expect(page("files/src/_folder.md")).toMatchFileSnapshot(
      "./__golden__/js-app.src-folder.md",
    );
  });

  it("creates a page for every parsed file and the repo-wide pages", () => {
    const paths = pages.map((p) => p.path);
    for (const p of [
      "index.md",
      "stack.md",
      "pipelines.md",
      "onboard.md",
      "reading-order.md",
      "files/_folder.md",
    ]) {
      expect(paths).toContain(p);
    }
    for (const f of facts.files.filter((f) => f.parsed && f.role === "source")) {
      expect(paths).toContain(`files/${f.path}.md`);
    }
  });

  it("has no broken links or anchors", () => {
    expect(brokenLinks(pages)).toEqual([]);
  });

  it("documents callers, callees, tests, and history per symbol", () => {
    const token = page("files/src/auth/token.ts.md");
    expect(token).toContain('id="sym-TokenService-verify"');
    expect(token).toMatch(/Called by\*\* \(1\)/);
    expect(token).toContain('introduced around `aaaaaaa` "add token service"');
    expect(token).toContain('last changed in `bbbbbbb` "harden token verification"');
    expect(page("files/src/utils/math.ts.md")).toContain("**Tested by:**");
  });

  it("converts to self-contained HTML", () => {
    const html = pagesToHtml(pages);
    const index = html.find((p) => p.path === "index.html")?.markdown ?? "";
    expect(index).toContain('href="stack.html"');
    expect(index).not.toMatch(/href="[^"]+\.md"/);
    expect(html.find((p) => p.path === "pipelines.html")?.markdown).toContain(
      '<pre class="mermaid">',
    );
  });
});
