import { describe, expect, it } from 'vitest';

import {
  BUILDINGS,
  BUILDING_CARD_ICON_SCALE,
  type BuildingDef,
  BUILDING_IDS,
  buildingUnlockCardsForLevel,
  findBuilding,
} from './buildings';
import { STRUCTURE_FOOTPRINT_OFFSETS } from '../config';
import { CROPS } from './crops';
import { GOODS } from './goods';
import { MAX_LEVEL } from './levels';
import { gridToIso } from '../systems/iso';

describe('BUILDINGS registry (T4.1)', () => {
  it('BUILDING_IDS matches the registry keys, and every def is self-consistent', () => {
    // RE-PIN (T4.4): the bakery joined the roster as production building #2.
    expect(BUILDING_IDS).toEqual(['flour_mill', 'bakery']);
    for (const id of BUILDING_IDS) {
      const def = BUILDINGS[id];
      expect(def.id).toBe(id);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.frame.length).toBeGreaterThan(0);
      expect(def.footprintOffsets.length).toBeGreaterThan(0);
      expect(def.price).toBeGreaterThan(0);
      expect(Number.isInteger(def.price)).toBe(true);
      expect(def.currency).toBe('coins');
      expect(def.unlockLevel).toBeGreaterThan(0);
      expect(Number.isInteger(def.unlockLevel)).toBe(true);
      for (const offset of def.footprintOffsets) {
        expect(Number.isInteger(offset.col)).toBe(true);
        expect(Number.isInteger(offset.row)).toBe(true);
      }
      expect(Number.isInteger(def.defaultAnchor.col)).toBe(true);
      expect(Number.isInteger(def.defaultAnchor.row)).toBe(true);
    }
  });

  it('every building is REACHABLE - its gate sits inside 1..MAX_LEVEL', () => {
    // NEW (T4.9): the bakery shipped at unlockLevel 9 against a MAX_LEVEL of
    // 8, so no save could ever buy it. The same sweep crops already get, so a
    // future building cannot be gated past the cap unnoticed.
    for (const id of BUILDING_IDS) {
      expect(BUILDINGS[id].unlockLevel).toBeGreaterThanOrEqual(1);
      expect(BUILDINGS[id].unlockLevel).toBeLessThanOrEqual(MAX_LEVEL);
    }
  });

  it('the flour mill carries its balance numbers', () => {
    const mill = BUILDINGS.flour_mill;
    expect(mill.name).toBe('Flour Mill');
    expect(mill.frame).toBe('flour_mill');
    // RE-PIN (T4.2b-r1): owner-set build cost, 1500 -> 500. The mill is now
    // cheap to put up and its CAPACITY carries the coin sink (slotUnlockCosts).
    expect(mill.price).toBe(500);
    // RE-PIN (T4.9): owner-set unlock level, 6 -> 3, so the processing chain
    // opens early. Inside MAX_LEVEL (8), so the mill stays reachable.
    expect(mill.unlockLevel).toBe(3);
  });

  it("the mill's footprint is the farmhouse's Art-Studio-tuned 2x2 block", () => {
    // The stated baseline (see the def's comment): the mill's art is staged at
    // the same 512x512 and packs through the identical 256-square path, so it
    // covers the same ground until an owner eyeball says otherwise.
    expect(BUILDINGS.flour_mill.footprintOffsets).toEqual(STRUCTURE_FOOTPRINT_OFFSETS.farmhouse);
  });

  it("the mill's render offset lands exactly on the center of a footprint tile", () => {
    // THE derivation the def claims: renderOffset is the FRONT footprint
    // tile's anchor-relative center, so the building's base sits on its own
    // footprint by construction rather than by measurement luck.
    const mill = BUILDINGS.flour_mill;
    const origin = gridToIso(0, 0);
    const centers = mill.footprintOffsets.map((offset) => {
      const center = gridToIso(offset.col, offset.row);
      return { x: center.x - origin.x, y: center.y - origin.y };
    });
    expect(centers).toContainEqual(mill.renderOffset);
    // Specifically the FRONT tile (the greatest y of the four), which is what
    // makes the ground point read as the foot of the building, not its middle.
    const frontY = Math.max(...centers.map((center) => center.y));
    expect(mill.renderOffset.y).toBe(frontY);
  });

  it('findBuilding resolves known ids and rejects unknown ones', () => {
    expect(findBuilding('flour_mill')).toBe(BUILDINGS.flour_mill);
    expect(findBuilding('barn')).toBeUndefined();
    expect(findBuilding('')).toBeUndefined();
    // Prototype keys are not building ids - the validator leans on this.
    expect(findBuilding('toString')).toBeUndefined();
    expect(findBuilding('constructor')).toBeUndefined();
  });

  it("the mill's milling recipe carries its provisional numbers (T4.2a)", () => {
    expect(BUILDINGS.flour_mill.milling).toEqual({
      // RE-PIN (T4.4): `inputCropId: 'sunwheat'` became the crop arm of the
      // new crop-or-good `input` union. Same crop, same behavior.
      input: { kind: 'crop', cropId: 'sunwheat' },
      inputCount: 5,
      outputGoodId: 'sunflour',
      outputCount: 2,
      batchMs: 1_200_000, // 20 minutes
      slots: 3,
      // RE-PIN (Balance Pass v2): owner-set slot prices dropped - slot 2 at
      // 2,000 (was 2,500), slot 3 at 6,000 (was 10,000). Only the slots PAST
      // the first are priced, so length = slots - 1.
      slotUnlockCosts: [2000, 6000],
    });
  });

  it('every recipe prices exactly the slots past the first, ascending (T4.2b-r1)', () => {
    // A building is born with one usable slot, so a costs list that is any
    // other length either strands a slot with no price or prices one that does
    // not exist. Ascending because a later slot being CHEAPER would make the
    // sequential unlock order feel like a penalty.
    for (const id of BUILDING_IDS) {
      const recipe = BUILDINGS[id].milling;
      if (recipe === undefined) continue;
      expect(recipe.slotUnlockCosts).toHaveLength(recipe.slots - 1);
      for (const cost of recipe.slotUnlockCosts) {
        expect(cost).toBeGreaterThan(0);
        expect(Number.isInteger(cost)).toBe(true);
      }
      const ascending = [...recipe.slotUnlockCosts].sort((a, b) => a - b);
      expect(recipe.slotUnlockCosts).toEqual(ascending);
    }
  });

  it('every milling recipe names a real input and a real good, with sane counts', () => {
    for (const id of BUILDING_IDS) {
      const recipe = BUILDINGS[id].milling;
      if (recipe === undefined) continue;
      // T4.4: the input is a crop OR a good, resolved out of its own registry.
      if (recipe.input.kind === 'crop') {
        expect(CROPS[recipe.input.cropId]).toBeDefined();
      } else {
        expect(GOODS[recipe.input.goodId]).toBeDefined();
      }
      expect(GOODS[recipe.outputGoodId]).toBeDefined();
      expect(recipe.inputCount).toBeGreaterThan(0);
      expect(recipe.outputCount).toBeGreaterThan(0);
      expect(recipe.slots).toBeGreaterThan(0);
      expect(recipe.batchMs).toBeGreaterThan(0);
      expect(Number.isInteger(recipe.inputCount)).toBe(true);
      expect(Number.isInteger(recipe.outputCount)).toBe(true);
      expect(Number.isInteger(recipe.slots)).toBe(true);
    }
  });

  it('EVERY production building is profitable: its output beats its input at sell value', () => {
    // THE reason a production building is worth putting up - if this ever
    // inverts, the processing premium is gone and the balance numbers need
    // another look. Now swept across the whole roster (T4.4), so a new
    // building cannot be added at a loss without this failing.
    for (const id of BUILDING_IDS) {
      const recipe = BUILDINGS[id].milling;
      if (recipe === undefined) continue;
      const inputUnitValue =
        recipe.input.kind === 'crop'
          ? CROPS[recipe.input.cropId].sellValue
          : GOODS[recipe.input.goodId].sellValue;
      const inputValue = inputUnitValue * recipe.inputCount;
      const outputValue = GOODS[recipe.outputGoodId].sellValue * recipe.outputCount;
      expect(outputValue).toBeGreaterThan(inputValue);
    }
  });

  it('no user-facing string uses an em dash (project rule)', () => {
    for (const id of BUILDING_IDS) {
      expect(BUILDINGS[id].name).not.toContain('—');
    }
  });
});

describe('buildingUnlockCardsForLevel (T4.2d)', () => {
  // RE-PIN (T4.9): the mill's gate moved 6 -> 3; the assertion reads the gate
  // off the def, so only the title's stated level needed updating.
  it('returns the mill card at exactly its unlockLevel (3), with the fitted icon scale', () => {
    expect(buildingUnlockCardsForLevel(BUILDINGS.flour_mill.unlockLevel)).toEqual([
      {
        iconFrame: 'flour_mill',
        label: 'Flour Mill available in the Shop!',
        iconScale: BUILDING_CARD_ICON_SCALE,
      },
    ]);
  });

  it('returns nothing for any level that gates no building', () => {
    const gated = new Set(BUILDING_IDS.map((id) => BUILDINGS[id].unlockLevel));
    for (let level = 1; level <= 20; level++) {
      if (gated.has(level)) continue;
      expect(buildingUnlockCardsForLevel(level)).toEqual([]);
    }
  });

  it('is derived from the registry, not hardcoded - one card per building at its own gate', () => {
    for (const id of BUILDING_IDS) {
      const def = BUILDINGS[id];
      const cards = buildingUnlockCardsForLevel(def.unlockLevel);
      expect(cards).toContainEqual({
        iconFrame: def.frame,
        label: `${def.name} available in the Shop!`,
        iconScale: BUILDING_CARD_ICON_SCALE,
      });
    }
  });

  // 256-frame building at 0.65 renders the same on-card size as a 128 crop
  // frame at CARD_ICON_SCALE 1.3: 256 * 0.65 == 128 * 1.3 == 166.4px.
  it('scales a 256 building frame to the same card size as a 128 crop frame', () => {
    expect(256 * BUILDING_CARD_ICON_SCALE).toBe(128 * 1.3);
  });
});

describe('the bakery def (T4.4)', () => {
  const BAKERY = BUILDINGS.bakery;

  it('carries its provisional balance numbers', () => {
    expect(BAKERY.name).toBe('Bakery');
    expect(BAKERY.frame).toBe('bakery');
    expect(BAKERY.price).toBe(2000);
    // RE-PIN (T4.9): owner-set unlock level, 9 -> 4. The old 9 was ABOVE the
    // MAX_LEVEL 8 cap, so the bakery was unreachable in-game; 4 puts it one
    // level after the mill's 3.
    expect(BAKERY.unlockLevel).toBe(4);
  });

  it('eats a GOOD - the reason MillingRecipe.input is a union', () => {
    expect(BAKERY.milling).toEqual({
      input: { kind: 'good', goodId: 'sunflour' },
      inputCount: 3,
      outputGoodId: 'bread',
      outputCount: 1,
      batchMs: 1_800_000, // 30 minutes
      slots: 3,
      // RE-PIN (Balance Pass v2): slot 2 5,000 -> 4,000, slot 3 20,000 -> 12,000.
      slotUnlockCosts: [4000, 12_000],
    });
  });

  it('takes the 2x2 baseline footprint, flagged for an owner eyeball', () => {
    // Same honest baseline the mill started from; the bakery art reads wider,
    // so this is the likeliest thing to want a nudge once judged live.
    expect(BAKERY.footprintOffsets).toEqual(BUILDINGS.flour_mill.footprintOffsets);
  });

  it("its render offset lands on the FRONT footprint tile's center, derived not guessed", () => {
    const origin = gridToIso(0, 0);
    const centers = BAKERY.footprintOffsets.map((offset) => {
      const center = gridToIso(offset.col, offset.row);
      return { x: center.x - origin.x, y: center.y - origin.y };
    });
    expect(centers).toContainEqual(BAKERY.renderOffset);
    const frontY = Math.max(...centers.map((center) => center.y));
    expect(BAKERY.renderOffset.y).toBe(frontY);
  });

  it('its default anchor does not overlap the mill footprint, the farmhouse or the notice board', () => {
    /** The tiles a building at `anchor` blocks. */
    const tilesOf = (def: typeof BAKERY) =>
      def.footprintOffsets.map(
        (o) => `${def.defaultAnchor.col + o.col},${def.defaultAnchor.row + o.row}`,
      );
    const bakeryTiles = new Set(tilesOf(BAKERY));
    for (const tile of tilesOf(BUILDINGS.flour_mill)) {
      expect(bakeryTiles.has(tile)).toBe(false);
    }
    // The farmhouse's own 2x2, from its anchor in config.
    const farmhouseTiles = STRUCTURE_FOOTPRINT_OFFSETS.farmhouse.map(
      (o) => `${-1 + o.col},${-3 + o.row}`,
    );
    for (const tile of farmhouseTiles) {
      expect(bakeryTiles.has(tile)).toBe(false);
    }
  });

  it('renders clear of the mill, not just footprint-legal', () => {
    // A legal footprint is NOT enough. Screen x depends only on (col - row)
    // and y only on (col + row), so two buildings sharing a (col - row)
    // diagonal stack in one screen column. The first anchor tried for the
    // bakery was footprint-legal yet rendered in the mill's exact column,
    // 256px above it, and the two 256px sprites merged into one blob.
    const renderPointOf = (def: BuildingDef) => {
      const front = { col: def.defaultAnchor.col + 2, row: def.defaultAnchor.row + 1 };
      return gridToIso(front.col, front.row);
    };
    const bakery = renderPointOf(BAKERY);
    const mill = renderPointOf(BUILDINGS.flour_mill);
    // Different screen column AND far enough apart vertically that a 256px
    // sprite cannot cover the other.
    expect(bakery.x).not.toBe(mill.x);
    expect(Math.abs(bakery.y - mill.y)).toBeGreaterThanOrEqual(256);
  });

  it('the production chain links up: the bakery eats what the mill makes', () => {
    // The whole point of the second building - if these ever stop matching,
    // the chain is broken and the bakery has no supply.
    const mill = BUILDINGS.flour_mill.milling!;
    const bakery = BAKERY.milling!;
    expect(bakery.input).toEqual({ kind: 'good', goodId: mill.outputGoodId });
  });
});

describe('buildingUnlockCardsForLevel with two buildings (T4.4)', () => {
  // RE-PIN (T4.9): the bakery's gate moved 9 -> 4 (9 was above the L8 cap).
  it('yields the bakery card at level 4', () => {
    expect(buildingUnlockCardsForLevel(4)).toEqual([
      {
        iconFrame: 'bakery',
        label: 'Bakery available in the Shop!',
        iconScale: BUILDING_CARD_ICON_SCALE,
      },
    ]);
  });

  // RE-PIN (T4.9): the mill's gate moved 6 -> 3.
  it('still yields only the mill card at level 3', () => {
    expect(buildingUnlockCardsForLevel(3)).toEqual([
      {
        iconFrame: 'flour_mill',
        label: 'Flour Mill available in the Shop!',
        iconScale: BUILDING_CARD_ICON_SCALE,
      },
    ]);
  });

  it('yields nothing at a level that gates neither', () => {
    // RE-PIN (T4.9): 6 and 9 gate nothing now that the mill sits at 3 and the
    // bakery at 4, so both join the list they used to be excluded from; 2 is
    // the new "just below the first gate" case.
    for (const level of [1, 2, 5, 6, 7, 8, 9, 10, 12]) {
      expect(buildingUnlockCardsForLevel(level)).toEqual([]);
    }
  });
});
