import Phaser from 'phaser';

import {
  COIN_RATE_MAX,
  COIN_RATE_MIN,
  HARVEST_CHAIN_RATE_MAX,
  HARVEST_CHAIN_RATE_STEP,
  HARVEST_CHAIN_WINDOW_MS,
  MUSIC_KEY,
  MUSIC_VOLUME,
  SFX_VOLUMES,
  type SfxKey,
} from '../data/audio';
import { gameState } from './gameState';

export type { SfxKey } from '../data/audio';

/**
 * Thin stateful wrapper over Phaser's sound system: every play call routes
 * through here so the persisted mute settings gate everything in one place.
 * Owns the harvest pitch chain, the coin jitter, and the looping music
 * track - including the browser autoplay dance (music requested before the
 * first user gesture defers to Phaser's `unlocked` event instead of erroring).
 *
 * Constructed by the scene; playback state (chain rate, music handle) is
 * in-memory only - the on/off settings live in `gameState.settings`.
 */
export class AudioManager {
  /** Real wall-clock ms of the last harvest pop; UI feel, not gameplay time. */
  private lastHarvestAt = -Infinity;
  private harvestRate = 1;
  private music: Phaser.Sound.BaseSound | null = null;
  /** Guards against stacking one `unlocked` handler per pre-gesture startMusic call. */
  private musicPendingUnlock = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /** Play a one-shot effect at its configured volume; a no-op while sfx are muted. */
  sfx(key: SfxKey, opts: { rate?: number } = {}): void {
    if (!gameState.getState().settings.sfxOn) return;
    this.scene.sound.play(key, { volume: SFX_VOLUMES[key], rate: opts.rate ?? 1 });
  }

  /**
   * Harvest pop with the escalating chain: consecutive calls within
   * HARVEST_CHAIN_WINDOW_MS raise the playback rate one step per call
   * (capped at HARVEST_CHAIN_RATE_MAX); a longer gap resets to 1.0. The
   * chain advances even while sfx are muted - it is cheap, and muting
   * mid-sweep then unmuting keeps the feel consistent.
   */
  harvestPop(): void {
    const nowMs = Date.now();
    this.harvestRate =
      nowMs - this.lastHarvestAt <= HARVEST_CHAIN_WINDOW_MS
        ? Math.min(this.harvestRate + HARVEST_CHAIN_RATE_STEP, HARVEST_CHAIN_RATE_MAX)
        : 1;
    this.lastHarvestAt = nowMs;
    this.sfx('harvest', { rate: this.harvestRate });
  }

  /** Coin arrival clink with random pitch jitter so batches don't machine-gun. */
  coin(): void {
    this.sfx('coin', { rate: COIN_RATE_MIN + Math.random() * (COIN_RATE_MAX - COIN_RATE_MIN) });
  }

  /**
   * Start the looping background track; a no-op while music is muted or
   * already playing. Browser autoplay policy blocks audio before the first
   * user gesture: while the sound system is locked this defers itself to
   * Phaser's `unlocked` event (fired on that gesture) instead of erroring.
   * The deferred call re-checks the setting, so muting before the first
   * gesture still wins.
   */
  startMusic(): void {
    if (!gameState.getState().settings.musicOn) return;
    if (this.scene.sound.locked) {
      if (this.musicPendingUnlock) return;
      this.musicPendingUnlock = true;
      this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        this.musicPendingUnlock = false;
        this.startMusic();
      });
      return;
    }
    if (this.music === null) {
      this.music = this.scene.sound.add(MUSIC_KEY, { loop: true, volume: MUSIC_VOLUME });
    }
    if (!this.music.isPlaying) this.music.play();
  }

  /** Persist the music setting and start/stop the track immediately. */
  setMusicOn(on: boolean): void {
    gameState.setMusicOn(on);
    if (on) {
      this.startMusic();
    } else {
      this.music?.stop();
    }
  }

  /** Persist the sfx setting; `sfx()` reads it live, so this is just the store write. */
  setSfxOn(on: boolean): void {
    gameState.setSfxOn(on);
  }
}
