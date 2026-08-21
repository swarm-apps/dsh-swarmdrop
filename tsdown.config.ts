/**
 * The browser half's build. Runs before `tsc`, not after — see `clean` below.
 *
 * The Node half stays with `tsc` (see `build` in package.json): its output is
 * one file per source file, which is what makes a stack trace from inside dsh
 * point at something you can open. This half cannot work that way — dsh's
 * loader wants a single artifact that registers itself — so it is bundled, and
 * the wrapper that registration needs is the `banner`/`footer` below.
 */
import { defineConfig } from 'tsdown'

// The loader looks the factory up by this, and it is the entry name the host
// composed into `window.__DSH_BOOT__`, so it must equal the package name.
const id = 'dsh-swarmdrop'

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',

  // A separate TypeScript program, and not optionally: dsh augments
  // `Context.sessions` differently on the two sides, so a shared program
  // compiles this half against the Node service surface.
  tsconfig: 'tsconfig.client.json',

  outDir: 'lib',
  // This runs *before* `tsc` (see `build` in package.json) precisely so it can
  // clean: `lib` is shared with the Node half, and nothing else empties it.
  // Without this, output from a source file that has since been deleted stays
  // behind and `files` packs it. Run second and this would delete the Node
  // half instead.
  clean: true,
  dts: true,
  // `react` is in devDependencies as well as peerDependencies, and only the
  // second one is external by default.
  deps: { neverBundle: ['react', 'react/jsx-runtime'] },
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),

  // A plugin's `./client` entry is **not** an ordinary module. The web shell
  // fetches it and expects it to register itself, resolving externals through
  // a `require` the loader injects — no import map, no globals.
  //
  // The object form applies to JS chunks only. A plain string would be
  // prepended to the declaration file too, which does not survive parsing.
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {
var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: { js: 'return module.exports; } });' },
})
