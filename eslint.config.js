import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      ".specify/**",
      ".claude/**",
      ".agents/**",
      ".codex/**",
      ".cursor/**",
      ".beads/**",
      "helper/spike/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]",
          message: "Do not write HTML strings; use DOM APIs (Principle V).",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Do not write HTML strings; use DOM APIs (Principle V).",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Test fixtures may build DOM from markup; the rule protects shipped code.
    files: ["**/tests/**/*.ts", "shared/**/*.test.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
