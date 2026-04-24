import { Route, Routes } from 'react-router-dom';
import { BuildFooter } from './components/BuildFooter';
import { Dashboard } from './components/Dashboard';
import { OnboardingModal } from './components/OnboardingModal';

/**
 * Both routes render the Dashboard; the `:id?` on the property route
 * makes Dashboard render the detail overlay whenever the URL has one.
 * A separate route element isn't needed — Dashboard pulls the id from
 * useParams and stacks the PropertyDetail modal on top of whichever
 * view-mode tab the user had open.
 */
const App = () => {
  return (
    <>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/p/:id" element={<Dashboard />} />
        <Route path="*" element={<Dashboard />} />
      </Routes>
      {/* First-time user onboarding. Self-gating — no-ops when user is
          anonymous or has already completed/skipped. Lives at App root
          so it overlays every route. */}
      <OnboardingModal />
      <BuildFooter />
    </>
  );
};

export default App;
