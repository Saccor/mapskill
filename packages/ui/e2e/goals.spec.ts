import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { cli, startCopy } from './global-setup';

test.describe.configure({ mode: 'serial' });

let app: ReturnType<typeof startCopy>;
test.beforeAll(() => {
  app = startCopy('half-saas');
});
test.afterAll(() => app?.stop());

const MISSING = ['ghost:pricing-page', 'ghost:checkout', 'ghost:webhook', 'ghost:subscriptions-table'];

test('the SaaS goal shows the four missing parts as ghosts, and Build reaches Claude', async ({ page }) => {
  await page.goto(app.url);
  await expect(page.locator('[data-node-id]').first()).toBeVisible();
  await page.getByLabel('Goal').selectOption('saas-auth-payments');
  for (const id of MISSING) await expect(page.locator(`[data-node-id="${id}"]`)).toBeVisible();
  await expect(page.locator('[data-node-id^="ghost:"]')).toHaveCount(4);
  await expect(page.locator('[data-node-id="ghost:checkout"]')).toHaveAttribute('aria-label', /Missing/);

  await page.locator('[data-node-id="ghost:checkout"]').click();
  await expect(page.locator('aside.panel')).toContainText('app/api/checkout/route.ts');
  await page.getByRole('button', { name: 'Build with Claude' }).click();
  await expect(page.getByText(/1 waiting/)).toBeVisible();

  const hook = cli(['hook', 'user-prompt-submit'], { CLAUDE_PROJECT_DIR: app.root }, JSON.stringify({ session_id: 's', cwd: app.root }));
  expect(hook.status).toBe(0);
  const out = JSON.parse(hook.stdout) as { hookSpecificOutput: { additionalContext: string } };
  expect(out.hookSpecificOutput.additionalContext).toContain('Add Checkout endpoint');
  expect(out.hookSpecificOutput.additionalContext).toContain('Suggested place: app/api/checkout/route.ts.');
});

test('building a missing part turns its ghost into a real part without moving the others', async ({ page }) => {
  await page.goto(app.url);
  await expect(page.locator('[data-node-id="ghost:pricing-page"]')).toBeVisible(); // the goal is remembered in .mapskill/goal.yaml
  await page.waitForTimeout(1500); // let the first fit settle
  const boxes = async () => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const el of await page.locator('[data-node-id]:not([data-node-id^="ghost:"])').all()) {
      const b = (await el.boundingBox())!;
      out[(await el.getAttribute('data-node-id'))!] = { x: Math.round(b.x), y: Math.round(b.y) };
    }
    return out;
  };
  const before = await boxes();
  fs.mkdirSync(path.join(app.root, 'app', 'pricing'), { recursive: true });
  fs.writeFileSync(path.join(app.root, 'app', 'pricing', 'page.tsx'), 'export default function Pricing() {\n  return <main>Prices</main>;\n}\n');
  await expect(page.locator('[data-node-id="page:app/pricing/page.tsx"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-node-id="ghost:pricing-page"]')).toHaveCount(0);
  const after = await boxes();
  for (const [id, pos] of Object.entries(before)) expect(after[id], id).toEqual(pos);
});
