import type { CropId } from './crops';

/**
 * Quest config (T3.10): long-horizon lifetime goals plus a rotating weekly
 * pool. All game data lives here, never in scene/system logic. The board UI
 * (scroll icon + panel) is `src/ui/QuestBoard.ts` (T3.10).
 */

/** A quest's reward, composable: any subset of trophy/chests/moondust. */
export interface QuestReward {
  /** A TROPHY_FRAMES frame, granted into the warehouse. */
  trophy?: string;
  /** Chest count, granted via the existing chest-grant path. */
  chests?: number;
  moondust?: number;
}

/** Which lifetime counter (`GameStateData.quests.lifetime`) a long quest tracks. */
export type LongQuestCounter =
  | { kind: 'cropHarvests'; cropId: CropId }
  | { kind: 'totalHarvests' }
  | { kind: 'ordersFulfilled' }
  | { kind: 'premiumFulfilled' }
  | { kind: 'chestsOpened' };

export interface LongQuestDef {
  id: string;
  name: string;
  description: string;
  counter: LongQuestCounter;
  target: number;
  reward: QuestReward;
  /**
   * Short noun phrase for the counted thing (T3.10b - a user report that a
   * bare "n/N" didn't say what was being counted), e.g. "Sunwheat
   * harvested". The board renders every row's progress as `${progressLabel}:
   * n/N`.
   */
  progressLabel: string;
}

/** One-time, lifetime-counter quests. Never rotate; claimed at most once each. */
export const LONG_QUESTS: readonly LongQuestDef[] = [
  {
    id: 'golden_fields',
    name: 'Golden Fields',
    description: 'Harvest 500 Sunwheat over the life of your farm.',
    counter: { kind: 'cropHarvests', cropId: 'sunwheat' },
    target: 500,
    reward: { trophy: 'trophy_goldscarecrow' },
    progressLabel: 'Sunwheat harvested',
  },
  {
    id: 'star_farmer',
    name: 'Star Farmer',
    description: 'Harvest 300 Starcorn over the life of your farm.',
    counter: { kind: 'cropHarvests', cropId: 'starcorn' },
    target: 300,
    reward: { trophy: 'trophy_starbanner' },
    progressLabel: 'Starcorn harvested',
  },
  {
    id: 'keeper_glow',
    name: 'Keeper of the Glow',
    description: 'Harvest 200 Glowberries over the life of your farm.',
    counter: { kind: 'cropHarvests', cropId: 'glowberry' },
    target: 200,
    reward: { trophy: 'trophy_moonwell' },
    progressLabel: 'Glowberries harvested',
  },
  {
    id: 'village_favorite',
    name: 'Village Favorite',
    description: 'Fulfill 50 villager orders.',
    counter: { kind: 'ordersFulfilled' },
    target: 50,
    reward: { chests: 2 },
    progressLabel: 'Orders fulfilled',
  },
  {
    id: 'premium_partner',
    name: 'Premium Partner',
    description: 'Fulfill 25 premium orders.',
    counter: { kind: 'premiumFulfilled' },
    target: 25,
    reward: { trophy: 'trophy_traderscart' },
    progressLabel: 'Premium orders fulfilled',
  },
  {
    id: 'treasure_hunter',
    name: 'Treasure Hunter',
    description: 'Open 10 chests.',
    counter: { kind: 'chestsOpened' },
    target: 10,
    reward: { chests: 3 },
    progressLabel: 'Chests opened',
  },
  {
    id: 'deep_roots',
    name: 'Deep Roots',
    description: 'Harvest 2000 crops of any kind over the life of your farm.',
    counter: { kind: 'totalHarvests' },
    target: 2000,
    reward: { trophy: 'trophy_ancientoak' },
    progressLabel: 'Crops harvested',
  },
];

/** Which weekly counter (`GameStateData.quests.weekly`) a weekly quest tracks. */
export type WeeklyQuestCounter =
  | { kind: 'growMinutes' }
  | { kind: 'featuredHarvests' }
  | { kind: 'orders' }
  | { kind: 'radiants' };

export interface WeeklyQuestDef {
  id: string;
  name: string;
  description: string;
  counter: WeeklyQuestCounter;
  /**
   * Absent for weekly_specialist (whose target comes from `perCropTarget`)
   * and weekly_growth (whose target is level-scaled - see
   * `GROWTH_TARGETS_BY_LEVEL` - and snapshot into the weekly state when the
   * week is drawn).
   */
  target?: number;
  /**
   * weekly_specialist only: target keyed by the week's featured crop. When
   * present it must be exhaustive over every CropId (T3.19 - a partial map's
   * "?? 0" fallback made missing crops' weeks complete instantly at 0/0), so
   * the compiler forces an entry for every future crop.
   */
  perCropTarget?: Record<CropId, number>;
  reward: QuestReward;
  /**
   * Short noun phrase for the counted thing (T3.10b, mirrors `LongQuestDef`).
   * weekly_specialist's is unused by the board - it keeps its own dynamic
   * "<featured crop>: n/N" copy instead (already names what it counts) -
   * kept here anyway so every def carries the field consistently.
   */
  progressLabel: string;
}

/**
 * Pool of 4 weekly quests; exactly 2 are active per week (see
 * `GameStateStore.ensureWeeklyQuests`). Counters reset and redraw every
 * rotation.
 */
export const WEEKLY_QUESTS: readonly WeeklyQuestDef[] = [
  {
    id: 'weekly_growth',
    name: 'Growing Strong',
    description:
      'Harvest minutes of growing time this week. The target grows with your farm level.',
    counter: { kind: 'growMinutes' },
    reward: { chests: 1 },
    progressLabel: 'Minutes of growth harvested',
  },
  {
    id: 'weekly_specialist',
    name: 'Specialist',
    description: "Harvest this week's featured crop the most.",
    counter: { kind: 'featuredHarvests' },
    perCropTarget: {
      sunwheat: 60,
      starcorn: 25,
      glowberry: 15,
      moonroot: 12,
      emberpepper: 8,
      dewmelon: 5,
      sagesprig: 3,
    },
    reward: { chests: 1, moondust: 2 },
    progressLabel: 'Featured crop harvested',
  },
  {
    id: 'weekly_trader',
    name: 'Weekly Trader',
    description: 'Fulfill 12 orders this week.',
    counter: { kind: 'orders' },
    target: 12,
    reward: { moondust: 3 },
    progressLabel: 'Orders fulfilled this week',
  },
  {
    id: 'weekly_radiance',
    name: 'Weekly Radiance',
    description: 'Harvest 2 Radiant crops this week.',
    counter: { kind: 'radiants' },
    target: 2,
    reward: { chests: 1 },
    progressLabel: 'Radiant harvests this week',
  },
];

/** Weekly rotation period. */
export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * weekly_growth's target (minutes of growing time) by player level 1..8
 * (T3.19, owner-approved). Index `level - 1`; `growthTargetForLevel` clamps
 * out-of-range levels. The value is snapshot into the weekly state when the
 * week is drawn, never re-read mid-week - leveling up must not raise the
 * target under a player's feet.
 */
export const GROWTH_TARGETS_BY_LEVEL: readonly number[] = [
  240, 240, 400, 600, 900, 1300, 1900, 2800,
];

/** The weekly_growth target for a player level, clamped to the table's 1..8 range. */
export function growthTargetForLevel(level: number): number {
  const index = Math.min(GROWTH_TARGETS_BY_LEVEL.length - 1, Math.max(0, Math.floor(level) - 1));
  return GROWTH_TARGETS_BY_LEVEL[index]!;
}

/**
 * Copy for the quest board's first-open explainer (T3.14), shown once per
 * save (see `GameStateData.quests.introSeen`) and dismissed only via its
 * "Got it" button.
 */
export const QUEST_BOARD_INTRO = {
  title: 'The Quest Board',
  body:
    'Quests are long-term goals that earn rare trophies, chests, and moondust. ' +
    'Long quests track your farm for its whole life. Weekly quests reset every ' +
    'week, so finish them before the week rolls over. When a quest is complete, ' +
    'come back and tap Claim.',
  buttonLabel: 'Got it',
} as const;
