import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  target: 'node22',
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
  // Bundled CJS deps call `require(...)` internally. In an ESM bundle those
  // become a shim that throws on dynamic require, so we expose a real CJS
  // `require` via createRequire.
  banner: {
    js: "import { createRequire as __promptless_createRequire } from 'module'; const require = __promptless_createRequire(import.meta.url);",
  },
  // The shebang in src/cli.ts is preserved into dist/cli.js by tsup.
})
