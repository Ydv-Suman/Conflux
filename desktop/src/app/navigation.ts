export type Route = '/' | '/sign-up' | '/check-email' | '/verify-email' | '/app';

export function navigate(path: Route) {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

