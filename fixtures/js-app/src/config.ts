import { z } from "zod";

const Schema = z.object({
  PORT: z.coerce.number().default(3000),
  JWT_SECRET: z.string().min(16),
});

export interface AppConfig {
  port: number;
  jwtSecret: string;
}

/** Validates environment variables and fails fast when one is missing. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = Schema.parse(env);
  return { port: parsed.PORT, jwtSecret: parsed.JWT_SECRET };
}
