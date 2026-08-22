/**
 * Formatting the browser half shares.
 *
 * Separate from `coerce.ts` by concern, not by dependency: that file reads what
 * another process said (defensively, field by field), this one turns a number
 * into something a person reads. Both are dependency-free and safe in a page —
 * an earlier version of this note claimed `coerce` pulled `cli.ts` behind it,
 * which was never true.
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

/**
 * Human-readable duration, from seconds.
 *
 * Pure, for the same reason {@link formatSize} is. Coarse on purpose: a
 * remaining time is an estimate that moves, and "1m 20s" ticking down digit by
 * digit reads as precision the number does not have. Anything over an hour
 * rounds to hours, because at that scale the minutes are noise.
 */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  if (whole < 60) return `${String(whole)}s`
  if (whole < 3600) {
    const minutes = Math.floor(whole / 60)
    const rest = whole % 60
    return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`
  }
  const hours = Math.floor(whole / 3600)
  const minutes = Math.round((whole % 3600) / 60)
  return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`
}
