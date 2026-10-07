import { API_URL } from './config';

type ErrorResponse = { message?: string };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: number | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestOptions = {
  body?: object;
  token?: string;
};

export const request = async <T = void>(
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  options: RequestOptions = {},
): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/vnd.conflux+json;v=1.0',
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ErrorResponse;
    const retryAfterHeader = response.headers.get('Retry-After');
    const retryAfter = retryAfterHeader === null ? null : Number(retryAfterHeader);
    throw new ApiError(
      error.message || `Request failed (${response.status})`,
      response.status,
      retryAfter !== null && Number.isFinite(retryAfter) ? retryAfter : null,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const post = <T = void>(path: string, body?: object, token?: string) =>
  request<T>(path, 'POST', { body, token });
