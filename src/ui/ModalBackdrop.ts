import Phaser from 'phaser';

import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../config';

/**
 * Invisible full-screen tap-catcher behind a modal panel: any tap outside
 * the panel closes it (the panel body and its buttons sit at a higher depth,
 * so they keep receiving their own pointer-downs first). The tap is also
 * swallowed - it never falls through to the field, seed bar, or HUD buttons
 * beneath, which hardens the modal input-blocking beyond the isModalOpen()
 * guard.
 *
 * A Zone renders nothing (zero overdraw) but still hit-tests; it is only
 * visible + interactive while its panel is open, so a closed panel's
 * backdrop can never eat a tap.
 */

/** Above the HUD/seed bar (2000) and chip (2050), below the panels (2100). */
const BACKDROP_DEPTH = 2090;

export class ModalBackdrop {
  private readonly zone: Phaser.GameObjects.Zone;

  constructor(scene: Phaser.Scene, onTap: () => void) {
    this.zone = scene.add
      .zone(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT)
      .setOrigin(0, 0)
      .setDepth(BACKDROP_DEPTH)
      .setVisible(false);
    this.zone.on(
      Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN,
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        // Swallow first: closing the panel clears isModalOpen(), so without
        // this the same tap would fall through and hit the field.
        event.stopPropagation();
        onTap();
      },
    );
  }

  /** Follow the owning panel's open state; interactive only while open. */
  setActive(active: boolean): void {
    this.zone.setVisible(active);
    if (active) {
      this.zone.setInteractive();
    } else {
      this.zone.disableInteractive();
    }
  }

  /**
   * Override the default tier (T3.16): lets an owning panel sit above
   * something normally higher than every other panel - e.g. arrange mode's
   * control row - by bumping its backdrop above that tier too, so a tap
   * anywhere outside the panel body still closes it. Pass undefined to
   * restore BACKDROP_DEPTH.
   */
  setDepth(depth?: number): void {
    this.zone.setDepth(depth ?? BACKDROP_DEPTH);
  }
}
