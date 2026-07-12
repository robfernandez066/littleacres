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
  addXp(n: number): void;
  setLevel(n: number): void;
  advanceTime(ms: number): void;
  getTimeOffsetMs(): number;
  plant(plotIndex: number, cropId: CropId): boolean;
  harvest(plotIndex: number): boolean;
  /** Overwrite every order slot with a fresh forced-premium order (T2.27). */
  fillBoardPremium(): void;
  /** Flies n coins from screen center to the HUD corner. Registered by FarmScene. */
  testCoinArc?(n: number): void;
  /**
   * Toggle Phaser's input debug outlines on every currently interactive
   * object in the Farm scene (T2.24). Registered by FarmScene. Objects made
   * interactive AFTER the toggle is turned on need it re-clicked to pick
   * them up too - see the overlay button's own title.
   */
  toggleHitboxes?(enabled: boolean): void;
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
    addXp: (n) => {
      store.addXp(n);
      store.save();
    },
    setLevel: (n) => {
      store.setLevel(n);
      store.save();
    },
    advanceTime: (ms) => advanceTime(ms),
    getTimeOffsetMs: () => getTimeOffsetMs(),
    plant: (plotIndex, cropId) => store.plantCrop(plotIndex, cropId),
    harvest: (plotIndex) => store.harvestPlot(plotIndex),
    fillBoardPremium: () => store.devFillBoardPremium(),
  };
}

/**
 * Late-bind `dev.testCoinArc` once the scene owning the CoinArc effect
 * exists (installDevTools runs before any scene is created).
 */
export function registerCoinArcTest(test: (n: number) => void): void {
  if (window.dev !== undefined) window.dev.testCoinArc = test;
}

/**
 * Late-bind `dev.toggleHitboxes` once the Farm scene exists, same pattern as
 * `registerCoinArcTest`.
 */
export function registerHitboxToggle(toggle: (enabled: boolean) => void): void {
  if (window.dev !== undefined) window.dev.toggleHitboxes = toggle;
}
