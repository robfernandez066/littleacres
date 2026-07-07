import type { CropId } from '../data/crops';
import type { GameStateData, GameStateStore } from './gameState';
import { advanceTime, getTimeOffsetMs } from './time';

/** Console-callable debug hooks, e.g. `dev.addCoins(100)`. Debug only. */
export interface DevTools {
  getState(): Readonly<GameStateData>;
  exportSave(): string;
  importSave(json: string): boolean;
  reset(): void;
  addCoins(n: number): void;
  advanceTime(ms: number): void;
  getTimeOffsetMs(): number;
  plant(plotIndex: number, cropId: CropId): boolean;
  harvest(plotIndex: number): boolean;
}

declare global {
  interface Window {
    dev?: DevTools;
  }
}

export function installDevTools(store: GameStateStore): void {
  window.dev = {
    getState: () => store.getState(),
    exportSave: () => store.exportSave(),
    importSave: (json) => store.importSave(json),
    reset: () => store.reset(),
    addCoins: (n) => {
      store.addCoins(n);
      store.save();
    },
    advanceTime: (ms) => advanceTime(ms),
    getTimeOffsetMs: () => getTimeOffsetMs(),
    plant: (plotIndex, cropId) => store.plantCrop(plotIndex, cropId),
    harvest: (plotIndex) => store.harvestPlot(plotIndex),
  };
}
