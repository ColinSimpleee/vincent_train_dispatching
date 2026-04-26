/**
 * mulberry32：32 位整数状态的快速 PRNG。
 * 选它的理由：实现 12 行、无外部依赖、给定 seed 跨平台逐位一致；
 * 不适用于密码学场景，但游戏物理够用。
 */

export interface PRNGState {
  /** 32 位无符号整数当前状态。`>>> 0` 强制无符号化。 */
  state: number
}

export function createPRNG(seed: number): PRNGState {
  return { state: seed >>> 0 }
}

export function clonePRNG(rng: PRNGState): PRNGState {
  return { state: rng.state >>> 0 }
}

/** 推进一次，返回 32 位无符号整数；mutates rng.state。 */
export function nextUint32(rng: PRNGState): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0
  let t = rng.state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0)
}

/** 浮点 ∈ [0, 1)。等价于 nextUint32(rng) / 2^32。 */
export function randomFloat(rng: PRNGState): number {
  return nextUint32(rng) / 0x100000000
}

/** 整数 ∈ [min, maxInclusive]。 */
export function randomInt(rng: PRNGState, min: number, maxInclusive: number): number {
  if (maxInclusive < min) throw new Error('randomInt: max < min')
  const range = maxInclusive - min + 1
  return min + (nextUint32(rng) % range)
}

/** 从非空数组等概率取一个。 */
export function randomChoice<T>(rng: PRNGState, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('randomChoice: empty array')
  return arr[randomInt(rng, 0, arr.length - 1)]!
}

/** Bernoulli：以 p 概率返回 true。p ∈ [0, 1]。 */
export function randomChance(rng: PRNGState, p: number): boolean {
  return randomFloat(rng) < p
}
