import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['scripts/**/*.mjs', 'vite.config.ts'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', globalThis: 'readonly', DOMException: 'readonly', structuredClone: 'readonly' } },
  },
);
