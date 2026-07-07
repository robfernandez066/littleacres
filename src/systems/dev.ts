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
  };
}
