import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**", "fixtures/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // `_name` marks a value that is intentionally unused, e.g. when omitting a field.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
