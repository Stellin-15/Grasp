import { Command, Option } from "commander";
import pc from "picocolors";
import { UserError } from "./analyze.js";
import {
  docsBuildCommand,
  onboardCommand,
  orderCommand,
  pipelinesCommand,
  scanCommand,
  showCommand,
  stackCommand,
} from "./commands.js";
import { VERSION } from "./version.js";

export { VERSION };

type Handler = (...args: never[]) => Promise<void>;

/** Turns expected failures into a one-line message instead of a stack trace. */
function run<T extends Handler>(fn: T): T {
  return (async (...args: never[]) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof UserError) {
        process.stderr.write(pc.red(`error: ${err.message}\n`));
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  }) as T;
}

function withCommon(cmd: Command): Command {
  return cmd
    .option("--json", "print machine-readable JSON")
    .option("--md", "print Markdown instead of terminal formatting")
    .option(
      "--workspace <dir>",
      "where Grasp stores its output (default: ~/.grasp/workspaces/<repo>)",
    )
    .option("--in-repo", "store output in <repo>/.grasp instead (for maintainers who commit it)")
    .option("--no-git", "ignore git: no history, list files from disk");
}

export function createProgram(): Command {
  const program = new Command()
    .name("grasp")
    .description("Understand any codebase, down to the logic.")
    .version(VERSION)
    .showHelpAfterError();

  withCommon(program.command("scan").argument("[path]", "repository to scan", "."))
    .description("map the repo: languages, entry points, reading order, risk, stack, pipelines")
    .action(run(scanCommand));

  withCommon(program.command("stack").argument("[path]", "repository", "."))
    .description("frameworks, libraries, runtimes, and tools, with where each is used")
    .action(run(stackCommand));

  withCommon(program.command("pipelines").argument("[path]", "repository", "."))
    .description("CI/CD pipelines: triggers, jobs, steps, secrets (names only), and local commands")
    .action(run(pipelinesCommand));

  withCommon(program.command("onboard").argument("[path]", "repository", "."))
    .description("how to set up, build, run, and test this project, and what a PR must pass")
    .action(run(onboardCommand));

  withCommon(program.command("order").argument("[path]", "repository", "."))
    .description("the order to read files in: entry points, then core, then the rest")
    .option("--limit <n>", "how many files to show", "30")
    .action(run(orderCommand));

  withCommon(
    program
      .command("show")
      .argument("<query>", "symbol, Class.method, file path, or path#Symbol")
      .argument("[path]", "repository", "."),
  )
    .description(
      "everything known about one symbol or file: signature, callers, callees, tests, history",
    )
    .action(run(showCommand));

  const docs = program.command("docs").description("generate documentation");
  withCommon(docs.command("build").argument("[path]", "repository", "."))
    .description(
      "write a cross-linked reference: one page per folder and file, a section per symbol",
    )
    .addOption(new Option("--format <format>", "md, html, or all").default("all"))
    .option("--no-history", "skip git blame (faster on very large repos)")
    .option("--history-limit <n>", "max files to read history for", "2000")
    .action(run(docsBuildCommand));

  return program;
}
