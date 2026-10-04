# @grasp/core

The language-independent engine behind every Grasp command. It builds the **static fact base**: what files exist, what each one defines, what it imports and calls, which tests cover it, and how it changed in git. Everything is computed without an LLM, and every fact carries a file and line.

| File                        | Responsibility                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `types.ts`                  | The fact base schema (`RepoFacts`, `SymbolFact`, `CallFact`, ...). Start here.                   |
| `scan.ts`                   | Orchestrates a scan: list files, extract with language packs, resolve, link tests, read history. |
| `walk.ts`, `classify.ts`    | Which files to look at, which to skip (secrets are never read), and what role each file plays.   |
| `lang.ts`                   | The `LanguagePack` plugin interface that `@grasp/langs` implements.                              |
| `resolve.ts`                | Cross-file linking: imports through re-exports, calls to symbols, tests to code.                 |
| `graph.ts`, `risk.ts`       | Import graph, PageRank, entry points, reading order, and risk ranking.                           |
| `git.ts`                    | Read-only git: file list, history, blame.                                                        |
| `config.ts`, `workspace.ts` | Layered config and the out-of-repo workspace where output is stored.                             |
| `query.ts`                  | `FactIndex` for lookups such as "who calls this?".                                               |
