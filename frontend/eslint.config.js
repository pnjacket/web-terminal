import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['vendor/**'],
  },
  {
    files: ['js/**/*.js'],
    ...js.configs.recommended,
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // xterm.js UMD globals
        Terminal: 'readonly',
        FitAddon: 'readonly',
        WebLinksAddon: 'readonly',
        // CodeMirror bundle global
        CM: 'readonly',
      },
    },
  },
  {
    files: ['js/test/**/*.js'],
    languageOptions: {
      globals: {
        // Vitest injected globals (globals: true in vitest.config.js)
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        suite: 'readonly',
      },
    },
  },
];
