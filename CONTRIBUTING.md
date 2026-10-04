# Contributing to Grasp

Thanks for helping. Grasp is in early development, so issues and ideas are as valuable as code.

## Setup

Requirements: Node 22.12 or newer, and pnpm (run `corepack enable` to get the pinned version).

```sh
pnpm install
pnpm build
pnpm test
```

## Before opening a PR

Run the same checks CI runs:

```sh
pnpm format:check
pnpm lint
pnpm build
pnpm test
```

If your change affects a published package, add a changeset with `pnpm changeset`.

## Repo layout

Each package has a README listing its files and what they do.

- `packages/core`: fact base schema, scanner, file classification, git, import graph, reading order, risk
- `packages/langs`: tree-sitter language packs (JS/TS/TSX, Python) and the worker pool
- `packages/infra`: manifests, framework catalog, CI/CD pipeline parsers, scripts, env vars, Docker
- `packages/contribute`: onboarding guide
- `packages/docs`: scan report, Markdown and HTML rendering, static reference pages
- `packages/cli`: the `grasp` command
- `fixtures/`: small sample repos used by golden tests (`js-app`, `py-app`, `malformed`)
- `docs/research.md`: findings about external conventions Grasp depends on

Golden files live in `__golden__/` next to the tests. When a change is intended, update them with `npx vitest run -u` and review the diff before committing.

Try your change on a real repo: `pnpm build && node packages/cli/dist/bin.js scan /path/to/repo`.

## Conventions

- TypeScript strict mode. ESM only.
- Comments explain why, assumptions, or gotchas. Do not restate what the code does.
- Every parser and adapter ships with fixtures and tests. A bad input file must never crash a scan.
- No em dashes in docs or user-facing text.
- Ask in an issue before adding a dependency that needs native compilation.
