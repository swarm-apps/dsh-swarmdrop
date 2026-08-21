/**
 * Wrap the compiled browser bundle into the artifact shape dsh's loader wants.
 *
 * A plugin's `./client` entry is **not** an ordinary ESM module. The web shell
 * fetches it and expects it to register itself:
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => exports })
 *
 * `id` must equal the package name — that is the entry name the host composed
 * into `window.__DSH_BOOT__`, and the loader looks the factory up by it.
 * `require` is injected by the loader and resolves the externals declared in
 * `dsh.client.inject`; there is no import map and no globals, so anything not
 * bundled and not injected simply will not resolve.
 *
 * dsh builds its own client bundles with a shared tsdown preset that lives
 * inside its monorepo and is not published. The artifact *shape*, though, is
 * this small — so an out-of-tree plugin reimplements the wrapper rather than
 * being blocked on that preset.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const id = manifest.name
if (typeof id !== 'string' || id.length === 0) {
  throw new TypeError('package.json must declare a non-empty name')
}

const compiled = await readFile(join(root, '.client-build', 'index.cjs'), 'utf8')
const output = join(root, 'lib', 'client.js')

await mkdir(dirname(output), { recursive: true })
await writeFile(output, [
  `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
  'var module = { exports: {} }; var exports = module.exports;',
  // The sourcemap comment would point at a file that is not shipped.
  compiled.replace(/\n?\/\/# sourceMappingURL=.*$/u, ''),
  'return module.exports; } });',
  '',
].join('\n'))

await rm(join(root, '.client-build'), { recursive: true, force: true })
console.log(`lib/client.js written for ${id}`)
