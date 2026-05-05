/**
 * Vitest configuration for XL AI Smart Mobility Platform.
 *
 * Runs unit tests and integration tests (integration tests require the
 * Next.js dev server to be running on localhost:3000).
 *
 * Commands:
 *   npm test                   — run all tests once
 *   npm run test:watch         — watch mode
 *   npm run test:coverage      — coverage report
 *   npm run test:unit          — unit tests only
 *   npm run test:integration   — integration tests only (needs server)
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // Override PostCSS with an empty in-memory config so Vite never tries to
  // load postcss.config.mjs (Tailwind v4 plugin format is incompatible with
  // the version of PostCSS bundled inside Vite/Vitest).
  css: {
    postcss: {
      plugins: [],
    },
  },

  test: {
    // Run in Node.js — no jsdom or browser emulation needed for API tests
    environment: 'node',

    // Make describe/it/expect available globally without imports
    globals: true,

    // Global setup: loads env, exports test helpers
    setupFiles: ['./tests/setup.ts'],

    // Only pick up files inside tests/ (not src/ or node_modules/)
    include: ['tests/**/*.test.ts'],

    // 30 seconds — DB queries and HTTP round-trips can be slow
    testTimeout: 30_000,

    coverage: {
      // Use V8 coverage (faster, no instrumentation)
      provider: 'v8',

      // Only measure coverage for application source files
      include: ['src/**/*.ts'],

      // Exclude generated, config, and test files
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'node_modules/**',
      ],

      reporter: ['text', 'html', 'lcov'],
    },
  },

  resolve: {
    alias: {
      // Map @/ imports to ./src/ — matches tsconfig paths
      '@': path.resolve(__dirname, './src'),
    },
  },
});
