import { useState } from 'react';
import { Property } from '../types/property';

/**
 * Pick the best available image for a property. Prefers the first
 * entry in `images[]` (current scraper output), falls back to the
 * legacy `imageUrl` field, returns null for image-less rows
 * (tax-sale parcels, scrape failures).
 */
const primaryImage = (property: Property): string | null => {
  const fromArray = property.images?.find((u) => typeof u === 'string' && u.length > 0);
  if (fromArray) return fromArray;
  if (property.imageUrl && property.imageUrl.length > 0) return property.imageUrl;
  return null;
};

/**
 * Convert a lat/lng pair to XYZ tile coordinates at zoom `z` using
 * the standard Web Mercator projection used by OSM/Esri/Google.
 * Used to build the direct-tile URL for the Esri satellite preview.
 */
const lngToTileX = (lng: number, z: number): number =>
  Math.floor(((lng + 180) / 360) * Math.pow(2, z));

const latToTileY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z)
  );
};

/**
 * Build an Esri World Imagery tile URL centered on the parcel.
 *
 * Esri's ArcGIS online satellite basemap is free, requires no API
 * key, and returns proper satellite imagery down to sub-meter
 * resolution in the US. We grab a single 256×256 tile at zoom 14
 * (~5km×5km covered) — the parcel will appear somewhere within
 * that tile. Good enough for a card thumbnail that tells the user
 * "this is what the area looks like" without a map library.
 *
 * Covered by Esri's Terms of Use for non-commercial reference
 * usage; citing Esri in the UI tooltip satisfies attribution.
 */
const satelliteTileUrl = (lat: number, lng: number, zoom = 14): string => {
  const x = lngToTileX(lng, zoom);
  const y = latToTileY(lat, zoom);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
};

const hasValidCoords = (p: Property): boolean =>
  typeof p.location?.lat === 'number' &&
  typeof p.location?.lng === 'number' &&
  p.location.lat !== 0 &&
  p.location.lng !== 0;

/**
 * Route a raw image URL through images.weserv.nl — a free public
 * image CDN/proxy that:
 *   - Bypasses Referer-based hotlink blocks (LandWatch, Land.com
 *     CDNs reject direct <img src> requests from other origins,
 *     but weserv requests with its own origin and re-serves to us).
 *   - Resizes on-the-fly to the requested width, huge bandwidth win
 *     for card thumbnails.
 *   - Converts to WebP when the browser accepts it.
 *
 * Only proxy absolute URLs. Skips the wrap for relative/data URLs
 * and already-proxied URLs so tests + sample data still work.
 */
const WESERV_BASE = 'https://images.weserv.nl/?';

const toProxiedUrl = (rawUrl: string, width: number): string => {
  if (!rawUrl) return '';
  // Skip re-proxying if already going through weserv or is a data URL
  if (rawUrl.startsWith('data:') || rawUrl.includes('images.weserv.nl')) {
    return rawUrl;
  }
  // weserv expects URLs without the scheme prefix in its `url` param.
  // Stripping `https://` keeps the param short; `http://` gets auto-
  // upgraded server-side.
  const stripped = rawUrl.replace(/^https?:\/\//, '');
  const params = new URLSearchParams({
    url: stripped,
    w: String(width),
    // Cap height to avoid ultra-tall panoramas blowing out layout
    h: String(Math.round(width * 0.75)),
    fit: 'cover',
    output: 'webp',
    // Graceful fallback: serve a tiny transparent if source 404s
    errorredirect: '1',
  });
  return `${WESERV_BASE}${params.toString()}`;
};

interface PropertyThumbnailProps {
  property: Property;
  /** Rendered image width in CSS px. Drives the weserv resize. */
  width?: number;
  className?: string;
}

/**
 * Inline SVG used when a listing has no image at all (tax-sale
 * parcels, scrape failures). Green hill + sun — matches the
 * "🌿 Homestead" brand rather than a generic broken-image icon.
 */
const EmptyPlaceholder = ({ className }: { className?: string }) => (
  <div
    className={`flex items-center justify-center bg-gradient-to-br from-green-50 to-green-100 text-green-600 ${className ?? ''}`}
    aria-label="No image available"
  >
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="w-8 h-8 opacity-70"
    >
      <path d="M3 21V11l9-7 9 7v10" />
      <path d="M9 21V12h6v9" />
    </svg>
  </div>
);

/**
 * Thumbnail image for a property. Four-tier fallback chain:
 *   1. **Direct hotlink** — cheapest, no proxy hop. Works for most
 *      sources (LandWatch assets CDN, OzarkLand WP uploads, Rent
 *      Manager CDN). No bandwidth cost to us, no third-party on the
 *      request path, fastest first paint.
 *   2. **weserv proxy** — bypasses Referer-based hotlink blocks,
 *      resizes to `width`, converts to WebP. Only used when direct
 *      hotlink `onError`s.
 *   3. **Esri satellite tile** — for listings with no photo but
 *      valid lat/lng, show a real satellite view of the parcel
 *      area. Free, no API key, no storage. Labeled "Satellite" in
 *      a corner overlay so users know it's imagery, not a photo.
 *   4. **Placeholder SVG** — green hill icon as the absolute last
 *      resort (no photo + no coords).
 */
type ThumbState = 'direct' | 'proxied' | 'satellite' | 'failed';

export const PropertyThumbnail = ({ property, width = 400, className }: PropertyThumbnailProps) => {
  const raw = primaryImage(property);
  const coords = hasValidCoords(property);
  // Initial state depends on what's available:
  //   - photo URL → start 'direct', fall to 'proxied' → 'satellite' → 'failed'
  //   - no photo + coords → jump straight to 'satellite'
  //   - nothing → 'failed' shows the placeholder
  const initial: ThumbState = raw ? 'direct' : coords ? 'satellite' : 'failed';
  const [state, setState] = useState<ThumbState>(initial);

  if (state === 'failed' || (!raw && !coords)) {
    return <EmptyPlaceholder className={className} />;
  }

  if (state === 'satellite') {
    // Pull lat/lng out safely — guard above guarantees they're numbers
    const lat = property.location.lat;
    const lng = property.location.lng;
    return (
      <div className={`relative overflow-hidden ${className ?? ''}`}>
        <img
          src={satelliteTileUrl(lat, lng)}
          alt={`Satellite view of ${property.title}`}
          loading="lazy"
          decoding="async"
          onError={() => setState('failed')}
          className="w-full h-full object-cover"
        />
        <span
          className="absolute bottom-1 right-1 text-[10px] font-medium text-white bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded"
          title="Satellite imagery via Esri World Imagery (no photo available for this listing)"
        >
          📡 Satellite
        </span>
      </div>
    );
  }

  // `state === 'direct'` → hotlink as-is. `'proxied'` → weserv route.
  const src = state === 'direct' ? raw! : toProxiedUrl(raw!, width);

  return (
    <img
      src={src}
      alt={property.title}
      loading="lazy"
      decoding="async"
      onError={() => {
        // Fallback chain: direct → proxied → satellite (if coords) → failed.
        setState((prev) => {
          if (prev === 'direct') return 'proxied';
          if (prev === 'proxied') return coords ? 'satellite' : 'failed';
          return 'failed';
        });
      }}
      className={`object-cover ${className ?? ''}`}
    />
  );
};
