import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryResults } from './QueryResults';
import { Property } from '../../types/property';

// Same mock shape as ListingsGrid.test — sidesteps PropertyCard's
// provider tree.
vi.mock('../PropertyCard', () => ({
  PropertyCard: ({ property }: { property: Property }) => (
    <div data-testid={`card-${property.id}`}>{property.title}</div>
  ),
}));

const stub = (id: string, title: string): Property =>
  ({
    id,
    title,
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
  }) as Property;

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

describe('QueryResults', () => {
  it('renders the question + count header', () => {
    render(
      wrap(
        <QueryResults
          result={{
            question: 'mountain creek under 30k',
            matches: [],
            totalConsidered: 1234,
            model: 'haiku',
          }}
          allProperties={[]}
          selectedId={null}
          onOpenProperty={() => {}}
        />,
      ),
    );
    expect(screen.getByText(/mountain creek under 30k/)).toBeInTheDocument();
    expect(screen.getByText(/0 of 1234/)).toBeInTheDocument();
  });

  it('shows a no-matches message when matches is empty', () => {
    render(
      wrap(
        <QueryResults
          result={{ question: 'q', matches: [], totalConsidered: 1, model: 'haiku' }}
          allProperties={[]}
          selectedId={null}
          onOpenProperty={() => {}}
        />,
      ),
    );
    expect(screen.getByText(/No listings matched/i)).toBeInTheDocument();
  });

  it('renders a card + reason per match in order', () => {
    render(
      wrap(
        <QueryResults
          result={{
            question: 'q',
            matches: [
              { id: 'b', reason: 'best fit' },
              { id: 'a', reason: 'second fit' },
            ],
            totalConsidered: 100,
            model: 'haiku',
          }}
          allProperties={[stub('a', 'A'), stub('b', 'B')]}
          selectedId={null}
          onOpenProperty={() => {}}
        />,
      ),
    );
    // Both cards present
    expect(screen.getByTestId('card-a')).toBeInTheDocument();
    expect(screen.getByTestId('card-b')).toBeInTheDocument();
    // Reasons rendered
    expect(screen.getByText(/best fit/)).toBeInTheDocument();
    expect(screen.getByText(/second fit/)).toBeInTheDocument();
    // Indices are 1-based and correspond to the order in matches
    const indices = screen.getAllByText(/^#\d+$/).map((n) => n.textContent);
    expect(indices).toEqual(['#1', '#2']);
  });

  it('skips matches that don\'t resolve in allProperties', () => {
    render(
      wrap(
        <QueryResults
          result={{
            question: 'q',
            matches: [
              { id: 'missing', reason: 'gone' },
              { id: 'a', reason: 'present' },
            ],
            totalConsidered: 2,
            model: 'haiku',
          }}
          allProperties={[stub('a', 'A')]}
          selectedId={null}
          onOpenProperty={() => {}}
        />,
      ),
    );
    expect(screen.getByTestId('card-a')).toBeInTheDocument();
    expect(screen.queryByTestId('card-missing')).not.toBeInTheDocument();
  });
});
