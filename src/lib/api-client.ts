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
  formData?: FormData;
  signal?: AbortSignal;
  /** Request timeout in ms. Defaults to 20s so the UI never hangs forever. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Browser API client.
 *
 * A network failure (server down, connection dropped, DNS, timeout) is turned
 * into an `ApiError` with code `NETWORK` instead of leaking the browser's raw
 * `TypeError: Failed to fetch` to the UI. Callers can therefore always render a
 * friendly, localised message and a retry.
 */
export async function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = "GET", json, formData, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  if (json !== undefined && formData !== undefined) {
    throw new Error("An API request cannot send JSON and FormData together");
  }

  // Compose the caller's signal with a timeout so a hung request still settles.
  // Done with an AbortController (not AbortSignal.any) for broad browser support.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: json === undefined ? undefined : { "Content-Type": "application/json" },
      body: formData ?? (json === undefined ? undefined : JSON.stringify(json)),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (caught) {
    // A caller-initiated abort is not a network failure; re-throw it as-is.
    if (signal?.aborted) throw caught;
    throw new ApiError(
      "NETWORK",
      "Não foi possível contactar o servidor. Verifica a tua ligação e tenta novamente.",
      0,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onExternalAbort);
  }

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
