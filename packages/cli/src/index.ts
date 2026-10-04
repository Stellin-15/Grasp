import { Command } from "commander";

export const VERSION = "0.0.0";

export function createProgram(): Command {
  return new Command()
    .name("grasp")
    .description("Understand any codebase, down to the logic.")
    .version(VERSION);
}
