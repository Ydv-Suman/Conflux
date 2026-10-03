export const API_URL = (
  import.meta.env.VITE_IDENTITY_API_URL ?? 'http://localhost:8080'
).replace(/\/$/, '');
export const LOGIN_PATH = import.meta.env.VITE_LOGIN_PATH ?? '/api/auth/login';
export const OAUTH_PATH = (
  import.meta.env.VITE_OAUTH_PATH ?? '/oauth2/authorization'
);
