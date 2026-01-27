import { TrainState, TrainType } from './types';
import type { Train } from './types';

export class StateMachine {
  
  static updateTrain(train: Train, tick: number): void {
    // Increment timer for current state
    train.timer++;

    switch (train.state) {
      case TrainState.MOVING_TO_PLATFORM:
        if (train.timer >= train.entryDuration) {
          train.state = TrainState.AT_PLATFORM;
          train.timer = 0;
          train.actualArriveTick = tick;
        }
        break;

      case TrainState.AT_PLATFORM:
        // Automatically finish service, but WAIT for player to depart
        // Unless it's a Terminating train, which might auto-finish or wait for swap
        if (train.timer >= train.schedule.stopDuration) {
           // Visual indicator that it is READY to depart? 
           // We stay in AT_PLATFORM state, but maybe we need a sub-state or just rely on UI to show "Ready"
           // Actually, let's transition to WAITING_DEPART to signal player "Ready to Go"
           train.state = TrainState.WAITING_DEPART;
           train.timer = 0;
        }
        break;
      
      case TrainState.WAITING_DEPART:
        // Stuck here until Player Action
        break;

      case TrainState.DEPARTED:
        if (train.timer >= train.exitDuration) {
          train.state = TrainState.FINISHED;
          train.actualDepartTick = tick;
        }
        break;
        
      case TrainState.FINISHED:
        // Terminal state
        break;
    }
  }

  // Player Actions
  static assignPlatform(train: Train, platformId: number): boolean {
    if (train.state !== TrainState.WAITING_ENTRY) return false;
    train.currentPlatformId = platformId;
    train.state = TrainState.MOVING_TO_PLATFORM;
    train.timer = 0;
    return true;
  }

  static dispatchTrain(train: Train): boolean {
    if (train.state !== TrainState.WAITING_DEPART) return false;
    train.state = TrainState.DEPARTED;
    train.timer = 0;
    return true;
  }
}
