import Phaser from 'phaser';

/**
 * First scene in the flow. Minimal one-time setup lives here (scale/config
 * tweaks, registry defaults). Hands off to Preload immediately.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    this.scene.start('Preload');
  }
}
