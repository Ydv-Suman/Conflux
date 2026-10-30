import { useEffect, useState } from 'react';
import { isAuthenticated, restoreSession } from './features/auth/session';
import { Login, Register, EmailStatus } from './features/auth/AuthPages';
import { Workspace } from './app/Workspace';
import { navigate, type Route } from './app/navigation';

export function App() {
  const [route, setRoute] = useState<Route>(location.pathname as Route);
  const [ready, setReady] = useState(false);
  useEffect(() => { const update = () => setRoute(location.pathname as Route); addEventListener('popstate', update); void restoreSession().finally(() => setReady(true)); return () => removeEventListener('popstate', update); }, []);
  if (!ready) return <main className="auth-page grid min-h-dvh place-items-center bg-[#f8f7f2]">Loading Conflux…</main>;
  if (route === '/app') return isAuthenticated() ? <Workspace /> : <Login onAuthenticated={() => navigate('/app')} />;
  if (isAuthenticated()) { queueMicrotask(() => navigate('/app')); return null; }
  if (route === '/sign-up') return <Register />;
  if (route === '/check-email') return <EmailStatus verify={false} />;
  if (route === '/verify-email') return <EmailStatus verify />;
  return <Login onAuthenticated={() => navigate('/app')} />;
}
