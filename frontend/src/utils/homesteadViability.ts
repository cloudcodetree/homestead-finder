import { Property } from '../types/property';

/**
 * Heuristic viability + buildout-cost estimates for a parcel.
 *
 * Pure functions over the data we already have stamped on each listing
 * (geoEnrichment, features, improvements, location). Everything here
 * is a rule-of-thumb estimate — soil class is real signal but specific
 * crop and energy numbers are within ±50%. The UI labels them clearly
 * as "estimates" so users don't read precision into them.
 *
 * Wherever a signal is missing (no geoEnrichment, missing soil class,
 * etc.) the calculator returns null instead of guessing — better to
 * show "data pending" than fabricate a viability score.
 */

// ── Growing viability ────────────────────────────────────────────────

export interface GrowingViability {
  score: number; // 0-100
  band: 'excellent' | 'good' | 'workable' | 'limited';
  recommendedUses: string[];
  rationale: string;
}

export const computeGrowingViability = (p: Property): GrowingViability | null => {
  const soil = p.geoEnrichment?.soil;
  if (!soil) return null;

  // USDA capability class (non-irrigated): 1=best for cropland, 8=worst.
  // Map to a 0-100 band.
  const capClassNum = parseInt(soil.capabilityClass ?? '', 10);
  if (!capClassNum || isNaN(capClassNum)) return null;
  const capScores: Record<number, number> = {
    1: 100, 2: 85, 3: 70, 4: 55, 5: 40, 6: 30, 7: 20, 8: 10,
  };
  let score = capScores[capClassNum] ?? 50;

  // Drainage adjustment.
  const drain = (soil.drainageClass ?? '').toLowerCase();
  if (drain.includes('well drained')) score += 0;
  else if (drain.includes('moderately') || drain.includes('somewhat')) score -= 8;
  else if (drain.includes('poorly') || drain.includes('very poor')) score -= 18;

  // Slope adjustment — hard to mechanize beyond ~10%, very hard >15%.
  const slope = soil.slopePercent ?? 0;
  if (slope > 15) score -= 15;
  else if (slope > 8) score -= 8;

  // SFHA = floodplain, not great for crop infrastructure.
  if (p.geoEnrichment?.flood?.isSFHA) score -= 12;

  // Prime farmland designation is gold.
  const farm = (soil.farmlandClass ?? '').toLowerCase();
  if (farm.includes('prime farmland')) score = Math.max(score, 75);

  score = Math.max(0, Math.min(100, score));

  const band: GrowingViability['band'] =
    score >= 80 ? 'excellent' : score >= 60 ? 'good' : score >= 40 ? 'workable' : 'limited';

  const recommendedUses: string[] = [];
  if (capClassNum <= 2 && slope < 8) {
    recommendedUses.push(
      'Row crops (vegetables, grains, herbs)',
      'Market garden / CSA',
      'High-tunnel intensive growing',
    );
  }
  if (capClassNum <= 3) recommendedUses.push('Orchard (fruit + nut trees)');
  if (capClassNum <= 4) recommendedUses.push('Hay / forage production');
  if (capClassNum <= 6) recommendedUses.push('Permanent pasture / silvopasture');
  if (capClassNum >= 5) recommendedUses.push('Timber stand / managed woodland');
  if (drain.includes('poorly')) recommendedUses.push('Wetland or flooded crops (rice, cranberries)');
  if (slope > 10) recommendedUses.push('Terraced beds / contour planting');

  const rationale =
    `USDA capability class ${capClassNum} (${soil.capabilityClassDescription ?? '—'}), ` +
    `${drain || 'unknown drainage'}, ${slope.toFixed(1)}% slope. ` +
    (farm.includes('prime') ? 'Designated prime farmland. ' : '') +
    (p.geoEnrichment?.flood?.isSFHA ? 'In FEMA SFHA — limits permanent structures. ' : '');

  return { score, band, recommendedUses, rationale };
};

// ── Livestock viability ──────────────────────────────────────────────

export interface LivestockViability {
  score: number;
  recommended: Array<{ kind: string; capacity: string }>;
  rationale: string;
}

export const computeLivestockViability = (p: Property): LivestockViability | null => {
  const acres = p.acreage ?? 0;
  if (acres <= 0) return null;

  const features = new Set(p.features ?? []);
  const hasPasture = features.has('pasture');
  const hasWater = features.has('water_well') || features.has('water_creek') || features.has('water_pond');

  let score = 30;
  // Acreage drives carrying capacity.
  if (acres >= 40) score = 90;
  else if (acres >= 10) score = 75;
  else if (acres >= 3) score = 60;
  else if (acres >= 0.5) score = 45;

  if (hasPasture) score = Math.min(100, score + 10);
  if (hasWater) score = Math.min(100, score + 5);

  // Drainage / capability still matters for forage growth.
  const cap = parseInt(p.geoEnrichment?.soil?.capabilityClass ?? '', 10);
  if (cap >= 7) score -= 10;

  score = Math.max(0, Math.min(100, score));

  const recommended: LivestockViability['recommended'] = [];
  if (acres >= 0.25) {
    recommended.push({ kind: 'Backyard poultry (chickens, ducks)', capacity: '6–25 birds' });
  }
  if (acres >= 0.5) {
    recommended.push({ kind: 'Rabbits / quail', capacity: '12–40 animals' });
  }
  if (acres >= 2) {
    recommended.push({
      kind: 'Goats or sheep',
      capacity: `${Math.floor(acres / 0.5)}–${Math.floor(acres / 0.25)} head`,
    });
  }
  if (acres >= 5) {
    recommended.push({ kind: 'Hogs (pastured)', capacity: `${Math.floor(acres / 2)}–${Math.floor(acres / 1)} head` });
  }
  if (acres >= 10) {
    recommended.push({
      kind: 'Cattle (grass-fed beef or dairy)',
      capacity: `${Math.floor(acres / 4)}–${Math.floor(acres / 2)} head`,
    });
  }
  if (acres >= 20 && hasPasture) {
    recommended.push({ kind: 'Horses or working stock', capacity: `${Math.floor(acres / 5)} head comfortable` });
  }

  const rationale =
    `${acres.toFixed(1)} acres ` +
    (hasPasture ? 'with established pasture. ' : 'without pasture noted. ') +
    (hasWater ? 'On-parcel water source detected. ' : 'No on-parcel water source — bring in or drill. ');

  return { score, recommended, rationale };
};

// ── Energy systems ───────────────────────────────────────────────────

export type EnergyFeasibility = 'strong' | 'workable' | 'marginal' | 'poor';

export interface EnergyOption {
  kind: 'solar' | 'wind' | 'hydro' | 'geothermal';
  label: string;
  feasibility: EnergyFeasibility;
  /** Low-end install cost in USD. Round-of-magnitude only. */
  costLowUsd: number;
  /** High-end install cost in USD. */
  costHighUsd: number;
  rationale: string;
}

const usaSolarSunHours = (lat: number): number => {
  // Crude piecewise approximation of annual avg daily peak-sun hours
  // by latitude across the contiguous US. Real numbers from NREL run
  // 4.0 (north WA) to 6.5 (AZ desert). Good enough for ±20% sizing.
  if (lat <= 0) return 5.0;
  if (lat < 32) return 6.0;
  if (lat < 36) return 5.5;
  if (lat < 40) return 5.0;
  if (lat < 44) return 4.5;
  return 4.2;
};

export const computeEnergyOptions = (p: Property): EnergyOption[] => {
  const lat = p.location?.lat ?? 0;
  const acres = p.acreage ?? 0;
  const features = new Set(p.features ?? []);
  const proximity = p.geoEnrichment?.proximity;
  const hasOpenSky = (p.geoEnrichment?.soil?.slopePercent ?? 0) < 15; // proxy
  const namedWater = (proximity?.namedWaterFeatures ?? []).map((s) => s.toLowerCase());
  const hasFlowingWater =
    namedWater.some((n) => /creek|stream|run|river/.test(n)) ||
    features.has('water_creek');

  const opts: EnergyOption[] = [];

  // Solar — works on any parcel with reasonable sun exposure.
  // Typical homestead: 10 kW grid-tied → $25–35k turnkey.
  // Off-grid 10 kW + battery: $40–55k.
  const sunHours = usaSolarSunHours(Math.abs(lat));
  const solarFeasible: EnergyFeasibility =
    sunHours >= 5.5 && hasOpenSky ? 'strong' : sunHours >= 4.5 ? 'workable' : 'marginal';
  opts.push({
    kind: 'solar',
    label: 'Solar PV',
    feasibility: solarFeasible,
    costLowUsd: 22_000,
    costHighUsd: 55_000,
    rationale:
      `~${sunHours.toFixed(1)} peak-sun hours/day for this latitude. ` +
      `Range covers a 10 kW grid-tied install ($22–35k) up to off-grid with battery ($40–55k).`,
  });

  // Wind — really only worth it with avg ≥ 10 mph at hub height.
  // We don't have parcel-level wind data; default to "marginal" except
  // in known-windy regions (rough geography proxy).
  const windRegion =
    (lat > 35 && lat < 45 && Math.abs(p.location?.lng ?? 0) > 95 && Math.abs(p.location?.lng ?? 0) < 105) || // Plains
    (lat > 40 && lat < 47 && Math.abs(p.location?.lng ?? 0) > 105); // Northern Rockies / Dakotas
  const windFeasible: EnergyFeasibility = windRegion && acres >= 5 ? 'workable' : 'poor';
  opts.push({
    kind: 'wind',
    label: 'Small wind turbine',
    feasibility: windFeasible,
    costLowUsd: 15_000,
    costHighUsd: 65_000,
    rationale: windRegion
      ? `Plains / high-elevation region — avg wind likely ≥ 10 mph. ` +
        `Cost range covers a 5 kW (low) to 15 kW (high) tower install.`
      : `Outside the high-wind belt. Most TX/MO/AR parcels avg 6–8 mph — ` +
        `below the 10 mph threshold for cost-effective small wind.`,
  });

  // Hydro — needs flowing water with usable head.
  let hydroFeasible: EnergyFeasibility = 'poor';
  if (hasFlowingWater) {
    // Slope >= 5% near a stream is a rough proxy for usable elevation drop.
    const slope = p.geoEnrichment?.soil?.slopePercent ?? 0;
    if (slope >= 5) hydroFeasible = 'workable';
    else hydroFeasible = 'marginal';
  }
  opts.push({
    kind: 'hydro',
    label: 'Micro-hydro',
    feasibility: hydroFeasible,
    costLowUsd: 8_000,
    costHighUsd: 30_000,
    rationale: hasFlowingWater
      ? `Flowing water on or near parcel. Site-specific feasibility depends on ` +
        `flow (≥ 10 gal/min year-round) and head (≥ 25 ft). Confirm with a ` +
        `licensed installer; water rights vary by state.`
      : `No flowing-water feature detected on or near the parcel — micro-hydro ` +
        `requires a year-round creek or stream with elevation drop.`,
  });

  // Geothermal (ground-source heat pump) — works anywhere.
  // Horizontal loop: ~0.5 acre per ton; 3-ton typical residential = 1.5 ac.
  // Vertical loop: less land, more drilling cost.
  const geoFeasible: EnergyFeasibility = acres >= 1.5 ? 'strong' : 'workable';
  opts.push({
    kind: 'geothermal',
    label: 'Geothermal heat pump (GSHP)',
    feasibility: geoFeasible,
    costLowUsd: 18_000,
    costHighUsd: 35_000,
    rationale:
      acres >= 1.5
        ? `Sufficient land for a horizontal loop field (3-ton system needs ~1.5 ac). ` +
          `Cost covers loop + heat pump + indoor ductwork.`
        : `Tight on land for a horizontal loop — vertical wells push cost to upper ` +
          `end of range but eliminate the surface-area constraint.`,
  });

  return opts;
};

// ── Buildout costs (greenhouse, aquaponics, water, etc.) ────────────

export interface BuildoutItem {
  kind: 'greenhouse' | 'aquaponics' | 'well' | 'cistern' | 'pond' | 'driveway';
  label: string;
  applicable: boolean;
  costLowUsd: number;
  costHighUsd: number;
  rationale: string;
}

export const computeBuildoutOptions = (p: Property): BuildoutItem[] => {
  const features = new Set(p.features ?? []);
  const improvements = p.improvements ?? {};
  const acres = p.acreage ?? 0;
  const items: BuildoutItem[] = [];

  // Greenhouse — pretty much always feasible.
  items.push({
    kind: 'greenhouse',
    label: 'Greenhouse / high tunnel',
    applicable: true,
    costLowUsd: 4_000,
    costHighUsd: 30_000,
    rationale:
      'DIY hoop house (16×24) ≈ $4–8k. Commercial high tunnel ≈ $15–30k. ' +
      'Year-round growing in any climate; pairs with rainwater catchment for irrigation.',
  });

  // Aquaponics — needs water + electric.
  const hasElectric = features.has('electric') || improvements.electric;
  const hasWater =
    features.has('water_well') || features.has('water_creek') || features.has('water_pond') ||
    improvements.well || improvements.water_city;
  items.push({
    kind: 'aquaponics',
    label: 'Aquaponics system',
    applicable: hasElectric && hasWater,
    costLowUsd: 5_000,
    costHighUsd: 35_000,
    rationale:
      hasElectric && hasWater
        ? 'Electric + water on-parcel — feasible. Small DIY system $5–10k; ' +
          'medium 200-fish + 200 sqft beds turnkey ~$25–35k.'
        : 'Needs both reliable electric and a water source. Add those first ' +
          '(see Solar PV / Well below) before scoping aquaponics.',
  });

  // Well — only if not already present.
  const hasWell = features.has('water_well') || improvements.well;
  items.push({
    kind: 'well',
    label: 'Drilled well',
    applicable: !hasWell,
    costLowUsd: 8_000,
    costHighUsd: 30_000,
    rationale: hasWell
      ? 'Already on-parcel. No additional cost.'
      : 'Typical rural TX/MO/AR well: 200–500 ft, $8–25k including pump and ' +
        'pressure tank. Depth and aquifer vary by county; ask a local driller.',
  });

  // Cistern — always nice to have for backup.
  items.push({
    kind: 'cistern',
    label: 'Rainwater cistern (10k gal)',
    applicable: true,
    costLowUsd: 6_000,
    costHighUsd: 18_000,
    rationale:
      '10,000-gal poly tank + first-flush diverter + filtration ≈ $6–12k DIY, ' +
      '$15–18k turnkey. TX rainwater catchment is legal and tax-exempt.',
  });

  // Pond — feasibility varies; offer if no pond yet.
  const hasPond = features.has('water_pond');
  items.push({
    kind: 'pond',
    label: 'Pond (1 acre, 8 ft deep)',
    applicable: !hasPond && acres >= 3,
    costLowUsd: 5_000,
    costHighUsd: 25_000,
    rationale: hasPond
      ? 'Already has a pond.'
      : acres < 3
        ? 'Acreage tight for a meaningful pond — usually wants 3+ acres.'
        : 'Excavation + dam ≈ $3–8k per acre-foot moved. NRCS may share cost ' +
          'if the pond serves livestock or wildlife.',
  });

  return items;
};

// ── Convenience wrapper ──────────────────────────────────────────────

export interface HomesteadViabilityReport {
  growing: GrowingViability | null;
  livestock: LivestockViability | null;
  energy: EnergyOption[];
  buildout: BuildoutItem[];
}

export const computeHomesteadViability = (p: Property): HomesteadViabilityReport => ({
  growing: computeGrowingViability(p),
  livestock: computeLivestockViability(p),
  energy: computeEnergyOptions(p),
  buildout: computeBuildoutOptions(p),
});
