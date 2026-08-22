import { describe, expect, it } from 'vitest'

import { versionSkew } from './format.js'

/**
 * The About page's version comparison.
 *
 * Two of these arms are conditions the page cannot easily be put into by hand
 * — you would need a daemon of a specific vintage — and getting one backwards
 * produces a confident sentence about the wrong thing.
 */
describe('versionSkew', () => {
  it('says nothing when the versions match', () => {
    expect(versionSkew('0.7.1', { state: 'known', version: '0.7.1' }))
      .toEqual({ kind: 'aligned' })
  })

  it('names the daemon version when they differ', () => {
    expect(versionSkew('0.7.1', { state: 'known', version: '0.6.0' }))
      .toEqual({ kind: 'differs', daemon: '0.6.0' })
  })

  it('treats a node that reports no version as older', () => {
    expect(versionSkew('0.8.0', { state: 'silent' })).toEqual({ kind: 'silent' })
  })

  /**
   * **Two old ones agree.** A binary that predates the version field asking a
   * daemon that predates it too is not skew — but "no version reported" looks
   * identical to the real thing, so without the floor every such pair gets
   * warned about a machine that is fine.
   */
  it('says nothing when the binary is too old to expect a version', () => {
    expect(versionSkew('0.7.1', { state: 'silent' })).toEqual({ kind: 'aligned' })
  })

  it('does not warn on an unparsable version', () => {
    expect(versionSkew('main-4f2a1c', { state: 'silent' })).toEqual({ kind: 'aligned' })
  })

  it('reads a version past the floor as new enough', () => {
    expect(versionSkew('0.10.0', { state: 'silent' })).toEqual({ kind: 'silent' })
    expect(versionSkew('1.0.0', { state: 'silent' })).toEqual({ kind: 'silent' })
  })

  /**
   * **No node is not a version problem.** Report one here and every user who
   * has not started SwarmDrop is told their node is out of date.
   */
  it('says nothing when no node is running', () => {
    expect(versionSkew('0.7.1', { state: 'none' })).toEqual({ kind: 'aligned' })
  })

  /**
   * The binary could not be run at all — already its own row on the page.
   * A comparison with one side missing is the same finding, said worse.
   */
  it('says nothing when the binary itself could not be read', () => {
    expect(versionSkew(null, { state: 'known', version: '0.6.0' }))
      .toEqual({ kind: 'aligned' })
  })
})
