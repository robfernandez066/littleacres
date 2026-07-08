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

/** Screen position of the HUD bag button (design space); harvested crops fly here. */
export const BAG_POSITION = { x: 940, y: 190 } as const;

/** Screen position of the HUD orders button, stacked below the bag. */
export const ORDERS_BUTTON_POSITION = { x: 940, y: 310 } as const;

/**
 * Off-screen-right point the fulfilled order goods fly to - "handed to the
 * villager". Past DESIGN_WIDTH so sprites exit the frame before landing.
 */
export const VILLAGER_POSITION = { x: 1240, y: 900 } as const;
