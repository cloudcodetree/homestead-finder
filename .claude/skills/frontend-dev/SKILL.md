# Skill: Frontend Development

## Purpose
Build and maintain the React + TypeScript dashboard for homestead-finder.

## Stack
- **React 18** with functional components and hooks
- **TypeScript** in strict mode — no `any`
- **Tailwind CSS v3** for styling
- **Leaflet + react-leaflet** for map
- **Vite** for bundling
- **Vitest** for unit tests

## Project Structure
```
frontend/src/
├── App.tsx                    ← Router, layout shell
├── main.tsx                   ← Entry point
├── types/property.ts          ← Shared TypeScript types
├── components/
│   ├── Dashboard.tsx          ← Main layout: FilterPanel + MapView/ListView toggle
│   ├── PropertyCard.tsx       ← Card in list view
│   ├── FilterPanel.tsx        ← All filter controls
│   ├── MapView.tsx            ← Leaflet map with markers
│   ├── PropertyDetail.tsx     ← Full detail modal/page
│   └── NotificationSettings.tsx ← Email alert preferences
├── hooks/
│   ├── useProperties.ts       ← Load + filter property data
│   └── useFilters.ts          ← Filter state management
└── utils/
    ├── scoring.ts             ← Deal score color/label helpers
    └── formatters.ts          ← Price, acreage, date formatting
```

## Component Patterns

### Standard Component Structure
```tsx
// Always named exports
// Always explicit prop interfaces
// No default exports for components

interface PropertyCardProps {
  property: Property;
  onClick: (id: string) => void;
  isSelected?: boolean;
}

export const PropertyCard = ({ property, onClick, isSelected = false }: PropertyCardProps) => {
  return (
    <div
      className={`rounded-lg border p-4 cursor-pointer transition-shadow hover:shadow-md ${
        isSelected ? 'border-green-500 bg-green-50' : 'border-gray-200'
      }`}
      onClick={() => onClick(property.id)}
    >
      {/* ... */}
    </div>
  );
};
```

### Data Loading Pattern
```tsx
// hooks/useProperties.ts pattern
export const useProperties = (filters: FilterState) => {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/data/listings.json');
        if (!response.ok) throw new Error('Failed to load listings');
        const data: Property[] = await response.json();
        setProperties(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const filtered = useMemo(() => applyFilters(properties, filters), [properties, filters]);

  return { properties: filtered, loading, error, total: properties.length };
};
```

## Tailwind Conventions

### Deal Score Badge Colors
```tsx
// utils/scoring.ts
export const getDealScoreColor = (score: number): string => {
  if (score >= 80) return 'bg-green-500 text-white';
  if (score >= 65) return 'bg-yellow-400 text-gray-900';
  if (score >= 50) return 'bg-orange-400 text-white';
  return 'bg-gray-400 text-white';
};

export const getDealScoreLabel = (score: number): string => {
  if (score >= 80) return 'Hot Deal';
  if (score >= 65) return 'Good Deal';
  if (score >= 50) return 'Fair';
  return 'Below Average';
};
```

### Responsive Layout
- Mobile-first: start with mobile layout, add `md:` and `lg:` breakpoints
- Dashboard: single column on mobile, sidebar + main on `lg:`
- Map: hidden on mobile by default, shown on `md:` or via toggle

## Map Integration (Leaflet)

```tsx
// Always import Leaflet CSS in component or main.tsx
import 'leaflet/dist/leaflet.css';
// Fix default marker icons (common Leaflet+Webpack/Vite issue)
import L from 'leaflet';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});
```

## Adding a New Component
1. Create `frontend/src/components/MyComponent.tsx`
2. Define `MyComponentProps` interface at the top
3. Use Tailwind for all styling
4. Export as named export
5. Import and use in parent component
6. If it has logic, extract to a hook in `hooks/`

## Performance Guidelines
- Use `useMemo` for filtered/sorted lists (can be large)
- Use `useCallback` for handlers passed to map markers (re-renders are expensive)
- Leaflet markers: cluster when > 50 points (use `react-leaflet-cluster`)
- Virtualize the property list when > 100 items

## Testing
```bash
cd frontend
npm run test          # Run Vitest tests
npm run type-check    # tsc --noEmit
npm run lint          # ESLint
npm run build         # Production build (catches errors)
```
