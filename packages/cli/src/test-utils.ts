import type { ServerMessage } from '@mapskill/core';
import { WebSocket } from 'ws';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `check` until it returns true. Throws after `timeoutMs`. */
export async function waitFor(check: () => boolean, timeoutMs = 5000, stepMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs} ms`);
    await sleep(stepMs);
  }
}

export interface TestClient {
  messages: ServerMessage[];
  close(): void;
}

/** Connects to the daemon's WebSocket, says hello and waits for the first graph message. */
export async function connect(info: { port: number; token: string }): Promise<TestClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws`);
  const messages: ServerMessage[] = [];
  ws.on('message', (data) => messages.push(JSON.parse(String(data)) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({ type: 'hello', token: info.token }));
  await waitFor(() => messages.some((m) => m.type === 'graph'), 30_000);
  return { messages, close: () => ws.close() };
}
