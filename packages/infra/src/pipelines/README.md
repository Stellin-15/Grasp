# CI/CD pipeline parsers

`index.ts` finds pipeline files and runs the matching parser, then derives each pipeline's purposes, deploy targets, brief idea, and job graph. `github.ts` handles GitHub Actions; `others.ts` handles GitLab CI, CircleCI, Azure Pipelines, and pre-commit. `actions.ts` describes well-known reusable steps (`actions/checkout`, orbs, Azure tasks).

To add a CI system: write a parser returning a `Pipeline`, register its file pattern in `PARSED`, and add a fixture.
