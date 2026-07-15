import Phaser from 'phaser';

import {
  AMBIENT_KEY,
  AMBIENT_MUSIC_FACTOR,
  BAGPOP_RATE_MAX,
  BAGPOP_RATE_MIN,
  COIN_RATE_MAX,
  COIN_RATE_MIN,
  DUCK_RESTORE_FADE_MS,
  EXPAND_DUCK_FAILSAFE_MS,
  HARVEST_CHAIN_RATE_MAX,
  HARVEST_CHAIN_RATE_STEP,
  HARVEST_CHAIN_WINDOW_MS,
  MUSIC_FADE_MS,
  MUSIC_TRACKS,
  nextTrackIndex,
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
 * One live playlist track instance. `fadeFactor` is 1 at full volume,
 * tweened 0->1 as the track starts and 1->0 over its final MUSIC_FADE_MS;
 * the applied sound volume is always `effectiveMusicVolume() * fadeFactor`.
 * `generation` pins this handle to the playlist "epoch" it was started in,
 * so a stale delayed-call from a stopped/restarted playlist is a no-op
 * instead of starting an unwanted track. `destroyed` is set true at every
 * site that destroys this handle's sound, so a same-frame tween onUpdate
 * racing the destroy (crossfade-out vs COMPLETE, or unduck-restore vs
 * COMPLETE) finds applyTrackVolume a harmless no-op instead of touching a
 * destroyed WebAudioSound's null internal node.
 */
interface TrackHandle {
  sound: ManagedSound;
  fadeFactor: number;
  generation: number;
  destroyed: boolean;
}

/**
 * Thin stateful wrapper over Phaser's sound system: every play call routes
 * through here so the persisted mute settings and channel volumes gate
 * everything in one place. Owns the harvest pitch chain, the coin/bagpop
 * jitters, the per-key concurrency cap, the jingle priority slot, and the
 * looping music track plus its ambient nature bed, and the expand fanfare's
 * duck (silences music/ambient/all other sfx for the fanfare's duration) -
 * including the browser autoplay dance (music requested before the first
 * user gesture defers to Phaser's `unlocked` event instead of erroring).
 *
 * Constructed by the scene; playback state (chain rate, live counts, music
 * handle) is in-memory only - the on/off + volume settings live in
 * `gameState.settings`.
 */
export class AudioManager {
  /** Real wall-clock ms of the last harvest pop; UI feel, not gameplay time. */
  private lastHarvestAt = -Infinity;
  private harvestRate = 1;
  /**
   * Live playlist tracks: normally one, briefly two during a crossfade (the
   * outgoing track fading 1->0 alongside the incoming track fading 0->1).
   */
  private musicHandles: TrackHandle[] = [];
  /** Shuffle-bag of not-yet-played track indices for the current cycle. */
  private playlistBag: number[] = [];
  private lastPlayedTrackIndex: number | null = null;
  /**
   * Bumped on every stop/restart of the playlist; scheduled callbacks capture
   * the generation they were created under and no-op if it has since moved
   * on, so a musicOn=false right before a scheduled crossfade can't start a
   * track nobody asked for.
   */
  private playlistGeneration = 0;
  /**
   * Live slider-drag override of the music volume, applied instead of the
   * stored setting until the drag commits - so a fade tween ticking mid-drag
   * still recomputes against the value under the finger.
   */
  private previewedMusicVolume: number | null = null;
  /** Looping ambient nature bed, riding the music channel's on/off + volume. */
  private ambient: ManagedSound | null = null;
  /** Guards against stacking one `unlocked` handler per pre-gesture startMusic call. */
  private musicPendingUnlock = false;
  /**
   * True for the duration of the expand fanfare: music/ambient are silenced
   * (not stopped) and `sfx()` skips every key. Set by `expandFanfare`,
   * cleared by `unduck` on the fanfare's completion or its failsafe timer,
   * whichever fires first.
   */
  private ducked = false;
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
   * A no-op while sfx are muted or the expand fanfare is ducking everything
   * else, and a silent skip at the concurrency cap.
   */
  sfx(key: SfxKey, opts: { rate?: number } = {}): void {
    if (this.ducked) return;
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
   * The farm-expansion fanfare: plays 'expand' outside the normal `sfx()`
   * gate (so it isn't silenced by the duck it is about to start), then
   * silences music/ambient/every other sfx for its duration - the loops keep
   * playing at zero volume rather than stopping, so their position carries
   * through. Restores on the clip's `complete` event or the failsafe delay,
   * whichever comes first. Never ducks if the sound fails to play (sfx muted
   * or at the concurrency cap).
   */
  expandFanfare(): void {
    const settings = gameState.getState().settings;
    if (!settings.sfxOn) return;
    const def = SFX_DEFS.expand;
    const sound = this.play('expand', def.volume * settings.sfxVolume, def.rate ?? 1);
    if (sound === null) return;
    this.ducked = true;
    for (const handle of this.musicHandles) handle.sound.setVolume(0);
    this.ambient?.setVolume(0);
    const unduck = (): void => this.unduck();
    sound.once(Phaser.Sound.Events.COMPLETE, unduck);
    this.scene.time.delayedCall(EXPAND_DUCK_FAILSAFE_MS, unduck);
  }

  /**
   * End the expand duck: fades music/ambient back in to the CURRENT store
   * volume (so a slider drag mid-duck applies on restore), unless music was
   * turned off mid-duck - in which case both tracks are already stopped and
   * must stay silent. A harmless no-op if already unducked (the complete
   * event and the failsafe both call this; only the first should act).
   */
  private unduck(): void {
    if (!this.ducked) return;
    this.ducked = false;
    const settings = gameState.getState().settings;
    if (!settings.musicOn) return;
    for (const handle of this.musicHandles) {
      this.scene.tweens.add({
        targets: handle.sound,
        volume: this.effectiveMusicVolume() * handle.fadeFactor,
        duration: DUCK_RESTORE_FADE_MS,
      });
    }
    if (this.ambient !== null) {
      this.scene.tweens.add({
        targets: this.ambient,
        volume: this.effectiveMusicVolume() * AMBIENT_MUSIC_FACTOR,
        duration: DUCK_RESTORE_FADE_MS,
      });
    }
  }

  /** The slider's live drag value while dragging, else the persisted store value. */
  private effectiveMusicVolume(): number {
    return this.previewedMusicVolume ?? gameState.getState().settings.musicVolume;
  }

  /** Apply the current effective volume x this handle's fadeFactor to its sound. */
  private applyTrackVolume(handle: TrackHandle): void {
    if (this.ducked || handle.destroyed) return;
    handle.sound.setVolume(this.effectiveMusicVolume() * handle.fadeFactor);
  }

  /** Re-apply the effective volume to every live track handle and the ambient bed. */
  private applyMusicVolumeToAll(): void {
    if (this.ducked) return;
    for (const handle of this.musicHandles) this.applyTrackVolume(handle);
    this.ambient?.setVolume(this.effectiveMusicVolume() * AMBIENT_MUSIC_FACTOR);
  }

  /**
   * Start one playlist track: fades its volume 0->1 over MUSIC_FADE_MS as it
   * begins, schedules a crossfade into the next track MUSIC_FADE_MS before
   * this one's known duration ends, and destroys the sound on completion.
   * The scheduled crossfade and the play itself are pinned to the playlist
   * generation active when this was called, so a musicOn=false (or a fresh
   * restart) in between makes them no-ops instead of resurrecting a track.
   */
  private playTrack(index: number): void {
    const generation = this.playlistGeneration;
    const track = MUSIC_TRACKS[index];
    if (track === undefined) return;
    const sound = this.scene.sound.add(track.key, { loop: false, volume: 0 });
    const handle: TrackHandle = { sound, fadeFactor: 0, generation, destroyed: false };
    this.musicHandles.push(handle);
    this.lastPlayedTrackIndex = index;
    this.applyTrackVolume(handle);
    sound.play();

    this.scene.tweens.add({
      targets: handle,
      fadeFactor: 1,
      duration: MUSIC_FADE_MS,
      onUpdate: () => this.applyTrackVolume(handle),
    });

    const fadeOutDelay = Math.max(0, sound.duration * 1000 - MUSIC_FADE_MS);
    this.scene.time.delayedCall(fadeOutDelay, () => {
      if (generation !== this.playlistGeneration) return;
      this.crossfadeToNext(handle);
    });

    sound.once(Phaser.Sound.Events.COMPLETE, () => {
      this.musicHandles = this.musicHandles.filter((live) => live !== handle);
      this.scene.tweens.killTweensOf(handle);
      this.scene.tweens.killTweensOf(handle.sound);
      handle.destroyed = true;
      sound.destroy();
    });
  }

  /** Fade the ending `handle` out to silence while the next track fades in alongside it. */
  private crossfadeToNext(handle: TrackHandle): void {
    this.scene.tweens.add({
      targets: handle,
      fadeFactor: 0,
      duration: MUSIC_FADE_MS,
      onUpdate: () => this.applyTrackVolume(handle),
    });
    const settings = gameState.getState().settings;
    if (!settings.musicOn) return;
    this.drawNextTrack();
  }

  /** Draw the next track from the shuffle bag and start it. */
  private drawNextTrack(): void {
    const { index, bag } = nextTrackIndex(this.playlistBag, this.lastPlayedTrackIndex, Math.random);
    this.playlistBag = bag;
    this.playTrack(index);
  }

  /**
   * Stop and tear down every live playlist track, and bump the generation so
   * any already-scheduled crossfade/completion callbacks become no-ops. The
   * shuffle bag and last-played index are left untouched, so turning music
   * back on continues the no-repeat sequence rather than resetting it.
   */
  private stopPlaylist(): void {
    this.playlistGeneration++;
    for (const handle of this.musicHandles) {
      this.scene.tweens.killTweensOf(handle);
      this.scene.tweens.killTweensOf(handle.sound);
      handle.destroyed = true;
      handle.sound.stop();
      handle.sound.destroy();
    }
    this.musicHandles = [];
  }

  /**
   * Start the playlist and the ambient nature bed riding alongside it; a
   * no-op while music is muted or a track is already playing. Browser
   * autoplay policy blocks audio before the first user gesture: while the
   * sound system is locked this defers itself to Phaser's `unlocked` event
   * (fired on that gesture) instead of erroring. The deferred call re-checks
   * the setting, so muting before the first gesture still wins.
   */
  startMusic(): void {
    // Playlist tracks + ambient are background-loaded since T3.21; while any
    // are still downloading this no-ops, and FarmScene's loader COMPLETE
    // handler re-invokes startMusic once they're all in the cache.
    const audioKeys = [...MUSIC_TRACKS.map((track) => track.key), AMBIENT_KEY];
    if (audioKeys.some((key) => !this.scene.cache.audio.has(key))) return;
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
    if (this.musicHandles.length === 0) this.drawNextTrack();

    if (this.ambient === null) {
      this.ambient = this.scene.sound.add(AMBIENT_KEY, {
        loop: true,
        volume: settings.musicVolume * AMBIENT_MUSIC_FACTOR,
      });
    }
    this.ambient.setVolume(settings.musicVolume * AMBIENT_MUSIC_FACTOR);
    if (!this.ambient.isPlaying) this.ambient.play();
  }

  /** Persist the music setting and start/stop the playlist + ambient bed immediately. */
  setMusicOn(on: boolean): void {
    gameState.setMusicOn(on);
    if (on) {
      this.startMusic();
    } else {
      this.stopPlaylist();
      this.ambient?.stop();
    }
  }

  /** Persist the sfx setting; `sfx()` reads it live, so this is just the store write. */
  setSfxOn(on: boolean): void {
    gameState.setSfxOn(on);
  }

  /**
   * Apply a music volume to the playing tracks and ambient bed WITHOUT
   * persisting - the slider calls this on every drag move so the change is
   * audible live, then commits once on release via `setMusicVolume`. A no-op
   * while the expand duck is silencing everything - the value still isn't
   * persisted here, so nothing is lost; `setMusicVolume` on release restores
   * it once unducked.
   */
  previewMusicVolume(volume: number): void {
    if (this.ducked) return;
    this.previewedMusicVolume = Phaser.Math.Clamp(volume, 0, 1);
    this.applyMusicVolumeToAll();
  }

  /**
   * Persist the music channel volume (store clamps) and apply it to the
   * playing tracks and ambient bed - unless the expand duck is silencing
   * everything, in which case the store write still happens but the live
   * volume stays at zero until `unduck` restores it from the store.
   */
  setMusicVolume(volume: number): void {
    gameState.setMusicVolume(volume);
    this.previewedMusicVolume = null;
    this.applyMusicVolumeToAll();
  }

  /** Persist the sfx channel volume; `sfx()` reads it live, so this is just the store write. */
  setSfxVolume(volume: number): void {
    gameState.setSfxVolume(volume);
  }
}
