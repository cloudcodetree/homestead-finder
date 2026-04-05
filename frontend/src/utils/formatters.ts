export const formatPrice = (price: number): string => {
  if (price >= 1_000_000) {
    return `$${(price / 1_000_000).toFixed(1)}M`;
  }
  if (price >= 1_000) {
    return `$${(price / 1_000).toFixed(0)}k`;
  }
  return `$${price.toLocaleString()}`;
};

export const formatPricePerAcre = (pricePerAcre: number): string => {
  if (pricePerAcre <= 0) return '';
  return `$${Math.round(pricePerAcre).toLocaleString()}/ac`;
};

export const formatAcreage = (acreage: number): string => {
  if (acreage <= 0) return '';
  if (acreage >= 1000) {
    return `${(acreage / 1000).toFixed(1)}k acres`;
  }
  return `${acreage % 1 === 0 ? acreage : acreage.toFixed(1)} acres`;
};

export const formatDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const formatDaysAgo = (isoDate: string): string => {
  const date = new Date(isoDate);
  const now = new Date();
  const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
};

export const formatSourceName = (source: string): string => {
  const names: Record<string, string> = {
    landwatch: 'LandWatch',
    lands_of_america: 'Lands of America',
    zillow: 'Zillow',
    realtor: 'Realtor.com',
    county_tax: 'County Tax Sale',
    govease: 'GovEase Tax Sale',
    auction: 'Auction',
    blm: 'BLM/USDA',
  };
  return names[source] ?? source;
};
