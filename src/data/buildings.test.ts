import { describe, expect, it } from 'vitest';

import { BUILDINGS, BUILDING_IDS, findBuilding } from './buildings';
import { STRUCTURE_FOOTPRINT_OFFSETS } from '../config';
import { CROPS } from './crops';
import { GOODS } from './goods';
import { gridToIso } from '../systems/iso';

describe('BUILDINGS registry (T4.1)', () => {
  it('BUILDING_IDS matches the registry keys, and every def is self-consistent', () => {
    expect(BUILDING_IDS).toEqual(['flour_mill']);
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

  it('the flour mill carries its balance numbers', () => {
    const mill = BUILDINGS.flour_mill;
    expect(mill.name).toBe('Flour Mill');
    expect(mill.frame).toBe('flour_mill');
    // RE-PIN (T4.2b-r1): owner-set build cost, 1500 -> 500. The mill is now
    // cheap to put up and its CAPACITY carries the coin sink (slotUnlockCosts).
    expect(mill.price).toBe(500);
    expect(mill.unlockLevel).toBe(6);
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
      inputCropId: 'sunwheat',
      inputCount: 5,
      outputGoodId: 'sunflour',
      outputCount: 2,
      batchMs: 1_200_000, // 20 minutes
      slots: 3,
      // RE-PIN (T4.2b-r1): owner-set slot prices - slot 2 at 2,500, slot 3 at
      // 10,000. Only the slots PAST the first are priced, so length = slots - 1.
      slotUnlockCosts: [2500, 10_000],
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

  it('every milling recipe names a real crop and a real good, with sane counts', () => {
    for (const id of BUILDING_IDS) {
      const recipe = BUILDINGS[id].milling;
      if (recipe === undefined) continue;
      expect(CROPS[recipe.inputCropId]).toBeDefined();
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

  it('milling the mill is profitable: the output beats the input at sell value', () => {
    // THE reason the mill is worth building - if this ever inverts, the
    // processing premium is gone and the balance numbers need another look.
    const recipe = BUILDINGS.flour_mill.milling!;
    const inputValue = CROPS[recipe.inputCropId].sellValue * recipe.inputCount;
    const outputValue = GOODS[recipe.outputGoodId].sellValue * recipe.outputCount;
    expect(outputValue).toBeGreaterThan(inputValue);
  });

  it('no user-facing string uses an em dash (project rule)', () => {
    for (const id of BUILDING_IDS) {
      expect(BUILDINGS[id].name).not.toContain('—');
    }
  });
});
