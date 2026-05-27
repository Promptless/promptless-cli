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
  // `prompts` (and other CJS deps) call `require('readline')` etc. internally.
  // In an ESM bundle those become a shim that throws on dynamic require, so we
  // expose a real CJS `require` via createRequire.
  banner: {
    js: "import { createRequire as __pless_createRequire } from 'module'; const require = __pless_createRequire(import.meta.url);",
  },
  // The shebang in src/cli.ts is preserved into dist/cli.js by tsup.
})
