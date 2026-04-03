import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Property } from '../types/property';
import { formatPrice, formatAcreage, formatPricePerAcre } from '../utils/formatters';
import { getDealScoreLabel } from '../utils/scoring';

// Fix Leaflet default marker icons broken by Vite
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const createScoreIcon = (score: number) => {
  const color = score >= 80 ? '#22c55e' : score >= 65 ? '#eab308' : score >= 50 ? '#f97316' : '#9ca3af';
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${color};
      color:white;
      border-radius:50%;
      width:32px;height:32px;
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:700;
      border:2px solid white;
      box-shadow:0 1px 4px rgba(0,0,0,0.3);
    ">${score}</div>`,
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
    const bounds = L.latLngBounds(properties.map(p => [p.location.lat, p.location.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
  }, [properties, map]);
  return null;
};

interface MapViewProps {
  properties: Property[];
  selectedId: string | null;
  onSelectProperty: (id: string) => void;
}

export const MapView = ({ properties, selectedId, onSelectProperty }: MapViewProps) => {
  return (
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
      <FitBounds properties={properties} />
      {properties.map(property => (
        <Marker
          key={property.id}
          position={[property.location.lat, property.location.lng]}
          icon={createScoreIcon(property.dealScore)}
          eventHandlers={{ click: () => onSelectProperty(property.id) }}
        >
          <Popup maxWidth={280}>
            <div className="text-sm">
              <p className="font-semibold text-gray-900 mb-1">{property.title}</p>
              <p className="text-gray-600">
                {formatPrice(property.price)} &middot; {formatAcreage(property.acreage)}
              </p>
              <p className="text-gray-500 text-xs">{formatPricePerAcre(property.pricePerAcre)}</p>
              <p className="mt-1 text-xs">
                <span className="font-medium">Score: {property.dealScore}</span>
                {' '}— {getDealScoreLabel(property.dealScore)}
              </p>
              <a
                href={property.url}
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
  );
};
