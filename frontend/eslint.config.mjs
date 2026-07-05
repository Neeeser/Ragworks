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
      // eslint-config-next bundles a newer eslint-plugin-react-hooks build whose
      // "recommended" set now includes react-hooks/set-state-in-effect. It fires on
      // the codebase's established prop/session-sync effect pattern (see
      // use-collection-tools.ts, use-provider-preferences.ts, etc.) in ~10 pre-existing
      // hooks. Task 13 scope is lint/TS config, not a hooks-architecture rewrite, so this
      // is kept at "warn" (still visible, doesn't block `npm run lint`) rather than adding
      // a dozen one-off disables or rewriting those hooks. Follow-up: revisit per-hook.
      "react-hooks/set-state-in-effect": "warn",
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
