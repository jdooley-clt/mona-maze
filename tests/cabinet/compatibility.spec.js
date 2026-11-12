import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { watchHealth, watchPolicy, expectStrictPolicy, expectNoViolations, ready, start, moveAndCollect, reachable, noHorizontalClipping } from './helpers.js';

const healthChecks = new WeakMap();
test.beforeEach(async ({ page, baseURL }, testInfo) => {
  healthChecks.set(page, watchHealth(page, [baseURL]));
  await watchPolicy(page);
  await page.goto(testInfo.tags.includes('@standalone') ? '/mona-maze/' : '/arcade/');
});
test.afterEach(async ({ page }) => healthChecks.get(page)());

async function launch(page, baseURL, keyboard = false) {
  const card = page.getByRole('button', { name: "Play Mona's Merge Maze", exact: true });
  if (keyboard) {
    await card.focus();
    await page.keyboard.press('Enter');
  } else await card.click();
  const iframe = page.locator('#frame-host iframe');
  await expect(iframe).toHaveAttribute('src', `${baseURL}/mona-maze/`);
  await expect(iframe).toBeFocused();
  const response = await page.request.get(`${baseURL}/mona-maze/`);
  expect(response.ok()).toBe(true);
  expect(await response.body()).toEqual(await readFile('dist/mona-merge-maze.html'));
  const game = page.frameLocator('#frame-host iframe');
  await ready(game);
  await expectStrictPolicy(game);
  await expect(game.locator('#arcade-link')).toBeHidden();
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-pointer-lock');
  await expect(iframe).toHaveAttribute('allow', 'fullscreen; gamepad');
  return game;
}

async function standaloneBacklink(page) {
  await expect(page).toHaveURL(/\/mona-maze\/$/);
  await ready(page);
  await expectStrictPolicy(page);
  const link = page.getByRole('link', { name: 'GitHub Arcade', exact: true });
  await expect(link).toHaveAttribute('href', 'https://jdooley-clt.github.io/arcade/');
  expect(await link.getAttribute('target')).toBeNull();
  await reachable(link);
  expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await noHorizontalClipping(page);
  return link;
}

test('standalone backlink supports native keyboard navigation without gameplay shortcuts', { tag: '@standalone' }, async ({ page }) => {
  const link = await standaloneBacklink(page);
  await page.locator('.brand').focus();
  for (let index = 0; index < 20; index++) {
    await page.keyboard.press('Tab');
    if (await link.evaluate(element => element === document.activeElement)) break;
  }
  await expect(link).toBeFocused();
  expect(await link.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  for (const key of ['v', 'p', 'ArrowUp']) await page.keyboard.press(key);
  await expect(page.locator('#orbit')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#intro')).toBeVisible();
  await expect(page.locator('#stage')).not.toHaveClass(/playing/);
  await expect(page.locator('#message')).toBeHidden();
  // Keep the candidate gate offline while asserting the native navigation destination.
  await page.route('https://jdooley-clt.github.io/arcade/', route =>
    route.fulfill({ contentType: 'text/html', body: '<title>GitHub Arcade destination</title>' }));
  await link.press('Enter');
  await expect(page).toHaveURL('https://jdooley-clt.github.io/arcade/');
});

for (const keyboard of [false, true]) {
  test(`${keyboard ? 'keyboard' : 'mouse'} launch, gameplay, preferences and focus exit`, async ({ page, baseURL }) => {
    const game = await launch(page, baseURL, keyboard);
    await page.locator('#focus-button').click();
    await start(game, keyboard);
    await page.keyboard.press('Space');
    await expect(page).toHaveURL(/#game\/mona-maze$/);
    await expect(page.locator('#frame-host iframe')).toHaveCount(1);
    await moveAndCollect(page, game, keyboard ? 'w' : 'ArrowUp');
    await page.keyboard.press('v');
    await expect(game.locator('#first')).toHaveAttribute('aria-pressed', 'true');
    const directions = ['N', 'E', 'S', 'W'];
    let facing = directions.indexOf(await game.locator('#direction-label').innerText());
    for (const [key, delta] of [['a', 3], ['d', 1], ['ArrowLeft', 3], ['ArrowRight', 1]]) {
      await page.keyboard.press(key);
      facing = (facing + delta) % 4;
      await expect(game.locator('#direction-label')).toHaveText(directions[facing]);
    }
    await game.locator('#restart').click();
    await start(game);
    await page.keyboard.press('d');
    await page.keyboard.press('d');
    await expect(game.locator('#direction-label')).toHaveText('S');
    await moveAndCollect(page, game, keyboard ? 's' : 'ArrowDown');
    for (const key of ['p', 'Escape']) {
      await page.keyboard.press(key);
      await expect(game.locator('#message-title')).toHaveText('Paused.');
      await expect(game.locator('#stage')).not.toHaveClass(/playing/);
      await expect(page.locator('#focus-button')).toHaveText('Exit focus');
      await page.keyboard.press(key);
      await expect(game.locator('#stage')).toHaveClass(/playing/);
    }
    await page.keyboard.press('p');
    for (const id of ['theme', 'music', 'sound']) {
      const button = game.locator(`#${id}`);
      const pressed = await button.getAttribute('aria-pressed');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', String(pressed !== 'true'));
      if (id === 'theme') await expect(game.locator('html')).toHaveAttribute('data-theme', pressed === 'true' ? 'light' : 'dark');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', pressed);
    }
    const oldWidth = await game.locator('#scene').evaluate(canvas => canvas.width);
    await page.setViewportSize({ width: 900, height: 700 });
    await expect.poll(() => game.locator('#scene').evaluate(canvas => canvas.width)).not.toBe(oldWidth);
    await noHorizontalClipping(page);
    await noHorizontalClipping(game);
    await reachable(page.getByRole('button', { name: 'Exit focus', exact: true }));
    await page.getByRole('button', { name: 'Exit focus', exact: true }).press('Enter');
    await expect(page.locator('#cabinet')).not.toHaveClass(/is-focused/);
  });
}

test('reload, return, switch and browser navigation detach the old iframe', async ({ page, baseURL }) => {
  let game = await launch(page, baseURL);
  await start(game);
  const first = page.frames().find(frame => frame.url() === `${baseURL}/mona-maze/`);
  await page.locator('#reload-game').click();
  await expect.poll(() => first.isDetached()).toBe(true);
  game = page.frameLocator('#frame-host iframe');
  await ready(game);
  await expect(game.locator('#intro')).toBeVisible();
  await expect(game.locator('#collected')).toHaveText('0');
  const second = page.frames().find(frame => frame.url() === `${baseURL}/mona-maze/`);
  await page.locator('#return-button').click();
  await expect.poll(() => second.isDetached()).toBe(true);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: "Play Mona's Merge Maze", exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Play Mona lifecycle fixture', exact: true }).click();
  await expect(page.locator('iframe')).toHaveAttribute('src', `${baseURL}/mona-maze/?lifecycle`);
  await ready(page.frameLocator('iframe'));
  const other = page.frames().find(frame => frame.url().endsWith('?lifecycle'));
  await page.goBack();
  await expect.poll(() => other.isDetached()).toBe(true);
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.goBack();
  await ready(page.frameLocator('iframe'));
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('src', `${baseURL}/mona-maze/`);
});

test('the Content Security Policy raises no violation across launch, play, pause, preferences and return', async ({ page, baseURL }) => {
  const game = await launch(page, baseURL);
  await start(game);
  await moveAndCollect(page, game);
  await page.keyboard.press('v');
  await expect(game.locator('#first')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('p');
  await expect(game.locator('#message-title')).toHaveText('Paused.');
  for (const id of ['theme', 'theme', 'help', 'close-help']) await game.locator(`#${id}`).click();
  await expect(game.locator('#help-dialog')).toBeHidden();
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(game.locator('#stage')).not.toHaveClass(/playing/);
  await expectNoViolations(game);
  const frame = page.frames().find(frame => frame.url() === `${baseURL}/mona-maze/`);
  await page.locator('#return-button').click();
  await expect.poll(() => frame.isDetached()).toBe(true);
  await expectNoViolations(page);
});

test('the Content Security Policy blocks injected inline script and style attributes', { tag: '@standalone' }, async ({ context }) => {
  // A separate page keeps the expected violations out of the health check of the fixture page.
  const probe = await context.newPage();
  await watchPolicy(probe);
  await probe.goto('/mona-maze/');
  await ready(probe);
  const outcome = await probe.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true';
    document.head.append(script);
    const box = document.createElement('div');
    box.setAttribute('style', 'color: rgb(1, 2, 3)');
    document.body.append(box);
    const attribute = getComputedStyle(box).color;
    box.style.color = 'rgb(4, 5, 6)';
    return { injected: window.__injected === true, attribute, cssom: getComputedStyle(box).color };
  });
  expect(outcome.injected, 'inline script must not execute').toBe(false);
  expect(outcome.attribute, 'style attributes must be ignored').not.toBe('rgb(1, 2, 3)');
  expect(outcome.cssom, 'CSSOM updates used by the game must keep working').toBe('rgb(4, 5, 6)');
  expect(await probe.evaluate(() => window.__cspViolations)).toEqual([
    expect.stringMatching(/^script-src-elem blocked inline/),
    expect.stringMatching(/^style-src-attr blocked inline/),
  ]);
  await probe.close();
});

for (const width of [320, 390]) {
  test.describe(`touch ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    test('full document controls remain reachable in cabinet and focus mode', async ({ page, baseURL }) => {
      const game = await launch(page, baseURL);
      await noHorizontalClipping(page);
      await noHorizontalClipping(game);
      await page.locator('#focus-button').tap();
      await game.locator('#play').tap();
      await expect(game.locator('#stage')).toHaveClass(/playing/);
      const before = Number(await game.locator('#collected').innerText());
      await game.getByRole('button', { name: 'Move up or forward', exact: true }).tap();
      await expect.poll(async () => Number(await game.locator('#collected').innerText())).toBeGreaterThan(before);
      await game.locator('#first').tap();
      for (const direction of ['1', '2', '3', '0']) await reachable(game.locator(`[data-dir="${direction}"]`));
      const oldDirection = await game.locator('#direction-label').innerText();
      await game.locator('[data-dir="1"]').tap();
      await expect(game.locator('#direction-label')).not.toHaveText(oldDirection);
      for (const id of ['theme', 'music', 'sound', 'help', 'orbit', 'first', 'new-run', 'restart', 'pause']) {
        await reachable(game.locator(`#${id}`));
      }
      await reachable(game.locator('#minimap'));
      await noHorizontalClipping(page);
      await noHorizontalClipping(game);
      await reachable(page.locator('#focus-button'));
      await page.locator('#focus-button').tap();
      await expect(page.locator('#cabinet')).not.toHaveClass(/is-focused/);
      for (const id of ['return-button', 'reload-game', 'open-game', 'guide-toggle', 'enter-game', 'focus-button', 'fullscreen-button']) {
        await reachable(page.locator(`#${id}`));
      }
    });
    test('standalone backlink supports touch navigation without horizontal overflow', { tag: '@standalone' }, async ({ page }) => {
      const link = await standaloneBacklink(page);
      await page.route('https://jdooley-clt.github.io/arcade/', route =>
        route.fulfill({ contentType: 'text/html', body: '<title>GitHub Arcade destination</title>' }));
      await link.tap();
      await expect(page).toHaveURL('https://jdooley-clt.github.io/arcade/');
    });
  });
}
