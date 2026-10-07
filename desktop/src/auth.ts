import { ApiError, post, request } from './api';

type TokenResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
};

export type AuthUser = {
  id: string;
  username: string;
};

export type UserProfile = {
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  username: string;
  emailVerified: boolean;
  createdAt: string;
};

let accessToken: string | null = null;
let currentUser: AuthUser | null = null;
let refreshPromise: Promise<boolean> | null = null;
let pendingLogoutToken: string | null = null;

const decodeUser = (token: string): AuthUser => {
  const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const paddedPayload = encodedPayload.padEnd(
    encodedPayload.length + ((4 - encodedPayload.length % 4) % 4),
    '=',
  );
  const payload = JSON.parse(
    decodeURIComponent(
      atob(paddedPayload)
        .split('')
        .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    ),
  ) as { sub?: string; username?: string };

  return {
    id: payload.sub ?? '',
    username: payload.username ?? 'Conflux user',
  };
};

const acceptTokens = (tokens: TokenResponse) => {
  accessToken = tokens.accessToken;
  currentUser = decodeUser(tokens.accessToken);
};

export const login = async (usernameOrEmail: string, password: string) => {
  const tokens = await post<TokenResponse>('/api/auth/login', {
    usernameOrEmail,
    password,
  });
  acceptTokens(tokens);
};

export const restoreSession = () => {
  refreshPromise ??= post<TokenResponse>('/api/auth/refresh')
    .then((tokens) => {
      acceptTokens(tokens);
      return true;
    })
    .catch(() => {
      accessToken = null;
      currentUser = null;
      return false;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
};

export const logout = async () => {
  const token = pendingLogoutToken ?? accessToken;
  accessToken = null;
  currentUser = null;
  try {
    if (!token) return;
    await post('/api/auth/logout', undefined, token);
    pendingLogoutToken = null;
  } catch (error) {
    pendingLogoutToken = token;
    throw error;
  }
};

export const getCurrentUser = () => currentUser;
export const isAuthenticated = () => accessToken !== null;

export const authenticatedPost = async <T = void>(path: string, body?: object) => {
  if (!accessToken && !(await restoreSession())) {
    throw new ApiError('Your session has expired. Please log in again.', 401, null);
  }

  try {
    return await post<T>(path, body, accessToken!);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !(await restoreSession())) {
      throw error;
    }
    return post<T>(path, body, accessToken!);
  }
};

export const authenticatedRequest = async <T = void>(
  path: string,
  method: 'GET' | 'PUT' | 'DELETE',
  body?: object,
) => {
  if (!accessToken && !(await restoreSession())) {
    throw new ApiError('Your session has expired. Please log in again.', 401, null);
  }

  try {
    return await request<T>(path, method, { body, token: accessToken! });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !(await restoreSession())) {
      throw error;
    }
    return request<T>(path, method, { body, token: accessToken! });
  }
};
