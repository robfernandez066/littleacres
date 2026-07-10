import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { FarmScene } from './scenes/FarmScene';
import { PreloadScene } from './scenes/PreloadScene';
import { installDevTools } from './systems/dev';
import { gameState } from './systems/gameState';
import { DevOverlay } from './ui/DevOverlay';

registerSW({ immediate: true });

gameState.load();
gameState.startAutosave();
installDevTools(gameState);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#000000',
  // Cap rendering at 60fps: on high-refresh displays Phaser otherwise renders
  // at the full refresh rate (observed 144fps), wasting GPU on a mostly-static
  // farm and starving the OS compositor (system-wide lag when moving windows).
  fps: { limit: 60 },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
  },
  scene: [BootScene, PreloadScene, FarmScene],
};

const game = new Phaser.Game(config);
new DevOverlay(game);
