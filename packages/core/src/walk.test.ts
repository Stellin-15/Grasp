import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFiles } from "./walk.js";

async function tree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "grasp-walk-"));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

describe("listFiles (filesystem)", () => {
  it("honors .gitignore, .graspignore, config ignores, default dirs, and secrets", async () => {
    const root = await tree({
      "src/a.ts": "",
      "src/b.gen.ts": "",
      "src/skip.ts": "",
      "build-out/x.js": "",
      "node_modules/pkg/index.js": "",
      ".env": "SECRET=1",
      ".env.example": "SECRET=",
      "keys/server.pem": "",
      ".gitignore": "build-out/\n",
      ".graspignore": "*.gen.ts\n",
    });
    const result = await listFiles(root, { useGit: false, ignore: ["src/skip.ts"] });
    expect(result.files).toEqual([".env.example", ".gitignore", ".graspignore", "src/a.ts"]);
    expect(result.secretsSkipped).toBe(2);
    expect(result.ignoredByGrasp).toBe(2);
    expect(result.source).toBe("filesystem");
  });
});
