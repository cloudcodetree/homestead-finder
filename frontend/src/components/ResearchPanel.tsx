import { ExternalResearchLinks, GeoEnrichment, PropertyLocation } from '../types/property';

interface ResearchPanelProps {
  location: PropertyLocation;
  geo?: GeoEnrichment;
  links?: ExternalResearchLinks;
}

const numberOr = (v: number | null | undefined, unit = '', digits = 0) =>
  v == null ? '—' : `${v.toFixed(digits)}${unit}`;

/**
 * Build fallback deep links to public research tools even if the scraper
 * didn't capture the exact URLs from the LandWatch detail page. All three
 * accept lat/lng directly.
 */
const buildFallbackLinks = (
  lat: number,
  lng: number
): { label: string; url: string; description: string }[] => [
  {
    label: 'AcreValue map',
    url: `https://www.acrevalue.com/map/?lat=${lat}&lng=${lng}&zoom=15`,
    description: 'Parcel info, soil productivity, crop history',
  },
  {
    label: 'USDA Web Soil Survey',
    url: `https://websoilsurvey.nrcs.usda.gov/app/WebSoilSurvey.aspx?TargetAppId=SoilWeb&latitude=${lat}&longitude=${lng}`,
    description: 'Full SSURGO soil report for this point',
  },
  {
    label: 'FEMA Flood Map',
    url: `https://msc.fema.gov/portal/search?AddressQuery=${lat},${lng}`,
    description: 'Official FEMA flood zone map',
  },
  {
    label: 'Google Maps (satellite)',
    url: `https://www.google.com/maps/@${lat},${lng},15z/data=!3m1!1e3`,
    description: 'Satellite imagery at this coordinate',
  },
  {
    label: 'First Street climate risk',
    url: `https://firststreet.org/risk-factor/${lat},${lng}`,
    description: 'Flood / fire / heat / wind projections',
  },
  {
    label: 'USGS National Map',
    url: `https://apps.nationalmap.gov/viewer/?x=${lng}&y=${lat}`,
    description: 'Topographic overlays, elevation, hydrography',
  },
];

const SoilBlock = ({ soil }: { soil: NonNullable<GeoEnrichment['soil']> }) => {
  const cap = soil.capabilityClass;
  // 1-8 where 1 is best; color by tier.
  const capColor = !cap
    ? 'bg-gray-100 text-gray-700'
    : ['1', '2'].includes(cap)
    ? 'bg-green-100 text-green-800 border-green-200'
    : ['3', '4'].includes(cap)
    ? 'bg-lime-100 text-lime-800 border-lime-200'
    : ['5', '6'].includes(cap)
    ? 'bg-amber-100 text-amber-800 border-amber-200'
    : 'bg-red-100 text-red-800 border-red-200';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Soil (USDA SSURGO)
        </h4>
        {cap && (
          <span
            className={`text-xs font-bold rounded-full px-2 py-0.5 border ${capColor}`}
            title={soil.capabilityClassDescription}
          >
            Class {cap}/8
          </span>
        )}
      </div>
      {soil.mapUnitName && (
        <p className="text-sm text-gray-800 mb-1">{soil.mapUnitName}</p>
      )}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
        {soil.farmlandClass && (
          <div>
            <span className="text-gray-400">Farmland: </span>
            {soil.farmlandClass}
          </div>
        )}
        {soil.slopePercent != null && (
          <div>
            <span className="text-gray-400">Slope: </span>
            {numberOr(soil.slopePercent, '%', 1)}
          </div>
        )}
        {soil.drainageClass && (
          <div>
            <span className="text-gray-400">Drainage: </span>
            {soil.drainageClass}
          </div>
        )}
        {soil.hydrologicGroup && (
          <div>
            <span className="text-gray-400">Hydro group: </span>
            {soil.hydrologicGroup}
          </div>
        )}
        {soil.bedrockDepthInches != null && (
          <div>
            <span className="text-gray-400">Bedrock: </span>
            {numberOr(soil.bedrockDepthInches, '″', 0)}
          </div>
        )}
        {soil.floodFrequency && (
          <div>
            <span className="text-gray-400">Flood freq: </span>
            {soil.floodFrequency}
          </div>
        )}
      </div>
      {soil.capabilityClassDescription && (
        <p className="mt-2 text-[11px] text-gray-500 italic">
          {soil.capabilityClassDescription}
        </p>
      )}
    </div>
  );
};

const FloodBlock = ({ flood }: { flood: NonNullable<GeoEnrichment['flood']> }) => {
  const isSFHA = flood.isSFHA;
  const zoneColor = isSFHA
    ? 'bg-red-100 text-red-800 border-red-200'
    : flood.floodZone === 'X'
    ? 'bg-green-100 text-green-800 border-green-200'
    : 'bg-gray-100 text-gray-700 border-gray-200';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Flood zone (FEMA)
        </h4>
        {flood.floodZone && (
          <span
            className={`text-xs font-bold rounded-full px-2 py-0.5 border ${zoneColor}`}
          >
            Zone {flood.floodZone}
          </span>
        )}
      </div>
      <p className="text-xs text-gray-600">
        {isSFHA ? (
          <>
            <strong>Inside the 100-year floodplain.</strong> Federal flood
            insurance generally required if financing.
          </>
        ) : flood.floodZone === 'X' ? (
          <>Outside mapped flood hazard areas.</>
        ) : flood.floodZone === 'D' ? (
          <>Flood hazard not yet determined for this area.</>
        ) : (
          <>FEMA zone {flood.floodZone || '—'}.</>
        )}
      </p>
      {flood.baseFloodElevation != null && (
        <p className="text-[11px] text-gray-500 mt-1">
          Base flood elevation: {flood.baseFloodElevation.toFixed(0)} ft
        </p>
      )}
    </div>
  );
};

const ElevationWatershedBlock = ({
  elevation,
  watershed,
}: {
  elevation?: GeoEnrichment['elevation'];
  watershed?: GeoEnrichment['watershed'];
}) => (
  <div className="bg-white border border-gray-200 rounded-lg p-3">
    <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
      Terrain &amp; water
    </h4>
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {elevation?.elevationFeet != null && (
        <div>
          <div className="text-gray-400">Elevation</div>
          <div className="text-gray-800 font-medium">
            {elevation.elevationFeet.toFixed(0)} ft
            <span className="text-gray-400 ml-1">
              ({elevation.elevationMeters?.toFixed(0)} m)
            </span>
          </div>
        </div>
      )}
      {watershed?.watershedName && (
        <div>
          <div className="text-gray-400">Watershed</div>
          <div className="text-gray-800 font-medium">{watershed.watershedName}</div>
          {watershed.huc12 && (
            <div className="text-[10px] text-gray-400 font-mono">HUC {watershed.huc12}</div>
          )}
        </div>
      )}
    </div>
  </div>
);

const ProximityBlock = ({
  proximity,
}: {
  proximity: NonNullable<GeoEnrichment['proximity']>;
}) => {
  const distMi = proximity.nearestTownDistanceMiles;
  // Color-code how remote this is — a homestead-specific signal
  const remoteColor =
    distMi == null
      ? 'text-gray-600'
      : distMi < 10
      ? 'text-green-700'
      : distMi < 25
      ? 'text-amber-700'
      : 'text-red-700';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
        Proximity (OpenStreetMap)
      </h4>
      <div className="space-y-2 text-xs">
        {proximity.nearestTownName && (
          <div>
            <div className="text-gray-400">Nearest town</div>
            <div className={`font-medium ${remoteColor}`}>
              {proximity.nearestTownName}
              <span className="text-gray-500 font-normal ml-1">
                ({proximity.nearestTownKind})
              </span>
              {distMi != null && (
                <span className="ml-2 font-semibold">{distMi.toFixed(0)} mi</span>
              )}
            </div>
            {proximity.nearestTownPopulation != null && (
              <div className="text-[11px] text-gray-500">
                pop. ~{proximity.nearestTownPopulation.toLocaleString()}
              </div>
            )}
          </div>
        )}
        {proximity.waterFeatureCount != null && (
          <div>
            <div className="text-gray-400">
              OSM water features within {proximity.searchRadiusMiles ?? 5} mi
            </div>
            <div className="text-gray-800 font-medium">
              {proximity.waterFeatureCount} feature
              {proximity.waterFeatureCount === 1 ? '' : 's'}
            </div>
            {proximity.namedWaterFeatures && proximity.namedWaterFeatures.length > 0 && (
              <div className="text-[11px] text-gray-500 mt-0.5">
                {proximity.namedWaterFeatures.slice(0, 5).join(' · ')}
              </div>
            )}
            {proximity.waterFeatureCount === 0 && (
              <div className="text-[11px] text-gray-500 italic mt-0.5">
                (OSM coverage is sparse in rural US — watershed and soil
                drainage above are more reliable water signals)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const ResearchPanel = ({ location, geo, links }: ResearchPanelProps) => {
  const lat = location.lat || geo?.lat;
  const lng = location.lng || geo?.lng;
  const hasCoord = lat != null && lng != null && lat !== 0 && lng !== 0;

  if (!hasCoord && !geo && !links) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-1">Parcel research</h3>
        <p className="text-xs text-gray-500">
          Coordinate data not yet scraped for this listing. Run{' '}
          <code className="px-1 bg-white rounded">
            python -m scraper.detail_fetcher
          </code>{' '}
          locally to fetch lat/lng + richer details.
        </p>
      </div>
    );
  }

  const fallbackLinks = hasCoord ? buildFallbackLinks(lat!, lng!) : [];
  // Prefer LandWatch's direct links when present — they already include
  // any applicable parcel/lot filters.
  const preferred: { label: string; url: string; description: string }[] = [];
  if (links?.acreValue)
    preferred.push({
      label: 'AcreValue (via listing)',
      url: links.acreValue,
      description: 'Parcel info, soil productivity, crop history',
    });
  if (links?.landId)
    preferred.push({
      label: 'Land id',
      url: links.landId,
      description: 'Property boundary + parcel identity',
    });
  if (links?.firstStreet)
    preferred.push({
      label: 'First Street climate risk',
      url: links.firstStreet,
      description: 'Flood / fire / heat / wind projections',
    });
  if (links?.coStar)
    preferred.push({
      label: 'CoStar',
      url: links.coStar,
      description: 'Commercial real-estate comps',
    });
  // De-dupe fallback links that are already in preferred (by label)
  const preferredLabels = new Set(preferred.map((p) => p.label.split(' ')[0]));
  const merged = [
    ...preferred,
    ...fallbackLinks.filter((f) => !preferredLabels.has(f.label.split(' ')[0])),
  ];

  return (
    <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-sky-900">Parcel research</h3>
        {hasCoord && (
          <span className="text-[10px] font-mono text-sky-700/70">
            {lat!.toFixed(4)}, {lng!.toFixed(4)}
          </span>
        )}
      </div>

      {/* Gov enrichment facts */}
      {geo?.soil && <SoilBlock soil={geo.soil} />}
      {geo?.flood && <FloodBlock flood={geo.flood} />}
      {(geo?.elevation || geo?.watershed) && (
        <ElevationWatershedBlock elevation={geo.elevation ?? undefined} watershed={geo.watershed ?? undefined} />
      )}
      {geo?.proximity && <ProximityBlock proximity={geo.proximity} />}

      {/* External research links */}
      {merged.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-sky-800 mb-2 uppercase tracking-wide">
            Explore this parcel
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {merged.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block bg-white border border-sky-100 hover:border-sky-300 rounded px-3 py-2 transition-colors"
              >
                <div className="text-sm font-medium text-sky-800">{link.label} →</div>
                <div className="text-[11px] text-gray-500">{link.description}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      {!geo && hasCoord && (
        <p className="text-[11px] text-gray-500 italic">
          Government enrichment (soil, flood, elevation, watershed) not yet
          populated. Run <code className="bg-white px-1 rounded">python -m scraper.enrich_geo</code> locally.
        </p>
      )}
    </div>
  );
};
