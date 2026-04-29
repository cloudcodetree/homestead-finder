/**
 * Generic photo bank for newsroom-style cards (HomeNews market strip,
 * site-updates, etc.). Looked up by short keyword (farm, forest, …)
 * so the JSON data files stay self-describing and we can swap photo
 * sources later without touching every news entry.
 *
 * Sourced from Unsplash's free CDN — these specific photo IDs are
 * stable URLs and don't require an API key. We pin to fixed IDs (not
 * the random `source.unsplash.com/featured` redirector) so the same
 * card always shows the same image and we don't re-shuffle on
 * re-renders.
 *
 * Refresh strategy: when we expand beyond rural-land themes, add new
 * keywords here. Don't inline raw URLs at call sites.
 */
export type PhotoKeyword =
  | 'farm'
  | 'forest'
  | 'creek'
  | 'cabin'
  | 'pasture'
  | 'ozarks';

const W = 800; // newspaper card hero is ~600 CSS px wide; over-deliver
const H = 400;
const fmt = `&w=${W}&h=${H}&q=80&auto=format&fit=crop`;

export const GENERIC_PHOTOS: Record<PhotoKeyword, string> = {
  // Rolling pasture w/ tree line
  farm: `https://images.unsplash.com/photo-1500382017468-9049fed747ef?${fmt}`,
  // Hardwood forest interior
  forest: `https://images.unsplash.com/photo-1448375240586-882707db888b?${fmt}`,
  // Creek through woods
  creek: `https://images.unsplash.com/photo-1502082553048-f009c37129b9?${fmt}`,
  // Cabin in trees
  cabin: `https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?${fmt}`,
  // Open pasture, big sky
  pasture: `https://images.unsplash.com/photo-1444090542259-0af8fa96557e?${fmt}`,
  // Ozark-like ridge view
  ozarks: `https://images.unsplash.com/photo-1499678329028-101435549a4e?${fmt}`,
};

export const photoUrl = (keyword: PhotoKeyword | undefined): string | null => {
  if (!keyword) return null;
  return GENERIC_PHOTOS[keyword] ?? null;
};
