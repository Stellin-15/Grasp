import { describe, expect, it } from "vitest";
import { createProgram, VERSION } from "./index.js";

describe("createProgram", () => {
  it("prints the version", async () => {
    let output = "";
    const program = createProgram()
      .exitOverride()
      .configureOutput({ writeOut: (s) => (output += s) });

    // Gotcha: exitOverride makes commander throw instead of calling process.exit.
    await expect(program.parseAsync(["node", "grasp", "--version"])).rejects.toThrow();
    expect(output.trim()).toBe(VERSION);
  });
});
