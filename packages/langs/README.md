# @grasp/langs

Language packs that turn source files into facts using [tree-sitter](https://tree-sitter.github.io/) WASM grammars (no native compilation). Each pack implements `LanguagePack` from `@grasp/core`: extract symbols, imports, and calls from one file, and resolve import specifiers to repo files.

| File                   | Responsibility                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `javascript.ts`        | JavaScript, TypeScript, and TSX: ES modules, CommonJS, classes, overloads, JSDoc; resolution through relative paths, NodeNext `.js` to `.ts`, tsconfig `paths`, and workspace packages. |
| `python.ts`            | Python: functions, classes, decorators, `__all__`, docstrings, relative imports, `src/` layouts.                                                                                        |
| `runtime.ts`           | Loads each grammar once per process.                                                                                                                                                    |
| `pool.ts`, `worker.ts` | Parses files on worker threads; tree-sitter WASM is single-threaded. Set `GRASP_WORKERS=0` to disable.                                                                                  |
| `util.ts`              | Shared helpers: signatures, docstrings, callee text, enclosing-symbol lookup.                                                                                                           |

Adding a language: write a pack with the same shape, add golden fixtures under `fixtures/`, and register it in `index.ts`.
