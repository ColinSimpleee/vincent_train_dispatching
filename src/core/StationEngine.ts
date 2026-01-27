import { TrainState, TrainType } from './types';
import type { Station, Train, Platform } from './types';
import { StateMachine } from './StateMachine';

export class StationEngine {
  station: Station;
  private _scheduler: any; // We'll simple inject manually for now or use a loader

  constructor(platformCount: number) {
    this.station = {
      tick: 0,
      platforms: Array.from({ length: platformCount }, (_, i) => ({
        id: i + 1,
        isOccupied: false,
        occupiedBy: null,
        lockedUntilTick: null
      })),
      waitingQueue: [],
      activeTrains: [],
      departedTrains: [],
      score: 0,
      isGameOver: false,
      config: { turnaroundLockTime: 600 } // Example generic lock
    };
  }

  // Called by Vue every 1000ms/2000ms whatever real time
  tick(): void {
    if (this.station.isGameOver) return;
    
    this.station.tick++;

    // 1. Update Active Trains
    // We intentionally iterate backwards or use a copy if we remove items, 
    // but for now let's just update states in place.
    for (const train of this.station.activeTrains) {
      StateMachine.updateTrain(train, this.station.tick);

      // Check for completion
      if (train.state === TrainState.FINISHED) {
         this.handleTrainFinished(train);
      }
    }
    
    // 2. Clear Platform Locks (Turnarounds)
    this.station.platforms.forEach(p => {
       if (p.lockedUntilTick !== null && this.station.tick >= p.lockedUntilTick) {
          p.lockedUntilTick = null;
          p.isOccupied = false;
          p.occupiedBy = null;
       }
    });

    // 3. Spawner (Simple Placeholder)
    // Real impl would read from Schedule JSON
  }

  // --- ACTIONS ---

  playerAssignPlatform(trainId: string, platformId: number): boolean {
    const train = this.station.waitingQueue.find(t => t.id === trainId);
    const platform = this.station.platforms.find(p => p.id === platformId);

    if (!train || !platform) return false;

    // Safety Check: Is Platform Occupied?
    if (platform.isOccupied) {
      this.triggerGameOver(`Collision! Train ${train.id} sent to occupied Platform ${platform.id}`);
      return false;
    }

    // Apply Transition
    if (StateMachine.assignPlatform(train, platform.id)) {
       // Move from Waiting -> Active
       this.station.waitingQueue = this.station.waitingQueue.filter(t => t.id !== trainId);
       this.station.activeTrains.push(train);
       
       // Lock Platform
       platform.isOccupied = true;
       platform.occupiedBy = train.id;
       return true;
    }
    return false;
  }

  playerDepartTrain(trainId: string): boolean {
    const train = this.station.activeTrains.find(t => t.id === trainId);
    if (!train) return false;

    if (StateMachine.dispatchTrain(train)) {
       // Calculate Score immediately? Or at exit?
       // Let's do nothing special here, platform clears when he LEFT (via timer)
       return true;
    }
    return false;
  }

  // --- INTERNAL ---

  private handleTrainFinished(train: Train) {
    // Logic for "Freeing" the platform
    // Use the `currentPlatformId` to free it
    const platform = this.station.platforms.find(p => p.id === train.currentPlatformId);
    
    if (platform) {
       // Standard Train: Free immediately
       if (train.type !== TrainType.TERMINATING) {
           platform.isOccupied = false;
           platform.occupiedBy = null;
       } else {
           // Terminating Train: Turnaround Lock
           platform.occupiedBy = "TURNAROUND";
           // lock for existing schedule turnaround or default
           const lockDuration = train.schedule.turnaroundDuration || this.station.config.turnaroundLockTime;
           platform.lockedUntilTick = this.station.tick + lockDuration;
           
           // TODO: Spawn new train here?
       }
    }

    // Move to history
    this.station.activeTrains = this.station.activeTrains.filter(t => t.id !== train.id);
    this.station.departedTrains.push(train);
  }

  private triggerGameOver(reason: string) {
    console.error("GAME OVER: " + reason);
    this.station.isGameOver = true;
  }
}
