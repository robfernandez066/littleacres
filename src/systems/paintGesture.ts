/**
 * Paint-mode gesture classifier (U3c-r1): the phase machine that keeps a path
 * paint stroke from laying a tile until the gesture has PROVEN itself a single
 * finger - the same defer-then-confirm discipline the plot-feedback path uses
 * for harvest/plant (FarmScene 'farm-pending'), lifted off-scene so its four
 * paths are unit-testable. The scene owns the tiles and coins; this owns only
 * "which phase are we in, and what should happen next".
 *
 * A touch lays NOTHING at first. It confirms and begins painting only when the
 * single finger either moves past the tap slop (drag-paint) or releases within
 * it (tap-paint). A SECOND finger before confirmation cancels the whole gesture
 * (zero tiles); a second finger mid-confirmed-stroke halts further painting
 * while the tiles already laid stay. Erase shares the same machine.
 */
export type PaintPhase = 'idle' | 'pending' | 'painting' | 'halted';

export class PaintGesture {
  private phaseValue: PaintPhase = 'idle';
  private downX = 0;
  private downY = 0;

  /** `slop` is the classifier's existing tap slop (design px). */
  constructor(private readonly slop: number) {}

  get phase(): PaintPhase {
    return this.phaseValue;
  }

  /** Whether a gesture is in flight (armed, painting, or halted mid-stroke). */
  get active(): boolean {
    return this.phaseValue !== 'idle';
  }

  /** First finger down in the paint band: arm the gesture, lay nothing yet. */
  begin(x: number, y: number): void {
    this.phaseValue = 'pending';
    this.downX = x;
    this.downY = y;
  }

  /**
   * The painting finger moved. Returns:
   * - 'confirm' the first time an armed gesture crosses the slop (a drag) - the
   *   caller lays the stroke's first tile(s) then;
   * - 'paint' on every later move of a confirmed stroke;
   * - 'none' while still within slop, or once the stroke is cancelled/halted.
   */
  move(x: number, y: number): 'confirm' | 'paint' | 'none' {
    if (this.phaseValue === 'pending') {
      if (Math.hypot(x - this.downX, y - this.downY) > this.slop) {
        this.phaseValue = 'painting';
        return 'confirm';
      }
      return 'none';
    }
    return this.phaseValue === 'painting' ? 'paint' : 'none';
  }

  /**
   * The painting finger released. Returns 'tap' for an armed, still-in-slop
   * release (the caller lays one tile at the down point), else 'none'. Always
   * ends the gesture.
   */
  end(x: number, y: number): 'tap' | 'none' {
    const tap =
      this.phaseValue === 'pending' && Math.hypot(x - this.downX, y - this.downY) <= this.slop;
    this.phaseValue = 'idle';
    return tap ? 'tap' : 'none';
  }

  /**
   * A second finger arrived. Before confirmation it CANCELS the gesture (zero
   * tiles laid, zero coins charged); mid-confirmed-stroke it HALTS further
   * painting (tiles already laid stay). A no-op once idle or already halted.
   */
  secondFinger(): 'cancel' | 'halt' | 'none' {
    if (this.phaseValue === 'pending') {
      this.phaseValue = 'idle';
      return 'cancel';
    }
    if (this.phaseValue === 'painting') {
      this.phaseValue = 'halted';
      return 'halt';
    }
    return 'none';
  }

  /** Force the gesture back to idle (the stroke ended by any other path). */
  reset(): void {
    this.phaseValue = 'idle';
  }
}
