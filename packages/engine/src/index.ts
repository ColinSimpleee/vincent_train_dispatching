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
export type {
  RailNode,
  RailEdge,
  RailMap,
  PlatformZone,
  SwitchGroup,
  SwitchGroupMember,
  TrainModel,
  TrainPhysics,
  EngineState,
  EngineInput,
  EngineEvent,
  Invariant,
  StepResult,
  TrainSpawnSpec,
} from './types'
export type { AdjacencyEntry, AdjacencyIndex } from './adjacency'
export { buildAdjacency, resolveNextEdge } from './adjacency'
export { EventBuffer } from './events'
export * as ENGINE_CONSTANTS from './constants'
export { step } from './step'
