# Grasp

**Clone any repo. Understand every line. Make your first contribution.**

Grasp is a free, local-first, open-source CLI that turns any codebase (open source, legacy, inherited, or AI-written) into a deep, code-level explanation you can learn from: what every file and function does, who calls it, what it calls, which tests cover it, how it changed over time, which frameworks the project uses and where, and what its CI/CD pipelines check. Then it helps you contribute.

> **Status: Phase 1 (static analysis, no LLM).** Everything below works today without an API key, an account, or network access. LLM-written explanations of each function's logic arrive in Phase 2. See the [project plan](<PROJECT_PLAN (Grasp).md>).

## Quick start

Requires Node 22.12+. Not on npm yet, so run from source:

```sh
git clone https://github.com/Stellin-15/Grasp && cd Grasp
corepack enable && pnpm install && pnpm build
node packages/cli/dist/bin.js scan /path/to/any/repo
```

## Commands

| Command                    | What you get                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grasp scan [path]`        | Repo map: languages, entry points, where to start reading, riskiest files, stack, pipelines, git hotspots, folders without docs.                               |
| `grasp order [path]`       | Full reading order: entry points, then the core that most code depends on, then the rest.                                                                      |
| `grasp show <name> [path]` | Everything about one function, method, class, or file: signature, parameters, docstring, callers, callees, tests, and git history (who introduced it and why). |
| `grasp stack [path]`       | Every framework and major library with a brief idea of what it is, its version, where this repo imports it, and the config files that control it.              |
| `grasp pipelines [path]`   | Every CI/CD pipeline: triggers, jobs, steps, job graph, secrets (names only), deploy targets, and the local commands that reproduce each check.                |
| `grasp onboard [path]`     | How to set up, build, run, and test this project, and exactly what a pull request must pass.                                                                   |
| `grasp docs build [path]`  | A cross-linked reference in Markdown and HTML: one page per folder and file, one section per symbol.                                                           |

Add `--json` for machine-readable output or `--md` for Markdown. Output is stored in `~/.grasp/workspaces/<repo>/`, never in the repo you are studying (use `--in-repo` if you maintain the repo and want to commit it).

## Principles

- **Any repo, any author.** Works on code you did not write.
- **Grounded.** Static facts first, LLM prose second; every claim cites file and line.
- **Non-invasive.** Studying a repo never modifies it. Secret files are skipped and never read.
- **Free and local-first.** No account, no telemetry, no network in Phase 1.

## Supported today

- **Languages (symbols, imports, calls):** JavaScript, TypeScript, TSX, Python. Other languages appear in maps and stats; deeper support follows the plan's language tiers.
- **Manifests:** npm, pnpm, Yarn, pip, Poetry, uv, Pipenv, Go modules, Cargo, Maven, Gradle, Bundler, Composer.
- **Pipelines:** GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, pre-commit (Jenkins, Travis, Bitbucket, Drone, Buildkite, AppVeyor, Cloud Build are detected and listed).

## Honest limits

- Call resolution is static and name-based. Calls through dynamic dispatch, dependency injection, or untyped variables are listed as unresolved rather than guessed.
- Risk and reading order are heuristics with visible reasons, not proof.
- Per-symbol history comes from `git blame`: it shows who last touched each line, which approximates when a symbol was introduced.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Each package has a README explaining its files.

## License

[MIT](LICENSE)
