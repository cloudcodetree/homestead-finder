import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './hooks/useAuth';
import { HiddenListingsProvider } from './hooks/useHiddenListings';
import { ListingRatingsProvider } from './hooks/useListingRatings';
import { SavedListingsProvider } from './hooks/useSavedListings';
import { UserPreferencesProvider } from './hooks/useUserPreferences';
import './index.css';

// `import.meta.env.BASE_URL` is "/homestead-finder/" under GitHub Pages
// and "/" in dev; BrowserRouter's basename lets react-router share the
// same prefix so URLs like "/homestead-finder/p/<id>" resolve correctly.
//
// AuthProvider wraps the app so every `useAuth()` call site shares one
// Supabase subscription. Having per-component subscriptions caused
// IndexedDB lock contention warnings under Strict Mode and left sign-
// out events orphaned in some consumers.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <UserPreferencesProvider>
          <SavedListingsProvider>
            <HiddenListingsProvider>
              <ListingRatingsProvider>
                <App />
              </ListingRatingsProvider>
            </HiddenListingsProvider>
          </SavedListingsProvider>
        </UserPreferencesProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
