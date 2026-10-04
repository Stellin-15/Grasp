# Grasp: Understand Any Codebase, Down to the Logic

Free, local-first, open-source CLI + viewer that turns any repository (open source, legacy, inherited, or AI-written) into a deep, code-level explanation you can learn from, and then helps you contribute to it.

> **How to use this file with Claude Code:** put it in the repo root and say: "Read PROJECT_PLAN (Grasp).md fully. Build Phase 0 and Phase 1. Follow section 15 (working agreement). Stop and summarize when Phase 1 is done." Then repeat per phase using the kickoff prompts in section 14.

Repo name: `grasp`
Fallback names if taken: `codetrail`, `understood`, `clearcode`, `whycode`
Tagline: _Clone any repo. Understand every line. Make your first contribution._

---

## 1. Why this exists

**The pain is real, and it is not limited to AI code.** The biggest barrier to contributing to open source is not writing code, it is understanding someone else's code: where things live, how data flows, why a function is written the way it is, and what will break if you touch it. Most repos have a README and maybe a CONTRIBUTING file, and almost none have documentation at the level of functions and logic. AI-written code makes this worse (code that works but nobody understands), but the problem is universal.

**Who feels it:**

- Developers who want to contribute to open source but bounce off large unfamiliar codebases
- Students and self-taught developers who learn best by reading real production code
- Engineers joining a new team or inheriting a legacy project
- Maintainers who want newcomers to ramp up without answering the same questions
- People reviewing or maintaining AI-generated code

**What they ask for:** a detailed explanation of the whole codebase, not just a summary; explanations of the actual logic inside functions; the _why_ behind code (from history, not guesses); a guided reading order; explanations at different skill levels; help going from "I found an issue" to "I know which files to change"; and all of it local, free, and without modifying the project they are studying.

**What already exists (do not copy, learn from):**

| Tool                                                    | What it does                                     | Gap Grasp fills                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| DeepWiki and clones (RepoWiki, deepwiki-open, repowise) | Auto wiki + chat                                 | Page-level summaries, not exhaustive symbol and logic docs; no completeness check; original is SaaS |
| Doc generators (TypeDoc, Sphinx, rustdoc, godoc)        | Render existing docstrings                       | Only as good as the comments that exist; no explanation of logic                                    |
| Sourcegraph, code search                                | Navigate and search                              | Finds code, does not explain it                                                                     |
| CodeRabbit-style walkthroughs                           | Per-PR explanation                               | Hosted, per-diff only, no repo-wide understanding                                                   |
| vibecoding-edu-tool, code-to-course skills              | Teach/explain code                               | One-off, no coverage over time, no contribution path                                                |
| Ma'at, katalint, Intent                                 | Docs-as-code, instruction linting, decision logs | Built for a repo's own maintainers, not for learners                                                |

**The bet (my inference, validate it, see section 10):** nobody owns **exhaustive, grounded, code-level documentation of any repo, generated locally, paired with a measure of what you have actually understood and a path to contributing.** DeepWiki tells you what a repo is about. Grasp teaches you how every part of it works.

**Design lessons baked in:**

- LLM explanations can be confidently wrong. So Grasp computes facts statically first (signatures, callers, callees, tests, git history) and the LLM only writes prose on top of those facts. Every claim cites file and line, and citations are verified mechanically.
- Large repos are expensive to document. Generation is bottom-up (symbols, then files, then folders, then the repo), hash-gated so only changed parts regenerate, resumable, and always shows a cost estimate first.
- You usually do not own the repo you are studying. Grasp never writes into it by default; all output lives in a separate workspace.
- "Comment the why, never the what" still holds for anything Grasp writes into source.

## 2. Positioning and principles

**For:** anyone who needs to understand code they did not write, with open-source contributors and learners as the primary audience. AI-heavy repos are one important case, not the whole product.

**Promise:** point Grasp at any repo. In 5 minutes, with no API key, get a map, a reading order, and a full structural reference of every file and symbol. With an LLM backend you already have, get a complete, cited, code-level explanation of the entire codebase, at your skill level, and a plan for your first contribution.

Principles:

1. **Any repo, any author.** Nothing depends on the code being AI-written or on the repo having Grasp installed.
2. **Exhaustive, not summary.** The goal is that every file and every non-trivial function has a real explanation of its logic. Completeness is measured and shown.
3. **Grounded.** Static facts first, LLM prose second, citations on every claim, mechanical verification of every citation.
4. **Non-invasive.** Studying a repo never modifies it. In-repo output is opt-in for maintainers.
5. **Free and local-first.** No server, no account, no telemetry. Uses the agent CLI you already have (Claude Code, Codex, Gemini CLI); API keys and Ollama are optional.
6. **Honest signals.** Coverage, risk, and authorship estimates show their evidence and are never claimed as proof.

## 3. The documentation model (the core of the product)

Grasp documents a codebase at five levels. Each level is built from the level below it, so higher-level docs are summaries of verified lower-level docs, not fresh guesses.

| Level | Unit                                             | What it contains                                                                                                                                                                                                       |
| ----- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L0    | Repository                                       | What the project does, who uses it, how to build/run/test, tech stack and frameworks, CI/CD pipelines, architecture diagram (Mermaid), main data flows, entry points, folder map, glossary, conventions, reading order |
| L1    | Folder / module                                  | Responsibility of the module, its public surface, what depends on it and what it depends on, key files, internal data flow, gotchas                                                                                    |
| L2    | File                                             | Purpose, every symbol it defines (with one-line summaries), imports and why they are needed, exported API, how this file is used elsewhere, tests that cover it                                                        |
| L3    | Symbol (function, method, class, type, constant) | Full reference entry, see template below                                                                                                                                                                               |
| L4    | Logic walkthrough                                | Step-by-step explanation of the body of non-trivial functions, block by block with line ranges, including every branch, loop, and error path                                                                           |

**L3 symbol entry template** (fields marked _static_ are computed without an LLM):

- **Signature** _(static)_: name, parameters, types, defaults, return type
- **Location** _(static)_: file and line range, link to source
- **Purpose**: what it does and why it exists, in plain language
- **Parameters**: meaning of each, valid ranges, what happens on unexpected input
- **Returns**: what and when, including null/empty/error cases
- **Logic walkthrough (L4)**: numbered steps, each citing a line range: "Lines 42 to 51: validates the token. If it is expired, returns early with 401 because..."
- **Branches and edge cases**: every condition and what triggers it
- **Errors and failure modes**: what it throws or returns on failure, and who handles it
- **Side effects**: I/O, network, database, mutation of arguments or global state, logging
- **State and invariants**: assumptions it relies on and guarantees it keeps
- **Concurrency and performance**: async behavior, locking, complexity, hot paths, when relevant
- **Called by** _(static)_: call sites with file and line
- **Calls** _(static)_: callees, with links to their docs
- **Tested by** _(static)_: tests that reference it
- **Real usage example** _(static extraction)_: taken from an actual call site or test, never invented
- **History** _(static, from git)_: when introduced, notable changes, linked commit messages and PR titles, which is where real "why" comes from
- **Gotchas**: surprising behavior, known pitfalls, related open TODOs/FIXMEs
- **Related**: sibling symbols, alternative APIs, the concept page it belongs to

**Project infrastructure docs** (everything about how this specific repo is built, tested, shipped, and what it is built with; detected from files in the repo, never from a generic list):

- **Tech stack and frameworks:** every framework, major library, runtime, and tool, detected from manifests and lockfiles (`package.json`, `pyproject.toml`, `requirements*.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `Gemfile`, `composer.json`, `*.csproj`, and others). For each one:
  - Name, version (declared and locked), and category (web framework, ORM, test runner, bundler, linter, UI library, CLI parser, and so on)
  - **Brief idea:** what the framework is in two or three sentences, for someone who has never used it
  - **How this repo uses it:** where it is imported or configured (file and line), which of its features the project relies on, and project-specific patterns built on top of it (e.g. "routes are registered in `src/server/routes.ts` using Express routers, one per resource")
  - **Config files** that control it, with each non-default setting explained
  - Link to the official docs for the exact major version used
  - Dev-only vs runtime dependency, and whether it is a direct or transitive dependency
- **CI/CD pipelines:** every pipeline definition found (GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Jenkinsfile, Travis, Buildkite, Bitbucket Pipelines, Drone, and pre-commit hooks). For each pipeline:
  - **Brief idea:** what the pipeline is for in one or two sentences (e.g. "runs tests on every PR and publishes to npm on version tags")
  - **Triggers:** push, PR, tags, schedules, manual dispatch, path filters
  - **Jobs and steps:** each job explained in order, with dependencies between jobs as a Mermaid diagram, matrix builds (OS, language versions), caching, and artifacts
  - **What a contributor's PR must pass:** the exact checks, and the local commands that reproduce each one
  - **Secrets and environment:** names only, never values, and what each is used for
  - **Deploy and release:** where the project ships (npm, PyPI, Docker registry, cloud, GitHub Releases), how versions are bumped, and what triggers a release
  - Reusable actions or templates used, with a brief idea of each
- **Build, run, and environment:** build tools and scripts (`package.json` scripts, Makefile targets, task runners), each explained; required environment variables (from `.env.example`, config loaders); Docker and docker-compose services; infrastructure as code (Terraform, Kubernetes manifests, Helm) at a summary level.
- **Quality tooling:** linters, formatters, type checkers, test frameworks, coverage tools, and their configs, so a contributor knows what will be enforced.

All of this is detected statically in Phase 1 (names, versions, files, triggers, jobs, steps) and explained by the LLM in Phase 2 (brief ideas, how-this-repo-uses-it, why a step exists). Every statement cites the config file and line.

**Cross-cutting docs** (built on top of L0 to L4):

- **Traces:** `grasp trace <entry>` follows an execution path (e.g. "what happens when an HTTP request hits /login") across files, step by step, citing each hop.
- **Concept pages:** recurring ideas in the codebase (caching layer, plugin system, event bus) explained once and linked from every place they appear.
- **Data model docs:** every schema, type, and table, with where it is created, read, and mutated.
- **Glossary:** project-specific terms and abbreviations, each linked to where it is defined.

**Audience levels:** every L0 to L4 page can be rendered `--for beginner | dev | reviewer`: analogies and no jargon; architecture and tradeoffs; risk and blast radius. Beginner mode also explains language features the code uses (e.g. "this is a Python decorator; here is what it does here").

**Triviality filter:** generated code, vendored code, lockfiles, migrations, simple getters and re-exports get static-only entries, not LLM prose. Configurable in `.grasp/config.json`.

**Completeness and freshness:** `grasp docs check` reports doc coverage (percent of files and non-trivial symbols with a current, verified entry), stale entries (source hash changed), and broken citations. This is the documentation equivalent of test coverage.

## 4. Feature set

### Pillar 1: Scan and map (no LLM, no network)

- `grasp scan`: repo map, language mix, size, entry points, build/test system detection, git hotspots (churn), folders without docs, top files to understand first
- `grasp stack`: detected frameworks, libraries, and tools with versions, categories, config files, and where each is used in the code
- `grasp pipelines`: every CI/CD pipeline with triggers, jobs, steps, matrix, job graph, and the local commands that reproduce each check
- **Reading order guide:** PageRank-style ordering over the import graph (entry points, then the core, then the leaves)
- **Static reference:** a full L2/L3 reference built only from parsing (signatures, call graph, tests, history, existing docstrings). Useful on its own, and the fact base for everything else.
- Export to Markdown, JSON, and HTML

### Pillar 2: Deep docs (the core)

- `grasp docs build [path] [--depth overview|file|symbol|logic] [--for ...]`: generates L0 to L4 docs as described in section 3, bottom-up, hash-gated, parallel, resumable
- `--dry-run` prints file count, symbol count, estimated tokens and cost per backend before any LLM call
- `grasp docs check`: completeness, freshness, citation verification
- `grasp docs update`: regenerates only what changed since last build (after `git pull`)
- `grasp explain <path|symbol|commit> --for beginner|dev|reviewer`: on-demand explanation of one thing, reusing built docs when they exist
- `grasp trace <entry>`: execution path walkthrough
- `grasp chat`: ask questions about the repo from the terminal, answered from the built docs plus source, with citations
- `grasp serve`: local viewer with folder tree, symbol pages, search, rendered Mermaid, cross-links, coverage heat map
- `grasp llms-txt`: machine-readable docs index for other agents
- **Steering:** `.grasp/config.json` controls what to document, what to skip, depth per folder, tone, default audience, and risk weights

### Pillar 3: Learn and track understanding

- Every file, folder, and symbol has a personal state: `unseen`, `skimmed`, `understood`
- `understood` is earned: read the explanation, then pass a short quiz (3 generated questions grounded in the code) or sign off explicitly (honor system). Stored with date and content hash.
- State **decays** when the code changes materially (hash mismatch), so after `git pull` you see what you need to re-read
- **Risk and value ranking for "read next":** import-graph centrality, git churn, sensitive paths (auth, payments, SQL, secrets handling), files touched by open issues you are interested in, and (only when detectable) AI-authored share
- `grasp next`: the single most valuable thing to read now
- `grasp exercise`: plants a small bug in a copy of real project code and asks you to find it (also feeds sign-off)
- `grasp course`: turns the repo into an interactive tutorial (lessons per module, diagrams, quizzes) as a local HTML bundle
- Personal score and report card; optional README badge for maintainers who opt in

### Pillar 4: Contribute

- `grasp onboard`: how to set up, build, run, and test this specific project, extracted from package manifests, Makefiles, CI workflows, Dockerfiles, and CONTRIBUTING. Shows commands; runs them only when asked.
- **Conventions extractor:** code style and lint config, test layout and naming, commit message format (learned from git log), branch and PR conventions, PR template, CLA/DCO requirements
- `grasp issue <number|url|pasted text>`: locates the code relevant to an issue (search plus graph plus LLM), produces a reading plan for exactly those files, a sketch of what would need to change, and which tests to run or add. Works offline with pasted text; fetching by number uses the `gh` CLI and requires `--network`.
- `grasp first-issues --network`: lists issues labeled good-first-issue / help-wanted, ranked by how much of the related code you already understand
- `grasp review`: before you open a PR, checks your changes against the project's conventions, runs the symbol-level diff (silent deletions, changed defaults, loosened conditions), and drafts a PR description in the project's style
- `grasp suggest commit` / `grasp suggest pr`: messages that match the project's conventions

### Pillar 5 (optional module): AI-assisted repos

Everything here is for people working on their own AI-heavy repos. It is off unless enabled with `grasp init`.

- `grasp init`: writes a tiny rules block (under ~25 lines) into `AGENTS.md` with marker blocks (`<!-- grasp:start -->` to `<!-- grasp:end -->`), idempotent, never overwrites user content. If a CLAUDE.md exists, adds a real `@AGENTS.md` import. Skill files in `.claude/skills/grasp/` and `.agents/skills/grasp/`. Verify each tool's current conventions before building.
- Rules say only: (1) write a change note at the end of each task, (2) comment only WHY / ASSUMPTION / GOTCHA, (3) never leave removed, loosened, or default-changed behavior unmentioned, (4) update the folder's `_ABOUT.md` when files are added or removed.
- Change notes in `.grasp/changes/YYYY-MM-DD-slug.md`: the ask, what changed, why, decisions, assumptions, what was removed / widened / defaulted differently, what to verify, files touched
- Estimated AI-authored share from co-author trailers and note files, shown with evidence
- `grasp drift`: compares a diff to the original ask and flags unrequested extras
- `grasp pr-comment` and a GitHub Action for reviewer-first PR walkthroughs
- `grasp doctor`: lints agent instruction files for bloat, conflicts, staleness, missing CLAUDE.md import

### Optional: MCP server

`get_symbol_doc(name)`, `get_file_doc(path)`, `get_folder_context(path)`, `get_codebase_guide()`, `get_reading_order()`, `trace(entry)`, `get_comprehension_gaps()`. Lets your coding agent use Grasp's docs instead of re-reading the whole repo.

## 5. Explicitly not building

- A hosted SaaS wiki, shared team dashboards, social comments
- Writing into a repo you are studying without an explicit opt-in
- Invented usage examples (examples come from real call sites and tests, or are clearly labeled and omitted by default)
- Auto-inserting comments into source by default (opt-in only, with an AST-equivalence safety check)
- Gamified scores that can be faked without reading

## 6. Architecture

TypeScript monorepo, pnpm workspaces, Node 22.12+ (see `docs/research.md`). Prefer WASM builds of tree-sitter to avoid native compile pain.

```
grasp/
  packages/
    core/        # scanner, language detection, import graph, symbol extraction,
                 # call graph, test linking, git history mining, hashing,
                 # reading order, risk/value scoring, config loader, workspace store
    langs/       # one tree-sitter query pack per language (symbols, imports, calls)
    infra/       # manifest/lockfile parsers, framework catalog, CI/CD pipeline
                 # parsers (GitHub Actions, GitLab CI, ...), build/env/docker detection
    docs/        # L0-L4 doc model, bottom-up builder, hash gating, citation
                 # verifier, completeness checker, renderers (md/json/html)
    explain/     # prompt templates per level and audience, backends: agent-cli | api | ollama
    learn/       # coverage store, decay, quiz, exercises, course generator
    contribute/  # onboard, conventions extractor, issue locator, review, suggest
    diff/        # symbol-level diff, drift check
    adapters/    # optional AI-repo module: AGENTS.md block, CLAUDE.md import, skills
    cli/         # `grasp` binary
    viewer/      # React + Vite local app
    mcp-server/  # optional
  action/        # GitHub Action: pr-comment + docs check
  examples/      # sample repos with generated docs, before and after
  docs/
```

**Workspace (where output lives):**

- **Default, non-invasive:** `~/.grasp/workspaces/<repo-id>/` (repo-id from remote URL plus root commit). Contains `docs/` (mirrored tree: one page per folder, file, and symbol), `facts.json` (static fact base), `coverage.json` (your personal understanding state), `cache/` (hashes, LLM outputs).
- **In-repo, opt-in** (`--in-repo`, for maintainers): `.grasp/` committed to git so a whole team shares docs and change notes.
- No database in v1. Plain files.

**Doc generation pipeline:**

1. Parse every file with tree-sitter, build the fact base (symbols, imports, calls, tests, history). Fail soft per file.
2. Order symbols so callees are documented before callers when possible.
3. For each L3/L4 unit: feed the LLM the source slice, the static facts, and the already-built docs of its callees. Ask for structured output matching the template.
4. Verify: every cited line range exists and contains the referenced identifier; every referenced symbol exists. Failed claims are dropped or flagged, never silently kept.
5. Roll up: file docs from symbol docs, folder docs from file docs, repo docs from folder docs.
6. Store with content hash of inputs, so unchanged units are reused on the next build.

**LLM backend order:** installed agent CLI (Claude Code, Codex, Gemini CLI) first, then direct API key, then local Ollama. Each wrapped behind one interface with fixture tests. Cost estimate and `--dry-run` before any LLM call. Concurrency and budget limits (`--max-cost`, `--max-files`).

**Safety:** scanner skips `.env`, keys, and anything in `.graspignore`. File contents go to an LLM only with an explicit flag (or a one-time confirmation per workspace) and after a secrets filter. Network access (GitHub issues, PRs) only with `--network`.

**Language support:** open source spans many languages, so languages are pluggable from day one.

- Tier 1 (Phase 1): JavaScript/TypeScript, Python
- Tier 2 (Phase 2 to 4): Go, Java, Rust, C, C++
- Tier 3 (Phase 6): C#, Ruby, PHP, Kotlin, Swift, others by community contribution
- Unsupported languages fall back to file-level docs without symbol extraction, and say so.

## 7. Phased build plan

### Phase 0: Scaffold

pnpm monorepo, TypeScript strict, ESLint, Prettier, Vitest, changesets, CI on mac/linux/windows, MIT license, README skeleton, CONTRIBUTING, issue templates.
**Done when:** build and tests pass in CI on all three OSes.

### Phase 1: The 5-minute map (no API key, no LLM, no network)

- Workspace store (out-of-repo by default), `.graspignore`, `.grasp/config.json`
- `grasp scan`: repo map, language mix, entry points, build/test detection, git hotspots, folders without docs
- Fact base for JS/TS and Python: symbols, imports, call graph, test linking, git history per symbol
- `grasp stack` (static): manifest and lockfile parsing for npm/pnpm/yarn, pip/poetry/uv, Go, Cargo, Maven/Gradle; framework catalog with categories and docs links; usage sites from imports
- `grasp pipelines` (static): parsers for GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, and pre-commit; Jenkinsfile and others listed as detected but not parsed yet
- Reading order guide
- Static reference docs (L2 and L3 static fields only) exported to Markdown, JSON, HTML
- `grasp onboard` (static extraction only)
  **Done when:** a stranger runs one command on an open-source repo they have never seen and, within 5 minutes, knows where to start reading and can look up any function's signature, callers, callees, tests, and history.

### Phase 2: Deep docs

- LLM backend interface (agent CLI first) with fixture tests and a fake backend for deterministic tests
- `grasp docs build` for L0 to L4, bottom-up, hash-gated, resumable, with `--dry-run` cost estimate
- Citation verifier and `grasp docs check` (completeness, freshness, broken citations)
- `grasp docs update` after `git pull`
- `grasp explain` with three audiences
- LLM-written infrastructure docs: brief idea per framework and pipeline, how this repo uses each framework, why each pipeline step exists
- Tier 2 languages start here
  **Done when:** on a medium open-source repo (roughly 200 to 500 files), every non-trivial function has an L3 entry with a logic walkthrough, docs check reports 100% citation validity, and a developer new to the repo says the docs taught them how it works.

### Phase 3: Viewer, traces, chat

- `grasp serve`: tree, symbol pages, search, Mermaid, cross-links
- `grasp trace`, concept pages, data model docs, glossary
- `grasp chat` grounded in the built docs
- `grasp llms-txt`
  **Done when:** a beginner can follow the generated guide and a trace for a real feature without opening the raw source first, and the viewer has zero broken links.

### Phase 4: Learn and track understanding

- Coverage states, sign-off, quiz, decay on hash change
- Risk/value ranking, `grasp next`, personal score and report card
- `grasp exercise`, `grasp course`
  **Done when:** you can run `grasp next`, read the doc, pass the quiz, pull an upstream change, and watch the affected parts decay honestly.

### Phase 5: Contribute

- Conventions extractor, full `grasp onboard`
- `grasp issue`, `grasp first-issues --network`
- Symbol-level diff, `grasp review`, `grasp suggest commit` / `grasp suggest pr`
  **Done when:** starting from a good-first-issue in a real open-source repo, a user gets the right files to read, a correct change sketch, and a PR description in the project's style, and a planted silent deletion is caught by review.

### Phase 6: AI-repo module, MCP, launch

- Optional AI-repo module (init, doctor, change notes, drift, pr-comment, GitHub Action)
- MCP server
- Tier 3 languages
- Docs site, demo GIF, before/after examples on well-known open-source repos, npm publish
- Launch posts (Show HN, relevant subreddits, open-source newcomer communities, X)

## 8. Making people genuinely use it

- **Value before setup:** Phase 1 needs no key, no account, and does not touch the repo.
- **Showcase real repos:** publish Grasp docs for a handful of popular open-source projects as examples. That is the best demo.
- **Maintainer pull:** maintainers can commit Grasp docs (`--in-repo`) or link a docs check badge to lower the newcomer barrier.
- **Contributor stories:** "I made my first PR to X using Grasp" is the growth loop.
- **Be honest:** generated docs are labeled, cited, and verified. Say what is static fact and what is LLM prose.
- **Proxy metrics without telemetry:** npm downloads, stars, public repos with a `.grasp/` folder, PRs mentioning Grasp.

## 9. Quality bar

- Fixture repos: tiny, medium, messy, multi-language, and one AI-heavy
- Golden-file tests for static fact extraction per language (symbols, imports, calls, tests)
- Golden-file tests for every manifest and pipeline parser (fixture `package.json`, `pyproject.toml`, workflow YAML, `.gitlab-ci.yml`, and so on), including malformed files that must fail soft
- Fake LLM backend for deterministic doc pipeline tests; golden docs for fixture repos
- Citation verifier tests (wrong line range, missing symbol, renamed symbol)
- Completeness and hash-gating tests (change one function, only its doc and its roll-ups regenerate)
- Coverage decay tests; risk-scoring tests with known-sensitive paths
- Symbol-diff tests (rename only, silent deletion, widened condition, changed default)
- Link checker on all generated docs; AST-equivalence test for any opt-in comment insertion
- `scan` on a 5k-file repo finishes in seconds; `docs build --dry-run` on a 5k-file repo finishes in seconds (budget and measure both)
- Idempotency tests for every adapter (run twice, no diff)

## 10. Validate before going big

1. Ship Phase 1 and post scan reports and reading orders for several popular open-source repos in different languages.
2. Ship Phase 2 on one or two of those repos and ask people who contribute to them: "Is this accurate? Would it have helped you ramp up?"
3. Share in open-source newcomer communities (first-timers, good-first-issue groups, language subreddits) and developer learning communities.
4. Talk to 5 to 10 maintainers. If they would link Grasp docs for newcomers, prioritize the in-repo mode and docs check badge. If learners care most, prioritize the viewer and learning mode.

## 11. Risks and honest constraints

- **LLM docs can be wrong.** Mitigation: static facts first, citations on every claim, mechanical verification, clear labels, audience-specific prompts tested on fixtures.
- **Cost on large repos.** Mitigation: dry-run estimates, depth control per folder, triviality filter, hash gating, resumable builds, local Ollama option.
- **Language coverage.** Mitigation: tree-sitter query packs per language, tiered rollout, honest fallback for unsupported languages.
- **Crowded neighborhood (DeepWiki and clones).** Mitigation: exhaustive symbol and logic docs, completeness metric, understanding tracking, and contribution path, none of which they do.
- **Sign-offs can be gamed.** Mitigation: quizzes, decay, exercises; scores are personal by default.
- **"Why" is hard to know for code you did not write.** Mitigation: mine commit messages, blame, and linked PRs; label inferred reasons as inferred.
- **Agent CLI backends differ** in flags and output. Wrap each behind one interface with fixture tests.
- **Tool conventions move fast** (AGENTS.md vs CLAUDE.md, skill folders). Isolate adapters, test them, log findings in `docs/research.md`.
- **Privacy and licensing.** Secrets filter, explicit flags, local-first default, out-of-repo workspace; respect repo licenses when publishing example docs.

## 12. Tech choices

| Area         | Choice                                                  | Why                                                 |
| ------------ | ------------------------------------------------------- | --------------------------------------------------- |
| Language     | TypeScript                                              | One language across CLI, viewer, action             |
| Monorepo     | pnpm workspaces + Turborepo                             | Fast, simple                                        |
| CLI          | commander or cac                                        | Small, stable                                       |
| Parsing      | tree-sitter (WASM)                                      | Multi-language, no native build                     |
| Git data     | git CLI via child process                               | Available everywhere, no native bindings            |
| Viewer       | React + Vite + Mermaid                                  | Lightweight local app                               |
| Tests        | Vitest + fixture repos + fake LLM backend               | Deterministic, conventions drift so fixtures matter |
| Distribution | npm (`npx grasp`), GitHub Action, later Homebrew/winget | Zero-friction install                               |

## 13. Definition of done for v1 (end of Phase 4)

- `npx grasp scan` on any supported repo gives a map, reading order, and static reference in under a minute, without touching the repo
- Tech stack and CI/CD pipeline docs are accurate for the repo they describe, with a brief idea of each framework and pipeline
- `grasp docs build` produces complete, cited L0 to L4 docs for a medium repo, and `grasp docs check` proves completeness and citation validity
- `grasp explain`, `grasp trace`, `grasp chat`, and the viewer work with the user's existing agent CLI
- Coverage, quiz, decay, and `grasp next` work
- README with demo GIF, example docs for real open-source repos, honest-limits section, MIT license, CI green

## 14. Kickoff prompts for Claude Code (copy one per phase)

- **Phase 0:** "Read PROJECT_PLAN (Grasp).md. Build Phase 0 only. Keep it minimal and make CI green on all three OSes. Summarize and stop."
- **Phase 1:** "Build Phase 1. No network and no LLM calls allowed in this phase. Output goes to the out-of-repo workspace by default. Add fixture repos and golden tests for JS/TS and Python fact extraction, manifest parsing, and pipeline parsing. Run `grasp scan` on this repo and on one small open-source repo, and show me the output. Summarize and stop."
- **Phase 2:** "Build Phase 2. Start with the LLM backend interface and a fake backend, then the L3/L4 symbol docs with the citation verifier, then roll-ups to L2, L1, L0, then docs check and update. Every generated claim must cite file and line and pass verification. Summarize and stop."
- **Phase 3:** "Build Phase 3: viewer, trace, concept pages, data model docs, glossary, chat, llms-txt. Summarize and stop."
- **Phase 4:** "Build Phase 4: coverage store, quiz, decay, ranking, `grasp next`, exercise, course. Write tests proving decay works in both directions. Summarize and stop."
- **Phase 5:** "Build Phase 5: onboard, conventions, issue locator, first-issues, symbol-level diff (with rename, silent deletion, widened condition, changed default tests), review, suggest. Summarize and stop."
- **Phase 6:** "Build Phase 6: optional AI-repo module, MCP server, Tier 3 languages, docs site, launch assets. Summarize and stop."

## 15. Working agreement for Claude Code

- Work phase by phase. Stop and summarize at the end of each phase. Do not start the next phase unprompted.
- Before building anything that depends on an external convention (tree-sitter grammars, agent CLI flags, AGENTS.md and CLAUDE.md loading rules, skill folder locations, GitHub APIs, MCP spec), check the current official docs and record findings in `docs/research.md`.
- Never write into a target repo unless the user passed an explicit in-repo flag.
- Static facts before LLM prose. Every generated claim cites file and line and passes the citation verifier.
- Phase 1 must not require any API key or network access.
- Never send file contents to an LLM without an explicit flag and the secrets filter. Never log secrets.
- Every language pack, adapter, parser, and diff rule ships with fixtures and tests. Fail soft: a bad file must never crash a scan or a docs build.
- Dogfood from Phase 1: run Grasp on this repo and keep its own docs complete.
- Comments in this repo follow the Grasp rule: why, assumption, gotcha. No comments that restate code.
- Ask before adding any dependency that needs native compilation.
- No em dashes in docs or user-facing text.
- When unsure about scope, choose the smaller option and note the question in the phase summary.
