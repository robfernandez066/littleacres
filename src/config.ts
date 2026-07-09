/** Portrait mobile design resolution. All layout is authored against this. */
export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

/** Texture key of the single texture atlas loaded in Preload. */
export const ATLAS_KEY = 'atlas';

/**
 * Tile frame geometry (see ASSETS.md and tools/pack-atlas.mjs). The tile art
 * has raised lips/fringes, so the frame is taller than the 2:1 diamond: the
 * diamond's top face spans TILE_WIDTH x TILE_HEIGHT (256x128, iso.ts) with
 * its center at (TILE_FRAME_WIDTH / 2, TILE_DIAMOND_CENTER_Y) and the lip
 * hanging below. Tile sprites therefore render with origin
 * (0.5, TILE_DIAMOND_CENTER_Y / TILE_FRAME_HEIGHT) so grid math is untouched.
 */
export const TILE_FRAME_WIDTH = 256;
export const TILE_FRAME_HEIGHT = 160;
export const TILE_DIAMOND_CENTER_Y = 64;

/**
 * Nine-slice margin for the `panel` frame, on all four sides of every
 * nineslice call. Measured from the packed art by tools/pack-atlas.mjs
 * (border 11px, corner radius ~15px, plus safety) - rerun the packer after
 * changing the panel art and keep this in sync with its logged value.
 */
export const PANEL_SLICE = 18;

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
