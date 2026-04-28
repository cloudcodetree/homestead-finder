import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';

// Hoisted mocks — vitest hoists `vi.mock` ABOVE imports, so the
// referenced fns must exist by the time the mock runs. We use
// `vi.hoisted` to declare them safely.
const authState = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, loading: false, configured: true },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => authState.current,
}));

// AuthButton renders a popover and calls into Supabase — test-irrelevant
// here. Replace with a marker.
vi.mock('./AuthButton', () => ({
  AuthButton: () => <div data-testid="auth-button" />,
}));

const renderAt = (path: string, child: React.ReactNode = <div>page</div>) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {/* /landing must be OUTSIDE the AppShell route the same way it
            is in App.tsx — otherwise the guard's `<Navigate to="/landing"/>`
            re-enters the shell and loops. */}
        <Route path="/landing" element={<div data-testid="landing">LANDING</div>} />
        <Route element={<AppShell />}>
          <Route path="/home" element={child} />
          <Route path="/browse" element={child} />
          <Route path="/p/:id" element={child} />
          <Route path="/upgrade" element={child} />
          <Route path="/projects" element={child} />
          <Route path="/saved-searches" element={child} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('AppShell auth guard', () => {
  beforeEach(() => {
    authState.current = { user: null, loading: false, configured: true };
  });

  it('lets anonymous users see /home (public-in-shell)', () => {
    renderAt('/home', <div data-testid="home">HOME</div>);
    expect(screen.getByTestId('home')).toBeInTheDocument();
    expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
  });

  it('lets anonymous users see /p/:id (deep-linked listing)', () => {
    renderAt('/p/abc123', <div data-testid="prop">PROP</div>);
    expect(screen.getByTestId('prop')).toBeInTheDocument();
  });

  it('lets anonymous users see /upgrade (public pricing)', () => {
    renderAt('/upgrade', <div data-testid="upgrade">UPGRADE</div>);
    expect(screen.getByTestId('upgrade')).toBeInTheDocument();
  });

  it('redirects anonymous users from /browse to /landing', () => {
    renderAt('/browse', <div data-testid="browse">BROWSE</div>);
    expect(screen.getByTestId('landing')).toBeInTheDocument();
    expect(screen.queryByTestId('browse')).not.toBeInTheDocument();
  });

  it('redirects anonymous users from /projects to /landing', () => {
    renderAt('/projects', <div data-testid="projects">PROJECTS</div>);
    expect(screen.getByTestId('landing')).toBeInTheDocument();
  });

  it('redirects anonymous users from /saved-searches to /landing', () => {
    renderAt('/saved-searches', <div data-testid="ss">SS</div>);
    expect(screen.getByTestId('landing')).toBeInTheDocument();
  });

  it('lets a signed-in user see authed routes', () => {
    authState.current = { user: { id: 'u1' }, loading: false, configured: true };
    renderAt('/browse', <div data-testid="browse">BROWSE</div>);
    expect(screen.getByTestId('browse')).toBeInTheDocument();
  });

  it('renders nothing while auth is loading (no flash)', () => {
    authState.current = { user: null, loading: true, configured: true };
    const { container } = renderAt('/browse', <div data-testid="browse">BROWSE</div>);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not redirect when Supabase is unconfigured (local dev)', () => {
    authState.current = { user: null, loading: false, configured: false };
    renderAt('/browse', <div data-testid="browse">BROWSE</div>);
    // Without config we treat as anonymous BUT skip the guard so the
    // app boots without a Supabase project.
    expect(screen.getByTestId('browse')).toBeInTheDocument();
  });
});
