import { describe, expect, it } from "vitest";
import { repoId, resolveWorkspace, sanitizeRemote } from "./workspace.js";

describe("sanitizeRemote", () => {
  it("strips embedded credentials", () => {
    expect(sanitizeRemote("https://x-access-token:abc123@github.com/o/r.git")).toBe(
      "https://github.com/o/r.git",
    );
    expect(sanitizeRemote("git@github.com:o/r.git")).toBe("git@github.com:o/r.git");
  });
});

describe("repoId", () => {
  it("is the same for https and ssh clones of one remote", () => {
    expect(repoId("/a/grasp", "https://github.com/O/Grasp.git")).toBe(
      repoId("/b/grasp", "git@github.com:o/grasp.git"),
    );
  });

  it("falls back to the path without a remote", () => {
    expect(repoId("/a/x")).not.toBe(repoId("/b/x"));
    expect(repoId("/a/My Repo")).toMatch(/^my-repo-[0-9a-f]{8}$/);
  });
});

describe("resolveWorkspace", () => {
  it("prefers explicit dir, then in-repo, then home", () => {
    expect(resolveWorkspace("/r", "id", { dir: "/w" })).toBe("/w");
    expect(resolveWorkspace("/r", "id", { inRepo: true }).replaceAll("\\", "/")).toBe("/r/.grasp");
    expect(resolveWorkspace("/r", "id").replaceAll("\\", "/")).toMatch(/workspaces\/id$/);
  });
});
