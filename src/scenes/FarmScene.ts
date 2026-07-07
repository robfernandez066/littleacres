import Phaser from 'phaser';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';

const BACKGROUND_COLOR = 0x7cb342;
const TITLE_COLOR = '#2e4a1f';

/**
 * The main farm scene. For now it renders a placeholder background covering
 * the full 1080x1920 design area and a title label so the scene flow is
 * visibly working.
 */
export class FarmScene extends Phaser.Scene {
  constructor() {
    super('Farm');
  }

  create(): void {
    this.add.rectangle(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, BACKGROUND_COLOR).setOrigin(0, 0);

    this.add
      .text(DESIGN_WIDTH / 2, DESIGN_HEIGHT / 2, 'Little Acres', {
        fontFamily: 'sans-serif',
        fontSize: '96px',
        color: TITLE_COLOR,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5);
  }
}
