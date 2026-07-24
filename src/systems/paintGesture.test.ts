import { describe, expect, it } from 'vitest';

import { PaintGesture } from './paintGesture';

const SLOP = 12;

describe('PaintGesture', () => {
  it('lays nothing on the down alone - the gesture only arms', () => {
    const g = new PaintGesture(SLOP);
    g.begin(100, 100);
    expect(g.phase).toBe('pending');
    expect(g.active).toBe(true);
  });

  it('drag-paint: a move past the slop confirms and begins painting', () => {
    const g = new PaintGesture(SLOP);
    g.begin(100, 100);
    // Within slop: still armed, nothing laid.
    expect(g.move(105, 103)).toBe('none');
    expect(g.phase).toBe('pending');
    // Past slop: confirm (caller lays the first tiles here).
    expect(g.move(100 + SLOP + 1, 100)).toBe('confirm');
    expect(g.phase).toBe('painting');
    // Every later move keeps painting.
    expect(g.move(160, 100)).toBe('paint');
    expect(g.move(180, 120)).toBe('paint');
  });

  it('tap-paint: an in-slop release lays exactly one tile at the down point', () => {
    const g = new PaintGesture(SLOP);
    g.begin(100, 100);
    expect(g.end(104, 98)).toBe('tap');
    expect(g.phase).toBe('idle');
    expect(g.active).toBe(false);
  });

  it('an out-of-slop release does not tap (it was a drag - tiles already laid on confirm)', () => {
    const g = new PaintGesture(SLOP);
    g.begin(100, 100);
    g.move(100 + SLOP + 1, 100); // confirm -> painting
    expect(g.end(200, 200)).toBe('none');
    expect(g.phase).toBe('idle');
  });

  it('pre-confirmation second finger: cancels outright - zero tiles, gesture inert', () => {
    const g = new PaintGesture(SLOP);
    g.begin(100, 100);
    expect(g.secondFinger()).toBe('cancel');
    expect(g.phase).toBe('idle');
    // A subsequent move paints nothing, and a release is not a tap.
    expect(g.move(100 + SLOP + 1, 100)).toBe('none');
    expect(g.end(100, 100)).toBe('none');
  });

  it('mid-stroke second finger: halts further painting; laid tiles stay', () => {
    const g = new PaintGesture(SLOP);
    g.begin(100, 100);
    g.move(100 + SLOP + 1, 100); // confirm -> painting (some tiles laid by the caller)
    expect(g.secondFinger()).toBe('halt');
    expect(g.phase).toBe('halted');
    // No more painting while halted, even as the finger keeps moving.
    expect(g.move(200, 200)).toBe('none');
    expect(g.move(240, 260)).toBe('none');
  });

  it('a second finger is a no-op once idle or already halted', () => {
    const g = new PaintGesture(SLOP);
    expect(g.secondFinger()).toBe('none'); // idle
    g.begin(100, 100);
    g.move(100 + SLOP + 1, 100);
    g.secondFinger(); // halt
    expect(g.secondFinger()).toBe('none'); // already halted (a third finger)
  });

  it('reset returns the machine to idle', () => {
    const g = new PaintGesture(SLOP);
    g.begin(100, 100);
    g.move(100 + SLOP + 1, 100);
    g.reset();
    expect(g.phase).toBe('idle');
    expect(g.active).toBe(false);
  });
});
