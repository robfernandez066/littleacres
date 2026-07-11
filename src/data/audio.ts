/**
 * Audio tunables: per-sound defs (volume, base rate, optional marker clip,
 * anti-crackle volume jitter), channel volume defaults, and the feel
 * parameters for the harvest pitch chain and the coin/bagpop jitters. All
 * playback goes through `systems/audio.ts`; nothing outside it should read
 * these directly.
 */

/** Keys of the ten one-shot effects loaded in Preload. */
export type SfxKey =
  | 'harvest'
  | 'plant'
  | 'coin'
  | 'tap'
  | 'fanfare'
  | 'levelup'
  | 'bagpop'
  | 'expand'
  | 'confirm'
  | 'radiant';

/** Loader key of the looping background track. */
export const MUSIC_KEY = 'music';

/** Loader key of the looping ambient nature bed. */
export const AMBIENT_KEY = 'ambient';

/** Ambient plays at this fraction of the music channel's volume. */
export const AMBIENT_MUSIC_FACTOR = 0.75;

/**
 * While the expand fanfare plays, music/ambient duck to silence and other
 * sfx are skipped. Unducks on the fanfare's `complete` event, or this
 * failsafe delay if that never fires - whichever comes first.
 */
export const EXPAND_DUCK_FAILSAFE_MS = 7000;

/** Fade-in duration when music/ambient are restored after an unduck. */
export const DUCK_RESTORE_FADE_MS = 500;

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
  // Skips the recording's harsh attack transient; still ends at the same point.
  harvest: { volume: 0.55, rate: 0.9, marker: { start: 0.05, duration: 0.95 }, volumeJitter: 0.1 },
  plant: { volume: 0.45, rate: 0.9, volumeJitter: 0.1 },
  coin: { volume: 0.3, volumeJitter: 0.1 },
  // A wooden footstep sped up 4x reads as a snappy UI tick.
  tap: { volume: 0.4, rate: 4.0 },
  fanfare: { volume: 0.7 },
  // Slightly faster than the fanfare so the bigger beat reads brighter.
  levelup: { volume: 0.8, rate: 1.15 },
  bagpop: { volume: 0.5, volumeJitter: 0.1 },
  expand: { volume: 0.7, rate: 1.0 },
  // Deliberately soft - the user tunes by ear; too-quiet is the correct failure mode.
  confirm: { volume: 0.4 },
  radiant: { volume: 0.5 },
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
 * The music channel's useful loudness sits in 0..0.4 gain; the slider's
 * position 0..1 is remapped to gain 0..MUSIC_SLIDER_MAX_GAIN so the full
 * track covers that usable range instead of clipping most of it into the
 * bottom 20%. The stored setting is still absolute gain (DEFAULT_MUSIC_VOLUME
 * unchanged) - only the slider's position <-> gain conversion changes.
 */
export const MUSIC_SLIDER_MAX_GAIN = 0.4;

/**
 * Harvest pitch chain: consecutive harvests within the window each raise the
 * playback rate by one step (capped), so a sweep audibly escalates; a gap
 * longer than the window resets the rate to 1.0.
 */
export const HARVEST_CHAIN_WINDOW_MS = 800;
export const HARVEST_CHAIN_RATE_STEP = 0.06;
export const HARVEST_CHAIN_RATE_MAX = 1.35;

/**
 * Coin arrival pitch jitter: each coin plays at a random rate in this range
 * so a batch of arrivals doesn't machine-gun identically.
 */
export const COIN_RATE_MIN = 0.95;
export const COIN_RATE_MAX = 1.1;

/** Bag arrival pitch jitter, same idea as the coin's. */
export const BAGPOP_RATE_MIN = 0.95;
export const BAGPOP_RATE_MAX = 1.1;
