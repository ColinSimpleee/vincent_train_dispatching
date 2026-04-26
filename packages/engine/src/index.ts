export const ENGINE_VERSION = '0.1.0'
export type { PRNGState } from './prng'
export {
  createPRNG,
  clonePRNG,
  nextUint32,
  randomFloat,
  randomInt,
  randomChoice,
  randomChance,
} from './prng'
