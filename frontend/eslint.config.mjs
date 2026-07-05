import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import sonarjs from "eslint-plugin-sonarjs";
import unusedImports from "eslint-plugin-unused-imports";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    plugins: {
      import: importPlugin,
      "unused-imports": unusedImports,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "import/no-cycle": "error",
      "import/no-duplicates": "error",
      "import/newline-after-import": "error",
      "max-lines": [
        "error",
        { max: 400, skipBlankLines: true, skipComments: true },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
      complexity: ["warn", 15],
      "max-depth": ["warn", 4],
      "import/order": [
        "error",
        {
          alphabetize: { order: "asc", caseInsensitive: true },
          "newlines-between": "always",
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
            "object",
            "type",
          ],
        },
      ],
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
    },
  },
  sonarjs.configs.recommended,
  {
    // max-lines is a file-size guardrail for production modules; test files
    // are expected to be longer (many cases, fixtures) so it's not useful there.
    files: ["**/__tests__/**"],
    rules: {
      "max-lines": "off",
    },
  },
  {
    // GRANDFATHERED, DO NOT COPY: eslint-config-next bundles a newer
    // eslint-plugin-react-hooks whose recommended set includes
    // react-hooks/set-state-in-effect (error by default). These 6 pre-existing
    // hooks (12 sites total) use a prop/session-sync setState-in-effect pattern
    // that predates the rule; rewriting them was out of scope for the lint-config
    // task. The rule stays at its default "error" everywhere else — new code must
    // not add setState-in-effect and must not be added to this list. Burn these
    // down per-hook (derived state / key-reset patterns) and delete this override.
    files: [
      "src/components/chat-studio/hooks/use-auto-scroll.ts",
      "src/components/chat-studio/hooks/use-chat-session-routing.ts",
      "src/components/chat-studio/hooks/use-collection-tools.ts",
      "src/components/chat-studio/hooks/use-panel-controls.ts",
      "src/components/chat-studio/hooks/use-provider-preferences.ts",
      "src/components/chat-studio/hooks/use-run-settings-order.ts",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
