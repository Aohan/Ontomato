import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import vue from "eslint-plugin-vue";
import prettierConfig from "eslint-config-prettier";
import vueParser from "vue-eslint-parser";

const layerSpec = "the Node.js server module and dependency rules";
const server = "packages/workbench-server/src";

// No file in this repository may depend on a private enterprise module: neither through an
// enterprise package name nor through a relative path into the adjacent enterprise
// repository.
// no-restricted-imports covers import/export-from/side-effect import, and it overrides
// rather than merges across config blocks, so every block repeats this entry; dynamic
// import() is covered by no-restricted-syntax.
const ENTERPRISE_SPECIFIER = "^@enterprise/|^(\\.\\./)+enterprise(/|$)";
const noEnterprise = { regex: ENTERPRISE_SPECIFIER, message: "public modules must not depend on a private enterprise module" };
const restrict = (patterns) => ["error", { patterns: [...patterns, noEnterprise] }];
const restrictLayer = (source, targets) =>
  restrict(
    targets.map((target) => ({
      regex: `^(\\.\\./)+${target}(/|$)`,
      message: `${source} must not depend on ${target}, see ${layerSpec}`,
    }))
  );

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      // Third-party minified libraries.
      "**/*.min.js",
      // Same as the source repository: default runtime resources and skill packages are out
      // of lint scope (the source eslint.config.js ignores data/** and skills/**).
      "packages/workbench-server/data/**",
      "packages/workbench-server/skills/**",
      // Java modules.
      "packages/data-engine-core/**",
    ],
  },
  js.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: { ...globals.node, ...globals.browser, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      ...ts.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
      "no-debugger": "warn",
      "no-restricted-imports": restrict([]),
      "no-restricted-syntax": [
        "error",
        {
          selector: `ImportExpression > Literal[value=/${ENTERPRISE_SPECIFIER.replaceAll("/", "\\/")}/]`,
          message: "public modules must not depend on a private enterprise module",
        },
      ],
    },
  },
  {
    // .mjs entry points running on Node (app build entries and development entries): add
    // only the Node globals.
    files: [
      "apps/*/build.mjs",
      "apps/*/build.node-test.mjs",
      "scripts/dev-command.mjs",
      "scripts/dev-command.node-test.mjs",
      "scripts/product-targets.node-test.mjs",
      "scripts/dev-stack.mjs",
      "scripts/dev-stack.node-test.mjs",
      "scripts/dev-platform-windows.mjs",
      "scripts/dev-platform-windows.node-test.mjs",
      "apps/data-engine/dev.mjs",
      "scripts/data-engine/dev-java.mjs",
      "scripts/data-engine/dev-java.node-test.mjs",
    ],
    languageOptions: { globals: globals.node },
  },
  {
    // Vue single-file components; rules match the source repository (without the prettier
    // plugin, formatting is checked separately).
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: "module" },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: { "@typescript-eslint": ts },
    rules: {
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/require-default-prop": "off",
      // As in the source repository, prettier owns formatting; only the template formatting
      // rules are off for Vue files, without changing the existing TS checks.
      ...prettierConfig.rules,
      "no-restricted-imports": restrict([]),
    },
  },
  {
    // Manager components consume only the context the host passes in; they do not depend on
    // host routes, a global message instance or a store.
    files: ["packages/ontology-manager/src/**/*.{ts,vue}"],
    rules: {
      // DOM type names (such as RequestInit) are not runtime globals; undefined identifiers
      // are checked by vue-tsc.
      "no-undef": "off",
      "no-restricted-imports": restrict([
        {
          regex: "^(vue-router|vue-i18n|pinia)(/|$)",
          message: "Manager components must not depend on host routes, a global message instance or a store; use the context passed in by the host",
        },
      ]),
    },
  },
  {
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": restrict([
        {
          regex: "(^|/)(?:src|web)(?:/|$)|^@ontomato/(?!contracts(/|$))",
          message: "contracts may depend only on the shared contracts, not on server or browser implementations",
        },
      ]),
    },
  },
  ...[
    ["core", ["services", "platform", "api", "infrastructure"]],
    ["platform", ["services", "api"]],
    ["services", ["api"]],
    ["utils", ["services", "platform", "api", "core"]],
    ["i18n", ["services", "platform", "api", "core"]],
    ["logging", ["services", "platform", "api", "core"]],
    ["config", ["services", "platform", "api", "core"]],
    ["infrastructure", ["services", "platform", "api", "core"]],
    // The assembly seam where the application is installed, at the bottommost layer.
    ["content", ["services", "platform", "api", "core", "infrastructure"]],
    ["runtime", ["services", "platform", "api", "core", "infrastructure"]],
    ["product", ["services", "platform", "api", "core", "infrastructure"]],
    ["identity", ["services", "platform", "api", "core", "infrastructure"]],
  ].map(([source, targets]) => ({
    files: [`${server}/${source}/**/*.ts`],
    rules: { "no-restricted-imports": restrictLayer(source, targets) },
  })),
  {
    files: [`${server}/api/routes/**/*.ts`],
    rules: {
      "no-restricted-imports": restrict([
        { regex: "^pg(/|$)", message: `api/routes must not depend on pg, see ${layerSpec}` },
        {
          regex: "^@langchain/openai(/|$)",
          message: `api/routes must not depend on @langchain/openai, see ${layerSpec}`,
        },
        {
          regex: "^(\\.\\./)+infrastructure/postgres[^/]*(/|$)",
          message: `api/routes must not depend on infrastructure/postgres, see ${layerSpec}`,
        },
      ]),
    },
  },
  {
    // Source-repository legacy allowlist (platform → services), moved over unchanged and
    // only ever reduced.
    files: [`${server}/platform/diagnosis/autotest/strategies/api-chat.ts`],
    rules: { "no-restricted-imports": restrict([]) },
  },
];
