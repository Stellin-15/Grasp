import { describe, expect, it } from "vitest";
import { parseJsonc } from "./jsonc.js";

describe("parseJsonc", () => {
  it("handles comments, trailing commas, and // inside strings", () => {
    const text = `{
      // line comment
      "url": "https://example.com/a", /* block */
      "paths": { "@/*": ["src/*"], },
    }`;
    expect(parseJsonc(text)).toEqual({ url: "https://example.com/a", paths: { "@/*": ["src/*"] } });
  });

  it("returns undefined for broken input", () => {
    expect(parseJsonc("{ nope")).toBeUndefined();
  });
});
