import type { TrainPhysics, RailMap } from './RailGraph.ts';

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
    PhysicsEngine.detectPhysicalCollisions(trains, map);

    // Phase 2: Resolve Conflicts
    PhysicsEngine.resolveConflicts(trains, map);

    // Phase 3: Commit Updates
    PhysicsEngine.commitUpdates(trains, map);
  }

  private static computeIntent(train: TrainPhysics, map: RailMap, dt: number, currentTick: number): void {
    if (train.state !== 'moving' || train.speed === 0) return;

    let distToMove = train.speed * dt;
    let tPos = train.position + distToMove;
    const currentEdge = map.edges[train.currentEdgeId];

    // Check Boundary
    if (tPos >= currentEdge.length) {
      const overflow = tPos - currentEdge.length;

      // Special Rule: Platform Stop (Auto-Service)
      // If we hit the end of a platform, and we haven't serviced it yet:
      if (currentEdge.isPlatform && train.lastServicedEdgeId !== train.currentEdgeId) {
          train.position = currentEdge.length;
          train.speed = 0;
          train.state = 'stopped';
          
          train.passengerState = 'BOARDING';
          // Record Schedule Info
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
          train.position = currentEdge.length;
          train.speed = 0;
          train.state = 'stopped';
          return;
      }

      // 1. Resolve Next Edge based on Topology & Switch State
      const nextNode = map.nodes[currentEdge.toNode];
      const nextEdgeId = PhysicsEngine.resolveNextEdge(nextNode, map);
      
      // --- RULES ENFORCEMENT ---
      
      // Rule 1: Signal Compliance (Stop at Red)
      if (nextNode && nextNode.signalState === 'red') {
             train.position = currentEdge.length;
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

  private static handlePassengerLogic(train: TrainPhysics) {
      if (train.passengerState === 'BOARDING') {
          train.boardingTimer = (train.boardingTimer || 0) - 1;
          if (train.boardingTimer <= 0) {
              train.passengerState = 'READY';
          }
      }
  }

  private static tryResume(train: TrainPhysics, map: RailMap): void {
      const currentEdge = map.edges[train.currentEdgeId];

      // Block Resume if strictly held by Passenger State
      if (train.passengerState === 'BOARDING' || train.passengerState === 'READY') return;
      
      // Only resume if we are waiting at the end of the track (Signal Waiting)
      // Epsilon safe
      if (train.position < currentEdge.length - 0.1) return;

      // Check Path Ahead
      const nextNode = map.nodes[currentEdge.toNode];
      const nextEdgeId = PhysicsEngine.resolveNextEdge(nextNode, map);
      
      if (!nextEdgeId) return; // Dead end

      // 1. Check Signal
      if (nextNode && nextNode.signalState === 'red') return; // Still Red

      // 2. Check Occupancy -> DISABLED (Ghost Trains)
      // const nextEdge = map.edges[nextEdgeId];
      // if (nextEdge && nextEdge.occupiedBy !== null) return; 

      // All Clear -> Resume
      train.state = 'moving';
      train.speed = RESUME_SPEED;
  }
  
  private static resolveNextEdge(node: any, map: RailMap): string | undefined {
      if (!node) return undefined;
      
      // Find outgoing edges, sorted deterministically
      const edges = Object.values(map.edges)
        .filter(e => e.fromNode === node.id)
        .sort((a, b) => a.id.localeCompare(b.id));

      if (edges.length === 0) return undefined;

      if (node.type === 'switch') {
          // Facing Point: One input, Multiple outputs.
          // State determines which output.
          const index = node.switchState || 0;
          return edges[index % edges.length]?.id;
      } else {
          // Connector / Endpoint / Buffer Stop
          // Buffer Stop has NO outgoing edges (filtered by length=0 usually, or just logic).
          if (node.type === 'buffer_stop') return undefined; 
          
          // Trailing Point (Merge):
          // If we are at a Merge node (2 in, 1 out), 'edges' will have 1 item.
          // SwitchState doesn't affect Merging in this simplified model.
          return edges[0]?.id;
      }
  }

  // --- Phase 1.5 ---
  private static detectPhysicalCollisions(trains: TrainPhysics[], map: RailMap) {
      // ACTUAL PENETRATION DETECTION (穿模检测)
      // Check if ANY PART of train A overlaps with ANY PART of train B
      
      // Train physical dimensions (using global constant)
      
      for (let i = 0; i < trains.length; i++) {
          for (let j = i + 1; j < trains.length; j++) {
              const t1 = trains[i];
              const t2 = trains[j];
              
              // Safety check: skip if trains are undefined
              if (!t1 || !t2) continue;
              
              // Skip collision check if either train has passed the control boundary (Handed Over)
              if (t1.isHandedOver || t2.isHandedOver) continue;

              // Calculate train lengths (head to tail)
              // Default to 8 cars if isCoupled is undefined
              const t1Length = (t1.isCoupled ?? false ? 16 : 8) * CAR_PITCH;
              const t2Length = (t2.isCoupled ?? false ? 16 : 8) * CAR_PITCH;
              
              // Train positions: position is the HEAD (front), tail is behind
              const t1Head = t1.position;
              const t1Tail = t1.position - t1Length;
              
              const t2Head = t2.position;
              const t2Tail = t2.position - t2Length;

              // 1. Same Edge Collision - Check if train segments overlap
              if (t1.currentEdgeId === t2.currentEdgeId) {
                  // Two segments overlap if:
                  // - t1's head is past t2's tail AND t1's tail is before t2's head
                  // In other words: NOT (t1 completely before t2 OR t1 completely after t2)
                  const t1CompletelyBefore = t1Head < t2Tail;
                  const t1CompletelyAfter = t1Tail > t2Head;
                  
                  const overlapping = !(t1CompletelyBefore || t1CompletelyAfter);
                  
                  if (overlapping) {
                      PhysicsEngine.triggerCollision(t1.id, t2.id);
                  }
              }
              
              // TODO: Cross-edge collision (when tail is on previous edge)
              // This would require checking if t1's tail (on previous edge) overlaps with t2
          }
      }
  }

  // --- Phase 2 ---
  private static resolveConflicts(trains: TrainPhysics[], map: RailMap): void {
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
        if (map.edges[train.currentEdgeId].occupiedBy === train.id) {
            map.edges[train.currentEdgeId].occupiedBy = null;
        }

        // History (For snake rendering)
        train.visitedPath = train.visitedPath || []; // Safety init
        train.visitedPath.unshift(train.currentEdgeId); // Add current to history (front)
        if (train.visitedPath.length > 5) train.visitedPath.pop(); // Keep 5 recent edges

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

        // Move proper
        train.currentEdgeId = nextEdgeId;
        train.position = train.nextMoveIntent.overflowDistance;
        
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
