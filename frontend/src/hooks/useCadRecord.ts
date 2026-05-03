import { useEffect, useState } from 'react';
import { useJsonAsset } from './useJsonAsset';

/**
 * County Appraisal District record stamped onto a listing by the
 * `cad_join.py` pass — the small fields the detail panel surfaces.
 * Keep this in sync with `slimRec` in `scraper/cad_join.py`.
 */
export interface CadRecord {
  geoId: string;
  propId?: number;
  owner?: string;
  acreage?: number | null;
  lastDeedDate?: string | null;
  appraisedValue?: number;
  assessedValue?: number;
  landValue?: number;
  improvementValue?: number;
  city?: string;
  zip?: string;
  valYear?: number;
  situs?: string;
}

type CadJoined = Record<string, CadRecord>;

const isEmpty = (d: CadJoined) => Object.keys(d).length === 0;

const loadFallback = async (): Promise<{ default: CadJoined }> => ({
  default: {} as CadJoined,
});

/**
 * Load the per-listing CAD-record map. The full join is done offline
 * by `python -m scraper.cad_join` and committed to `data/cad_joined.json`.
 *
 * Currently only Travis County has a join file (each county needs its
 * own bulk-export parser + ArcGIS layer). Listings outside Travis or
 * without coords return null cleanly.
 */
export const useCadRecord = (listingId: string | undefined): CadRecord | null => {
  const { data } = useJsonAsset<CadJoined>({
    assetPath: 'data/cad_joined.json',
    loadFallback,
    isEmpty,
  });
  const [rec, setRec] = useState<CadRecord | null>(null);
  useEffect(() => {
    if (!listingId || !data) {
      setRec(null);
      return;
    }
    setRec(data[listingId] ?? null);
  }, [listingId, data]);
  return rec;
};
