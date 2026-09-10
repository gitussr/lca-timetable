/**
 * Browser-side API client.
 *
 * One place that understands the server's error envelope, so no component
 * hand-rolls status handling. The three cases that matter are distinguished by
 * status, because they need genuinely different UI: a 409 carries the winning
 * server state to re-apply against (§24), a 400 carries per-field messages
 * (§28), and a 403 means the optimistic change must be rolled back entirely
 * (§8 — the server, not the hidden button, is the authority).
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      /** Short, already human-readable. Safe to show as-is (§43). */
      error: string;
      detail?: string;
      /** 400 only: field name → message. */
      fields?: Record<string, string>;
      /** 409 only: the current server state that beat us. */
      current?: unknown;
    };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    // Offline, DNS, connection reset — never surface the raw exception (§43).
    return {
      ok: false,
      status: 0,
      error: 'No connection',
      detail: 'The change was not saved. Check your connection and try again.',
    };
  }

  if (res.status === 204) return { ok: true, data: undefined as T };

  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    /* an HTML error page, say */
  }

  if (res.ok) return { ok: true, data: payload as T };

  // A session that expired mid-edit lands here; the page reload gets a login (§43).
  if (res.status === 401) {
    return {
      ok: false,
      status: 401,
      error: 'Signed out',
      detail: 'Your session ended. Reload the page to sign in again.',
    };
  }

  return {
    ok: false,
    status: res.status,
    error: typeof payload.error === 'string' ? payload.error : 'Could not save',
    detail: typeof payload.detail === 'string' ? payload.detail : undefined,
    fields: payload.fields as Record<string, string> | undefined,
    current: payload.current,
  };
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T,>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
};

/** Collapses an ApiResult failure into one line for a status message. */
export function describe(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (result.fields) {
    const first = Object.values(result.fields)[0];
    if (first) return first;
  }
  return result.detail ?? result.error;
}
