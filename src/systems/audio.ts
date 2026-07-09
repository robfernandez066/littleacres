import Phaser from 'phaser';

import {
  BAGPOP_RATE_MAX,
  BAGPOP_RATE_MIN,
  COIN_RATE_MAX,
  COIN_RATE_MIN,
  HARVEST_CHAIN_RATE_MAX,
  HARVEST_CHAIN_RATE_STEP,
  HARVEST_CHAIN_WINDOW_MS,
  MUSIC_KEY,
  SFX_DEFS,
  SFX_MAX_CONCURRENT,
  type SfxKey,
} from '../data/audio';
import { gameState } from './gameState';

export type { SfxKey } from '../data/audio';

/**
 * Every concrete sound implementation (WebAudio, HTML5, NoAudio); unlike
 * BaseSound they all expose live volume control, which the music slider needs.
 */
type ManagedSound =
  Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | Phaser.Sound.NoAudioSound;

/** Marker name used for every clipped effect; one clip per sound instance. */
const MARKER_NAME = 'clip';

/**
 * Thin stateful wrapper over Phaser's sound system: every play call routes
 * through here so the persisted mute settings and channel volumes gate
 * everything in one place. Owns the harvest pitch chain, the coin/bagpop
 * jitters, the per-key concurrency cap, the jingle priority slot, and the
 * looping music track - including the browser autoplay dance (music requested
 * before the first user gesture defers to Phaser's `unlocked` event instead
 * of erroring).
 *
 * Constructed by the scene; playback state (chain rate, live counts, music
 * handle) is in-memory only - the on/off + volume settings live in
 * `gameState.settings`.
 */
export class AudioManager {
  /** Real wall-clock ms of the last harvest pop; UI feel, not gameplay time. */
  private lastHarvestAt = -Infinity;
  private harvestRate = 1;
  private music: ManagedSound | null = null;
  /** Guards against stacking one `unlocked` handler per pre-gesture startMusic call. */
  private musicPendingUnlock = false;
  /** Live instance count per key, for the anti-crackle concurrency cap. */
  private readonly liveCounts = new Map<SfxKey, number>();
  /**
   * The jingle priority slot: fanfare and levelup share it, one at a time.
   * `levelup` preempts a playing fanfare; `fanfare` is skipped while a
   * levelup plays, so a fulfill + level-up beat only celebrates the level-up.
   */
  private jingleKey: SfxKey | null = null;
  private jingleSound: ManagedSound | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Play a one-shot effect: configured base volume x sfx channel volume
   * (x per-play jitter where configured), base rate x the caller's rate.
   * A no-op while sfx are muted, and a silent skip at the concurrency cap.
   */
  sfx(key: SfxKey, opts: { rate?: number } = {}): void {
    const settings = gameState.getState().settings;
    if (!settings.sfxOn) return;
    const def = SFX_DEFS[key];
    const rate = (def.rate ?? 1) * (opts.rate ?? 1);
    let volume = def.volume * settings.sfxVolume;
    if (def.volumeJitter !== undefined) {
      volume *= 1 + (Math.random() * 2 - 1) * def.volumeJitter;
    }
    if (key === 'fanfare' || key === 'levelup') {
      this.playJingle(key, volume, rate);
      return;
    }
    this.play(key, volume, rate);
  }

  /**
   * Play one tracked instance of `key`, or null when the key is already at
   * SFX_MAX_CONCURRENT live instances (the anti-crackle cap - past ~6
   * simultaneous identical pops another adds only clipping). The count
   * decrements exactly once per instance on whichever of complete/stop fires
   * first, then the sound is destroyed.
   */
  private play(key: SfxKey, volume: number, rate: number): ManagedSound | null {
    const liveCount = this.liveCounts.get(key) ?? 0;
    if (liveCount >= SFX_MAX_CONCURRENT) return null;
    const sound = this.scene.sound.add(key);
    this.liveCounts.set(key, liveCount + 1);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.liveCounts.set(key, (this.liveCounts.get(key) ?? 1) - 1);
      sound.destroy();
    };
    sound.once(Phaser.Sound.Events.COMPLETE, release);
    sound.once(Phaser.Sound.Events.STOP, release);
    const marker = SFX_DEFS[key].marker;
    if (marker !== undefined) {
      sound.addMarker({
        name: MARKER_NAME,
        start: marker.start,
        duration: marker.duration,
        config: { volume, rate },
      });
      sound.play(MARKER_NAME);
    } else {
      sound.play({ volume, rate });
    }
    return sound;
  }

  /**
   * The jingle slot. A fanfare never plays over a levelup; anything else
   * entering the slot stops whatever currently occupies it first, so at most
   * one jingle is ever audible.
   */
  private playJingle(key: SfxKey, volume: number, rate: number): void {
    const playing = this.jingleSound !== null && this.jingleSound.isPlaying;
    if (playing && key === 'fanfare' && this.jingleKey === 'levelup') return;
    if (playing) this.jingleSound?.stop();
    this.jingleSound = this.play(key, volume, rate);
    this.jingleKey = key;
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

  /** Crop-into-bag blub with the same style of pitch jitter as the coin. */
  bagpop(): void {
    this.sfx('bagpop', {
      rate: BAGPOP_RATE_MIN + Math.random() * (BAGPOP_RATE_MAX - BAGPOP_RATE_MIN),
    });
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
    const settings = gameState.getState().settings;
    if (!settings.musicOn) return;
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
      this.music = this.scene.sound.add(MUSIC_KEY, { loop: true, volume: settings.musicVolume });
    }
    this.music.setVolume(gameState.getState().settings.musicVolume);
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

  /**
   * Apply a music volume to the playing track WITHOUT persisting - the
   * slider calls this on every drag move so the change is audible live,
   * then commits once on release via `setMusicVolume`.
   */
  previewMusicVolume(volume: number): void {
    this.music?.setVolume(Phaser.Math.Clamp(volume, 0, 1));
  }

  /** Persist the music channel volume (store clamps) and apply it to the playing track. */
  setMusicVolume(volume: number): void {
    gameState.setMusicVolume(volume);
    this.music?.setVolume(gameState.getState().settings.musicVolume);
  }

  /** Persist the sfx channel volume; `sfx()` reads it live, so this is just the store write. */
  setSfxVolume(volume: number): void {
    gameState.setSfxVolume(volume);
  }
}
