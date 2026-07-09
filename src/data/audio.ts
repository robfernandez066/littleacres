/**
 * Audio tunables: per-sound volumes, music volume, and the feel parameters
 * for the harvest pitch chain and coin jitter. All playback goes through
 * `systems/audio.ts`; nothing outside it should read these directly.
 */

/** Keys of the six one-shot effects loaded in Preload. */
export type SfxKey = 'harvest' | 'plant' | 'coin' | 'tap' | 'fanfare' | 'levelup';

/** Loader key of the looping background track. */
export const MUSIC_KEY = 'music';

/** Per-effect playback volume (0..1). */
export const SFX_VOLUMES: Record<SfxKey, number> = {
  harvest: 0.9,
  plant: 0.7,
  coin: 0.5,
  tap: 0.4,
  fanfare: 0.7,
  levelup: 0.8,
};

/** Background music volume - quiet bed under the effects. */
export const MUSIC_VOLUME = 0.35;

/**
 * Harvest pitch chain: consecutive harvests within the window each raise the
 * playback rate by one step (capped), so a sweep audibly escalates; a gap
 * longer than the window resets the rate to 1.0.
 */
export const HARVEST_CHAIN_WINDOW_MS = 800;
export const HARVEST_CHAIN_RATE_STEP = 0.06;
export const HARVEST_CHAIN_RATE_MAX = 1.5;

/**
 * Coin arrival pitch jitter: each coin plays at a random rate in this range
 * so a batch of arrivals doesn't machine-gun identically.
 */
export const COIN_RATE_MIN = 0.95;
export const COIN_RATE_MAX = 1.1;
