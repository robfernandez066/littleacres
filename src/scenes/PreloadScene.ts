import Phaser from 'phaser';

import atlasJsonUrl from '../../assets/atlas.json?url';
import atlasPngUrl from '../../assets/atlas.png';
import grassTextureAUrl from '../../assets/grass_texture_a.png';
import grassTextureBUrl from '../../assets/grass_texture_b.png';
import bagpopMp3Url from '../../assets/audio/bagpop.mp3?url';
import coinMp3Url from '../../assets/audio/coin.mp3?url';
import confirmMp3Url from '../../assets/audio/confirm.mp3?url';
import expandMp3Url from '../../assets/audio/expand.mp3?url';
import fanfareOggUrl from '../../assets/audio/fanfare.ogg?url';
import harvestMp3Url from '../../assets/audio/harvest.mp3?url';
import levelupOggUrl from '../../assets/audio/levelup.ogg?url';
import plantMp3Url from '../../assets/audio/plant.mp3?url';
import radiantMp3Url from '../../assets/audio/radiant.mp3?url';
import tapOggUrl from '../../assets/audio/tap.ogg?url';
import {
  ATLAS_KEY,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  GROUND_TEXTURE_A_KEY,
  GROUND_TEXTURE_B_KEY,
} from '../config';
import { type SfxKey } from '../data/audio';

/** Loader key -> fingerprinted URL for the ten one-shot effects. */
const SFX_URLS: Record<SfxKey, string> = {
  harvest: harvestMp3Url,
  plant: plantMp3Url,
  coin: coinMp3Url,
  tap: tapOggUrl,
  fanfare: fanfareOggUrl,
  levelup: levelupOggUrl,
  bagpop: bagpopMp3Url,
  expand: expandMp3Url,
  confirm: confirmMp3Url,
  radiant: radiantMp3Url,
};

const BACKGROUND_COLOR = 0xfdf6e3;
const TRACK_COLOR = 0x2e4a1f;
const FILL_COLOR = 0xf7d154;
const TEXT_COLOR = '#2e4a1f';
const BAR_WIDTH = 560;
const BAR_HEIGHT = 28;
const BAR_PADDING = 4;

/**
 * Loads the texture atlas and shows a centered progress bar driven by the
 * loader's progress events, then hands off to Farm.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    const centerX = DESIGN_WIDTH / 2;
    const centerY = DESIGN_HEIGHT / 2;

    this.add.rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, BACKGROUND_COLOR).setOrigin(0, 0);
    this.add
      .text(centerX, centerY - 70, 'Loading...', {
        fontFamily: 'sans-serif',
        fontSize: '40px',
        color: TEXT_COLOR,
      })
      .setOrigin(0.5, 0.5);
    this.add.rectangle(centerX, centerY, BAR_WIDTH, BAR_HEIGHT, TRACK_COLOR).setOrigin(0.5, 0.5);

    // Left-anchored fill scaled by load progress (scaleX 0 -> 1 == 0% -> 100%).
    const fill = this.add
      .rectangle(
        centerX - BAR_WIDTH / 2 + BAR_PADDING,
        centerY,
        BAR_WIDTH - BAR_PADDING * 2,
        BAR_HEIGHT - BAR_PADDING * 2,
        FILL_COLOR,
      )
      .setOrigin(0, 0.5)
      .setScale(0, 1);
    this.load.on('progress', (value: number) => {
      fill.setScale(value, 1);
    });

    this.load.atlas(ATLAS_KEY, atlasPngUrl, atlasJsonUrl);
    // Ground textures (T2.28 experiment): standalone images, not atlas frames
    // - see ASSETS.md "Ground textures (standalone, not atlas frames)".
    this.load.image(GROUND_TEXTURE_A_KEY, grassTextureAUrl);
    this.load.image(GROUND_TEXTURE_B_KEY, grassTextureBUrl);
    for (const [key, url] of Object.entries(SFX_URLS)) {
      this.load.audio(key, url);
    }
  }

  create(): void {
    this.scene.start('Farm');
  }
}
