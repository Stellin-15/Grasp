import { describe, expect, it } from "vitest";
import { toPosixPath } from "./paths.js";

describe("toPosixPath", () => {
  it("converts Windows separators", () => {
    expect(toPosixPath("src\\core\\index.ts")).toBe("src/core/index.ts");
  });

  it("leaves POSIX paths unchanged", () => {
    expect(toPosixPath("src/core/index.ts")).toBe("src/core/index.ts");
  });
});
