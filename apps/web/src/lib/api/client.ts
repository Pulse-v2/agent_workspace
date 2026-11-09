/** Browser-side helper for the app's JSON API ({ data, meta } / { error }). */
export class ApiClientError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ApiClientError";
  }
}

type Envelope<T> = { data: T; meta?: Record<string, unknown> };

export async function apiFetch<T>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<Envelope<T>> {
  const { json, headers, ...rest } = init;
  const response = await fetch(url, {
    ...rest,
    headers: { ...(json === undefined ? {} : { "content-type": "application/json" }), ...headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(response.status, error?.code ?? "unknown", error?.message ?? "The request failed. Please try again.", error?.details);
  }
  return payload as Envelope<T>;
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}
