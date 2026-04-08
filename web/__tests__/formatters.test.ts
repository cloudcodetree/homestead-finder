import { describe, it, expect } from 'vitest';
import {
  formatPrice,
  formatPricePerAcre,
  formatAcreage,
  formatDate,
  formatDaysAgo,
  formatSourceName,
} from '@/lib/formatters';

describe('formatPrice', () => {
  it('formats millions', () => {
    expect(formatPrice(2_500_000)).toBe('$2.5M');
  });
  it('formats thousands', () => {
    expect(formatPrice(50_000)).toBe('$50k');
  });
  it('formats small values with comma', () => {
    expect(formatPrice(500)).toBe('$500');
  });
});

describe('formatPricePerAcre', () => {
  it('formats positive per-acre value', () => {
    expect(formatPricePerAcre(1234)).toBe('$1,234/ac');
  });
  it('returns empty string for zero or negative', () => {
    expect(formatPricePerAcre(0)).toBe('');
    expect(formatPricePerAcre(-10)).toBe('');
  });
});

describe('formatAcreage', () => {
  it('returns empty string for zero acres', () => {
    expect(formatAcreage(0)).toBe('');
  });
  it('formats thousands as k acres', () => {
    expect(formatAcreage(1500)).toBe('1.5k acres');
  });
  it('formats whole acres without decimals', () => {
    expect(formatAcreage(40)).toBe('40 acres');
  });
  it('formats fractional acres with one decimal', () => {
    expect(formatAcreage(2.5)).toBe('2.5 acres');
  });
});

describe('formatDate', () => {
  it('formats ISO date to readable format', () => {
    const result = formatDate('2026-04-07');
    expect(result).toMatch(/Apr \d+, 2026/);
  });
});

describe('formatDaysAgo', () => {
  it('returns "Today" for same-day dates', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(formatDaysAgo(today)).toBe('Today');
  });
});

describe('formatSourceName', () => {
  it('maps known source to display name', () => {
    expect(formatSourceName('govease')).toBe('GovEase Tax Sale');
    expect(formatSourceName('landwatch')).toBe('LandWatch');
  });
  it('returns original for unknown source', () => {
    expect(formatSourceName('unknown')).toBe('unknown');
  });
});
