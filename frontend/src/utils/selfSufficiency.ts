import { Property } from '../types/property';

/**
 * Self-Sufficiency Score — the headline metric for the redesigned
 * detail page. Replaces Deal / Investment / Homestead-Fit as the
 * lead score. Asks one question: how close is this parcel to fully
 * autonomous living?
 *
 * Five weighted axes; each independently scored 0–100. Composite
 * is a weighted average. Heuristic — calibrated against the data
 * we already have stamped on each listing (geoEnrichment, features,
 * improvements, location, acreage). No new data fetches.
 */

export type AxisKey = 'food' | 'water' | 'energy' | 'shelter' | 'resilience';

export interface Axis {
  key: AxisKey;
  label: string;
  score: number;
  weight: number;
  /** One-line plain-language verdict for this axis. */
  verdict: string;
  /** Specific interventions that would lift this axis, with rough
   *  cost and score-delta. Drives the buildout-to-autonomy panel. */
  gaps: Gap[];
}

export interface Gap {
  label: string;
  costLowUsd: number;
  costHighUsd: number;
  /** Estimated score lift on this axis if executed. */
  liftPoints: number;
}

export interface SelfSufficiencyReport {
  composite: number;
  axes: Axis[];
  weakest: Axis;
  /** Total cost range to bring every axis to ≥85. */
  costToFullLowUsd: number;
  costToFullHighUsd: number;
  /** Composite if all gaps closed. */
  potentialComposite: number;
}

const AXIS_WEIGHTS: Record<AxisKey, number> = {
  food: 0.28,
  water: 0.25,
  energy: 0.20,
  shelter: 0.15,
  resilience: 0.12,
};

// ── Per-axis calculators ───────────────────────────────────────────────

const foodAxis = (p: Property): Axis => {
  const soil = p.geoEnrichment?.soil;
  const acres = p.acreage ?? 0;
  const features = new Set(p.features ?? []);
  const cap = parseInt(soil?.capabilityClass ?? '', 10) || 5;
  const capScore = ({ 1: 100, 2: 88, 3: 75, 4: 60, 5: 45, 6: 35, 7: 22, 8: 10 } as Record<number, number>)[cap] ?? 45;

  // Acreage gate: <2ac caps the food score; >20ac doesn't keep raising it
  // because the bottleneck shifts to labor / capital, not land.
  const acreFactor = Math.min(1, Math.max(0.3, acres / 5));

  let score = capScore * acreFactor;
  const drain = (soil?.drainageClass ?? '').toLowerCase();
  if (drain.includes('poorly')) score -= 10;
  if (p.geoEnrichment?.flood?.isSFHA) score -= 12;
  if (features.has('pasture')) score += 6;
  if (features.has('timber')) score += 4; // mast crops, foraging

  score = Math.max(0, Math.min(100, Math.round(score)));

  const gaps: Gap[] = [];
  if (score < 70 && cap <= 4 && acres >= 1) {
    gaps.push({
      label: 'Build raised beds + greenhouse for intensive growing',
      costLowUsd: 4_000,
      costHighUsd: 15_000,
      liftPoints: 12,
    });
  }
  if (acres >= 5 && !features.has('pasture')) {
    gaps.push({
      label: 'Establish pasture / silvopasture (seeding + fencing)',
      costLowUsd: 6_000,
      costHighUsd: 18_000,
      liftPoints: 10,
    });
  }
  if (acres >= 10) {
    gaps.push({
      label: 'Plant orchard (50 fruit/nut trees, 5-yr to bearing)',
      costLowUsd: 1_500,
      costHighUsd: 4_500,
      liftPoints: 8,
    });
  }

  const verdict =
    score >= 80 ? `Excellent food potential — ${acres.toFixed(0)}ac of class-${cap} land.` :
    score >= 60 ? `Solid for diversified food production. Best-fit: pasture + orchard + market garden.` :
    score >= 40 ? `Workable with intensive methods (raised beds, high tunnels). Calorie autonomy harder.` :
    `Limited food capacity — better as woodlot or grazing than tillage.`;

  return { key: 'food', label: 'Food', score, weight: AXIS_WEIGHTS.food, verdict, gaps };
};

const waterAxis = (p: Property): Axis => {
  const features = new Set(p.features ?? []);
  const improvements = p.improvements ?? {};
  const proximity = p.geoEnrichment?.proximity;
  const namedWater = (proximity?.namedWaterFeatures ?? []).map((s) => s.toLowerCase());
  const lat = p.location?.lat ?? 0;

  let score = 30;
  let hasWell = features.has('water_well') || !!improvements.well;
  let hasCity = !!improvements.water_city;
  if (hasWell || hasCity) score += 35;
  if (features.has('water_creek') || namedWater.some((n) => /creek|stream|run|river/.test(n))) score += 18;
  if (features.has('water_pond')) score += 10;
  // Rough catchment potential: TX Hill Country / Austin metro gets ~30in/yr.
  // 30in × 1000sqft roof = ~18k gal/yr — meaningful supplemental supply.
  // Outside the desert SW (lat 30-38, lng -103 to -114), most US is workable.
  const lng = Math.abs(p.location?.lng ?? 0);
  const desertSW = lat > 30 && lat < 38 && lng > 103 && lng < 114;
  if (!desertSW) score += 5;

  if (p.geoEnrichment?.flood?.isSFHA) score -= 8; // ironic: too much water = bad

  score = Math.max(0, Math.min(100, Math.round(score)));

  const gaps: Gap[] = [];
  if (!hasWell && !hasCity) {
    gaps.push({
      label: 'Drill well (rural TX/MO/AR typical 200–500 ft)',
      costLowUsd: 8_000,
      costHighUsd: 25_000,
      liftPoints: 30,
    });
  }
  gaps.push({
    label: 'Add 10k gal rainwater cistern + first-flush + filtration',
    costLowUsd: 6_000,
    costHighUsd: 15_000,
    liftPoints: 12,
  });
  if (!features.has('water_pond') && (p.acreage ?? 0) >= 5) {
    gaps.push({
      label: 'Excavate ~1 acre × 8 ft pond (NRCS may cost-share)',
      costLowUsd: 5_000,
      costHighUsd: 20_000,
      liftPoints: 8,
    });
  }

  const verdict =
    score >= 80 ? 'Strong water security — well + surface water on parcel.' :
    score >= 60 ? 'Workable. Diversify with rainwater catchment for resilience.' :
    score >= 40 ? 'Tight. Drilling a well is the highest-leverage move.' :
    'Major bottleneck. No on-parcel source — bring water in or punt.';

  return { key: 'water', label: 'Water', score, weight: AXIS_WEIGHTS.water, verdict, gaps };
};

const energyAxis = (p: Property): Axis => {
  const lat = Math.abs(p.location?.lat ?? 0);
  const acres = p.acreage ?? 0;
  const features = new Set(p.features ?? []);
  const improvements = p.improvements ?? {};

  // Solar baseline by latitude.
  const sunHours = lat < 32 ? 6.0 : lat < 36 ? 5.5 : lat < 40 ? 5.0 : lat < 44 ? 4.5 : 4.2;
  let score = (sunHours / 6.0) * 60; // up to 60 from solar alone

  if (features.has('timber') || (acres >= 10 && features.has('hunting'))) score += 12; // wood/biomass
  if (acres >= 1.5) score += 6; // geothermal possible
  if (features.has('water_creek') && (p.geoEnrichment?.soil?.slopePercent ?? 0) >= 5) score += 10; // hydro
  if (improvements.electric || features.has('electric')) score += 8; // grid-tie option

  score = Math.max(0, Math.min(100, Math.round(score)));

  const gaps: Gap[] = [];
  gaps.push({
    label: 'Install 10 kW grid-tied solar + battery backup',
    costLowUsd: 22_000,
    costHighUsd: 45_000,
    liftPoints: 25,
  });
  if (acres >= 1.5) {
    gaps.push({
      label: 'Geothermal heat pump (3-ton, horizontal loop)',
      costLowUsd: 18_000,
      costHighUsd: 35_000,
      liftPoints: 12,
    });
  }
  if (features.has('water_creek') && (p.geoEnrichment?.soil?.slopePercent ?? 0) >= 5) {
    gaps.push({
      label: 'Micro-hydro (year-round flow, ≥25ft head)',
      costLowUsd: 8_000,
      costHighUsd: 25_000,
      liftPoints: 8,
    });
  }

  const verdict =
    score >= 80 ? 'Energy abundance — multiple paths to full autonomy.' :
    score >= 60 ? 'Workable. Solar + battery covers it; biomass adds resilience.' :
    score >= 40 ? 'Solar-only path. Real but uncomfortable in long winter overcasts.' :
    'Marginal. Northern latitude or shaded — supplement with biomass or grid-tie.';

  return { key: 'energy', label: 'Energy', score, weight: AXIS_WEIGHTS.energy, verdict, gaps };
};

const shelterAxis = (p: Property): Axis => {
  const features = new Set(p.features ?? []);
  const improvements = p.improvements ?? {};
  const acres = p.acreage ?? 0;

  let score = 20;
  if (improvements.home || improvements.cabin) score += 50;
  else if (improvements.outbuilding || improvements.barn) score += 20;
  if (features.has('structures')) score += 10;
  if (features.has('timber') && acres >= 5) score += 15; // can mill lumber
  if (improvements.well || features.has('water_well')) score += 8;
  if (improvements.septic || features.has('septic')) score += 8;
  if (improvements.electric || features.has('electric')) score += 6;
  if (p.moveInReady) score = Math.max(score, 90);

  score = Math.max(0, Math.min(100, Math.round(score)));

  const gaps: Gap[] = [];
  if (!improvements.home && !improvements.cabin) {
    gaps.push({
      label: 'Build cabin (modest 600sqft DIY → modular turnkey)',
      costLowUsd: 30_000,
      costHighUsd: 120_000,
      liftPoints: 45,
    });
  }
  if (!improvements.septic && !features.has('septic')) {
    gaps.push({
      label: 'Conventional septic system (1k gal tank + leach field)',
      costLowUsd: 6_000,
      costHighUsd: 14_000,
      liftPoints: 8,
    });
  }
  if (!improvements.electric && !features.has('electric')) {
    gaps.push({
      label: 'Run grid power (per pole, varies by distance)',
      costLowUsd: 4_000,
      costHighUsd: 30_000,
      liftPoints: 6,
    });
  }

  const verdict =
    score >= 80 ? 'Move-in ready or close — minimal extra build needed.' :
    score >= 60 ? 'Outbuilding starting point + utilities; cabin/home is the next step.' :
    score >= 40 ? 'Bare land with utilities; substantial build ahead.' :
    'Raw land — every system from scratch.';

  return { key: 'shelter', label: 'Shelter', score, weight: AXIS_WEIGHTS.shelter, verdict, gaps };
};

const resilienceAxis = (p: Property): Axis => {
  let score = 75; // baseline assumes "no major flags"
  const flood = p.geoEnrichment?.flood;
  const features = new Set(p.features ?? []);

  if (flood?.isSFHA) score -= 30; // FEMA SFHA = 100-yr floodplain
  if (flood?.floodZone === 'X' || flood?.floodZone === 'X500') score += 5;

  // Drought proxy: arid SW interior
  const lat = p.location?.lat ?? 0;
  const lng = Math.abs(p.location?.lng ?? 0);
  if (lat > 30 && lat < 38 && lng > 103 && lng < 116) score -= 12;

  // Slope = wildfire + erosion proxy
  const slope = p.geoEnrichment?.soil?.slopePercent ?? 0;
  if (slope > 20) score -= 10;
  else if (slope > 12) score -= 5;

  // Owner type: ag exemption proxy via acreage. TX needs ≥10ac for ag-use.
  const acres = p.acreage ?? 0;
  if (acres >= 10) score += 8; // likely ag-exempt eligible
  if (features.has('no_hoa')) score += 5;

  score = Math.max(0, Math.min(100, Math.round(score)));

  const gaps: Gap[] = [];
  if (acres >= 10) {
    gaps.push({
      label: 'File for ag exemption (TX: ~80% property-tax reduction)',
      costLowUsd: 0,
      costHighUsd: 500,
      liftPoints: 8,
    });
  }
  if (slope > 12) {
    gaps.push({
      label: 'Defensible-space clearing + fire breaks',
      costLowUsd: 2_000,
      costHighUsd: 10_000,
      liftPoints: 6,
    });
  }

  const verdict =
    score >= 80 ? 'Few resilience flags — solid foundation for off-grid living.' :
    score >= 60 ? 'Manageable risks. Ag exemption + defensible space close most gaps.' :
    score >= 40 ? 'Notable flags — flood, fire, drought, or zoning limit autonomy.' :
    'High-risk parcel. Self-sufficiency fights against the land here.';

  return { key: 'resilience', label: 'Resilience', score, weight: AXIS_WEIGHTS.resilience, verdict, gaps };
};

// ── Composite ─────────────────────────────────────────────────────────

export const computeSelfSufficiency = (p: Property): SelfSufficiencyReport => {
  const axes = [foodAxis(p), waterAxis(p), energyAxis(p), shelterAxis(p), resilienceAxis(p)];
  const composite = Math.round(
    axes.reduce((sum, a) => sum + a.score * a.weight, 0),
  );
  const weakest = [...axes].sort((a, b) => a.score - b.score)[0];

  // Aggregate cost-to-full from gaps. Cap per-axis lift at gap-to-85.
  let costLow = 0;
  let costHigh = 0;
  const projectedAxes = axes.map((axis) => {
    let projected = axis.score;
    for (const gap of axis.gaps) {
      if (projected >= 85) break;
      projected = Math.min(100, projected + gap.liftPoints);
      costLow += gap.costLowUsd;
      costHigh += gap.costHighUsd;
    }
    return { ...axis, projected };
  });
  const potentialComposite = Math.round(
    projectedAxes.reduce((sum, a) => sum + a.projected * a.weight, 0),
  );

  return {
    composite,
    axes,
    weakest,
    costToFullLowUsd: costLow,
    costToFullHighUsd: costHigh,
    potentialComposite,
  };
};
