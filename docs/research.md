# Research log

Findings about external conventions Grasp depends on. Check the date; these move fast.

## 2026-10-04: toolchain (Phase 0)

- **TypeScript:** latest is 7.0.x (native port), but typescript-eslint 8.71 supports only `>=4.8.4 <6.1.0`. Pinned TypeScript 6.0.x until typescript-eslint supports 7.
- **Node:** Vitest 5, Commander 15, and Changesets 3 require Node 22.12 or newer. Node 20 is end of life (April 2026). Target is Node 22+, not Node 20+ as the plan first said.
- **ESLint:** 10.x, flat config only (`eslint.config.js`).
- **GitHub Actions:** latest major tags are `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`. `pnpm/action-setup` reads the pnpm version from `packageManager` in the root `package.json`.
- **npm name:** `grasp` is taken on npm (unrelated package, v0.6.0). `grasp-cli` was free on this date. Internal packages use the `@grasp/*` scope and stay private until a published name is chosen in Phase 6.
- **Turborepo:** deferred. With two packages, `tsc -b` project references handle build ordering. Revisit when builds get slow.
