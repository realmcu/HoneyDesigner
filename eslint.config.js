// eslint.config.js
// Flat config equivalent of .eslintrc.json (CommonJS format)
const tseslint = require('typescript-eslint');
const importPlugin = require('eslint-plugin-import');
const globals = require('globals');

module.exports = [
  // Global ignore patterns (equivalent to ignorePatterns)
  {
    ignores: ['node_modules', 'out', 'dist', '**/*.d.ts'],
  },

  // Equivalent of "extends: eslint:recommended"
  tseslint.configs.eslintRecommended,

  // Equivalent of "extends: plugin:@typescript-eslint/recommended"
  ...tseslint.configs.recommended,

  // Equivalent of "extends: plugin:import/recommended"
  importPlugin.flatConfigs.recommended,

  // Equivalent of "extends: plugin:import/typescript"
  importPlugin.flatConfigs.typescript,

  // Equivalent of env, parserOptions, settings, and custom rules
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.es2021,
        ...globals.node,
        ...globals.browser,
      },
    },
    settings: {
      'import/core-modules': ['vscode'],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-case-declarations': 'off',
      'prefer-const': 'off',
      'import/no-unresolved': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-empty': 'off',
      'no-console': 'off',
    },
  },
];
