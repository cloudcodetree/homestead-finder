import { useEffect, useState } from 'react';
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Pencil, X } from 'lucide-react';
import { Property } from '../types/property';
import { formatPrice, formatAcreage, formatPricePerAcre } from '../utils/formatters';
import { getListingTypeStyle } from '../utils/listingType';
import { safeUrl } from '../utils/safeUrl';
import { getDealScoreLabel } from '../utils/scoring';
import { computeSelfSufficiency } from '../utils/selfSufficiency';

// Fix Leaflet default marker icons broken by Vite
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

/**
 * Marker icon composition:
 *   - Outer fill = Self-Sufficiency tier color (green ≥70, amber ≥50,
 *     rose otherwise). Same banding as the InvestmentScore palette.
 *     Switched from Deal Score 2026-05-06 — autonomy-first reframe.
 *   - Inner ring = listing-type color (tax-sale variants, owner-finance,
 *     standard). Tells the user whether they're looking at a marketplace
 *     listing, an owner-finance parcel, or a tax-sale parcel.
 *   - Center text = the Self-Sufficiency composite (0–100).
 */
const createScoreIcon = (property: Property) => {
  const s = computeSelfSufficiency(property).composite;
  const scoreColor = s >= 70 ? '#10b981' : s >= 50 ? '#f59e0b' : '#f43f5e';
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
  /** When set, the saved polygon is rendered as a translucent overlay
   * and listings outside it are filtered upstream. */
  drawnArea?: Array<[number, number]> | null;
  /** Called when the user finishes drawing a new polygon. Empty array
   * = clear. */
  onAreaChange?: (polygon: Array<[number, number]> | null) => void;
}

interface DrawingLayerProps {
  active: boolean;
  vertices: Array<[number, number]>;
  onAddVertex: (v: [number, number]) => void;
  onFinish: () => void;
}

/**
 * Captures the next click on the map as a polygon vertex when
 * drawing mode is active. Double-click closes the polygon. The
 * map's own scroll-zoom and pan handlers stay enabled — only
 * single clicks are consumed for vertex placement.
 */
const DrawingLayer = ({ active, vertices, onAddVertex, onFinish }: DrawingLayerProps) => {
  useMapEvents({
    click(e) {
      if (!active) return;
      onAddVertex([e.latlng.lat, e.latlng.lng]);
    },
    dblclick() {
      if (!active) return;
      onFinish();
    },
  });
  if (!active || vertices.length === 0) return null;
  // Render an in-progress polyline so the user sees their vertices
  // accumulating; closes into a polygon visually only on finish.
  return (
    <Polyline
      positions={vertices}
      pathOptions={{ color: '#16a34a', weight: 2, dashArray: '4 4' }}
    />
  );
};

// A listing is mappable only when it has non-zero coords — scraper
// output seeds `lat/lng = 0` until the geo-enrichment pass runs, and
// stacking 100+ markers at Null Island is worse than hiding them.
const hasValidCoords = (p: Property): boolean =>
  p.location?.lat !== 0 &&
  p.location?.lng !== 0 &&
  p.location?.lat !== undefined &&
  p.location?.lng !== undefined;

export const MapView = ({
  properties,
  onSelectProperty,
  drawnArea = null,
  onAreaChange,
}: MapViewProps) => {
  const mappable = properties.filter(hasValidCoords);
  const missingCoords = properties.length - mappable.length;
  const [drawing, setDrawing] = useState(false);
  const [pending, setPending] = useState<Array<[number, number]>>([]);

  const startDrawing = () => {
    setPending([]);
    setDrawing(true);
  };
  const finishDrawing = () => {
    setDrawing(false);
    if (pending.length >= 3 && onAreaChange) {
      onAreaChange(pending);
    }
    setPending([]);
  };
  const cancelDrawing = () => {
    setDrawing(false);
    setPending([]);
  };
  const clearArea = () => {
    onAreaChange?.(null);
  };

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

      {/* Drawing toolbar — pinned top-right of the map. Above marker
          z-index (Leaflet markers render around 600). */}
      {onAreaChange && (
        <div className="absolute top-3 right-3 z-[600] flex flex-col gap-1.5 items-end">
          {!drawing && !drawnArea && (
            <button
              type="button"
              onClick={startDrawing}
              className="bg-white border border-gray-300 hover:border-green-500 hover:text-green-700 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-md shadow flex items-center gap-1.5"
              title="Click vertices on the map; double-click to finish"
            >
              <Pencil className="w-3.5 h-3.5" />
              Draw area
            </button>
          )}
          {drawing && (
            <div className="bg-white border border-green-300 rounded-md shadow p-2 flex items-center gap-2">
              <span className="text-xs text-gray-600">
                {pending.length === 0
                  ? 'Click first vertex…'
                  : `${pending.length} vertex${pending.length === 1 ? '' : 'es'} — double-click to finish`}
              </span>
              <button
                type="button"
                onClick={finishDrawing}
                disabled={pending.length < 3}
                className="text-xs font-medium text-green-700 hover:text-green-800 disabled:text-gray-300"
              >
                Finish
              </button>
              <button
                type="button"
                onClick={cancelDrawing}
                className="text-xs text-gray-500 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          )}
          {!drawing && drawnArea && drawnArea.length >= 3 && (
            <button
              type="button"
              onClick={clearArea}
              className="bg-white border border-gray-300 hover:border-red-400 hover:text-red-700 text-gray-700 text-xs font-medium px-3 py-1.5 rounded-md shadow flex items-center gap-1.5"
              title="Remove the drawn search area"
            >
              <X className="w-3.5 h-3.5" />
              Clear area
            </button>
          )}
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
          // Disable map's default double-click-zoom while drawing —
          // double-click is the "finish polygon" gesture, and the
          // zoom would fight it.
          doubleClickZoom={!drawing}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds properties={mappable} />
          {drawnArea && drawnArea.length >= 3 && (
            <Polygon
              positions={drawnArea}
              pathOptions={{
                color: '#16a34a',
                weight: 2,
                fillColor: '#16a34a',
                fillOpacity: 0.08,
              }}
            />
          )}
          <DrawingLayer
            active={drawing}
            vertices={pending}
            onAddVertex={(v) => setPending((p) => [...p, v])}
            onFinish={finishDrawing}
          />
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
