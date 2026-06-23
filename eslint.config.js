const baseConfig = require('@ai-studio/eslint-config');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/.turbo/**',
      'apps/desktop/**',
    ],
  },
  ...baseConfig,
];
