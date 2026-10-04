import { describe, expect, it } from "vitest";
import { redactSecrets } from "./redact.js";

describe("redactSecrets", () => {
  it("removes common secrets and keeps line numbers stable", () => {
    const input = [
      'const key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";',
      'password = "hunter2hunter2"',
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA",
      "-----END RSA PRIVATE KEY-----",
      'db = "postgres://admin:s3cretpw@db:5432/app"',
      "last line",
    ].join("\n");
    const { text, redactions } = redactSecrets(input);
    expect(text).not.toMatch(/sk-ant-|hunter2|MIIEp|s3cretpw/);
    expect(text.split("\n")).toHaveLength(7);
    expect(text.split("\n")[6]).toBe("last line");
    expect(redactions.map((r) => r.kind).sort()).toEqual([
      "Anthropic key",
      "URL credentials",
      "hardcoded credential",
      "private key",
    ]);
  });

  it("leaves placeholders and ordinary code alone", () => {
    const input =
      'token = "changeme-please"\nconst tokenizer = new Tokenizer();\napi_key = "${API_KEY}"';
    expect(redactSecrets(input).text).toBe(input);
  });
});
