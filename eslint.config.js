const baseConfig = require('@squirl/eslint-config');

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
