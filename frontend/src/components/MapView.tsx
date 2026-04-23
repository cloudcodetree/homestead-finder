import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Property } from '../types/property';
import { formatPrice, formatAcreage, formatPricePerAcre } from '../utils/formatters';
import { getListingTypeStyle } from '../utils/listingType';
import { safeUrl } from '../utils/safeUrl';
import { getDealScoreLabel } from '../utils/scoring';

// Fix Leaflet default marker icons broken by Vite
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/**
 * Marker icon composition:
 *   - Outer fill = deal-score color (green/yellow/orange/gray). Keeps
 *     the at-a-glance "hot deal" cue.
 *   - Inner ring = listing-type color (tax-sale variants, owner-finance,
 *     standard). Tells the user whether they're looking at a marketplace
 *     listing, an owner-finance parcel, or a tax-sale parcel.
 *   - Center text = the deal score number.
 */
const createScoreIcon = (property: Property) => {
  const s = property.dealScore;
  const scoreColor = s >= 80 ? '#22c55e' : s >= 65 ? '#eab308' : s >= 50 ? '#f97316' : '#9ca3af';
  const typeColor = getListingTypeStyle(property).markerHex;
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${scoreColor};
      color:white;
      border-radius:50%;
      width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;
      border:3px solid ${typeColor};
      box-shadow:0 1px 4px rgba(0,0,0,0.35);
    ">${s}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

interface FitBoundsProps {
  properties: Property[];
}

const FitBounds = ({ properties }: FitBoundsProps) => {
  const map = useMap();
  useEffect(() => {
    if (properties.length === 0) return;
    const bounds = L.latLngBounds(properties.map((p) => [p.location.lat, p.location.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
  }, [properties, map]);
  return null;
};

interface MapViewProps {
  properties: Property[];
  selectedId: string | null;
  onSelectProperty: (id: string) => void;
}

// A listing is mappable only when it has non-zero coords — scraper
// output seeds `lat/lng = 0` until the geo-enrichment pass runs, and
// stacking 100+ markers at Null Island is worse than hiding them.
const hasValidCoords = (p: Property): boolean =>
  p.location?.lat !== 0 &&
  p.location?.lng !== 0 &&
  p.location?.lat !== undefined &&
  p.location?.lng !== undefined;

export const MapView = ({ properties, onSelectProperty }: MapViewProps) => {
  const mappable = properties.filter(hasValidCoords);
  const missingCoords = properties.length - mappable.length;

  return (
    <div className="relative h-full w-full">
      {missingCoords > 0 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[500] max-w-[90%] rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 shadow">
          <strong>{missingCoords}</strong> listing{missingCoords === 1 ? '' : 's'} hidden — no
          coordinates yet. Run{' '}
          <code className="bg-amber-100 px-1 rounded">python -m scraper.enrich_geo</code> to geocode
          them.
        </div>
      )}
      {mappable.length === 0 ? (
        <div className="flex h-full w-full items-center justify-center bg-gray-50 text-sm text-gray-500">
          <div className="text-center max-w-md px-6">
            <p className="font-medium text-gray-700 mb-1">No mappable listings</p>
            <p className="text-xs">
              None of the {properties.length} current listing{properties.length === 1 ? '' : 's'} ha
              {properties.length === 1 ? 's' : 've'} been geocoded yet. The List view still shows
              everything.
            </p>
          </div>
        </div>
      ) : (
        <MapContainer
          center={[39.5, -98.35]}
          zoom={4}
          className="h-full w-full"
          scrollWheelZoom={true}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds properties={mappable} />
          {mappable.map((property) => (
            <Marker
              key={property.id}
              position={[property.location.lat, property.location.lng]}
              icon={createScoreIcon(property)}
              eventHandlers={{ click: () => onSelectProperty(property.id) }}
            >
              <Popup maxWidth={280}>
                <div className="text-sm">
                  <p className="font-semibold text-gray-900 mb-1">{property.title}</p>
                  <p className="text-gray-600">
                    {formatPrice(property.price)} &middot; {formatAcreage(property.acreage)}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {formatPricePerAcre(property.pricePerAcre)}
                  </p>
                  <p className="mt-1 text-xs">
                    <span className="font-medium">Score: {property.dealScore}</span> —{' '}
                    {getDealScoreLabel(property.dealScore)}
                  </p>
                  <a
                    href={safeUrl(property.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 block text-green-600 hover:text-green-700 text-xs font-medium"
                  >
                    View listing →
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      )}
    </div>
  );
};
