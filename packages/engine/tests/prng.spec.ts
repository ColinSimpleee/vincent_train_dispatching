import { describe, expect, it } from 'vitest'
import { createPRNG, nextUint32, clonePRNG } from '@engine/prng'

describe('mulberry32 PRNG', () => {
  it('相同 seed 产生相同序列', () => {
    const a = createPRNG(42)
    const b = createPRNG(42)
    const seqA: number[] = []
    const seqB: number[] = []
    for (let i = 0; i < 100; i++) {
      seqA.push(nextUint32(a))
      seqB.push(nextUint32(b))
    }
    expect(seqA).toEqual(seqB)
  })

  it('不同 seed 产生不同序列', () => {
    const a = createPRNG(42)
    const b = createPRNG(43)
    const va: number[] = []
    const vb: number[] = []
    for (let i = 0; i < 32; i++) {
      va.push(nextUint32(a))
      vb.push(nextUint32(b))
    }
    expect(va).not.toEqual(vb)
  })

  it('clonePRNG 后两份独立推进互不干扰', () => {
    const a = createPRNG(7)
    nextUint32(a)
    const b = clonePRNG(a)
    nextUint32(a)
    nextUint32(a)
    const before = b.state
    nextUint32(b)
    expect(b.state).not.toBe(before)
    // a 多推进 2 步不会反向影响 b
    expect(clonePRNG(a).state).not.toBe(b.state)
  })

  it('mulberry32 第一个输出对 seed=1 是已知常数（防回归）', () => {
    const rng = createPRNG(1)
    const v = nextUint32(rng)
    // mulberry32(1) 第一步：state = 1 + 0x6D2B79F5 = 0x6D2B79F6
    // 详见实现注释
    expect(v).toBe(2693262067)
  })
})
