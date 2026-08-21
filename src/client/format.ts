/**
 * Formatting the browser half shares.
 *
 * Small, and deliberately here rather than in `coerce.ts`: that file is the Node
 * half's defensive reader and pulls `cli.ts`'s module graph with it. This one is
 * pure presentation and safe in a page.
 */

/**
 * Human-readable byte count.
 *
 * **Pure — these run during replay too.** A conversation row is rebuilt from the
 * log every time the session is opened, so anything here that read a clock, a
 * locale, or a preference would render differently on the second read of the
 * same event.
 *
 * The `@` menu row and the conversation row both call it, on the same item: two
 * copies would eventually disagree about the same file's size in two places on
 * one screen.
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${value.toFixed(1)} ${String(units[unit])}`
}
