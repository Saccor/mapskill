import type { GoalAnswer, LayoutFile, LocksAnswer, MapRequest, PublicGraph, RequestKind, SourceAnswer } from '@mapskill/core/client';

const TOKEN_KEY = 'mapskill-token';

/** Reads the token from ?t=, remembers it for reloads, and returns the address without it. */
export function takeToken(
  location: { search: string; pathname: string; hash: string },
  storage: Pick<Storage, 'getItem' | 'setItem'>,
): { token: string | null; cleanUrl: string | null } {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('t');
  if (fromUrl) {
    storage.setItem(TOKEN_KEY, fromUrl);
    params.delete('t');
    const rest = params.toString();
    return { token: fromUrl, cleanUrl: `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}` };
  }
  return { token: storage.getItem(TOKEN_KEY), cleanUrl: null };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Api {
  constructor(
    private readonly token: string,
    private readonly base = '',
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { 'x-mapskill-token': this.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new ApiError(res.status, json.error ?? res.statusText);
    return json;
  }

  graph = (): Promise<PublicGraph> => this.call('GET', '/api/graph');
  locks = (): Promise<LocksAnswer> => this.call('GET', '/api/locks');
  setLock = (nodeId: string, locked: boolean): Promise<LocksAnswer> => this.call('POST', '/api/locks', { nodeId, locked });
  requests = async (): Promise<MapRequest[]> => (await this.call<{ requests: MapRequest[] }>('GET', '/api/requests')).requests;
  addRequest = async (input: { kind: RequestKind; text: string; nodeId?: string; findingId?: string }): Promise<MapRequest> =>
    (await this.call<{ request: MapRequest }>('POST', '/api/requests', input)).request;
  cancelRequest = async (id: string): Promise<MapRequest[]> =>
    (await this.call<{ requests: MapRequest[] }>('POST', '/api/requests/cancel', { id })).requests;
  dismiss = async (findingId: string): Promise<void> => {
    await this.call('POST', '/api/dismiss', { findingId });
  };
  goal = (): Promise<GoalAnswer> => this.call('GET', '/api/goal');
  setGoal = (goalId: string | null): Promise<GoalAnswer> => this.call('POST', '/api/goal', { goalId });
  layout = (): Promise<LayoutFile> => this.call('GET', '/api/layout');
  saveLayout = async (slots: Record<string, number>): Promise<void> => {
    await this.call('POST', '/api/layout', { slots });
  };
  source = (file: string, start: number, end: number): Promise<SourceAnswer> =>
    this.call('GET', `/api/source?file=${encodeURIComponent(file)}&start=${start}&end=${end}`);
}
