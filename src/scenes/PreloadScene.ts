import Phaser from 'phaser';

/**
 * Loads game assets before the game starts. No assets exist yet - future
 * tasks will queue loads in preload(). Hands off to Farm when done.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload(): void {
    // Placeholder: asset loading will be added in a future task.
  }

  create(): void {
    this.scene.start('Farm');
  }
}
