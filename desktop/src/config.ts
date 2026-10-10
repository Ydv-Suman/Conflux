export const API_URL = (
  import.meta.env.VITE_IDENTITY_API_URL ?? 'http://localhost:8080'
).replace(/\/$/, '');
export const WORKSPACE_API_URL = (
  import.meta.env.VITE_WORKSPACE_API_URL ?? 'http://localhost:9000'
).replace(/\/$/, '');
export const OAUTH_PATH = (
  import.meta.env.VITE_OAUTH_PATH ?? '/oauth2/authorization'
);
