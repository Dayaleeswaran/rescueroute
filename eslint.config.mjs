import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "artifacts/**",
      "public/vendor/**",
      ".data/**",
    ],
  },
  {
    files: ["**/*.mjs", "public/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ["error", "always"],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-var": "error",
      "prefer-const": "error",
      "no-duplicate-imports": "error",
      "object-shorthand": ["error", "always"],
      "no-useless-return": "error",
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  { files: ["public/*.js"], languageOptions: { globals: globals.browser } },
  // UI integration deliberately evaluates the actual interface in jsdom.
  {
    files: ["test/ui.test.mjs", "test/motion.test.mjs"],
    rules: { "no-eval": "off" },
  },
];
