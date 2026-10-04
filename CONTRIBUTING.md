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

- `packages/core`: scanner, fact base, graphs, workspace store
- `packages/cli`: the `grasp` command
- `docs/research.md`: findings about external conventions Grasp depends on

More packages arrive phase by phase; see the project plan.

## Conventions

- TypeScript strict mode. ESM only.
- Comments explain why, assumptions, or gotchas. Do not restate what the code does.
- Every parser and adapter ships with fixtures and tests. A bad input file must never crash a scan.
- No em dashes in docs or user-facing text.
- Ask in an issue before adding a dependency that needs native compilation.
