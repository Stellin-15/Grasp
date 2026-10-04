export interface CompletionRequest {
  system: string;
  prompt: string;
  /** JSON Schema the answer must match. */
  schema: Record<string, unknown>;
}

export interface CompletionResult {
  data: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Reported by the backend when it knows; Claude Code reports API-equivalent cost. */
  costUsd?: number | undefined;
}

/**
 * One way to reach a model. Everything above this interface is backend-agnostic,
 * so Claude Code, the Anthropic API, Ollama, and the test fake are interchangeable.
 */
export interface LlmBackend {
  id: string;
  /** Human-readable, e.g. "Claude Code (your Claude plan)". */
  label: string;
  /** Model actually requested; "default" when the backend picks. */
  model: string;
  /** Fixed tokens added to every call (system prompt, schema tooling). Used for estimates. */
  overheadTokens: number;
  /** Who pays, shown before any call. */
  billing: string;
  available(): Promise<boolean>;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

export class BackendError extends Error {
  constructor(
    message: string,
    /** True for rate limits and timeouts: worth retrying later. */
    readonly retryable = false,
  ) {
    super(message);
  }
}
