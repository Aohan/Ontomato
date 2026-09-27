import js from "@eslint/js";
import ts from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";
import vue from "eslint-plugin-vue";
import prettierConfig from "eslint-config-prettier";
import vueParser from "vue-eslint-parser";

const layerSpec = "InfoHub《Node.js 服务端开发规范》模块与依赖";
const server = "packages/workbench-server/src";

// 公共仓任何文件都不得依赖私有企业模块：既不能用企业包名，也不能用相对路径跨到相邻的 enterprise 仓。
// no-restricted-imports 覆盖 import/export-from/侧效 import，且在多个配置块间是覆盖而非合并，
// 所以每个块都带上这一条；动态 import() 由 no-restricted-syntax 覆盖。
const ENTERPRISE_SPECIFIER = "^@enterprise/|^(\\.\\./)+enterprise(/|$)";
const noEnterprise = { regex: ENTERPRISE_SPECIFIER, message: "公共模块不得依赖私有企业模块" };
const restrict = (patterns) => ["error", { patterns: [...patterns, noEnterprise] }];
const restrictLayer = (source, targets) =>
  restrict(
    targets.map((target) => ({
      regex: `^(\\.\\./)+${target}(/|$)`,
      message: `${source} 不得依赖 ${target}，见 ${layerSpec}`,
    }))
  );

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      // 第三方压缩库。
      "**/*.min.js",
      // 与源仓相同：默认运行资源与技能包不在 lint 范围（源 eslint.config.js 忽略 data/**、skills/**）。
      "packages/workbench-server/data/**",
      "packages/workbench-server/skills/**",
      // Java 模块。
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
          message: "公共模块不得依赖私有企业模块",
        },
      ],
    },
  },
  {
    // 应用的 Node 构建入口（.mjs）：运行在 Node，只补 Node 全局。
    files: ["apps/*/build.mjs", "apps/*/build.node-test.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // Vue 单文件组件；规则与源仓相同（不含 prettier 插件，格式另行核对）。
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
      // 与源仓一致由 prettier 负责格式；只对 Vue 文件关闭模板格式规则，不改变既有 TS 检查。
      ...prettierConfig.rules,
      "no-restricted-imports": restrict([]),
    },
  },
  {
    // Manager 组件只消费宿主传入的上下文，不依赖宿主路由、全局词条实例或 store。
    files: ["packages/ontology-manager/src/**/*.{ts,vue}"],
    rules: {
      // DOM 类型名（如 RequestInit）不是运行时全局；未定义标识符由 vue-tsc 检查。
      "no-undef": "off",
      "no-restricted-imports": restrict([
        {
          regex: "^(vue-router|vue-i18n|pinia)(/|$)",
          message: "Manager 组件不得依赖宿主路由、全局词条实例或 store；使用宿主传入的上下文",
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
          message: "contracts 只能依赖共享契约，不得依赖服务端或浏览器实现",
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
    // 应用安装的装配缝，位于最底层。
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
        { regex: "^pg(/|$)", message: `api/routes 不得依赖 pg，见 ${layerSpec}` },
        {
          regex: "^@langchain/openai(/|$)",
          message: `api/routes 不得依赖 @langchain/openai，见 ${layerSpec}`,
        },
        {
          regex: "^(\\.\\./)+infrastructure/postgres[^/]*(/|$)",
          message: `api/routes 不得依赖 infrastructure/postgres，见 ${layerSpec}`,
        },
      ]),
    },
  },
  {
    // 源仓存量白名单（platform → services），原样迁入，只减不增。
    files: [`${server}/platform/diagnosis/autotest/strategies/api-chat.ts`],
    rules: { "no-restricted-imports": restrict([]) },
  },
];
