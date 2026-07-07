// eslint.config.js
// ESLint flat config for Adv_Backend Node.js project (ESLint v10+).

const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');
const prettierPlugin = require('eslint-plugin-prettier');

module.exports = [
  {
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      // Prettier — all formatting handled by prettier
      'prettier/prettier': 'error',

      // Logging — use Winston, not console
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Code quality
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^_',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      'no-process-exit': 'off',
      'no-undef': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],

      // Security
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  // Prettier config must come last — disables conflicting rules
  prettierConfig,
  {
    files: ['**/*.test.js', '**/*.spec.js', '**/tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  // Standalone CLI scripts — console output is intentional here
  {
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['**/node_modules/**', '**/dist/**', 'coverage/**', 'frontend/**', 'landing/**'],
  },
];
