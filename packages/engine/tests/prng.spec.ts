import { describe, expect, it } from 'vitest'
import {
  createPRNG,
  nextUint32,
  clonePRNG,
  randomFloat,
  randomInt,
  randomChoice,
  randomChance,
} from '@engine/prng'

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

describe('PRNG 包装方法', () => {
  it('randomFloat ∈ [0, 1)', () => {
    const rng = createPRNG(123)
    for (let i = 0; i < 1000; i++) {
      const v = randomFloat(rng)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('randomInt(min, maxInclusive) 的边界', () => {
    const rng = createPRNG(123)
    const counts = new Map<number, number>()
    for (let i = 0; i < 10000; i++) {
      const v = randomInt(rng, 5, 10)
      expect(v).toBeGreaterThanOrEqual(5)
      expect(v).toBeLessThanOrEqual(10)
      counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    // 6 个值都应至少出现过
    expect(counts.size).toBe(6)
  })

  it('randomChoice 永远从输入数组取', () => {
    const rng = createPRNG(123)
    const arr = ['A', 'B', 'C']
    const seen = new Set<string>()
    for (let i = 0; i < 100; i++) {
      seen.add(randomChoice(rng, arr))
    }
    for (const s of seen) expect(arr).toContain(s)
  })

  it('randomChance(p) 概率与 p 大致一致', () => {
    const rng = createPRNG(7)
    let trues = 0
    for (let i = 0; i < 10000; i++) {
      if (randomChance(rng, 0.3)) trues++
    }
    // 0.3 ± 0.02 → [0.28, 0.32]
    expect(trues / 10000).toBeGreaterThan(0.27)
    expect(trues / 10000).toBeLessThan(0.33)
  })

  it('包装方法与 nextUint32 一致地推进同一 state', () => {
    const a = createPRNG(99)
    randomFloat(a)
    randomInt(a, 0, 100)
    const after = a.state

    const b = createPRNG(99)
    nextUint32(b)
    nextUint32(b)
    expect(b.state).toBe(after)
  })
})
