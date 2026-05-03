import { useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Property } from '../types/property';
import { useCompsCorpus } from '../hooks/useCountyMedians';
import { findBestComps, rawLandPpa } from '../utils/comps';
import { formatPricePerAcre } from '../utils/formatters';

// Same default-icon hack the main MapView uses — Leaflet's bundled
// images don't resolve through Vite's bundler so we point at a CDN.
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const subjectIcon = L.divIcon({
  className: '',
  html:
    '<div style="background:#16a34a;border:3px solid white;border-radius:50%;' +
    'width:18px;height:18px;box-shadow:0 1px 3px rgba(0,0,0,0.4)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const compIcon = L.divIcon({
  className: '',
  html:
    '<div style="background:#9ca3af;border:2px solid white;border-radius:50%;' +
    'width:10px;height:10px;box-shadow:0 1px 2px rgba(0,0,0,0.3)"></div>',
  iconSize: [10, 10],
  iconAnchor: [5, 5],
});

interface PropertyMiniMapProps {
  property: Property;
}

/**
 * Small map on the property detail page. Shows:
 *   - the subject parcel as a green dot (the headline marker)
 *   - up to ~10 nearest comp listings as muted gray dots, so the user
 *     sees the geographic spread of comps from CompBreakdown directly
 *
 * Renders nothing when the listing is missing coords (tax-sale rows
 * without a parcel lookup, older scrapes that predate geocoding).
 *
 * Lazy-loaded via the consumer (PropertyDetail uses React.lazy + Suspense)
 * so the Leaflet bundle doesn't tax first paint of every detail view.
 */
export const PropertyMiniMap = ({ property }: PropertyMiniMapProps) => {
  const lat = property.location?.lat ?? 0;
  const lng = property.location?.lng ?? 0;
  const corpus = useCompsCorpus();
  const comp = useMemo(() => findBestComps(property, corpus), [property, corpus]);

  if (!lat || !lng) return null;

  // Cap the comp markers so a 100-row pool doesn't blanket the map.
  // Sorted by distance to subject would be ideal but the existing
  // findBestComps result is already sorted by raw-land $/ac; the
  // first 10 give a representative spread without per-marker noise.
  const compMarkers = (comp?.comps ?? [])
    .filter((p) => (p.location?.lat ?? 0) !== 0 && (p.location?.lng ?? 0) !== 0)
    .slice(0, 10);

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-baseline justify-between gap-2 px-4 pt-3 pb-2">
        <h3 className="text-base font-semibold text-gray-900">Location</h3>
        <span className="text-[11px] uppercase tracking-wide text-gray-400">
          subject + nearest comps
        </span>
      </div>
      <div className="h-64 sm:h-72 w-full">
        <MapContainer
          center={[lat, lng]}
          zoom={11}
          scrollWheelZoom={false}
          className="h-full w-full"
          attributionControl={false}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Marker position={[lat, lng]} icon={subjectIcon}>
            <Popup>
              <strong>This listing</strong>
              <br />
              {property.title}
              <br />
              {formatPricePerAcre(rawLandPpa(property))}/ac (raw land)
            </Popup>
          </Marker>
          {compMarkers.map((p) => (
            <Marker
              key={p.id}
              position={[p.location.lat, p.location.lng]}
              icon={compIcon}
            >
              <Popup>
                <strong>{p.title}</strong>
                <br />
                {formatPricePerAcre(rawLandPpa(p))}/ac
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
      <p className="text-[11px] text-gray-500 px-4 py-2 leading-snug border-t border-gray-100">
        Green dot = this listing.{' '}
        {compMarkers.length > 0
          ? `Gray dots = ${compMarkers.length} nearest comparable listings.`
          : 'No comp pool drawn yet.'}{' '}
        Tap any dot for the listing.
      </p>
    </section>
  );
};
