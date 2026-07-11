import Phaser from 'phaser';

import { CROPS } from '../data/crops';
import { gameState, type GameStateData } from '../systems/gameState';
import { isReady } from '../systems/growth';
import { isModalOpen } from '../systems/modalPanels';
import { now } from '../systems/time';

/** Real wall-clock lifetime of the label once shown; a UI timer, not game time. */
const CROP_COUNTDOWN_TTL_MS = 4000;

/** Above crops (drawn at their y position), below the seed bar (2000). */
const LABEL_DEPTH = 1900;
/** Above the plot's tile center - clears the crop sprite and its ready bounce. */
const LABEL_OFFSET_Y = -120;

const LABEL_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'Arial, sans-serif',
  fontSize: '46px',
  fontStyle: 'bold',
  color: '#fff3c4',
  stroke: '#3a2a10',
  strokeThickness: 8,
};

/** `45s` under a minute, `3m 20s` from a minute up - no em dashes, no zero-padding. */
function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * One shared pooled "time remaining" label for a tapped growing-but-not-ready
 * plot - last tap wins, re-targeting just moves it. Owns no input handling;
 * `FarmScene` decides when a tap qualifies and supplies the plot's screen
 * position at `show` time, then drives `refresh` off its own clock tick.
 */
export class CropCountdown {
  private readonly label: Phaser.GameObjects.Text;
  private plotIndex: number | null = null;
  private shownAt = -Infinity;

  constructor(scene: Phaser.Scene) {
    this.label = scene.add
      .text(0, 0, '', LABEL_STYLE)
      .setOrigin(0.5)
      .setDepth(LABEL_DEPTH)
      .setVisible(false);
  }

  /** Show (or re-target) the countdown for `plotIndex`, above `pos`, and (re)start its TTL. */
  show(plotIndex: number, pos: { x: number; y: number }): void {
    this.plotIndex = plotIndex;
    this.shownAt = Date.now();
    this.label.setPosition(pos.x, pos.y + LABEL_OFFSET_Y).setVisible(true);
    this.refresh(gameState.getState());
  }

  /**
   * Re-derive the live remaining time from state + clock, called every scene
   * tick. Hides when the crop ripens, the plot stops growing, the TTL has
   * elapsed, a modal panel is open, or onboarding is somehow active.
   */
  refresh(state: GameStateData): void {
    if (this.plotIndex === null) return;
    if (isModalOpen() || !state.onboarding.completed) {
      this.hide();
      return;
    }
    const plot = state.plots[this.plotIndex];
    if (plot === undefined || plot.state !== 'growing') {
      this.hide();
      return;
    }
    const nowMs = now();
    if (isReady(plot, nowMs) || Date.now() - this.shownAt >= CROP_COUNTDOWN_TTL_MS) {
      this.hide();
      return;
    }
    const remainingMs = plot.plantedAt + CROPS[plot.cropId].growMs - nowMs;
    this.label.setText(formatRemaining(remainingMs));
  }

  /** Hide immediately - a new tap target, a ripened crop, or an expired TTL. */
  hide(): void {
    this.plotIndex = null;
    this.label.setVisible(false);
  }
}
