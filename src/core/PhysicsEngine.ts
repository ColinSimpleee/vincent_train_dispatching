import type { TrainPhysics, RailMap, RailNode } from './RailGraph.ts';

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

// 物理常量
const CAR_PITCH = 30;           // 车厢间距（单位）
const DWELL_TIME_MIN = 1800;    // 最小停站时间（30秒 * 60 ticks）
const DWELL_TIME_MAX = 3600;    // 最大停站时间（60秒 * 60 ticks）
const BUFFER_TIME_MIN = 3600;   // 最小发车缓冲（60秒 * 60 ticks）
const BUFFER_TIME_MAX = 5400;   // 最大发车缓冲（90秒 * 60 ticks）
const RESUME_SPEED = 60;        // 恢复运行速度

export class PhysicsEngine {
  
  static update(trains: TrainPhysics[], map: RailMap, dt: number, currentTick: number): void {
    // Phase 0: Passenger Logic
    for (const train of trains) {
        PhysicsEngine.handlePassengerLogic(train);
    }

    // Phase 1: Compute Intents & Resume Checks
    for (const train of trains) {
      if (train.state === 'moving') {
          PhysicsEngine.computeIntent(train, map, dt, currentTick);
      } else if (train.state === 'stopped') {
          PhysicsEngine.tryResume(train, map);
      }
    }

    // Phase 1.5: Physical Collision Check
    PhysicsEngine.detectPhysicalCollisions(trains);

    // Phase 2: Resolve Conflicts
    PhysicsEngine.resolveConflicts(trains);

    // Phase 3: Commit Updates
    PhysicsEngine.commitUpdates(trains, map);
  }

  private static computeIntent(train: TrainPhysics, map: RailMap, dt: number, currentTick: number): void {
    if (train.state !== 'moving' || train.speed === 0) return;

    const dir = train.direction || 1; // Default forward for safety
    const distToMove = train.speed * dt;
    const tPos = train.position + (distToMove * dir); // Direction affects position change
    const currentEdge = map.edges[train.currentEdgeId];
    
    if (!currentEdge) {
      console.error(`Train ${train.id} on invalid edge ${train.currentEdgeId}`);
      train.state = 'stopped';
      return;
    }

    // Check Boundary (direction-aware)
    const isArriving = (dir === 1 && tPos >= currentEdge.length) || (dir === -1 && tPos <= 0);

    if (isArriving) {
      const overflow = dir === 1 ? (tPos - currentEdge.length) : Math.abs(tPos);

      // Special Rule: Platform Stop (Auto-Service)
      if (currentEdge.isPlatform && train.lastServicedEdgeId !== train.currentEdgeId) {
          train.position = dir === 1 ? currentEdge.length : 0;
          train.speed = 0;
          train.state = 'stopped';
          
          train.passengerState = 'BOARDING';
          train.arrivalTick = currentTick;
          const dwell = DWELL_TIME_MIN + Math.floor(Math.random() * (DWELL_TIME_MAX - DWELL_TIME_MIN));
          train.boardingTimer = dwell;
          train.stopDuration = dwell;
          train.stopBuffer = BUFFER_TIME_MIN + Math.floor(Math.random() * (BUFFER_TIME_MAX - BUFFER_TIME_MIN));
          
          train.lastServicedEdgeId = train.currentEdgeId; 
          return;
      }
      
      // Stop Condition: No Path left (Arrived)
      if (!train.path || train.path.length === 0) {
          train.position = dir === 1 ? currentEdge.length : 0;
          train.speed = 0;
          train.state = 'stopped';
          return;
      }

      // 1. Resolve Next Edge based on direction
      const nextNodeId = dir === 1 ? currentEdge.toNode : currentEdge.fromNode;
      const nextNode = map.nodes[nextNodeId];
      
      if (!nextNode) {
        console.error(`Train ${train.id} reached invalid node ${nextNodeId}`);
        train.state = 'stopped';
        return;
      }
      
      const nextEdgeId = PhysicsEngine.resolveNextEdge(nextNode, map, train.currentEdgeId);
      
      // --- RULES ENFORCEMENT ---
      
      // Rule 1: Signal Compliance (Stop at Red)
      if (nextNode.signalState === 'red') {
             train.position = dir === 1 ? currentEdge.length : 0;
             train.speed = 0;
             train.state = 'stopped';
             return;
      }

      // Rule 2: Switch Safety / Wrong Path
      // (Implicitly handled by resolveNextEdge)

      // Rule 3: Block Occupancy -> DISABLED by User Request ("Ghost Mode")
      // const nextEdge = map.edges[nextEdgeId];
      // if (nextEdge.occupiedBy !== null) { ... }

      // ---------------------
      
      if (!nextEdgeId) {
        train.position = dir === 1 ? currentEdge.length : 0;
        train.speed = 0;
        train.state = 'stopped';
        return;
      }

      // Register Intent (Path is Clear)
      train.nextMoveIntent = {
        targetEdgeId: nextEdgeId,
        overflowDistance: overflow
      };
    } else {
      // Normal Move
      train.position = tPos;
      train.nextMoveIntent = undefined;
    }
  }

  private static handlePassengerLogic(train: TrainPhysics): void {
      if (train.passengerState !== 'BOARDING') return;

      train.boardingTimer = (train.boardingTimer || 0) - 1;
      if (train.boardingTimer <= 0) {
          train.passengerState = 'READY';
      }
  }

  private static tryResume(train: TrainPhysics, map: RailMap): void {
      const currentEdge = map.edges[train.currentEdgeId];
      const dir = train.direction || 1;
      
      if (!currentEdge) {
        console.error(`Train ${train.id} on invalid edge ${train.currentEdgeId}`);
        return;
      }

      // Block Resume if strictly held by Passenger State
      if (train.passengerState === 'BOARDING' || train.passengerState === 'READY') return;
      
      // Check if at boundary (direction-aware)
      const distToBound = dir === 1 
        ? (currentEdge.length - train.position) 
        : train.position;
      if (distToBound > 0.1) return; // Not at boundary

      // Check Path Ahead
      const nextNodeId = dir === 1 ? currentEdge.toNode : currentEdge.fromNode;
      const nextNode = map.nodes[nextNodeId];
      
      if (!nextNode) return;
      
      const nextEdgeId = PhysicsEngine.resolveNextEdge(nextNode, map, train.currentEdgeId);
      
      if (!nextEdgeId) return; // Dead end

      // 1. Check Signal
      if (nextNode.signalState === 'red') return; // Still Red

      // 2. Check Occupancy -> DISABLED (Ghost Trains)
      // const nextEdge = map.edges[nextEdgeId];
      // if (nextEdge && nextEdge.occupiedBy !== null) return; 

      // All Clear -> Resume
      train.state = 'moving';
      train.speed = RESUME_SPEED;
  }
  
  /**
   * Resolve next edge based on topology, switch state, and incoming direction.
   * Implements "Flow Consistency": trains maintain their direction of travel through nodes.
   * 
   * @param node - The node the train is arriving at
   * @param map - Rail map
   * @param incomingEdgeId - The edge the train is coming from (to determine flow direction)
   */
  private static resolveNextEdge(node: RailNode | undefined, map: RailMap, incomingEdgeId: string): string | undefined {
      if (!node) return undefined;
      
      const incomingEdge = map.edges[incomingEdgeId];
      if (!incomingEdge) return undefined;
      
      // Determine train's arrival orientation
      const arrivedAtFromNode = incomingEdge.fromNode === node.id;
      
      // Get candidate edges based on flow consistency
      const candidates = Object.values(map.edges).filter(e => {
          if (e.id === incomingEdgeId) return false; // Don't reverse
          
          if (arrivedAtFromNode) {
              // Moving backward → continue backward
              return e.toNode === node.id;
          } else {
              // Moving forward → continue forward  
              return e.fromNode === node.id;
          }
      }).sort((a, b) => a.id.localeCompare(b.id));
      
      if (candidates.length === 0) return undefined;
      if (candidates.length === 1) return candidates[0]?.id;
      
      // Multiple candidates - check switch state
      if (node.type === 'switch') {
          const index = node.switchState || 0;
          return candidates[index % candidates.length]?.id;
      }
      
      return candidates[0]?.id;
  }

  private static getTrainLength(train: TrainPhysics): number {
      const carCount = train.isCoupled ? 16 : 8;
      return carCount * CAR_PITCH;
  }

  private static checkSegmentsOverlap(head1: number, tail1: number, head2: number, tail2: number): boolean {
      const completelyBefore = head1 < tail2;
      const completelyAfter = tail1 > head2;
      return !(completelyBefore || completelyAfter);
  }

  // --- Phase 1.5 ---
  private static detectPhysicalCollisions(trains: TrainPhysics[]): void {
      for (let i = 0; i < trains.length; i++) {
          for (let j = i + 1; j < trains.length; j++) {
              const t1 = trains[i];
              const t2 = trains[j];

              if (!t1 || !t2) continue;
              if (t1.isHandedOver || t2.isHandedOver) continue;
              if (t1.currentEdgeId !== t2.currentEdgeId) continue;

              const t1Head = t1.position;
              const t1Tail = t1.position - PhysicsEngine.getTrainLength(t1);
              const t2Head = t2.position;
              const t2Tail = t2.position - PhysicsEngine.getTrainLength(t2);

              if (PhysicsEngine.checkSegmentsOverlap(t1Head, t1Tail, t2Head, t2Tail)) {
                  PhysicsEngine.triggerCollision(t1.id, t2.id);
              }
          }
      }
  }

  // --- Phase 2 ---
  private static resolveConflicts(trains: TrainPhysics[]): void {
    const claims = new Map<string, string>(); // EdgeId -> TrainId

    for (const train of trains) {
      if (!train.nextMoveIntent) continue;

      const targetId = train.nextMoveIntent.targetEdgeId;
      // const targetEdge = map.edges[targetId];

      // 1. Check Existing Occupancy -> DISABLED (Ghost Mode)
      // We allow entering occupied edges. Physical check handles crashes.
      
      // 2. Check Simultaneous Claims (Race Condition)
      if (claims.has(targetId)) {
        // If two trains try to enter the same edge simultaneously, it's a crash.
        PhysicsEngine.triggerCollision(train.id, claims.get(targetId)!);
      }
      
      claims.set(targetId, train.id);
    }
  }

  // --- Phase 3 ---
  private static commitUpdates(trains: TrainPhysics[], map: RailMap): void {
    for (const train of trains) {
      if (train.nextMoveIntent) {
        // Release Old
        const oldEdge = map.edges[train.currentEdgeId];
        if (oldEdge && oldEdge.occupiedBy === train.id) {
            oldEdge.occupiedBy = null;
        }

        // History (For snake rendering)
        train.visitedPath = train.visitedPath || []; // Safety init
        train.visitedPath.unshift(train.currentEdgeId); // Add current to history (front)
        if (train.visitedPath.length > 20) train.visitedPath.pop(); // Keep 20 recent edges

        // Determine arrival node and new direction
        const currentEdge = map.edges[train.currentEdgeId];
        
        if (!currentEdge) {
            train.nextMoveIntent = undefined;
            continue;
        }
        
        const currentDir = train.direction || 1;
        const arrivalNodeId = currentDir === 1 ? currentEdge.toNode : currentEdge.fromNode;
        
        // Occupy New
        const nextEdgeId = train.nextMoveIntent.targetEdgeId;
        // Occupancy update is formal but doesn't block (since check is disabled)
        if (map.edges[nextEdgeId]) {
            map.edges[nextEdgeId].occupiedBy = train.id;
        } else {
             console.error(`Missing edge ${nextEdgeId} for train ${train.id}`);
             train.state = 'stopped';
             train.nextMoveIntent = undefined;
             continue;
        }
        
        const nextEdge = map.edges[nextEdgeId];

        // AUTO-SET DIRECTION: determine based on edge geometry
        // If next edge STARTS at arrival node → Forward (1)
        // If next edge ENDS at arrival node → Backward (-1)
        if (nextEdge.fromNode === arrivalNodeId) {
            train.direction = 1;
            train.position = train.nextMoveIntent.overflowDistance;
        } else if (nextEdge.toNode === arrivalNodeId) {
            train.direction = -1;
            train.position = nextEdge.length - train.nextMoveIntent.overflowDistance;
        } else {
            console.error(`Edge discontinuity: ${train.currentEdgeId} -> ${nextEdgeId}`);
            train.position = train.nextMoveIntent.overflowDistance; // Fallback
        }

        // Move train to new edge
        train.currentEdgeId = nextEdgeId;
        
        // Consume path only if we followed the plan
        if (train.path && train.path.length > 0 && train.path[0] === nextEdgeId) {
            train.path.shift(); 
        }
        
        // Clear Intent
        train.nextMoveIntent = undefined;
      }
    }
  }

  private static triggerCollision(trainA: string, trainB: string) {
    const msg = `CRASH! Train ${trainA} collided with ${trainB}`;
    console.error(msg);
    alert(msg); // Brutal MVP feedback
    throw new Error(msg); // Stop simulation
  }
}
