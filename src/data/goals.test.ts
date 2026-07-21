import { describe, expect, it } from 'vitest';

import { createDefaultState } from '../systems/gameState';
import { REGIONS } from './farm';
import { RESTORE_FARMHOUSE_COST, RESTORE_PANEL_PERK, RESTORE_PANEL_TITLE } from './restoration';
import {
  GOALS,
  GOALS_ICON_FRAME,
  GOALS_PANEL_SUBTITLE,
  goalActionLabel,
  goalLockedNote,
  goalProgressLine,
  goalStatus,
  goalViews,
  regionUnlockCardsForLevel,
  type GoalState,
} from './goals';

/** The current schema version - only `createDefaultState`'s shape matters here. */
const VERSION = 21;

/** A GoalState with the fields a test cares about overridden. */
function stateWith(overrides: Partial<GoalState>): GoalState {
  return { ...createDefaultState(VERSION), ...overrides };
}

const EAST_MEADOW = REGIONS[0]!;

describe('goals registry (T3.30)', () => {
  it('lists exactly the two entries in order: restoration, then East Meadow', () => {
    expect(GOALS.map((def) => def.title)).toEqual([
      'Restore the Homestead',
      `Unlock ${EAST_MEADOW.name}`,
    ]);
  });

  it('reads the restoration entry from data/restoration.ts rather than duplicating it', () => {
    const restore = GOALS[0]!;
    expect(restore.kind).toBe('restoration');
    expect(restore.title).toBe(RESTORE_PANEL_TITLE);
    expect(restore.reward).toBe(RESTORE_PANEL_PERK);
    expect(restore.costCoins).toBe(RESTORE_FARMHOUSE_COST.coins);
    expect(restore.costMoondust).toBe(RESTORE_FARMHOUSE_COST.moondust);
  });

  it('reads the region entry from REGIONS rather than duplicating it', () => {
    const region = GOALS[1]!;
    expect(region.kind).toBe('region');
    expect(region.reward).toBe(
      `Expanded Territory and ${EAST_MEADOW.plotGrant} Additional Farming Plots`,
    );
    expect(region.costCoins).toBe(EAST_MEADOW.costCoins);
    expect(region.levelGate).toBe(EAST_MEADOW.levelGate);
    // A region is bought with coins only - never moondust.
    expect(region.costMoondust).toBe(0);
  });

  it('has one entry per region, so a future region joins the list for free', () => {
    expect(GOALS.filter((def) => def.kind === 'region')).toHaveLength(REGIONS.length);
  });

  it('uses the exact designed subtitle and no em dashes anywhere in its copy', () => {
    expect(GOALS_PANEL_SUBTITLE).toBe("Everything you're growing toward.");
    const copy = [
      GOALS_PANEL_SUBTITLE,
      ...GOALS.flatMap((def) => [def.title, def.reward, goalLockedNote(def)]),
    ];
    for (const line of copy) expect(line).not.toContain('—');
  });
});

describe('restoration entry status', () => {
  it('is open (actionable) while the farmhouse is un-restored, at any level', () => {
    expect(goalStatus(GOALS[0]!, stateWith({ level: 1, restoration: { farmhouse: 0 } }))).toBe(
      'open',
    );
  });

  it('is owned once restoration.farmhouse === 1', () => {
    expect(goalStatus(GOALS[0]!, stateWith({ restoration: { farmhouse: 1 } }))).toBe('owned');
  });
});

describe('region entry status', () => {
  const region = GOALS[1]!;

  it('is locked below the region level gate', () => {
    expect(goalStatus(region, stateWith({ level: EAST_MEADOW.levelGate - 1 }))).toBe('locked');
    expect(goalLockedNote(region)).toBe(`Requires Farm Level ${EAST_MEADOW.levelGate}`);
  });

  it('is open (actionable) at the level gate and above, while still unowned', () => {
    expect(goalStatus(region, stateWith({ level: EAST_MEADOW.levelGate }))).toBe('open');
    expect(goalStatus(region, stateWith({ level: EAST_MEADOW.levelGate + 5 }))).toBe('open');
  });

  it('is owned once the region is in regionsUnlocked, even below the gate', () => {
    const owned = stateWith({ level: 1, regionsUnlocked: [EAST_MEADOW.id] });
    expect(goalStatus(region, owned)).toBe('owned');
  });
});

describe('progress line', () => {
  it('tracks both currencies on one line each, with no "Saved" prefix and no "and"', () => {
    // RE-PIN (Balance Pass v2): RESTORE_FARMHOUSE_COST.coins 50,000 -> 100,000
    // (moondust 20 unchanged), so every denominator below follows.
    const line = goalProgressLine(GOALS[0]!, stateWith({ coins: 12300, moondust: 3 }));
    expect(line).toBe('12,300 / 100,000 coins\n3 / 20 moondust');
    expect(line.split('\n')).toEqual(['12,300 / 100,000 coins', '3 / 20 moondust']);
  });

  it('clamps each numerator at its price so a rich player never reads past 100%', () => {
    // RE-PIN (Balance Pass v2): restore cost coins 50,000 -> 100,000.
    const line = goalProgressLine(GOALS[0]!, stateWith({ coins: 999999, moondust: 400 }));
    expect(line).toBe('100,000 / 100,000 coins\n20 / 20 moondust');
  });

  it('returns the single coins line for a coins-only goal', () => {
    // No such goal ships today - this pins the branch so one can be added safely.
    // RE-PIN (Balance Pass v2): restore cost coins 50,000 -> 100,000.
    const coinsOnly = { ...GOALS[0]!, costMoondust: 0 };
    expect(goalProgressLine(coinsOnly, stateWith({ coins: 12300 }))).toBe('12,300 / 100,000 coins');
  });

  it('is empty for entries that do not track progress (the region rows)', () => {
    expect(goalProgressLine(GOALS[1]!, stateWith({ coins: 100 }))).toBe('');
  });

  it('is dropped entirely once an entry is owned', () => {
    const views = goalViews(stateWith({ coins: 100, restoration: { farmhouse: 1 } }));
    // Looked up by id, not position: a completed entry sorts to the bottom.
    const restore = views.find((view) => view.def.id === 'restore_homestead')!;
    expect(restore.status).toBe('owned');
    expect(restore.progress).toBe('');
  });
});

describe('call-to-action button (T3.30-r1)', () => {
  it('labels the region entry "Go There" and the restoration entry "Restore"', () => {
    expect(goalActionLabel(GOALS[0]!)).toBe('Restore');
    expect(goalActionLabel(GOALS[1]!)).toBe('Go There');
  });

  it('carries no em dashes in either label', () => {
    for (const def of GOALS) expect(goalActionLabel(def)).not.toContain('—');
  });

  /**
   * The panel shows the button on ACTIONABLE rows only, so the statuses below
   * are what decides its presence. Locked and completed rows show none.
   */
  it('is offered on exactly the open statuses, never on locked or owned', () => {
    // Restoration un-restored = open; East Meadow below its gate = locked.
    const early = stateWith({ level: 3, restoration: { farmhouse: 0 } });
    expect(goalViews(early).map((view) => view.status === 'open')).toEqual([true, false]);

    // At the gate both are actionable.
    const atGate = stateWith({ level: EAST_MEADOW.levelGate, restoration: { farmhouse: 0 } });
    expect(goalViews(atGate).every((view) => view.status === 'open')).toBe(true);

    // Both achieved = neither actionable.
    const allDone = stateWith({
      level: 99,
      restoration: { farmhouse: 1 },
      regionsUnlocked: [EAST_MEADOW.id],
    });
    expect(goalViews(allDone).some((view) => view.status === 'open')).toBe(false);
  });
});

describe('region level-up card (T3.30-r1)', () => {
  it('announces a region on the level that opens its gate', () => {
    expect(regionUnlockCardsForLevel(EAST_MEADOW.levelGate)).toEqual([
      { iconFrame: GOALS_ICON_FRAME, label: `${EAST_MEADOW.name} is ready to unlock!` },
    ]);
  });

  it('announces nothing on any other level', () => {
    for (let level = 1; level <= 20; level++) {
      if (level === EAST_MEADOW.levelGate) continue;
      expect(regionUnlockCardsForLevel(level)).toEqual([]);
    }
  });

  it('emits one card per region sharing a gate level, derived from REGIONS', () => {
    // Whatever REGIONS holds, the count at a gate level matches it exactly -
    // so a future region joins the celebration with no new code here.
    for (const region of REGIONS) {
      const cards = regionUnlockCardsForLevel(region.levelGate);
      const expected = REGIONS.filter((other) => other.levelGate === region.levelGate);
      expect(cards).toHaveLength(expected.length);
      expect(cards.map((card) => card.label)).toEqual(
        expected.map((other) => `${other.name} is ready to unlock!`),
      );
    }
  });

  it('carries no em dashes in its copy', () => {
    for (const region of REGIONS) {
      for (const card of regionUnlockCardsForLevel(region.levelGate)) {
        expect(card.label).not.toContain('—');
      }
    }
  });
});

describe('goalViews display order', () => {
  it('derives every entry in one pass while nothing is completed', () => {
    const views = goalViews(stateWith({ level: 3, coins: 0, restoration: { farmhouse: 0 } }));
    expect(views.map((view) => view.def.id)).toEqual(GOALS.map((def) => def.id));
    expect(views.map((view) => view.status)).toEqual(['open', 'locked']);
  });

  it('sinks a completed entry below every unfinished one', () => {
    // Restoration is FIRST in the registry, so completing it must move it last.
    const views = goalViews(stateWith({ level: 3, restoration: { farmhouse: 1 } }));
    expect(views.map((view) => view.status)).toEqual(['locked', 'owned']);
    expect(views[1]!.def.id).toBe('restore_homestead');
  });

  it('keeps registry order within each half (stable partition)', () => {
    const allDone = stateWith({
      level: 99,
      restoration: { farmhouse: 1 },
      regionsUnlocked: [EAST_MEADOW.id],
    });
    const views = goalViews(allDone);
    expect(views.every((view) => view.status === 'owned')).toBe(true);
    expect(views.map((view) => view.def.id)).toEqual(GOALS.map((def) => def.id));
  });
});
