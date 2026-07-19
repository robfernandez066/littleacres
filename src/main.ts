import Phaser from 'phaser';
import { registerSW } from 'virtual:pwa-register';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from './config';
import { BootScene } from './scenes/BootScene';
import { FarmScene } from './scenes/FarmScene';
import { PreloadScene } from './scenes/PreloadScene';
import { ShadowLabScene } from './scenes/ShadowLabScene';
import { installDevTools } from './systems/dev';
import { gameState } from './systems/gameState';
import { DevOverlay } from './ui/DevOverlay';
import { showUpdateToast } from './ui/updateToast';

/** Hourly check for long-lived sessions; passive, no UI unless an update is actually waiting. */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => showUpdateToast(() => void updateSW(true)),
  onRegisteredSW: (_url, r) => {
    if (r) setInterval(() => void r.update(), UPDATE_CHECK_INTERVAL_MS);
  },
});

gameState.load();
gameState.startAutosave();
installDevTools(gameState);

void navigator.storage
  ?.persist?.()
  ?.then((granted) => console.info('littleacres: persistent storage', granted));

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  // Matches FarmScene's field green (T3.22) so the letterbox reads as
  // extended lawn - interim presentation fix; the real safe-area/overscan
  // work is scheduled with the camera era.
  backgroundColor: '#55913f',
  // Cap rendering at 60fps: on high-refresh displays Phaser otherwise renders
  // at the full refresh rate (observed 144fps), wasting GPU on a mostly-static
  // farm and starving the OS compositor (system-wide lag when moving windows).
  // NOT `fps.limit`: TimeStep.stepLimitFPS accumulates delta from rAF ticks and
  // resets it to 0 (not carrying the remainder) once it crosses the threshold,
  // so on a 144Hz display (~6.94ms/tick) it only fires every 3rd tick - a real
  // ~48fps, not 60. `target` + `forceSetTimeOut` instead drives the loop off
  // setTimeout at the target interval directly, so every step is a real render
  // at ~60fps (verified against node_modules/phaser/src/core/TimeStep.js).
  fps: { target: 60, forceSetTimeOut: true },
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: DESIGN_WIDTH,
    height: DESIGN_HEIGHT,
  },
  // Dev-only authored-shadow preview route (T3.29). `import.meta.env.DEV` folds
  // to false in production builds, so ShadowLabScene tree-shakes out entirely.
  scene:
    import.meta.env.DEV && new URLSearchParams(location.search).has('shadowlab')
      ? [ShadowLabScene]
      : [BootScene, PreloadScene, FarmScene],
};

const game = new Phaser.Game(config);
new DevOverlay(game);
