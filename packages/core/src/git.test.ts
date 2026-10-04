import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blame, gitInfo, listGitFiles, readHistory, summarizeRange } from "./git.js";

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "grasp-git-"));
  // Gotcha: both commits would otherwise share a timestamp, making date order ambiguous.
  const git = (date: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Ada",
        GIT_AUTHOR_EMAIL: "ada@example.com",
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: "Ada",
        GIT_COMMITTER_EMAIL: "ada@example.com",
        GIT_COMMITTER_DATE: date,
      },
    });
  const d1 = "2024-01-01T00:00:00Z";
  const d2 = "2024-02-01T00:00:00Z";
  git(d1, "init", "-q", "-b", "main");
  await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
  await writeFile(join(dir, ".gitignore"), "ignored.txt\n");
  git(d1, "add", ".");
  git(d1, "commit", "-q", "-m", "add a");
  await writeFile(join(dir, "a.ts"), "export const a = 1;\nexport const b = 2;\n");
  await writeFile(join(dir, "ignored.txt"), "x");
  await writeFile(join(dir, "new.ts"), "x");
  git(d2, "commit", "-q", "-am", "add b");
  return dir;
}

describe("git", () => {
  it("reads repo info, files, history, and blame", async () => {
    const dir = await makeRepo();

    const info = await gitInfo(dir);
    expect(info.isGit).toBe(true);
    expect(info.branch).toBe("main");

    const files = await listGitFiles(dir);
    expect(files?.sort()).toEqual([".gitignore", "a.ts", "new.ts"]);

    const { files: history, commitsRead } = await readHistory(dir, 100);
    expect(commitsRead).toBe(2);
    expect(history["a.ts"]?.commits).toBe(2);
    expect(history["a.ts"]?.recent[0]?.subject).toBe("add b");

    const lines = await blame(dir, "a.ts");
    expect(lines[0]?.subject).toBe("add a");
    expect(lines[1]?.subject).toBe("add b");
    const range = summarizeRange(lines, 1, 2);
    expect(range.introduced?.subject).toBe("add a");
    expect(range.commits).toHaveLength(2);
  });

  it("degrades to no history outside git", async () => {
    const dir = await mkdtemp(join(tmpdir(), "grasp-nogit-"));
    expect((await gitInfo(dir)).isGit).toBe(false);
    expect((await readHistory(dir, 100)).commitsRead).toBe(0);
  });
});
