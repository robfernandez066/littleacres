/** Portrait mobile design resolution. All layout is authored against this. */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

/** Texture key of the single placeholder atlas loaded in Preload. */
export const ATLAS_KEY = 'atlas';

/**
 * Screen position of the HUD coin counter (design space). Coin arcs fly here;
 * the counter itself renders here starting next task.
 */
export const HUD_COIN_POSITION = { x: 140, y: 120 } as const;
