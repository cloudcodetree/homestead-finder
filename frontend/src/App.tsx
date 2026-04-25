import { Route, Routes } from 'react-router-dom';
import { BuildFooter } from './components/BuildFooter';
import { Dashboard } from './components/Dashboard';
import { Landing } from './components/Landing';
import { OnboardingModal } from './components/OnboardingModal';
import { ProjectDetail } from './components/ProjectDetail';
import { ProjectsIndex } from './components/ProjectsIndex';

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
        <Route path="/projects" element={<ProjectsIndex />} />
        <Route path="/project/:id" element={<ProjectDetail />} />
        <Route path="/landing" element={<Landing />} />
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
