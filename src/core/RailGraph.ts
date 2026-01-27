export interface RailNode {
  id: string;
  x: number;
  y: number;
  type: 'switch' | 'endpoint' | 'connector' | 'buffer_stop';
  
  // Phase 3: Control States
  switchState?: number; // Index of active outgoing edge (0..N-1)
  signalState?: 'red' | 'green'; // For signals
}

export interface RailEdge {
  id: string;
  fromNode: string;
  toNode: string;
  length: number;
  
  // State
  occupiedBy: string | null;
  isPlatform?: boolean;
  
  // Visualization (Bezier Control Points)
  control1?: { x: number; y: number };
  control2?: { x: number; y: number };
}

export interface PlatformZone {
  id: string;
  label: string;
  rect: { x: number; y: number; w: number; h: number }; 
}

export interface RailMap {
  nodes: Record<string, RailNode>;
  edges: Record<string, RailEdge>;
  platforms: PlatformZone[]; // Visual zones
}

// Visual Models
export type TrainModel = 'CR400AF' | 'CR400BF' | 'CRH380A';

export interface TrainPhysics {
  id: string;
  
  // Visuals
  modelType: TrainModel;
  isCoupled: boolean; // True = 16 cars (Double length), False = 8 cars

  // Physics State
  currentEdgeId: string;
  position: number;      // Distance from 'fromNode' along the edge
  speed: number;         // Units per second
  state: 'moving' | 'stopped';
  
  // Navigation
  path: string[];        // Upcoming Edge IDs to traverse
  visitedPath: string[]; // History of Edge IDs traversed (for tail rendering)
  
  // Internal (Transient for Intent Phase)
  nextMoveIntent?: {
    targetEdgeId: string;
    overflowDistance: number;
  };

  // Gameplay State
  passengerState?: 'BOARDING' | 'READY';
  boardingTimer?: number; 
  lastServicedEdgeId?: string; // To prevent re-stopping at same platform
  
  // Control Handover
  isHandedOver?: boolean; // True if train has passed the control boundary

  // Schedule / Timing
  arrivalTick?: number;      // Actual arrival tick at platform
  stopDuration?: number;     // Assigned stop duration (ticks)
  stopBuffer?: number;       // Random buffer (60-90s) for departure
}
