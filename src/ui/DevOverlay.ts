import type Phaser from 'phaser';

import { DRESSING_PALETTE_FRAMES, DRESSING_SCALE_STEP } from '../config';
import { MAX_LEVEL } from '../data/levels';
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
    // Static: identifies the running build so a stale service-worker cache is
    // always detectable (missing entirely in builds older than this line).
    const buildEl = document.createElement('div');
    buildEl.textContent = `build ${__BUILD_TIME__}`;
    const readouts = document.createElement('div');
    readouts.append(buildEl, this.fpsEl, this.clockEl, this.poolsEl);
    this.root.appendChild(readouts);

    this.root.appendChild(this.buildButtons());
    this.root.appendChild(this.buildDressingEditorControls());

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
    // Stronger economy buttons (T3.3a-r2z), same wiring as the small ones.
    addButton('+1000 coins', () => {
      gameState.addCoins(1000);
      gameState.save();
      this.refresh();
    });
    addButton('+500 moondust', () => {
      gameState.addMoondust(500);
      gameState.save();
      this.refresh();
    });
    addButton('+1000 xp', () => {
      gameState.addXp(1000);
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
    addButton('Max level', () => {
      window.dev?.setLevel(MAX_LEVEL);
      this.refresh();
    });
    addButton('Premium board', () => {
      window.dev?.fillBoardPremium();
      this.refresh();
    });

    // Title itself carries the caveat (T2.24): objects made interactive
    // AFTER this is turned on (e.g. a panel opened later) need it re-toggled
    // to pick them up too - see `registerHitboxToggle`'s doc comment.
    let hitboxesOn = false;
    addButton('Hitboxes (re-toggle to refresh)', () => {
      hitboxesOn = !hitboxesOn;
      window.dev?.toggleHitboxes?.(hitboxesOn);
    });

    // T2.28/T2.28a: cycles the ground rendering mode live (tiles -> tiles_flat
    // -> texture_a -> texture_b -> tiles) so the owner can compare in-game.
    // Label carries the current mode; the button owns its own text since the
    // ground mode isn't part of the JSON state dump below.
    const groundButton = document.createElement('button');
    groundButton.textContent = 'Ground: tiles';
    groundButton.style.cssText = 'font-family: monospace; font-size: 12px; padding: 4px 8px;';
    groundButton.addEventListener('click', () => {
      const mode = window.dev?.cycleGroundMode?.();
      if (mode !== undefined) groundButton.textContent = `Ground: ${mode}`;
    });
    bar.appendChild(groundButton);

    return bar;
  }

  /**
   * Dressing editor (T2.28a): an "Edit dressing" toggle, a palette row (one
   * "+" button per DRESSING_PALETTE_FRAMES entry that spawns a decal at
   * screen center) and an action row (Scale +/-, Move to front, Delete,
   * Copy layout) - the
   * palette/action rows only show while editing is on, since they act on a
   * FarmScene-owned selection that doesn't exist while it's off. All state
   * lives in FarmScene; this is a thin DOM front end over the dev hooks
   * registered by `registerDressingEditorHooks`.
   */
  private buildDressingEditorControls(): HTMLDivElement {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; gap: 6px; margin-top: 6px;';

    const mkButton = (label: string, onClick: () => void): HTMLButtonElement => {
      const button = document.createElement('button');
      button.textContent = label;
      button.style.cssText = 'font-family: monospace; font-size: 12px; padding: 4px 8px;';
      button.addEventListener('click', onClick);
      return button;
    };

    const paletteRow = document.createElement('div');
    paletteRow.style.cssText = 'display: none; gap: 6px; flex-wrap: wrap;';
    for (const frame of DRESSING_PALETTE_FRAMES) {
      paletteRow.appendChild(mkButton(`+ ${frame}`, () => window.dev?.spawnDressing?.(frame)));
    }

    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display: none; gap: 6px; flex-wrap: wrap;';
    actionRow.appendChild(
      mkButton('Scale +', () => window.dev?.scaleDressingSelected?.(DRESSING_SCALE_STEP)),
    );
    actionRow.appendChild(
      mkButton('Scale -', () => window.dev?.scaleDressingSelected?.(-DRESSING_SCALE_STEP)),
    );
    actionRow.appendChild(
      mkButton('Move to front', () => window.dev?.toggleDressingSelectedFront?.()),
    );
    actionRow.appendChild(mkButton('Delete', () => window.dev?.deleteDressingSelected?.()));
    actionRow.appendChild(
      mkButton('Copy layout', () => {
        const json = window.dev?.copyDressingLayoutJson?.();
        if (json !== undefined) void navigator.clipboard.writeText(json);
      }),
    );

    let editOn = false;
    const toggleButton = mkButton('Edit dressing: off', () => {
      editOn = !editOn;
      toggleButton.textContent = `Edit dressing: ${editOn ? 'on' : 'off'}`;
      paletteRow.style.display = editOn ? 'flex' : 'none';
      actionRow.style.display = editOn ? 'flex' : 'none';
      window.dev?.toggleDressingEdit?.(editOn);
    });

    container.append(toggleButton, paletteRow, actionRow);
    return container;
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
