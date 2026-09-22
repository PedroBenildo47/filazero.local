/**
 * Minimal HTTP client with a cookie jar, used by the API test suite.
 * Node's fetch does not persist cookies, so they are tracked manually.
 */

export interface ApiResult<T> {
  status: number;
  data: T | null;
  error: { code: string; message: string } | null;
  headers: Headers;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE" | "OPTIONS";
  json?: unknown;
  signal?: AbortSignal;
  /** Extra request headers (e.g. `Origin` for the CORS tests). */
  headers?: Record<string, string>;
  /**
   * Sends this exact string as the body (no re-serialisation). Required when the
   * bytes are signed, e.g. the payment webhook.
   */
  rawBody?: string;
}

export class ApiClient {
  private readonly cookies = new Map<string, string>();

  constructor(private readonly baseUrl: string) {}

  cookieHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  hasSessionCookie(): boolean {
    return this.cookies.has("filazero_session");
  }

  private storeCookies(response: Response): void {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    for (const cookie of setCookies) {
      const pair = cookie.split(";")[0];
      if (!pair) continue;
      const separator = pair.indexOf("=");
      if (separator === -1) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...options.headers };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    if (options.json !== undefined || options.rawBody !== undefined) {
      headers["content-type"] = "application/json";
    }

    const requestBody =
      options.rawBody !== undefined
        ? options.rawBody
        : options.json === undefined
          ? undefined
          : JSON.stringify(options.json);

    const response = await fetch(new URL(path, this.baseUrl), {
      method: options.method ?? "GET",
      headers,
      body: requestBody,
      signal: options.signal,
      redirect: "manual",
    });

    this.storeCookies(response);

    const text = await response.text();
    let body: { data?: T; error?: { code: string; message: string } } | null = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    return {
      status: response.status,
      data: (body?.data ?? null) as T | null,
      error: body?.error ?? null,
      headers: response.headers,
    };
  }

  get<T>(path: string) {
    return this.request<T>(path);
  }
  post<T>(path: string, json?: unknown) {
    return this.request<T>(path, { method: "POST", json });
  }
  patch<T>(path: string, json?: unknown) {
    return this.request<T>(path, { method: "PATCH", json });
  }
  del<T>(path: string) {
    return this.request<T>(path, { method: "DELETE" });
  }
}
