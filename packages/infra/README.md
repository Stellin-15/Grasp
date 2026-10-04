# @grasp/infra

Detects how a repository is built, tested, and shipped, and what it is built with. Powers `grasp stack`, `grasp pipelines`, and the infrastructure sections of the docs.

| File           | Responsibility                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifests.ts` | Dependencies from package.json, pyproject, requirements, Pipfile, go.mod, Cargo, Maven, Gradle, Gemfile, composer; exact versions from lockfiles. |
| `catalog.ts`   | Hand-written catalog of frameworks: category, a brief idea for newcomers, docs link, config files.                                                |
| `stack.ts`     | Matches dependencies to the catalog and finds where each framework is imported.                                                                   |
| `pipelines/`   | Parsers for GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, and pre-commit, plus purpose, deploy target, and job graph detection.           |
| `build.ts`     | Scripts (npm, make, just, tox, nox, Taskfile), env vars, Docker, Compose, IaC, quality tools, and entry points.                                   |

Every finding cites the file and line it came from. Secret values are never read; only their names are reported.
