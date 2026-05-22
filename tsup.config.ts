import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  clean: true,
  // Bundle every dep (remark, unified, …) into a single file so the installed
  // package has zero runtime dependencies — works for both npm and pnpm users.
  noExternal: [/.*/],
  splitting: false,
  sourcemap: false,
  dts: false,
  minify: false,
  shims: false,
  // The shebang in src/cli.ts is preserved into dist/cli.js by tsup.
})
