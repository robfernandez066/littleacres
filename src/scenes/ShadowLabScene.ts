import Phaser from 'phaser';

import atlasPngUrl from '../../assets/atlas.png';
import atlasJsonUrl from '../../assets/atlas.json?url';
import grassTextureAUrl from '../../assets/grass_texture_a.png';
import { ATLAS_KEY, SHADOW_PLACEMENT_OVERRIDES } from '../config';
import { SHADOW_LAB_ENTRIES } from '../generated/shadowLab';
import { placeAuthoredShadow } from '../systems/authoredShadowPlacement';

/**
 * ShadowLabScene (T3.29) - DEV-ONLY authored-shadow preview route. Reached at
 * `?shadowlab=<building>` (only when import.meta.env.DEV, see main.ts). It uses
 * the ACTUAL atlas, the ACTUAL placeAuthoredShadow() code, real grass, and the
 * real preview scale, so what the shadow workflow captures here matches the game.
 *
 * Query params:
 *   ?shadowlab=<building>   which authored shadow (default: the first one)
 *   &variant=<frame>        render an alternate/variant frame (e.g. farmhouse_restored)
 *   &overlay=1              draw the anchor overlay (ground point + transformed anchor)
 *   &bg=checker             checkerboard instead of grass (shadow readability)
 *   &zoom=<n>               camera zoom (default 1)
 *
 * Publishes the numeric result on `window.__shadowLab` for the capture tool.
 */
export class ShadowLabScene extends Phaser.Scene {
  constructor() {
    super('ShadowLab');
  }

  preload(): void {
    this.load.image('shadowlab_grass', grassTextureAUrl);
    this.load.atlas(ATLAS_KEY, atlasPngUrl, atlasJsonUrl);
  }

  create(): void {
    const params = new URLSearchParams(location.search);
    const requested = params.get('shadowlab') || Object.keys(SHADOW_LAB_ENTRIES)[0] || '';
    const entry = SHADOW_LAB_ENTRIES[requested];
    if (entry === undefined) {
      this.add.text(40, 40, `ShadowLab: unknown building "${requested}".\nKnown: ${Object.keys(SHADOW_LAB_ENTRIES).join(', ') || '(none)'}`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffffff',
      });
      return;
    }
    const wantVariant = params.get('variant');
    const useVariant = wantVariant && entry.variants.includes(wantVariant) ? wantVariant : null;
    const showOverlay = params.get('overlay') === '1';
    const checker = params.get('bg') === 'checker';
    const zoom = Number(params.get('zoom') ?? '1') || 1;

    const W = this.scale.width;
    const H = this.scale.height;
    const cx = Math.round(W / 2);
    const cy = Math.round(H * 0.58); // ground point sits a bit below centre

    // Background: real grass (default) or a checkerboard for shadow readability.
    if (checker) {
      const g = this.add.graphics().setDepth(-100);
      const s = 24;
      for (let y = 0; y < H; y += s) {
        for (let x = 0; x < W; x += s) {
          g.fillStyle(((x / s + y / s) & 1) === 0 ? 0xc8c8c8 : 0xa0a0a0, 1).fillRect(x, y, s, s);
        }
      }
    } else {
      this.add
        .tileSprite(0, 0, W, H, 'shadowlab_grass')
        .setOrigin(0, 0)
        .setTileScale(0.5, 0.5)
        .setDepth(-100);
    }

    const buildingFrame = useVariant ?? entry.sourceFrame;
    const building = this.add.image(cx, cy, ATLAS_KEY, buildingFrame);
    // Base-anchored origin: the ground point within the source frame, adjusted
    // for a taller variant that is bottom-flush (same rule as the game).
    const variantH = building.frame.realHeight;
    const overhang = variantH - entry.sourceFrameHeight;
    building
      .setScale(entry.previewScale)
      .setOrigin(entry.groundPointX / entry.sourceFrameWidth, (entry.groundPointY + overhang) / variantH)
      .setDepth(100);

    // The shadow, placed by the SAME code the game uses.
    const placement = SHADOW_PLACEMENT_OVERRIDES[entry.frame];
    if (placement === undefined) {
      this.add.text(40, 40, `ShadowLab: no runtime placement for ${entry.frame}`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ff5555',
      });
      return;
    }
    const shadow = this.add.image(0, 0, ATLAS_KEY, entry.frame);
    placeAuthoredShadow(shadow, placement, {
      x: cx,
      baseY: cy,
      scaleX: entry.previewScale,
      scaleY: entry.previewScale,
      flipX: false,
      depth: 99,
    });

    // Numeric anchor check, exposed for the capture tool.
    const matrix = shadow.getWorldTransformMatrix();
    const anchorWorld = matrix.transformPoint(
      placement.anchorX - shadow.displayOriginX,
      placement.anchorY - shadow.displayOriginY,
    );
    const diagnostic = {
      building: entry.building,
      frame: entry.frame,
      variant: useVariant,
      groundPoint: { x: cx, y: cy },
      transformedAnchor: { x: anchorWorld.x, y: anchorWorld.y },
      anchorDelta: { x: anchorWorld.x - cx, y: anchorWorld.y - cy },
      shadow: {
        realWidth: shadow.frame.realWidth,
        realHeight: shadow.frame.realHeight,
        cutWidth: shadow.frame.cutWidth,
        cutHeight: shadow.frame.cutHeight,
        scale: entry.previewScale,
      },
    };
    (window as unknown as { __shadowLab?: unknown }).__shadowLab = diagnostic;
    console.log('[shadowlab]', diagnostic);

    const cam = this.cameras.main;
    cam.setZoom(zoom);
    cam.centerOn(cx, cy - 140);

    if (showOverlay) {
      const gfx = this.add.graphics().setDepth(1_000_000);
      const cross = (color: number, x: number, y: number, len: number, wid: number): void => {
        gfx.lineStyle(wid, color, 1).beginPath();
        gfx.moveTo(x - len, y);
        gfx.lineTo(x + len, y);
        gfx.moveTo(x, y - len);
        gfx.lineTo(x, y + len);
        gfx.strokePath();
      };
      // logical-canvas + packed-alpha outlines via the shadow's transform.
      const tp = (lx: number, ly: number): Phaser.Math.Vector2 =>
        matrix.transformPoint(lx - shadow.displayOriginX, ly - shadow.displayOriginY) as Phaser.Math.Vector2;
      const outline = (color: number, x0: number, y0: number, w: number, h: number): void => {
        const a = tp(x0, y0);
        const b = tp(x0 + w, y0);
        const c = tp(x0 + w, y0 + h);
        const d = tp(x0, y0 + h);
        gfx.lineStyle(2, color, 1).beginPath();
        gfx.moveTo(a.x, a.y);
        gfx.lineTo(b.x, b.y);
        gfx.lineTo(c.x, c.y);
        gfx.lineTo(d.x, d.y);
        gfx.closePath();
        gfx.strokePath();
      };
      outline(0xffffff, 0, 0, shadow.frame.realWidth, shadow.frame.realHeight);
      cross(0xff0000, cx, cy, 40, 8); // red: real ground point
      cross(0xff00ff, anchorWorld.x, anchorWorld.y, 26, 5); // magenta: transformed anchor
      this.add
        .text(cx - 220, cy + 60, `anchorDelta=(${diagnostic.anchorDelta.x.toFixed(3)}, ${diagnostic.anchorDelta.y.toFixed(3)})  ${entry.frame}${useVariant ? ' / ' + useVariant : ''}`, {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#ffffff',
          backgroundColor: '#000000cc',
        })
        .setDepth(1_000_001);
    }
  }
}
