type QueryValue = string | number | boolean | null | undefined;

interface RequestOptions {
  body?: unknown;
  headers?: HeadersInit;
  method?: 'DELETE' | 'GET' | 'POST' | 'PUT';
  params?: Record<string, QueryValue>;
}

interface ApiMessageLike {
  message?: string;
}

const metaEnv = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env;

const baseUrl =
  metaEnv?.VITE_METASCHEDULER_API_URL ??
  '/api';

function createUrl(target: string) {
  if (/^https?:\/\//.test(target)) {
    return new URL(target);
  }

  return new URL(target, window.location.origin);
}

function buildUrl(path: string, params?: Record<string, QueryValue>) {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = createUrl(`${normalizedBase}${normalizedPath}`);

  if (!params) {
    return url.toString();
  }

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }

    url.searchParams.set(key, String(value));
  });

  return url.toString();
}

// the API mostly returns JSON, but some errors come back as plain text
async function parseResponse<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  const text = await response.text();
  return text ? (text as T) : null;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(buildUrl(path, options.params), {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const data = await parseResponse<T | ApiMessageLike>(response);

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `Request failed with status ${response.status}`;

    throw new ApiRequestError(message, response.status, data);
  }

  return data as T;
}

export const apiClient = {
  delete: <T>(path: string, options: Omit<RequestOptions, 'method'> = {}) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  get: <T>(path: string, options: Omit<RequestOptions, 'body' | 'method'> = {}) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'body' | 'method'> = {}) =>
    request<T>(path, { ...options, body, method: 'POST' }),
  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'body' | 'method'> = {}) =>
    request<T>(path, { ...options, body, method: 'PUT' }),
};
