# Research log

Findings about external conventions Grasp depends on. Check the date; these move fast.

## 2026-10-04: toolchain (Phase 0)

- **TypeScript:** latest is 7.0.x (native port), but typescript-eslint 8.71 supports only `>=4.8.4 <6.1.0`. Pinned TypeScript 6.0.x until typescript-eslint supports 7.
- **Node:** Vitest 5, Commander 15, and Changesets 3 require Node 22.12 or newer. Node 20 is end of life (April 2026). Target is Node 22+, not Node 20+ as the plan first said.
- **ESLint:** 10.x, flat config only (`eslint.config.js`).
- **GitHub Actions:** latest major tags are `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`. `pnpm/action-setup` reads the pnpm version from `packageManager` in the root `package.json`.
- **npm name:** `grasp` is taken on npm (unrelated package, v0.6.0). `grasp-cli` was free on this date. Internal packages use the `@grasp/*` scope and stay private until a published name is chosen in Phase 6.
- **Turborepo:** deferred. With two packages, `tsc -b` project references handle build ordering. Revisit when builds get slow.

## 2026-10-04: parsing and detection (Phase 1)

- **tree-sitter:** `web-tree-sitter` 0.27.0 loads the WASM builds shipped inside `tree-sitter-javascript` 0.25.0 (ABI 15), `tree-sitter-typescript` 0.23.2 (ABI 14, includes `tsx`), and `tree-sitter-python` 0.25.0 (ABI 15). API: `Parser.init()`, `Language.load(path)`, `parser.parse(text)`, `tree.delete()` (WASM memory is not garbage collected).
- **Grammar packages have native install scripts** (`node-gyp-build`). Grasp never uses the native bindings; pnpm 10 skips dependency build scripts and `ignoredBuiltDependencies` in `pnpm-workspace.yaml` silences the warning. For the published package (Phase 6), copy the `.wasm` files into `@grasp/langs` so end users never run those scripts.
- **Performance (django, 7,084 files, 32-core Windows machine):** WASM parsing is about 6 s single-threaded for 2,900 Python files. Measures that brought a cold scan from 25 s to about 7 s and a warm scan to about 4 s:
  - `descendantsOfType` (native filtering) instead of visiting every node from JavaScript.
  - A worker-thread pool (`GRASP_WORKERS`, default cores - 1, max 8).
  - Skipping unchanged files by size + mtime, like git's index.
  - Compact JSON for the 60+ MB fact base.
  - Fewer git processes (each costs about 100 ms on Windows).
- **Determinism:** files finish in arbitrary order under concurrency, so facts are sorted before linking. Python `from pkg import mod` creates both a name binding and a submodule binding; the submodule wins explicitly.
- **YAML 1.2:** the `yaml` package parses GitHub Actions' `on:` key as a string (YAML 1.1 parsers turn it into `true`).
- **Mermaid** diagrams in HTML output load `mermaid@11` from jsdelivr in the viewer's browser. Grasp itself makes no network calls; offline, the diagram source stays readable.
- **Open question for Phase 2:** per-symbol history uses `git blame` (oldest surviving line). `git log -L` is exact but too slow for whole-repo docs; consider it for single-symbol `grasp show`.
