import { Navigate } from 'react-router-dom';

/**
 * Everyone — anonymous or signed in — lands on /browse. The Browse
 * page is the product's headline view (the actual listings + filters
 * + map), and forcing returning users through /landing or /home was
 * adding a click for no reason. Signed-in users still have direct
 * links to /home, /swipe, /projects, etc. via the account menu.
 *
 * Kept as a thin Navigate wrapper (rather than mounting Browse at
 * "/" directly) so a future cold-start state — e.g. a "what's new
 * since you last visited" banner — has a single mount point.
 */
export const RootRedirect = () => {
  return <Navigate to="/browse" replace />;
};
