import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    // Everything here is either vendored (not ours to lint), a build
    // artifact, or another repo's submodule with its own tooling.
    ignores: [
      'dist/**',
      'build/**',
      'coverage/**',
      'node_modules/**',
      'venv/**',
      'gc-overlay/**',
      'rio-visualizer/**',
      'server/rio/pyrio/**',
      'public/layout/lib/gsap/**',
      'public/layout/lib/three/**',
      'public/layout/lib/fonts/**',
    ],
  },

  // React app (Vite build) — src/
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Not a correctness rule — this codebase intentionally co-locates hooks/
      // constants with the components that use them (contexts, production
      // console). It only affects Vite HMR granularity, not app behavior.
      'react-refresh/only-export-components': 'off',
    },
  },

  // OBS overlay scripts (public/layout/lib) — no build step, plain browser
  // scripts loaded via <script src>. overlay-base.js/rio-data.js attach
  // OverlayBase/RioData to window; gsap/io load from vendored/CDN scripts.
  // Modules and classic IIFE scripts coexist here, so we parse everything
  // as a module (a superset of what the classic files need).
  {
    files: ['public/layout/lib/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        OverlayBase: 'readonly',
        RioData: 'readonly',
        gsap: 'readonly',
        io: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
