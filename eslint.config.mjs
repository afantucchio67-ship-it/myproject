// Configurazione ESLint (flat config). Nessuna dipendenza: si usa con un
// eslint globale: `eslint src bin test build.mjs server.mjs`
export default [
  {
    files: ['**/*.js', '**/*.mjs'],
    ignores: ['dist/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', self: 'readonly', navigator: 'readonly',
        console: 'readonly', URL: 'readonly', Blob: 'readonly', Worker: 'readonly', FileReader: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', ResizeObserver: 'readonly',
        WebGL2RenderingContext: 'readonly', HTMLInputElement: 'readonly', HTMLElement: 'readonly', Node: 'readonly',
        localStorage: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', performance: 'readonly',
        process: 'readonly', globalThis: 'readonly', location: 'readonly', Image: 'readonly', Event: 'readonly', TextDecoder: 'readonly', TextEncoder: 'readonly', DataView: 'readonly', ArrayBuffer: 'readonly',
        Buffer: 'readonly', Response: 'readonly', Headers: 'readonly', Request: 'readonly', fetch: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-dupe-keys': 'error',
      'no-unreachable': 'error',
      'no-self-assign': 'warn',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },
];
