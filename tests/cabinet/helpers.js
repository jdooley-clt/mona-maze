import { expect } from '@playwright/test';

export const STRICT_POLICY = /^default-src 'none'; script-src(?: 'sha256-[A-Za-z0-9+/]{43}=')+; style-src(?: 'sha256-[A-Za-z0-9+/]{43}=')+; img-src data:; font-src data:; base-uri 'none'; form-action 'none'$/;

// Records Content Security Policy violations in every frame; a violation also fails watchHealth.
export async function watchPolicy(page) {
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      const violation = `${event.violatedDirective} blocked ${event.blockedURI} at ${event.sourceFile}:${event.lineNumber}`;
      window.__cspViolations.push(violation);
      console.error(`Content Security Policy violation: ${violation}`);
    });
  });
}

export async function expectNoViolations(scope) {
  expect(await scope.locator(':root').evaluate(() => window.__cspViolations), 'Content Security Policy violations').toEqual([]);
}

export async function expectStrictPolicy(scope) {
  await expect(scope.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', STRICT_POLICY);
  await expect(scope.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin-when-cross-origin');
}

export function watchHealth(page, origins) {
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', response => {
    if (origins.includes(new URL(response.url()).origin) && response.status() >= 400) {
      errors.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', request => {
    if (origins.includes(new URL(request.url()).origin)) failedRequests.push(request);
  });
  return () => {
    // Request failure can precede framedetached; check the final lifecycle state.
    const failures = failedRequests.filter(request => !(request.failure()?.errorText === 'net::ERR_ABORTED'
      && request.isNavigationRequest()
      && request.frame() !== page.mainFrame()
      && request.frame().isDetached()))
      .map(request => `${request.failure()?.errorText} ${request.url()}`);
    expect([...errors, ...failures], 'Uncaught errors, console errors, or missing required assets').toEqual([]);
  };
}

export async function ready(game) {
  await expect(game.locator('#play')).toBeEnabled();
  await expect(game.locator('#total')).not.toHaveText('0');
  await expect(game.locator('.error-notice')).toHaveCount(0);
  await expect.poll(() => game.locator('#scene').evaluate(canvas => new Promise(resolve => {
    requestAnimationFrame(() => {
      const gl = canvas.getContext('webgl2');
      if (!gl || gl.isContextLost()) return resolve(0);
      const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 4 * 97) {
        colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      }
      resolve(colors.size);
    });
  })), { message: 'WebGL must render a nonblank, multicolored board' }).toBeGreaterThan(20);
}

export async function start(game, keyboard = false) {
  if (keyboard) await game.locator('#stage').press('Enter');
  else await game.locator('#play').click();
  await expect(game.locator('#stage')).toHaveClass(/playing/);
  await expect(game.locator('#stage')).toBeFocused();
}

export async function moveAndCollect(page, game, key = 'ArrowUp') {
  const before = Number(await game.locator('#collected').innerText());
  await page.keyboard.down(key);
  try {
    await expect.poll(async () => Number(await game.locator('#collected').innerText())).toBeGreaterThan(before);
  } finally {
    await page.keyboard.up(key);
  }
}

export async function reachable(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  const geometry = await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return { left: box.left, right: box.right, width: innerWidth, hit: element.contains(hit) };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.hit, 'Control must not be covered or clipped').toBe(true);
}

export async function noHorizontalClipping(scope) {
  expect(await scope.locator('html').evaluate(element =>
    element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}
