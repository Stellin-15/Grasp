import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { listFiles } from "@grasp/core";
import { detectInfra } from "@grasp/infra";
import { describe, expect, it } from "vitest";
import { buildOnboarding } from "./onboard.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url));

async function onboard(name: string) {
  const root = fixture(name);
  const { files } = await listFiles(root, { useGit: false });
  const repo = {
    files,
    readText: (p: string) => readFile(join(root, p), "utf8").catch(() => undefined),
  };
  return buildOnboarding(repo, await detectInfra(repo));
}

describe("buildOnboarding", () => {
  it("builds the js-app guide", async () => {
    const g = await onboard("js-app");
    await expect(JSON.stringify(g, null, 2) + "\n").toMatchFileSnapshot(
      "./__golden__/js-app.onboard.json",
    );
    const titles = g.steps.map((s) => s.title);
    expect(titles.slice(0, 4)).toEqual([
      "Install the language runtime",
      "Install dependencies",
      "Configure environment variables",
      "Start backing services",
    ]);
    expect(g.steps.find((s) => s.title === "Run the tests")?.commands).toEqual([
      "pnpm test",
      "make test",
    ]);
    expect(g.prChecks.map((c) => c.command)).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm lint",
      "pnpm test",
    ]);
    expect(g.contributing.sections).toEqual([
      "Development setup",
      "Commit messages",
      "Pull requests",
    ]);
  });

  it("builds the py-app guide with hooks and GitLab checks", async () => {
    const g = await onboard("py-app");
    await expect(JSON.stringify(g, null, 2) + "\n").toMatchFileSnapshot(
      "./__golden__/py-app.onboard.json",
    );
    expect(g.steps.find((s) => s.title === "Install git hooks")?.commands).toEqual([
      "pre-commit install",
    ]);
    expect(g.prChecks.map((c) => c.command)).toContain("pytest");
    expect(g.prChecks.some((c) => c.command.includes("deploy"))).toBe(false);
  });
});
