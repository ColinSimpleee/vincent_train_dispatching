import type { TrainPhysics, RailMap, RailNode } from './RailGraph.ts'
import {
  CAR_PITCH,
  DWELL_TIME_MIN,
  DWELL_TIME_MAX,
  BUFFER_TIME_MIN,
  BUFFER_TIME_MAX,
  RESUME_SPEED,
} from './constants'

/**
 * PhysicsEngine - 列车物理模拟引擎
 *
 * 核心职责：
 * - 计算列车移动意图（computeIntent）
 * - 检测物理碰撞（detectPhysicalCollisions）
 * - 解决路径冲突（resolveConflicts）
 * - 提交状态更新（commitUpdates）
 *
 * 道岔逻辑：
 * - 分岔点（Facing Point）：根据 switchState 选择出路
 * - 汇入点（Trailing Point）：忽略 switchState，直接通过
 */

// 邻接表缓存：nodeId → { outgoing: Edge[], incoming: Edge[] }
interface AdjacencyEntry {
  outgoing: { id: string; fromNode: string; toNode: string }[]
  incoming: { id: string; fromNode: string; toNode: string }[]
}
let adjacencyIndex: Map<string, AdjacencyEntry> = new Map()
let adjacencyMapRef: RailMap | null = null

function buildAdjacencyIndex(map: RailMap): void {
  adjacencyIndex = new Map()
  for (const edge of Object.values(map.edges)) {
    // outgoing from fromNode
    let fromEntry = adjacencyIndex.get(edge.fromNode)
    if (!fromEntry) {
      fromEntry = { outgoing: [], incoming: [] }
      adjacencyIndex.set(edge.fromNode, fromEntry)
    }
    fromEntry.outgoing.push({ id: edge.id, fromNode: edge.fromNode, toNode: edge.toNode })

    // incoming to toNode
    let toEntry = adjacencyIndex.get(edge.toNode)
    if (!toEntry) {
      toEntry = { outgoing: [], incoming: [] }
      adjacencyIndex.set(edge.toNode, toEntry)
    }
    toEntry.incoming.push({ id: edge.id, fromNode: edge.fromNode, toNode: edge.toNode })
  }

  // Sort for deterministic switch resolution
  for (const entry of adjacencyIndex.values()) {
    entry.outgoing.sort((a, b) => a.id.localeCompare(b.id))
    entry.incoming.sort((a, b) => a.id.localeCompare(b.id))
  }

  adjacencyMapRef = map
}

// 复用的 claims Map（避免每 tick 分配）
const claimsMap = new Map<string, string>()

export class PhysicsEngine {

  static update(trains: TrainPhysics[], map: RailMap, dt: number, currentTick: number): void {
    // 确保邻接表是最新的
    if (adjacencyMapRef !== map) {
      buildAdjacencyIndex(map)
    }

    // Phase 0: Passenger Logic
    for (const train of trains) {
      PhysicsEngine.handlePassengerLogic(train)
    }

    // Phase 1: Compute Intents & Resume Checks
    for (const train of trains) {
      if (train.state === 'moving') {
        PhysicsEngine.computeIntent(train, map, dt, currentTick)
      } else if (train.state === 'stopped') {
        PhysicsEngine.tryResume(train, map)
      }
    }

    // Phase 1.5: Physical Collision Check
    PhysicsEngine.detectPhysicalCollisions(trains)

    // Phase 2: Resolve Conflicts
    PhysicsEngine.resolveConflicts(trains)

    // Phase 3: Commit Updates
    PhysicsEngine.commitUpdates(trains, map)
  }

  private static computeIntent(
    train: TrainPhysics,
    map: RailMap,
    dt: number,
    currentTick: number,
  ): void {
    if (train.state !== 'moving' || train.speed === 0) return

    const dir = train.direction
    const distToMove = train.speed * dt
    const tPos = train.position + distToMove * dir
    const currentEdge = map.edges[train.currentEdgeId]

    if (!currentEdge) {
      console.error(`Train ${train.id} on invalid edge ${train.currentEdgeId}`)
      train.state = 'stopped'
      return
    }

    // Check Boundary (direction-aware)
    const isArriving = (dir === 1 && tPos >= currentEdge.length) || (dir === -1 && tPos <= 0)

    if (isArriving) {
      const overflow = dir === 1 ? tPos - currentEdge.length : Math.abs(tPos)

      // Special Rule: Platform Stop (Auto-Service)
      if (currentEdge.isPlatform && train.lastServicedEdgeId !== train.currentEdgeId) {
        train.position = dir === 1 ? currentEdge.length : 0
        train.speed = 0
        train.state = 'stopped'

        train.passengerState = 'BOARDING'
        train.arrivalTick = currentTick
        const dwell =
          DWELL_TIME_MIN + Math.floor(Math.random() * (DWELL_TIME_MAX - DWELL_TIME_MIN))
        train.boardingTimer = dwell
        train.stopDuration = dwell
        train.stopBuffer =
          BUFFER_TIME_MIN + Math.floor(Math.random() * (BUFFER_TIME_MAX - BUFFER_TIME_MIN))

        train.lastServicedEdgeId = train.currentEdgeId
        return
      }

      // Stop Condition: No Path left (Arrived)
      if (!train.path || train.path.length === 0) {
        train.position = dir === 1 ? currentEdge.length : 0
        train.speed = 0
        train.state = 'stopped'
        return
      }

      // 1. Resolve Next Edge based on direction
      const nextNodeId = dir === 1 ? currentEdge.toNode : currentEdge.fromNode
      const nextNode = map.nodes[nextNodeId]

      if (!nextNode) {
        console.error(`Train ${train.id} reached invalid node ${nextNodeId}`)
        train.state = 'stopped'
        return
      }

      const nextEdgeId = PhysicsEngine.resolveNextEdge(nextNode, train.currentEdgeId)

      // --- RULES ENFORCEMENT ---

      // Rule 1: Signal Compliance (Stop at Red)
      if (nextNode.signalState === 'red') {
        train.position = dir === 1 ? currentEdge.length : 0
        train.speed = 0
        train.state = 'stopped'
        return
      }

      if (!nextEdgeId) {
        train.position = dir === 1 ? currentEdge.length : 0
        train.speed = 0
        train.state = 'stopped'
        return
      }

      // Register Intent (Path is Clear)
      train.nextMoveIntent = {
        targetEdgeId: nextEdgeId,
        overflowDistance: overflow,
      }
    } else {
      // Normal Move
      train.position = tPos
      train.nextMoveIntent = undefined
    }
  }

  private static handlePassengerLogic(train: TrainPhysics): void {
    if (train.passengerState !== 'BOARDING') return

    train.boardingTimer = (train.boardingTimer ?? 0) - 1
    if (train.boardingTimer! <= 0) {
      train.passengerState = 'READY'
    }
  }

  private static tryResume(train: TrainPhysics, map: RailMap): void {
    const currentEdge = map.edges[train.currentEdgeId]
    const dir = train.direction

    if (!currentEdge) {
      console.error(`Train ${train.id} on invalid edge ${train.currentEdgeId}`)
      return
    }

    // Block Resume if strictly held by Passenger State
    if (train.passengerState === 'BOARDING' || train.passengerState === 'READY') return

    // Check if at boundary (direction-aware)
    const distToBound = dir === 1 ? currentEdge.length - train.position : train.position
    if (distToBound > 0.1) return // Not at boundary

    // Check Path Ahead
    const nextNodeId = dir === 1 ? currentEdge.toNode : currentEdge.fromNode
    const nextNode = map.nodes[nextNodeId]

    if (!nextNode) return

    const nextEdgeId = PhysicsEngine.resolveNextEdge(nextNode, train.currentEdgeId)

    if (!nextEdgeId) return // Dead end

    // 1. Check Signal
    if (nextNode.signalState === 'red') return // Still Red

    // All Clear -> Resume
    train.state = 'moving'
    train.speed = RESUME_SPEED
  }

  /**
   * 使用邻接表快速解析下一条边（替代全量扫描）
   */
  private static resolveNextEdge(
    node: RailNode | undefined,
    incomingEdgeId: string,
  ): string | undefined {
    if (!node) return undefined

    const adj = adjacencyIndex.get(node.id)
    if (!adj) return undefined

    // 判断列车从哪个方向到达节点
    // 如果 incomingEdge.toNode === node.id → 正向到达 → 继续正向（从 outgoing 找）
    // 如果 incomingEdge.fromNode === node.id → 反向到达 → 继续反向（从 incoming 找）
    const incomingFromOut = adj.outgoing.find((e) => e.id === incomingEdgeId)
    const arrivedAtFromNode = !!incomingFromOut

    let candidates: { id: string }[]
    if (arrivedAtFromNode) {
      // Moving backward → continue backward (edges whose toNode is this node)
      candidates = adj.incoming.filter((e) => e.id !== incomingEdgeId)
    } else {
      // Moving forward → continue forward (edges whose fromNode is this node)
      candidates = adj.outgoing.filter((e) => e.id !== incomingEdgeId)
    }

    if (candidates.length === 0) return undefined
    if (candidates.length === 1) return candidates[0]?.id

    // Multiple candidates - check switch state
    if (node.type === 'switch') {
      const index = node.switchState ?? 0
      return candidates[index % candidates.length]?.id
    }

    return candidates[0]?.id
  }

  static getTrainLength(train: TrainPhysics): number {
    const carCount = train.isCoupled ? 16 : 8
    return carCount * CAR_PITCH
  }

  private static checkSegmentsOverlap(
    head1: number,
    tail1: number,
    head2: number,
    tail2: number,
  ): boolean {
    const completelyBefore = head1 < tail2
    const completelyAfter = tail1 > head2
    return !(completelyBefore || completelyAfter)
  }

  // --- Phase 1.5 ---
  private static detectPhysicalCollisions(trains: TrainPhysics[]): void {
    for (let i = 0; i < trains.length; i++) {
      for (let j = i + 1; j < trains.length; j++) {
        const t1 = trains[i]
        const t2 = trains[j]

        if (!t1 || !t2) continue
        if (t1.isHandedOver || t2.isHandedOver) continue
        if (t1.currentEdgeId !== t2.currentEdgeId) continue

        const t1Head = t1.position
        const t1Tail = t1.position - PhysicsEngine.getTrainLength(t1)
        const t2Head = t2.position
        const t2Tail = t2.position - PhysicsEngine.getTrainLength(t2)

        if (PhysicsEngine.checkSegmentsOverlap(t1Head, t1Tail, t2Head, t2Tail)) {
          PhysicsEngine.triggerCollision(t1.id, t2.id)
        }
      }
    }
  }

  // --- Phase 2（复用 claimsMap 避免每 tick 分配） ---
  private static resolveConflicts(trains: TrainPhysics[]): void {
    claimsMap.clear()

    for (const train of trains) {
      if (!train.nextMoveIntent) continue

      const targetId = train.nextMoveIntent.targetEdgeId

      // Check Simultaneous Claims (Race Condition)
      if (claimsMap.has(targetId)) {
        PhysicsEngine.triggerCollision(train.id, claimsMap.get(targetId)!)
      }

      claimsMap.set(targetId, train.id)
    }
  }

  // --- Phase 3 ---
  private static commitUpdates(trains: TrainPhysics[], map: RailMap): void {
    for (const train of trains) {
      if (train.nextMoveIntent) {
        // Release Old
        const oldEdge = map.edges[train.currentEdgeId]
        if (oldEdge && oldEdge.occupiedBy === train.id) {
          oldEdge.occupiedBy = null
        }

        // History (For snake rendering)
        train.visitedPath = train.visitedPath ?? []
        train.visitedPath.unshift(train.currentEdgeId)
        if (train.visitedPath.length > 20) train.visitedPath.pop()

        // Determine arrival node and new direction
        const currentEdge = map.edges[train.currentEdgeId]

        if (!currentEdge) {
          train.nextMoveIntent = undefined
          continue
        }

        const currentDir = train.direction
        const arrivalNodeId = currentDir === 1 ? currentEdge.toNode : currentEdge.fromNode

        // Occupy New
        const nextEdgeId = train.nextMoveIntent.targetEdgeId
        if (map.edges[nextEdgeId]) {
          map.edges[nextEdgeId].occupiedBy = train.id
        } else {
          console.error(`Missing edge ${nextEdgeId} for train ${train.id}`)
          train.state = 'stopped'
          train.nextMoveIntent = undefined
          continue
        }

        const nextEdge = map.edges[nextEdgeId]

        // AUTO-SET DIRECTION
        if (nextEdge.fromNode === arrivalNodeId) {
          train.direction = 1
          train.position = train.nextMoveIntent.overflowDistance
        } else if (nextEdge.toNode === arrivalNodeId) {
          train.direction = -1
          train.position = nextEdge.length - train.nextMoveIntent.overflowDistance
        } else {
          console.error(`Edge discontinuity: ${train.currentEdgeId} -> ${nextEdgeId}`)
          train.position = train.nextMoveIntent.overflowDistance
        }

        // Move train to new edge
        train.currentEdgeId = nextEdgeId

        // Consume path only if we followed the plan
        if (train.path && train.path.length > 0 && train.path[0] === nextEdgeId) {
          train.path.shift()
        }

        // Clear Intent
        train.nextMoveIntent = undefined
      }
    }
  }

  private static triggerCollision(trainA: string, trainB: string) {
    const msg = `CRASH! Train ${trainA} collided with ${trainB}`
    console.error(msg)
    throw new Error(msg)
  }
}
