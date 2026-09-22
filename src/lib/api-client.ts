/**
 * Browser API client.
 *
 * The frontend never talks to PostgreSQL directly: every read and write goes
 * through the real HTTP API implemented in `src/app/api/**`. Cookies are sent
 * with `same-origin` credentials so the httpOnly session cookie is included.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  get isUnauthenticated(): boolean {
    return this.code === "UNAUTHENTICATED" || this.code === "SESSION_EXPIRED";
  }
}

export interface ApiRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", json, signal } = options;

  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: json === undefined ? undefined : { "Content-Type": "application/json" },
    body: json === undefined ? undefined : JSON.stringify(json),
    signal,
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } })
      ?.error;
    throw new ApiError(
      error?.code ?? "INTERNAL",
      error?.message ?? `Pedido falhou (${response.status})`,
      response.status,
      error?.details,
    );
  }

  return (payload as { data: T }).data;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Ocorreu um erro inesperado.";
}
