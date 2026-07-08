import type Phaser from 'phaser';

import { gameState } from '../systems/gameState';
import { getPoolStatsRegistry } from '../systems/pool';
import { advanceTime, getTimeOffsetMs } from '../systems/time';

/** Top-left square (px) that the hidden reveal gesture watches. */
const CORNER_SIZE = 150;
/** Taps required inside the corner, within the window below, to toggle. */
const REVEAL_TAP_COUNT = 5;
const REVEAL_WINDOW_MS = 1_500;
/** Cadence for the FPS/state readouts while the overlay is open. */
const REFRESH_INTERVAL_MS = 500;

/** One "name inUse/size hw highWater" segment per registered effect pool. */
function formatPoolStats(): string {
  const parts: string[] = [];
  for (const [name, pool] of getPoolStatsRegistry()) {
    parts.push(`${name} ${pool.inUse}/${pool.size} hw ${pool.highWater}`);
  }
  return parts.length > 0 ? `pools: ${parts.join(' | ')}` : 'pools: (none registered)';
}

/**
 * Hidden dev overlay: a plain DOM layer (not a Phaser scene) for inspecting
 * and mutating live game state. Toggled by 5 taps in the top-left corner
 * within 1.5s, or the backtick key. Hidden by default and never intercepts
 * game input while hidden.
 */
export class DevOverlay {
  private readonly root: HTMLDivElement;
  private readonly fpsEl: HTMLDivElement;
  private readonly clockEl: HTMLDivElement;
  private readonly poolsEl: HTMLDivElement;
  private readonly stateEl: HTMLPreElement;
  private visible = false;
  private refreshTimer: number | null = null;
  private tapTimestamps: number[] = [];

  constructor(private readonly game: Phaser.Game) {
    this.root = document.createElement('div');
    this.root.style.cssText = `
      position: fixed;
      inset: 0;
      display: none;
      flex-direction: column;
      background: rgba(0, 0, 0, 0.85);
      color: #7CFC7C;
      font-family: monospace;
      font-size: 13px;
      padding: 10px;
      box-sizing: border-box;
      z-index: 100000;
      pointer-events: auto;
    `;

    this.fpsEl = document.createElement('div');
    this.clockEl = document.createElement('div');
    this.poolsEl = document.createElement('div');
    const readouts = document.createElement('div');
    readouts.append(this.fpsEl, this.clockEl, this.poolsEl);
    this.root.appendChild(readouts);

    this.root.appendChild(this.buildButtons());

    this.stateEl = document.createElement('pre');
    this.stateEl.style.cssText =
      'flex: 1; overflow: auto; margin: 10px 0 0; white-space: pre-wrap;';
    this.root.appendChild(this.stateEl);

    document.body.appendChild(this.root);

    window.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    window.addEventListener('keydown', this.onKeyDown);
  }

  private buildButtons(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.style.cssText = 'display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;';

    const addButton = (label: string, onClick: () => void): void => {
      const button = document.createElement('button');
      button.textContent = label;
      button.style.cssText = 'font-family: monospace; font-size: 12px; padding: 4px 8px;';
      button.addEventListener('click', onClick);
      bar.appendChild(button);
    };

    addButton('+100 coins', () => {
      gameState.addCoins(100);
      gameState.save();
      this.refresh();
    });
    addButton('+50 xp', () => {
      gameState.addXp(50);
      gameState.save();
      this.refresh();
    });
    addButton('Reset save', () => {
      if (window.confirm('Reset save? This cannot be undone.')) {
        gameState.reset();
        this.refresh();
      }
    });
    addButton('Warp +1m', () => {
      advanceTime(60_000);
      this.refresh();
    });
    addButton('Warp +10m', () => {
      advanceTime(600_000);
      this.refresh();
    });
    addButton('Warp +60m', () => {
      advanceTime(3_600_000);
      this.refresh();
    });

    return bar;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.clientX > CORNER_SIZE || event.clientY > CORNER_SIZE) return;
    const t = Date.now();
    this.tapTimestamps = [...this.tapTimestamps, t].filter((ts) => t - ts <= REVEAL_WINDOW_MS);
    if (this.tapTimestamps.length >= REVEAL_TAP_COUNT) {
      this.tapTimestamps = [];
      this.toggle();
    }
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === '`') this.toggle();
  };

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'flex' : 'none';
    if (this.visible) {
      this.startRefresh();
    } else {
      this.stopRefresh();
    }
  }

  private startRefresh(): void {
    if (this.refreshTimer !== null) return;
    this.refresh();
    this.refreshTimer = window.setInterval(() => this.refresh(), REFRESH_INTERVAL_MS);
  }

  private stopRefresh(): void {
    if (this.refreshTimer === null) return;
    window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private refresh(): void {
    this.fpsEl.textContent = `FPS: ${Math.round(this.game.loop.actualFps)}`;
    this.clockEl.textContent = `clock +${Math.round(getTimeOffsetMs() / 60_000)}m`;
    this.poolsEl.textContent = formatPoolStats();
    this.stateEl.textContent = JSON.stringify(gameState.getState(), null, 2);
  }
}
