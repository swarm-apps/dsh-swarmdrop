/**
 * Which control has a call in flight.
 *
 * A tiny module of its own because three unrelated things need it — the port
 * that sets it, the panel that greys out a button, and the conversation row
 * that does the same — and the alternative was importing it from `panel-port`,
 * which pulls dsh's client runtime (and therefore a DOM) behind it. A pure
 * string rule should not require a browser to read.
 *
 * Keys are per *thing*, never per kind: two transfers can be in flight, and one
 * pending pause must not grey out the other's buttons.
 */

/** A control with a call in flight. */
export type BusyKey = 'node' | 'pair' | `device:${string}` | `transfer:${string}`

/** The unpair key for one device. */
export function deviceKey(peerId: string): BusyKey {
  return `device:${peerId}`
}

/** The control key for one transfer. */
export function transferKey(transferId: string): BusyKey {
  return `transfer:${transferId}`
}
