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
  const boxes = async () => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const el of await page.locator('[data-node-id]:not([data-node-id^="ghost:"])').all()) {
      const b = (await el.boundingBox())!;
      out[(await el.getAttribute('data-node-id'))!] = { x: Math.round(b.x), y: Math.round(b.y) };
    }
    return out;
  };
  // Let the first fit settle: two consecutive reads of every box must agree.
  await expect
    .poll(async () => {
      const a = JSON.stringify(await boxes());
      await page.waitForTimeout(150);
      return a === JSON.stringify(await boxes());
    }, { timeout: 10_000 })
    .toBe(true);
  const before = await boxes();
  const ghostBox = (await page.locator('[data-node-id="ghost:pricing-page"]').boundingBox())!;
  fs.mkdirSync(path.join(app.root, 'app', 'pricing'), { recursive: true });
  fs.writeFileSync(path.join(app.root, 'app', 'pricing', 'page.tsx'), 'export default function Pricing() {\n  return <main>Prices</main>;\n}\n');
  await expect(page.locator('[data-node-id="page:app/pricing/page.tsx"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-node-id="ghost:pricing-page"]')).toHaveCount(0);
  const after = await boxes();
  for (const [id, pos] of Object.entries(before)) expect(after[id], id).toEqual(pos);
  expect(after['page:app/pricing/page.tsx']).toEqual({ x: Math.round(ghostBox.x), y: Math.round(ghostBox.y) });
});

test('the goal panel takes focus when it opens, Escape closes it and returns focus to its button', async ({ page }) => {
  await page.goto(app.url);
  await page.getByLabel('Goal').selectOption('saas-auth-payments');
  const toggle = page.getByRole('button', { name: 'Show goal' });
  await toggle.click();
  const heading = page.locator('.goal-panel h2');
  await expect(heading).toBeFocused();
  await expect(page.locator('.goal-progress .sr-only')).toContainText('Goal:');
  await expect(page.locator('.goal-progress [aria-hidden="true"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.goal-panel')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Show goal' })).toBeFocused();
  await page.getByLabel('Goal').selectOption('');
  await expect(page.locator('.goal-progress')).toHaveCount(0);
});

test('Escape closes the ghost panel first and leaves the goal panel open', async ({ page }) => {
  await page.goto(app.url);
  await page.getByLabel('Goal').selectOption('saas-auth-payments');
  await page.getByRole('button', { name: 'Show goal' }).click();
  await page.locator('.goal-panel').getByRole('button', { name: 'Checkout endpoint' }).click();
  await expect(page.locator('aside.ghost-panel h2')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('aside.ghost-panel')).toHaveCount(0);
  await expect(page.locator('.goal-panel')).toBeVisible();
});
