export * from "./types.js";
export {
  BackendError,
  type CompletionRequest,
  type CompletionResult,
  type LlmBackend,
} from "./backend.js";
export { ClaudeCodeBackend, type ClaudeCodeOptions } from "./backends/claude-code.js";
export { FakeBackend, type FakeResponder } from "./backends/fake.js";
export { redactSecrets, type RedactResult } from "./redact.js";
export { PROMPT_VERSION, systemPrompt } from "./prompts.js";
export {
  MalformedAnswer,
  verifyFile,
  verifyFolder,
  verifyRepo,
  verifySymbol,
  type VerifyContext,
} from "./verify.js";
export {
  explainRepo,
  planExplanations,
  runExplanations,
  type ExplainOptions,
  type Plan,
  type ProgressEvent,
  type RepoContext,
  type RunResult,
  type Unit,
} from "./build.js";
export { checkExplanations, type CoverageCount, type DocsCheck } from "./check.js";
export { estimateUsd } from "./estimate.js";
