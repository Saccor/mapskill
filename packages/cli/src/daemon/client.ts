export class DaemonRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the daemon's HTTP API with the token. Throws DaemonRequestError for non-2xx answers. */
export async function request<T>(
  info: { port: number; token: string },
  method: 'GET' | 'POST',
  pathname: string,
  body?: unknown,
  timeoutMs = 2000,
): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${info.port}${pathname}`, {
    method,
    headers: { 'x-mapskill-token': info.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  let json: T & { error?: string };
  try {
    json = (await res.json()) as T & { error?: string };
  } catch {
    throw new DaemonRequestError(res.status, res.statusText);
  }
  if (!res.ok) throw new DaemonRequestError(res.status, json.error ?? res.statusText);
  return json;
}
