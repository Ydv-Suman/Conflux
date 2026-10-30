export const messageFor = (error: unknown, fallback: string) => error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
