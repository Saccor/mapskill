import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const url = (): string => process.env.MAPSKILL_E2E_URL!;
const root = (): string => process.env.MAPSKILL_E2E_ROOT!;
const token = (): string => new URL(url()).searchParams.get('t')!;
const api = async <T>(p: string): Promise<T> => {
  const res = await fetch(new URL(p, url()), { headers: { 'x-mapskill-token': token() } });
  if (!res.ok) throw new Error(`${p} answered ${res.status}`);
  return (await res.json()) as T;
};
type Graph = { nodes: { id: string; label: string; file?: string; zone: string }[] };

async function open(page: Page): Promise<Graph> {
  await page.goto(url());
  const graph = await api<Graph>('/api/graph');
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
  return graph;
}

async function boxes(page: Page): Promise<Record<string, { x: number; y: number }>> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const el of await page.locator('[data-node-id]').all()) {
    const id = (await el.getAttribute('data-node-id'))!;
    const b = (await el.boundingBox())!;
    out[id] = { x: Math.round(b.x), y: Math.round(b.y) };
  }
  return out;
}

test('renders clean-app with every part', async ({ page }) => {
  const graph = await open(page);
  const shown = graph.nodes.filter((n) => n.zone !== 'tests');
  await expect(page.locator('[data-node-id]')).toHaveCount(shown.length);
  await expect(page.getByRole('button', { name: /^Pages/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('t')).toBeNull();
});

test('click opens the panel', async ({ page }) => {
  const graph = await open(page);
  const first = graph.nodes.find((n) => n.zone !== 'tests')!;
  await page.locator(`[data-node-id="${first.id}"]`).click();
  await expect(page.locator('aside.panel h2')).toContainText(first.label);
});

test('keyboard: Tab to a part, Enter opens the panel, Escape closes it', async ({ page }) => {
  await open(page);
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.hasAttribute('data-node-id'))) break;
  }
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-node-id'))).toBe(true);
  const partId = (await page.evaluate(() => document.activeElement?.getAttribute('data-node-id')))!;
  await page.keyboard.press('Enter');
  await expect(page.locator('aside.panel')).toBeVisible();
  // No manual focus: Escape right after Enter must close the panel and give focus back to the part.
  await page.keyboard.press('Escape');
  await expect(page.locator('aside.panel')).toHaveCount(0);
  await expect(page.locator(`[data-node-id="${partId}"]`)).toBeFocused();
});

test('a file change pulses the part and moves nothing', async ({ page }) => {
  const graph = await open(page);
  const target = graph.nodes.find((n) => n.file && n.zone !== 'tests')!;
  await page.waitForTimeout(1500); // let the first fitView settle
  const before = await boxes(page);
  fs.appendFileSync(path.join(root(), target.file!), '\n// touched by the e2e test\n');
  await expect(page.locator(`[data-node-id="${target.id}"]`)).toHaveClass(/pulsing/, { timeout: 10_000 });
  expect(await boxes(page)).toEqual(before);
});

test('existing parts keep their slots when a part is added', async ({ page }) => {
  await open(page);
  await expect.poll(async () => Object.keys((await api<{ slots: Record<string, number> }>('/api/layout')).slots).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const before = (await api<{ slots: Record<string, number> }>('/api/layout')).slots;
  fs.mkdirSync(path.join(root(), 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root(), 'lib', 'e2e-added.ts'), 'export function e2eAdded(x: number) {\n  return x + 1;\n}\n');
  const added = page.locator('[data-node-id*="lib/e2e-added.ts"]');
  await expect(added).toBeVisible({ timeout: 10_000 });
  const addedId = (await added.getAttribute('data-node-id'))!;
  await expect.poll(async () => (await api<{ slots: Record<string, number> }>('/api/layout')).slots[addedId], { timeout: 10_000 }).not.toBeUndefined();
  const after = (await api<{ slots: Record<string, number> }>('/api/layout')).slots;
  for (const [id, slot] of Object.entries(before)) {
    expect(id in after, `${id} is still saved`).toBe(true);
    expect(after[id]).toBe(slot);
  }
});

test('opening a part shows highlighted code and the page raises no CSP violations', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /content security policy/i.test(m.text())) consoleErrors.push(m.text());
  });
  const graph = await open(page);
  const withCode = graph.nodes.find((n) => n.file && n.zone !== 'tests')!;
  await page.locator(`[data-node-id="${withCode.id}"]`).click();
  await expect(page.locator('aside.panel .code .shiki')).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
