/**
 * Audio tunables: per-sound defs (volume, base rate, optional marker clip,
 * anti-crackle volume jitter), channel volume defaults, and the feel
 * parameters for the harvest pitch chain and the coin/bagpop jitters. All
 * playback goes through `systems/audio.ts`; nothing outside it should read
 * these directly.
 */

/** Keys of the seven one-shot effects loaded in Preload. */
export type SfxKey = 'harvest' | 'plant' | 'coin' | 'tap' | 'fanfare' | 'levelup' | 'bagpop';

/** Loader key of the looping background track. */
export const MUSIC_KEY = 'music';

export interface SfxDef {
  /** Base playback volume (0..1), before channel volume and jitter. */
  volume: number;
  /** Base playback rate; caller rates (harvest chain, coin jitter) multiply on top. */
  rate?: number;
  /** Play only this slice of the file (seconds), via a Phaser sound marker. */
  marker?: { start: number; duration: number };
  /** Per-play +/- volume jitter fraction, so dense bursts don't phase-stack into crackle. */
  volumeJitter?: number;
}

/** Per-effect playback definition. */
export const SFX_DEFS: Record<SfxKey, SfxDef> = {
  // First second of a long leaf-rustle recording; the chain rate shortens it further.
  harvest: { volume: 0.9, marker: { start: 0, duration: 1.0 }, volumeJitter: 0.1 },
  plant: { volume: 0.7, volumeJitter: 0.1 },
  coin: { volume: 0.5, volumeJitter: 0.1 },
  // A wooden footstep sped up 4x reads as a snappy UI tick.
  tap: { volume: 0.4, rate: 4.0 },
  fanfare: { volume: 0.7 },
  // Slightly faster than the fanfare so the bigger beat reads brighter.
  levelup: { volume: 0.8, rate: 1.15 },
  bagpop: { volume: 0.5, volumeJitter: 0.1 },
};

/**
 * Max simultaneous live instances per sfx key; plays beyond the cap are
 * silently skipped - 7+ identical overlapping pops add nothing but clipping.
 */
export const SFX_MAX_CONCURRENT = 6;

/** Channel volume defaults (fresh saves AND the v5 -> v6 migration). */
export const DEFAULT_MUSIC_VOLUME = 0.2;
export const DEFAULT_SFX_VOLUME = 0.7;

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

/** Bag arrival pitch jitter, same idea as the coin's. */
export const BAGPOP_RATE_MIN = 0.95;
export const BAGPOP_RATE_MAX = 1.1;
