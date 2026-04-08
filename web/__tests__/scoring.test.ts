import { describe, it, expect } from 'vitest';
import {
  getDealScoreColor,
  getDealScoreBorderColor,
  getDealScoreLabel,
  getDealScoreTextColor,
} from '@/lib/scoring';

describe('getDealScoreColor', () => {
  it('returns green for hot deals (>= 80)', () => {
    expect(getDealScoreColor(95)).toContain('green');
  });
  it('returns yellow for good deals (65-79)', () => {
    expect(getDealScoreColor(70)).toContain('yellow');
  });
  it('returns orange for fair deals (50-64)', () => {
    expect(getDealScoreColor(55)).toContain('orange');
  });
  it('returns gray for below average (<50)', () => {
    expect(getDealScoreColor(30)).toContain('gray');
  });
});

describe('getDealScoreLabel', () => {
  it('labels hot deals', () => {
    expect(getDealScoreLabel(85)).toBe('Hot Deal');
  });
  it('labels good deals', () => {
    expect(getDealScoreLabel(70)).toBe('Good Deal');
  });
  it('labels fair deals', () => {
    expect(getDealScoreLabel(55)).toBe('Fair');
  });
  it('labels below average', () => {
    expect(getDealScoreLabel(30)).toBe('Below Avg');
  });
});

describe('getDealScoreBorderColor', () => {
  it('returns appropriate border class', () => {
    expect(getDealScoreBorderColor(85)).toContain('green');
    expect(getDealScoreBorderColor(30)).toContain('gray');
  });
});
