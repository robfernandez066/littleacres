import type { GameStateData } from '../systems/gameState';
import { REGIONS } from './farm';
import { RESTORE_FARMHOUSE_COST, RESTORE_PANEL_PERK, RESTORE_PANEL_TITLE } from './restoration';

/**
 * Goals registry (T3.30) - the long-horizon, save-toward objectives the Goals
 * hub lists in one place.
 *
 * This adds NO purchase mechanics of its own: every entry is a TRACKER over a
 * flow that already exists (farmhouse restoration via `gameState.restoreFarmhouse`
 * / RestorePanel; a region via the on-field RegionSign and
 * `gameState.purchaseRegion`). Every price, perk and gate here is READ from the
 * owning data module (`restoration.ts`, `farm.ts` REGIONS) rather than restated,
 * so a tuning pass on either automatically moves this list too.
 *
 * The list is ordered so future entries slot in: restoration first, then one
 * entry per region in REGIONS order. A second region (R2/R3) becomes a Goals
 * entry purely by landing in REGIONS, with no change here.
 */

/** Which existing flow an entry tracks - decides what tapping it does. */
export type GoalKind = 'restoration' | 'region';

/**
 * An entry's derived state:
 * - `owned` - already achieved; the row is inert and reads as complete.
 * - `locked` - a level gate is still closed; the row is inert and says so.
 * - `open` - actionable now (which does NOT mean affordable - the owning flow
 *   is still the one that checks the price).
 */
export type GoalStatus = 'owned' | 'locked' | 'open';

interface GoalCommon {
  id: string;
  title: string;
  /** What the goal grants, one line. */
  reward: string;
  costCoins: number;
  costMoondust: number;
  /** Player level required to act on it; 0 when there is no level gate. */
  levelGate: number;
  /** Whether the row shows a saving-toward-the-price progress line. */
  showProgress: boolean;
}

/** Tracks the farmhouse restoration (`state.restoration.farmhouse`). */
export interface RestorationGoalDef extends GoalCommon {
  kind: 'restoration';
}

/** Tracks one region's unlock (`state.regionsUnlocked`). */
export interface RegionGoalDef extends GoalCommon {
  kind: 'region';
  /** The REGIONS id - the scene glides the camera to this region's sign. */
  regionId: string;
}

export type GoalDef = RestorationGoalDef | RegionGoalDef;

/** The state a goal's status/progress derives from - nothing else is read. */
export type GoalState = Pick<
  GameStateData,
  'level' | 'coins' | 'moondust' | 'restoration' | 'regionsUnlocked'
>;

/** Panel title and subtitle. Subtitle copy is fixed by design (T3.30). */
export const GOALS_PANEL_TITLE = 'Goals';
export const GOALS_PANEL_SUBTITLE = "Everything you're growing toward.";

/** The atlas frame for the goals star (packed in T3.30 - see ICON_NAMES). */
export const GOALS_ICON_FRAME = 'goals';

/**
 * The call-to-action label on an ACTIONABLE card's button (T3.30-r1). Per
 * kind, because the two flows send the player somewhere different: a region's
 * purchase lives on its on-field sign, so the button carries them there, while
 * the restoration's lives in a panel that opens right on top.
 */
export function goalActionLabel(def: GoalDef): string {
  return def.kind === 'region' ? 'Go There' : 'Restore';
}

/**
 * The farmhouse restoration entry. Title and perk are the SAME constants the
 * RestorePanel renders, so the two can never drift apart; tapping the row opens
 * that panel, which owns the purchase.
 */
const RESTORATION_GOAL: RestorationGoalDef = {
  kind: 'restoration',
  id: 'restore_homestead',
  title: RESTORE_PANEL_TITLE,
  reward: RESTORE_PANEL_PERK,
  costCoins: RESTORE_FARMHOUSE_COST.coins,
  costMoondust: RESTORE_FARMHOUSE_COST.moondust,
  levelGate: 0,
  showProgress: true,
};

/**
 * One entry per purchasable region, in REGIONS order. The actual purchase
 * stays on the on-field RegionSign - this row only tracks it and (when
 * actionable) sends the camera there, so there is exactly one place to buy.
 */
const REGION_GOALS: readonly RegionGoalDef[] = REGIONS.map((region) => ({
  kind: 'region' as const,
  id: `unlock_${region.id}`,
  regionId: region.id,
  title: `Unlock ${region.name}`,
  // Two rewards, not one: the band itself opens up as placeable ground
  // (`placeableRect`), AND the plots land in the shed. The plot count alone
  // does not convey the new space, so the copy leads with it.
  reward: `Expanded Territory and ${region.plotGrant} Additional Farming Plots`,
  costCoins: region.costCoins,
  costMoondust: 0,
  levelGate: region.levelGate,
  showProgress: false,
}));

/** Every goal, in display order: restoration first, then the regions. */
export const GOALS: readonly GoalDef[] = [RESTORATION_GOAL, ...REGION_GOALS];

/** A goal's status for the given state - the single authority the panel renders from. */
export function goalStatus(def: GoalDef, state: GoalState): GoalStatus {
  if (def.kind === 'restoration') {
    return state.restoration.farmhouse === 1 ? 'owned' : 'open';
  }
  if (state.regionsUnlocked.includes(def.regionId)) return 'owned';
  return state.level < def.levelGate ? 'locked' : 'open';
}

/**
 * The locked row's REQUIREMENT, title-cased: "Requires Farm Level 7". The
 * panel puts its own soft-red "Locked:" tag in front of this, so the string
 * deliberately does not carry that word itself.
 */
export function goalLockedNote(def: GoalDef): string {
  return `Requires Farm Level ${def.levelGate}`;
}

/**
 * The saving-toward-the-price progress for entries that track it, or '' for
 * those that do not. Each numerator is clamped at its price so a player past
 * the cost reads a full bar rather than an over-100% number.
 *
 * ONE LINE PER CURRENCY (T3.30-r2), newline-separated - no "Saved" prefix and
 * no "and" joining them. Two short "have / need" rows read at a glance; the
 * one-line sentence they replaced did not.
 */
export function goalProgressLine(def: GoalDef, state: GoalState): string {
  if (!def.showProgress) return '';
  const coins = `${Math.min(state.coins, def.costCoins).toLocaleString('en-US')} / ${def.costCoins.toLocaleString('en-US')} coins`;
  if (def.costMoondust <= 0) return coins;
  const dust = `${Math.min(state.moondust, def.costMoondust)} / ${def.costMoondust} moondust`;
  return `${coins}\n${dust}`;
}

/**
 * One level-up celebration card, shaped like `SYSTEM_UNLOCK_CARDS`'s entries
 * (data/levels.ts) so LevelUpCelebration can concatenate the two without
 * caring which produced which.
 */
export interface GoalUnlockCard {
  iconFrame: string;
  label: string;
}

/**
 * The celebration cards announcing that a region just became unlockable
 * (T3.30-r1): one per region whose `levelGate` is exactly `level`, so it fires
 * on the level-up that opens the gate and on no other level.
 *
 * Derived from REGIONS, so a future region announces itself with no new code -
 * the same reason the Goals list itself is REGIONS-derived. Kept here (a
 * Phaser-free data module) rather than inside LevelUpCelebration so it stays
 * directly unit-testable, following the seedBarLayout.ts precedent.
 */
export function regionUnlockCardsForLevel(level: number): GoalUnlockCard[] {
  return REGIONS.filter((region) => region.levelGate === level).map((region) => ({
    iconFrame: GOALS_ICON_FRAME,
    label: `${region.name} is ready to unlock!`,
  }));
}

/** One entry's fully derived row content. */
export interface GoalView {
  def: GoalDef;
  status: GoalStatus;
  /** '' when the entry does not track progress or is already owned. */
  progress: string;
}

/**
 * Every goal's derived view in DISPLAY order: everything still to do first (in
 * registry order), then everything already achieved (also in registry order).
 * Finished goals sinking to the bottom keeps the live objectives at the top of
 * the panel where they are read, and turns the completed ones into a quiet
 * trophy shelf underneath rather than clutter in the middle of the list.
 *
 * The partition is STABLE, so within each half the registry order is preserved
 * and a row never jumps around for any reason other than being completed.
 */
export function goalViews(state: GoalState): GoalView[] {
  const views = GOALS.map((def) => {
    const status = goalStatus(def, state);
    return {
      def,
      status,
      progress: status === 'owned' ? '' : goalProgressLine(def, state),
    };
  });
  return [
    ...views.filter((view) => view.status !== 'owned'),
    ...views.filter((view) => view.status === 'owned'),
  ];
}
