import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ListingsGrid } from './ListingsGrid';
import { Property } from '../../types/property';

// PropertyCard pulls hooks in (auth, savedListings, hiddenListings,
// ratings, useCountyMedians) which would force every test to mount
// the entire provider tree. The toolbar/grid wiring is what we care
// about here, so mock the card to a marker that's easy to assert on.
vi.mock('../PropertyCard', () => ({
  PropertyCard: ({
    property,
    onClick,
  }: {
    property: Property;
    onClick: (id: string) => void;
  }) => (
    <button data-testid={`card-${property.id}`} onClick={() => onClick(property.id)}>
      {property.title}
    </button>
  ),
}));

const stub = (overrides: Partial<Property>): Property =>
  ({
    id: 'a',
    title: 'A property',
    description: '',
    source: 'test',
    url: '',
    location: { lat: 0, lng: 0, state: 'MO', county: 'X', address: '' },
    price: 1,
    pricePerAcre: 1,
    acreage: 1,
    dealScore: 1,
    features: [],
    images: [],
    dateFound: '2026-01-01',
    status: 'unverified',
    ...overrides,
  }) as Property;

const wrap = (ui: React.ReactNode) => (
  <MemoryRouter>{ui}</MemoryRouter>
);

describe('ListingsGrid', () => {
  it('renders an empty state with a Clear filters CTA when properties is empty', async () => {
    const onReset = vi.fn();
    render(
      wrap(
        <ListingsGrid
          properties={[]}
          selectedId={null}
          onOpenProperty={() => {}}
          onResetFilters={onReset}
        />,
      ),
    );
    expect(screen.getByText(/No properties match/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('renders one card per property and forwards click', async () => {
    const onOpen = vi.fn();
    render(
      wrap(
        <ListingsGrid
          properties={[stub({ id: 'a' }), stub({ id: 'b' }), stub({ id: 'c' })]}
          selectedId={null}
          onOpenProperty={onOpen}
          onResetFilters={() => {}}
        />,
      ),
    );
    expect(screen.getByTestId('card-a')).toBeInTheDocument();
    expect(screen.getByTestId('card-b')).toBeInTheDocument();
    expect(screen.getByTestId('card-c')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('card-b'));
    expect(onOpen).toHaveBeenCalledWith('b');
  });
});
