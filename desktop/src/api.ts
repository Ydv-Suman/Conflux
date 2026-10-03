import { API_URL } from './config';

type ErrorResponse = { message?: string };

export const post = async (path: string, body: object) => {
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.conflux+json;v=1.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ErrorResponse;
    throw new Error(error.message || `Request failed (${response.status})`);
  }
};
