/** All gameplay numbers live here, never in scene/system logic. */
export type CropId = 'sunwheat' | 'starcorn' | 'glowberry' | 'moonroot' | 'emberpepper';

/** Growth stages per crop: 0 = sprout, 1 = mid, 2 = ready to harvest. */
export const CROP_STAGES = 3;

/**
 * Crop sprite frames are square, anchored by a fixed baseline: a sprite sits
 * on a tile by placing it at the tile's iso center with origin
 * (0.5, CROP_BASELINE_Y / CROP_FRAME_SIZE). The packed art's lowest opaque
 * row is at CROP_BASELINE_Y + CROP_SINK - sunk a little below the anchored
 * baseline so the mound's visual middle sits on the diamond center, hugging
 * the tile. CROP_SINK is enforced by tools/pack-atlas.mjs (keep them in
 * sync). See ASSETS.md.
 */
export const CROP_FRAME_SIZE = 128;
export const CROP_BASELINE_Y = 104;
export const CROP_SINK = 14;

export interface CropDef {
  id: CropId;
  /** Display name (user-facing). */
  name: string;
  /** Plural display name for counted UI copy ("4 Starcorn", "8 Sunwheat"). */
  pluralName: string;
  /** Atlas frame per growth stage, index 0 (sprout) to 2 (ready). */
  stageFrames: readonly [string, string, string];
  /** Coins spent to plant one (planting spends coins directly in MVP). */
  seedCost: number;
  /** Coins received per crop when sold. */
  sellValue: number;
  /** Real time from planting to harvest-ready, in ms of game-clock time. */
  growMs: number;
  /** XP granted per harvest. */
  xp: number;
  /** Minimum player level required to plant. */
  unlockLevel: number;
}

/** Balance numbers are provisional and will be tuned later. */
export const CROPS: Record<CropId, CropDef> = {
  sunwheat: {
    id: 'sunwheat',
    name: 'Sunwheat',
    pluralName: 'Sunwheat',
    stageFrames: ['sunwheat_0', 'sunwheat_1', 'sunwheat_2'],
    seedCost: 5,
    sellValue: 8,
    growMs: 30_000,
    xp: 2,
    unlockLevel: 1,
  },
  starcorn: {
    id: 'starcorn',
    name: 'Starcorn',
    // Mass-noun plural: "4 Starcorn", never "Starcorns".
    pluralName: 'Starcorn',
    stageFrames: ['starcorn_0', 'starcorn_1', 'starcorn_2'],
    seedCost: 12,
    sellValue: 20,
    growMs: 120_000,
    xp: 9,
    unlockLevel: 2,
  },
  glowberry: {
    id: 'glowberry',
    name: 'Glowberry',
    pluralName: 'Glowberries',
    stageFrames: ['glowberry_0', 'glowberry_1', 'glowberry_2'],
    seedCost: 30,
    sellValue: 55,
    growMs: 300_000,
    xp: 15,
    unlockLevel: 3,
  },
  moonroot: {
    id: 'moonroot',
    name: 'Moonroot',
    pluralName: 'Moonroots',
    stageFrames: ['moonroot_0', 'moonroot_1', 'moonroot_2'],
    seedCost: 60,
    sellValue: 100,
    growMs: 480_000,
    xp: 28,
    unlockLevel: 4,
  },
  emberpepper: {
    id: 'emberpepper',
    name: 'Emberpepper',
    pluralName: 'Emberpeppers',
    stageFrames: ['emberpepper_0', 'emberpepper_1', 'emberpepper_2'],
    seedCost: 110,
    sellValue: 210,
    growMs: 1_200_000,
    xp: 70,
    unlockLevel: 5,
  },
};
