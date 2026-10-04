# @grasp/docs

Turns facts into documents people read.

| File           | Responsibility                                                                                |
| -------------- | --------------------------------------------------------------------------------------------- |
| `report.ts`    | The scan report model: summary, languages, entry points, reading order, risk, hotspots, gaps. |
| `markdown.ts`  | Markdown renderers for the report, stack, pipelines, and onboarding guide.                    |
| `reference.ts` | The static reference: one page per folder and file, one section per symbol, all cross-linked. |
| `html.ts`      | Converts pages to self-contained HTML (Mermaid diagrams render in the browser).               |

Phase 2 adds LLM-written explanations on top of these pages; the static facts stay as the cited ground truth.
