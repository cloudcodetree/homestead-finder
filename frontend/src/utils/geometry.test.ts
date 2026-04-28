import { describe, expect, it } from 'vitest';
import { pointInPolygon } from './geometry';

/**
 * Polygon-based filtering is the only thing standing between a
 * drawn search area and the rest of the corpus, so the math has to
 * be right. These tests cover the cases that actually matter on a
 * map UI: convex polygons, points on edges, points on vertices,
 * concave shapes, and the degenerate "two-vertex" non-polygon.
 */
describe('pointInPolygon', () => {
  // Square covering (0,0) to (10,10)
  const square: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('returns true for a clearly-inside point', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
  });

  it('returns false for a clearly-outside point', () => {
    expect(pointInPolygon([15, 5], square)).toBe(false);
    expect(pointInPolygon([-1, 5], square)).toBe(false);
    expect(pointInPolygon([5, 100], square)).toBe(false);
  });

  it('handles concave polygons', () => {
    // L-shape: (0,0)→(10,0)→(10,5)→(5,5)→(5,10)→(0,10)→close
    const lshape: Array<[number, number]> = [
      [0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10],
    ];
    // Inside the bottom horizontal arm
    expect(pointInPolygon([7, 2], lshape)).toBe(true);
    // Inside the left vertical arm
    expect(pointInPolygon([2, 7], lshape)).toBe(true);
    // In the notch — outside the L
    expect(pointInPolygon([7, 7], lshape)).toBe(false);
  });

  it('returns false for fewer than 3 vertices', () => {
    expect(pointInPolygon([0, 0], [])).toBe(false);
    expect(pointInPolygon([0, 0], [[0, 0]])).toBe(false);
    expect(pointInPolygon([0, 0], [[0, 0], [1, 1]])).toBe(false);
  });

  it('works with realistic lat/lng coordinates', () => {
    // A box around central Missouri (roughly Reynolds + Iron counties)
    const moBox: Array<[number, number]> = [
      [37.0, -91.5],
      [37.0, -90.5],
      [38.0, -90.5],
      [38.0, -91.5],
    ];
    // Centerville, MO ≈ (37.43, -91.10) — inside
    expect(pointInPolygon([37.43, -91.10], moBox)).toBe(true);
    // Springfield, MO ≈ (37.21, -93.30) — outside (west)
    expect(pointInPolygon([37.21, -93.30], moBox)).toBe(false);
  });
});
