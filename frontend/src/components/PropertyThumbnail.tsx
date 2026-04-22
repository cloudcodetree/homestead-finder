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
 * Thumbnail image for a property. Three-tier fallback chain:
 *   1. **Direct hotlink** — cheapest, no proxy hop. Works for most
 *      sources (LandWatch assets CDN, OzarkLand WP uploads, Rent
 *      Manager CDN). No bandwidth cost to us, no third-party on the
 *      request path, fastest first paint.
 *   2. **weserv proxy** — bypasses Referer-based hotlink blocks,
 *      resizes to `width`, converts to WebP. Only used when direct
 *      hotlink `onError`s.
 *   3. **Placeholder SVG** — green hill icon when both prior tiers
 *      fail (404, CORS, CSP, or no image in data to begin with).
 */
type ThumbState = 'direct' | 'proxied' | 'failed';

export const PropertyThumbnail = ({ property, width = 400, className }: PropertyThumbnailProps) => {
  const raw = primaryImage(property);
  const [state, setState] = useState<ThumbState>('direct');

  if (!raw || state === 'failed') {
    return <EmptyPlaceholder className={className} />;
  }

  // `state === 'direct'` → hotlink as-is. `'proxied'` → weserv route.
  const src = state === 'direct' ? raw : toProxiedUrl(raw, width);

  return (
    <img
      src={src}
      alt={property.title}
      loading="lazy"
      decoding="async"
      onError={() => {
        // First failure: try weserv. Second failure: fall to placeholder.
        setState((prev) => (prev === 'direct' ? 'proxied' : 'failed'));
      }}
      className={`object-cover ${className ?? ''}`}
    />
  );
};
