import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { watchHealth, ready, start, moveAndCollect } from './helpers.js';

const gameURL = 'https://jdooley-clt.github.io/mona-maze/';
const cabinetURL = 'https://jdooley-clt.github.io/arcade/#game/mona-maze';

async function publishedIdentity(response) {
  expect(response?.ok(), 'Published game must respond successfully').toBe(true);
  if (process.env.EXPECTED_GAME_SHA256) {
    expect(createHash('sha256').update(await response.body()).digest('hex'),
      'Pages must serve the exact compatibility-tested build, not stale HTML')
      .toBe(process.env.EXPECTED_GAME_SHA256);
  }
}

test('published game starts directly and inside the production cabinet', async ({ page }) => {
  const health = watchHealth(page, ['https://jdooley-clt.github.io']);
  await publishedIdentity(await page.goto(gameURL));
  await ready(page);
  await start(page);
  await moveAndCollect(page, page);
  const gameResponse = page.waitForResponse(response => response.url() === gameURL
    && response.request().isNavigationRequest());
  await page.goto(cabinetURL);
  await publishedIdentity(await gameResponse);
  await expect(page.locator('#frame-host iframe')).toHaveAttribute('src', gameURL);
  const game = page.frameLocator('#frame-host iframe');
  await ready(game);
  await page.locator('#focus-button').click();
  await start(game);
  await page.keyboard.press('Space');
  await expect(page).toHaveURL(cabinetURL);
  await moveAndCollect(page, game);
  await page.keyboard.press('v');
  await expect(game.locator('#first')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('p');
  await expect(game.locator('#message-title')).toHaveText('Paused.');
  health();
});
