import type { GroundMode } from '../config';
import type { CropId } from '../data/crops';
import type { GoodId } from '../data/goods';
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
  /**
   * Dev-only region unlock (T3.3b): a straight pipe to
   * `gameState.devUnlockRegion` - the real `purchaseRegion` path minus the
   * level and coin gates (unlocks the region and grants its plots). Returns
   * whether the unlock was accepted (false for an unknown or already-unlocked
   * region id).
   */
  unlockRegion(id: string): boolean;
  /**
   * Dev-only flour mill (T4.1): a straight pipe to
   * `gameState.devBuildBuilding('flour_mill')` - the real `buyBuilding` path
   * minus the level and coin gates. THE only way to get a mill this task (it
   * has no shop entry and no unlock card yet), so the building can be placed,
   * moved, and eyeballed. Returns whether one was placed (false if a mill is
   * already owned - one per save).
   */
  buildMill(): boolean;
  /**
   * Grant `count` of a processed good straight into the bag (T4.0) - a pipe to
   * `gameState.devGrantGood`, for exercising the sell path without milling.
   */
  grantGood(goodId: GoodId, count: number): void;
  /**
   * Start one milling batch on the placed mill (T4.2a). Resolves the mill's own
   * index in `state.buildings`, so the caller does not have to know it. Returns
   * false if no mill is placed, its slots are full, or the bag is short of the
   * recipe's input crop.
   */
  startMilling(): boolean;
  /**
   * Back-date every in-flight batch so all of them read ready immediately
   * (T4.2a) - the dev fast-forward that makes collection testable without
   * waiting out a real 20-minute batch.
   */
  finishMilling(): void;
  /**
   * Dev-only restoration toggle (T3.25): a straight pipe to
   * `gameState.devSetFarmhouseRestored` - flips the farmhouse between its
   * current and restored look (and the Homestead luck perk with it) for free,
   * in either direction. Returns the new value. The scene re-reads the frame
   * on its refresh tick, so the swap shows without a reload.
   */
  setFarmhouseRestored(restored: boolean): boolean;
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
   * Cycle the ground rendering mode texture_a -> tiles -> tiles_flat ->
   * texture_a (T2.28 dev experiment; meadow texture_a is the shipping
   * default since T3.3s-r2b, the tile modes remain for comparison),
   * rebuilding only the ground layer. Registered by FarmScene. Returns the
   * new mode so the caller (the overlay button) can update its own label.
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
  /**
   * T3.3s-r2 dev restrictions overlay: toggles a persistent overlay of ALL
   * blocked tiles - both structures' footprints at their LIVE anchors (red
   * diamonds, tracking moves as they commit), the expand sign's while it
   * still stands, and the placeable-domain boundary (a dim wash beyond it).
   * Console-logs its state like the other probes. Registered by FarmScene.
   */
  footprints?(): void;
  /**
   * T3.26 dev-only farmhouse transform knobs, for diagnosing the building's
   * angle: does an in-plane rotation make it sit right on the iso grid (a tilt
   * the art can be rotated out of), or not (a perspective mismatch that needs
   * new art)? All four are NON-PERSISTENT - they move the sprite only, never
   * state, and a reload clears them. Each logs the live rotation/scale/offset
   * so the owner can record whatever looks right. Registered by FarmScene.
   *
   * - setFarmhouseRotation: absolute degrees, pivoting on the sprite centre.
   * - setFarmhouseScale: absolute MULTIPLIER over the normal display scale.
   * - nudgeFarmhouse: CUMULATIVE px offset from the computed position.
   * - resetFarmhouseTransform: back to the exact baseline render.
   */
  setFarmhouseRotation?(degrees: number): void;
  setFarmhouseScale?(mult: number): void;
  nudgeFarmhouse?(dx: number, dy: number): void;
  resetFarmhouseTransform?(): void;
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
    unlockRegion: (id) => store.devUnlockRegion(id),
    buildMill: () => store.devBuildBuilding('flour_mill'),
    grantGood: (goodId, count) => store.devGrantGood(goodId, count),
    startMilling: () => {
      const index = store.getState().buildings.findIndex((b) => b.type === 'flour_mill');
      return index >= 0 && store.startMilling(index);
    },
    finishMilling: () => store.devFinishMilling(),
    setFarmhouseRestored: (restored) => store.devSetFarmhouseRestored(restored),
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
 * Late-bind `dev.footprints` once the Farm scene exists, same pattern as
 * `registerCoinArcTest`.
 */
export function registerFootprintsToggle(toggle: () => void): void {
  if (window.dev !== undefined) window.dev.footprints = toggle;
}

/**
 * Late-bind the T3.26 farmhouse transform knobs once the Farm scene exists,
 * bundled like `registerDressingEditorHooks` since the four are always wired
 * together.
 */
export function registerFarmhouseTransformHooks(hooks: {
  setRotation: (degrees: number) => void;
  setScale: (mult: number) => void;
  nudge: (dx: number, dy: number) => void;
  reset: () => void;
}): void {
  if (window.dev === undefined) return;
  window.dev.setFarmhouseRotation = hooks.setRotation;
  window.dev.setFarmhouseScale = hooks.setScale;
  window.dev.nudgeFarmhouse = hooks.nudge;
  window.dev.resetFarmhouseTransform = hooks.reset;
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
