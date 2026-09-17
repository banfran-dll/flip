/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` makes the build work from any sub-path (e.g. GitHub Pages
// project sites at https://<user>.github.io/<repo>/) as well as the root.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { sourcemap: false },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
