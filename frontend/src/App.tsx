import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { BuildFooter } from './components/BuildFooter';
import { Landing } from './components/Landing';
import { RootRedirect } from './components/RootRedirect';

// Eager: AppShell, Landing, BuildFooter, RootRedirect.
// Everything below is loaded only when its route is visited, so
// `/landing` (the public marketing page — first thing anonymous
// visitors see) doesn't pull Dashboard, MapView, ProjectDetail,
// etc. into the initial bundle. Vite/Rollup creates a separate
// chunk per `import()` call.
const Dashboard = lazy(() =>
  import('./components/Dashboard').then((m) => ({ default: m.Dashboard })),
);
const HomeFeed = lazy(() =>
  import('./components/HomeFeed').then((m) => ({ default: m.HomeFeed })),
);
const SwipeView = lazy(() =>
  import('./components/SwipeView').then((m) => ({ default: m.SwipeView })),
);
const ProjectsIndex = lazy(() =>
  import('./components/ProjectsIndex').then((m) => ({ default: m.ProjectsIndex })),
);
const ProjectDetail = lazy(() =>
  import('./components/ProjectDetail').then((m) => ({ default: m.ProjectDetail })),
);
const AIPromptsPage = lazy(() =>
  import('./components/pages/AIPromptsPage').then((m) => ({ default: m.AIPromptsPage })),
);
const NotificationsPage = lazy(() =>
  import('./components/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })),
);
const OnboardingPage = lazy(() =>
  import('./components/pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
);
const PropertyDetailPage = lazy(() =>
  import('./components/pages/PropertyDetailPage').then((m) => ({ default: m.PropertyDetailPage })),
);
const SavedSearchesPage = lazy(() =>
  import('./components/pages/SavedSearchesPage').then((m) => ({ default: m.SavedSearchesPage })),
);
const UpgradePage = lazy(() =>
  import('./components/pages/UpgradePage').then((m) => ({ default: m.UpgradePage })),
);
// Preview: persona-targeted redesign of the property-detail page.
// Mounted at /preview/redesigned-detail/:id? for visual review before
// rolling phases of the redesign into the production /p/:id route.
const RedesignedDetailPreview = lazy(() =>
  import('./components/preview/RedesignedDetailPreview').then((m) => ({
    default: m.RedesignedDetailPreview,
  })),
);
// Preview: site-wide redesign — Browse with Self-Sufficiency-led
// cards + redesigned filter panel + redesigned nav grouping.
const RedesignedBrowsePreview = lazy(() =>
  import('./components/preview/RedesignedBrowsePreview').then((m) => ({
    default: m.RedesignedBrowsePreview,
  })),
);
// Preview: side-by-side comparison table — closes the "no compare"
// gap from the persona critique.
const ComparePreview = lazy(() =>
  import('./components/preview/ComparePreview').then((m) => ({
    default: m.ComparePreview,
  })),
);

// First-time-user onboarding self-gates on auth + completion-stamp.
// Lazy because anonymous visitors and returning users both never
// render its body — no need to ship it in the initial chunk.
const OnboardingModal = lazy(() =>
  import('./components/OnboardingModal').then((m) => ({ default: m.OnboardingModal })),
);

const RouteFallback = () => (
  <div className="flex items-center justify-center h-full p-10">
    <div className="inline-block w-6 h-6 border-2 border-gray-200 border-t-green-600 rounded-full animate-spin" />
  </div>
);

/**
 * App routing.
 *
 * - `/landing` and `/onboarding` render outside `AppShell` — both
 *   are full-screen flows that own their own chrome.
 * - Everything else is wrapped by `AppShell`, which provides the
 *   persistent top bar + collapsible left rail.
 * - `/` is a redirect: signed-in users get the personalized home
 *   feed, anonymous users get the marketing landing page.
 *
 * `OnboardingModal` still mounts at App root so first-time-user
 * gating can fire on any page (it self-gates via auth + completion
 * stamp). `OnboardingPage` is the page-mode version, opened from
 * the account menu so users can revise answers at a real URL.
 */
const App = () => {
  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          {/* Public, no shell */}
          <Route path="/landing" element={<Landing />} />
          <Route path="/onboarding" element={<OnboardingPage />} />

          {/* Authed/in-shell routes */}
          <Route element={<AppShell />}>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/browse" element={<Dashboard />} />
            <Route path="/home" element={<HomeFeed />} />
            <Route path="/swipe" element={<SwipeView />} />
            <Route path="/projects" element={<ProjectsIndex />} />
            <Route path="/project/:id" element={<ProjectDetail />} />
            <Route path="/p/:id" element={<PropertyDetailPage />} />
            <Route
              path="/preview/redesigned-detail/:id?"
              element={<RedesignedDetailPreview />}
            />
            <Route
              path="/preview/redesigned-browse"
              element={<RedesignedBrowsePreview />}
            />
            <Route path="/preview/compare" element={<ComparePreview />} />
            <Route path="/upgrade" element={<UpgradePage />} />
            <Route path="/saved-searches" element={<SavedSearchesPage />} />
            <Route path="/settings/notifications" element={<NotificationsPage />} />
            <Route path="/settings/ai-prompts" element={<AIPromptsPage />} />
            {/* Unknown URL — bounce to /home (signed-in) or /landing
                (anonymous). Prevents anonymous visitors from landing on
                the bare Dashboard via a typo or stale share link. */}
            <Route path="*" element={<RootRedirect />} />
          </Route>
        </Routes>
      </Suspense>
      <Suspense fallback={null}>
        <OnboardingModal />
      </Suspense>
      <BuildFooter />
    </>
  );
};

export default App;
