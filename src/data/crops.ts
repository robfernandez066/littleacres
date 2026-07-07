/** The three MVP crops. Gameplay data (grow times, prices) arrives in a later task. */
export type CropId = 'sunwheat' | 'carrot' | 'glowberry';

/** Growth stages per crop: 0 = sprout, 1 = mid, 2 = ready to harvest. */
export const CROP_STAGES = 3;

/**
 * Crop sprite frames are square with the plant's base drawn on a fixed
 * baseline, so a sprite sits on a tile by placing it at the tile's iso center
 * with origin (0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE). See ASSETS.md.
 */
export const CROP_FRAME_SIZE = 128;
export const CROP_BASELINE_Y = 104;

export interface CropDef {
  id: CropId;
  /** Display name (user-facing). */
  name: string;
  /** Atlas frame per growth stage, index 0 (sprout) to 2 (ready). */
  stageFrames: readonly [string, string, string];
}

export const CROPS: Record<CropId, CropDef> = {
  sunwheat: {
    id: 'sunwheat',
    name: 'Sunwheat',
    stageFrames: ['sunwheat_0', 'sunwheat_1', 'sunwheat_2'],
  },
  carrot: {
    id: 'carrot',
    name: 'Carrot',
    stageFrames: ['carrot_0', 'carrot_1', 'carrot_2'],
  },
  glowberry: {
    id: 'glowberry',
    name: 'Glowberry',
    stageFrames: ['glowberry_0', 'glowberry_1', 'glowberry_2'],
  },
};
