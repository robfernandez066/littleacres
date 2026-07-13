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

/** One music track: its loader key plus the credit info shown in CreditsPanel. */
export interface MusicTrack {
  key: string;
  artist: string;
  title: string;
  source: 'Pixabay';
}

/**
 * The three-song playlist. Credits render FROM this config - no hardcoded
 * credit strings anywhere else.
 */
export const MUSIC_TRACKS: MusicTrack[] = [
  {
    key: 'music_andriig',
    artist: 'andriig',
    title: 'Agriculture Farming Farm Music',
    source: 'Pixabay',
  },
  {
    key: 'music_mfcc',
    artist: 'mfcc',
    title: 'Agriculture Organic Farming Music',
    source: 'Pixabay',
  },
  { key: 'music_geoffharvey', artist: 'geoffharvey', title: 'Fun On The Farm', source: 'Pixabay' },
];

/** Crossfade duration (ms) between playlist tracks, and on duck restore. */
export const MUSIC_FADE_MS = 2000;

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
  // 0.3 was tuned on desktop speakers and vanished on phone speakers (2026-07-13).
  coin: { volume: 0.45, volumeJitter: 0.1 },
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

/** In-place Fisher-Yates shuffle using an injected rng (for testability). */
function shuffle(indices: number[], rng: () => number): number[] {
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    // Both indices are within bounds by construction (0 <= j <= i < indices.length).
    const temp = indices[i]!;
    indices[i] = indices[j]!;
    indices[j] = temp;
  }
  return indices;
}

/**
 * Shuffle-bag playlist draw: pop the next track index off `bag`, reshuffling
 * a fresh bag of every MUSIC_TRACKS index when it runs dry. On a reshuffle,
 * the new bag's first pick is swapped away from `lastPlayed` (when more than
 * one track exists) so a cycle boundary never repeats the same track back to
 * back - mid-cycle draws already can't repeat, since each index appears once
 * per bag.
 */
export function nextTrackIndex(
  bag: readonly number[],
  lastPlayed: number | null,
  rng: () => number,
): { index: number; bag: number[] } {
  let pool = [...bag];
  if (pool.length === 0) {
    pool = shuffle(
      MUSIC_TRACKS.map((_, index) => index),
      rng,
    );
    if (pool.length > 1 && pool[0] === lastPlayed) {
      const swapWith = 1 + Math.floor(rng() * (pool.length - 1));
      // Both indices are within bounds: swapWith is in [1, pool.length - 1].
      const temp = pool[0]!;
      pool[0] = pool[swapWith]!;
      pool[swapWith] = temp;
    }
  }
  // pool always has at least one element: either bag was non-empty, or it was
  // just reshuffled from MUSIC_TRACKS (never empty).
  const index = pool[0]!;
  return { index, bag: pool.slice(1) };
}
