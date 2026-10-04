import { describe, expect, it } from "vitest";
import { add, sumAll } from "../src/utils/math.js";

describe("math", () => {
  it("adds", () => {
    expect(add(1, 2)).toBe(3);
  });

  it("sums", async () => {
    expect(await sumAll(1, 2, 3)).toBe(6);
  });
});
