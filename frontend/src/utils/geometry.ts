/**
 * Point-in-polygon test using the ray-casting algorithm. Edges of
 * the polygon count as inside (the "or-equal" comparisons in the
 * predicate). Polygon is implicitly closed — the last vertex
 * connects back to the first.
 *
 * Coordinates are interpreted as (lat, lng); the algorithm is
 * coordinate-agnostic so this works equivalently for (x, y).
 *
 * For a US-scale homestead-finder use case the small projection
 * distortion is negligible — we're answering "is this listing inside
 * the user's drawn area on the map" not "is it inside a precise
 * geodesic boundary". Spherical-correct algorithms would be overkill.
 */
export const pointInPolygon = (
  point: [number, number],
  polygon: Array<[number, number]>,
): boolean => {
  if (polygon.length < 3) return false;
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};
