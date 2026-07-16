import type { GroundMode } from '../config';
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
  /**
   * Grant n plots into the shed (T3.3a) - a straight pipe to
   * `gameState.grantPlots`, same validation (positive integer, total
   * entitlement capped at the maximal grid). Returns whether the grant
   * was accepted.
   */
  grantPlots(n: number): boolean;
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
  /**
   * Cycle the ground rendering mode tiles -> tiles_flat -> texture_a ->
   * texture_b -> tiles (T2.28/T2.28a dev experiment), rebuilding only the
   * ground layer. Registered by FarmScene. Returns the new mode so the
   * caller (the overlay button) can update its own label.
   */
  cycleGroundMode?(): GroundMode;
  /**
   * Dressing editor (T2.28a dev overlay): toggle drag-editing of every scene
   * dressing decal, spawn one from the palette, scale/delete the current
   * selection, or serialize the live layout for "Copy layout". All optional
   * and registered together by FarmScene - see `registerDressingEditorHooks`.
   */
  toggleDressingEdit?(enabled: boolean): void;
  spawnDressing?(frame: string): void;
  scaleDressingSelected?(delta: number): void;
  /** Toggles the "Move to front" flag on the current selection - see FarmScene.toggleSelectedDressingFront. */
  toggleDressingSelectedFront?(): void;
  deleteDressingSelected?(): void;
  copyDressingLayoutJson?(): string;
  /**
   * Set the MAIN (world) camera's scroll/zoom (T3.4a camera split): the whole
   * world layer shifts/scales while the UI camera's layer stays pixel-fixed.
   * No args resets to the default (0, 0, zoom 1). Registered by FarmScene.
   */
  camera?(scrollX?: number, scrollY?: number, zoom?: number): void;
  /**
   * T3.4a verification probe: the Farm scene's ROOT display list (must be
   * exactly the two camera-split layers) plus each layer's child count.
   * Registered by FarmScene.
   */
  sceneLayers?(): { root: string[]; worldChildren: number; uiChildren: number };
  /**
   * T3.4b verification probe: the live world-camera view plus the current
   * gesture classification and the pinch farming-suppression/recenter
   * visibility flags. Registered by FarmScene.
   */
  cameraState?(): {
    scrollX: number;
    scrollY: number;
    zoom: number;
    gesture: string | null;
    farmingSuppressed: boolean;
    recenterVisible: boolean;
  };
  /**
   * T3.27 dev-only decor sizing probe: while ON, the arrange-mode Scale +/-
   * buttons may take the SELECTED decoration past the normal cap up to a dev
   * ceiling, and every scale change/selection logs the frame, scale factor,
   * and rendered px size to the console. Off by default; no behavior change
   * while off. Turning it off (or scene boot) logs any decoration currently
   * left above the normal cap. Registered by FarmScene.
   */
  decorSizing?(enabled: boolean): void;
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
    grantPlots: (n) => store.grantPlots(n),
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

/**
 * Late-bind `dev.cycleGroundMode` once the Farm scene exists, same pattern as
 * `registerCoinArcTest`.
 */
export function registerGroundModeCycle(cycle: () => GroundMode): void {
  if (window.dev !== undefined) window.dev.cycleGroundMode = cycle;
}

/**
 * Late-bind `dev.camera` once the Farm scene exists, same pattern as
 * `registerCoinArcTest`.
 */
export function registerCameraControl(
  set: (scrollX?: number, scrollY?: number, zoom?: number) => void,
): void {
  if (window.dev !== undefined) window.dev.camera = set;
}

/**
 * Late-bind `dev.cameraState` once the Farm scene exists, same pattern as
 * `registerCoinArcTest`.
 */
export function registerCameraStateProbe(
  probe: () => {
    scrollX: number;
    scrollY: number;
    zoom: number;
    gesture: string | null;
    farmingSuppressed: boolean;
    recenterVisible: boolean;
  },
): void {
  if (window.dev !== undefined) window.dev.cameraState = probe;
}

/**
 * Late-bind `dev.sceneLayers` once the Farm scene exists, same pattern as
 * `registerCoinArcTest`.
 */
export function registerSceneLayersProbe(
  probe: () => { root: string[]; worldChildren: number; uiChildren: number },
): void {
  if (window.dev !== undefined) window.dev.sceneLayers = probe;
}

/**
 * Late-bind `dev.decorSizing` once the Farm scene exists, same pattern as
 * `registerCoinArcTest`.
 */
export function registerDecorSizingToggle(toggle: (enabled: boolean) => void): void {
  if (window.dev !== undefined) window.dev.decorSizing = toggle;
}

/**
 * Late-bind the dressing editor's five hooks once the Farm scene exists, same
 * pattern as `registerCoinArcTest` - bundled into one call since the overlay
 * always wires all five together for the "Edit dressing" feature.
 */
export function registerDressingEditorHooks(hooks: {
  toggle: (enabled: boolean) => void;
  spawn: (frame: string) => void;
  scaleSelected: (delta: number) => void;
  toggleSelectedFront: () => void;
  deleteSelected: () => void;
  copyLayoutJson: () => string;
}): void {
  if (window.dev === undefined) return;
  window.dev.toggleDressingEdit = hooks.toggle;
  window.dev.spawnDressing = hooks.spawn;
  window.dev.scaleDressingSelected = hooks.scaleSelected;
  window.dev.toggleDressingSelectedFront = hooks.toggleSelectedFront;
  window.dev.deleteDressingSelected = hooks.deleteSelected;
  window.dev.copyDressingLayoutJson = hooks.copyLayoutJson;
}
