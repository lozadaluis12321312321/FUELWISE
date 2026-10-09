import { test, expect } from '@playwright/test';

async function navigate(page, name) {
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name, exact: true }).click();
}

test('regression: a reserve above 25 percent still triggers a warning', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Vehicle');
  await page.getByLabel('Safety reserve (%)').fill('50');
  await page.getByLabel('Fuel left (L)').fill('15');
  await expect(page.locator('#lowFuelBanner')).toBeVisible();
  await expect(page.locator('#lowFuelBanner')).toContainText('Fuel critical');
});

test('regression: historical fill-ups do not update present fuel or prices', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Activity');
  await page.getByLabel('Fill-up date').fill('2020-01-01');
  await page.getByLabel('Odometer in kilometers').fill('1000');
  await page.getByLabel('Liters purchased').fill('30');
  await page.getByLabel('Fill-up price per liter').fill('0.50');
  await page.getByLabel('Fill-up station').selectOption({ label: 'QuickFuel (corner)' });
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await expect(page.locator('#logBody')).toContainText('2020-01-01');
  await navigate(page, 'Vehicle');
  await expect(page.getByLabel('Fuel left (L)')).toHaveValue('5');
  await navigate(page, 'Stations');
  await expect(page.locator('#stationList li').filter({ hasText: 'QuickFuel' })).toContainText('$1.89/L');
});

test('regression: estimated arrival on empty is not recommended', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Vehicle');
  await page.getByLabel('Efficiency (km/L)').fill('8');
  await page.getByLabel('Fuel left (L)').fill('0.1');
  await navigate(page, 'Overview');
  await expect(page.locator('#recommendation')).toContainText('No station in range');
});

test('monochrome themes follow the device and persist a manual choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.logo')).toHaveAttribute('src', 'logo.svg');
  await expect(page.locator('.logo')).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f7f7f7');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#111111');
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Switch to light mode' }).click();
    for (const name of ['Overview', 'Stations', 'Vehicle', 'Activity']) {
      await navigate(page, name);
      await page.setViewportSize({ width: 320, height: 720 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const colored = await page.evaluate(() => [...document.querySelectorAll('body, header, nav, button, input, select, .card, .banner, .stat, .tag, .range-summary')].flatMap(el => {
        const style = getComputedStyle(el);
        return ['color', 'backgroundColor', 'borderTopColor'].filter(property => {
          const channels = style[property].match(/[\d.]+/g)?.map(Number);
          return channels && channels[3] !== 0 && (channels[0] !== channels[1] || channels[1] !== channels[2]);
        }).map(property => `${el.tagName}.${el.className}: ${property}=${style[property]}`);
      }));
      expect(colored).toEqual([]);
    }
  }
});

test('mobile navigation, persistent edits, and touch layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#recommendation')).toContainText('BudgetGas');
  await expect(page.locator('#vehicleCard')).toBeHidden();
  await navigate(page, 'Vehicle');
  await page.getByLabel('Fuel left (L)').fill('8');
  await page.reload();
  await navigate(page, 'Vehicle');
  await expect(page.getByLabel('Fuel left (L)')).toHaveValue('8');
  await navigate(page, 'Stations');
  await page.getByLabel('Station name', { exact: true }).fill('Test Fuel');
  await page.getByLabel('Price per liter', { exact: true }).fill('1.20');
  await page.getByLabel('Distance in kilometers').fill('1');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('#stationList')).toContainText('Test Fuel');
  await navigate(page, 'Overview');
  await expect(page.locator('#recommendation .winner')).toContainText('Test Fuel');
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await navigate(page, 'Activity');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('out-of-range stations do not suggest continuing to drive', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Vehicle');
  await page.getByLabel('Fuel left (L)').fill('0');
  await navigate(page, 'Overview');
  await expect(page.locator('#recommendation')).toContainText('No station in range');
  await expect(page.locator('#recommendation')).toContainText('roadside assistance');
  await expect(page.locator('#recommendation')).not.toContainText('Head to the closest');
});

test('full-tank logs calculate learned efficiency', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Activity');
  for (const odometer of ['1000', '1400']) {
    await page.getByLabel('Odometer in kilometers').fill(odometer);
    await page.getByLabel('Liters purchased').fill('30');
    await page.getByLabel('Fill-up price per liter').fill('1.50');
    await page.getByRole('button', { name: 'Log', exact: true }).click();
  }
  await expect(page.locator('#learned')).toContainText('13.33 km/L');
  await page.getByRole('button', { name: 'Use this value' }).click();
  await navigate(page, 'Vehicle');
  await expect(page.getByLabel('Efficiency (km/L)')).toHaveValue('13.33');
});

test('invalid backup does not replace saved data', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Activity');
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#importFile').setInputFiles({
    name: 'bad.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ vehicle: { eff: 0 }, stations: [] })),
  });
  await navigate(page, 'Stations');
  await expect(page.locator('#stationList')).toContainText('QuickFuel');
  await page.reload();
  await navigate(page, 'Stations');
  await expect(page.locator('#stationList')).toContainText('QuickFuel');
});

test('native storage adapter, backup sharing, and Android back navigation', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    window.FuelWisePlatform = {
      native: true,
      get: async (key) => localStorage.getItem(key === 'fuelwise.v1' ? 'native-test-state' : key),
      set: async (key, value) => localStorage.setItem(key === 'fuelwise.v1' ? 'native-test-state' : key, value),
      setTheme: async (theme) => { window.nativeTheme = theme; },
      exportData: async (value) => { window.sharedBackup = JSON.parse(value); },
      onBack: async (callback) => { window.nativeBack = callback; },
      minimize: () => { window.didMinimize = true; },
    };
  });
  await page.goto('/');
  await navigate(page, 'Vehicle');
  await page.getByLabel('Fuel left (L)').fill('9');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect.poll(() => page.evaluate(() => window.nativeTheme)).toBe('dark');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('native-test-state'))?.vehicle.fuel)).toBe(9);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => page.evaluate(() => window.nativeTheme)).toBe('dark');
  await navigate(page, 'Vehicle');
  await expect(page.getByLabel('Fuel left (L)')).toHaveValue('9');
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await context.setOffline(true);
  await navigate(page, 'Activity');
  await page.getByRole('button', { name: 'Export data' }).click();
  expect(await page.evaluate(() => window.sharedBackup.vehicle.fuel)).toBe(9);
  await page.evaluate(() => window.nativeBack());
  await expect(page.locator('#aiCard')).toBeVisible();
  await page.evaluate(() => window.nativeBack());
  expect(await page.evaluate(() => window.didMinimize)).toBe(true);
});

test('unavailable native storage never overwrites existing data', async ({ page }) => {
  await page.addInitScript(() => {
    window.writes = 0;
    window.FuelWisePlatform = {
      native: true,
      get: async () => { throw new Error('Storage unavailable'); },
      set: async () => { window.writes++; },
    };
  });
  await page.goto('/');
  await expect(page.locator('#appStatus')).toContainText('Unable to load saved data');
  expect(await page.evaluate(() => window.writes)).toBe(0);
  await expect(page.locator('.bottom-nav button').first()).toBeDisabled();
});

test('valid backup import restores stations and rejects cancellation', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Vehicle');
  await page.getByLabel('Fuel left (L)').fill('7');
  const backup = await page.evaluate(() => JSON.parse(localStorage.getItem('fuelwise.v1')));
  backup.stations = [{ id: 'imported-1', name: 'Restored Station', distance: 1, price: 1.5 }];
  await navigate(page, 'Activity');
  const file = { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) };
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#importFile').setInputFiles(file);
  await navigate(page, 'Stations');
  await expect(page.locator('#stationList')).toContainText('QuickFuel');
  await navigate(page, 'Activity');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#importFile').setInputFiles(file);
  await expect(page.locator('#stationList')).toContainText('Restored Station');
  await page.reload();
  await navigate(page, 'Stations');
  await expect(page.locator('#stationList')).toContainText('Restored Station');
  await expect(page.locator('#stationList')).not.toContainText('QuickFuel');
});

test('bundled mobile assets load without remote dependencies', async ({ page }) => {
  const errors = [];
  const remote = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:5501/')) remote.push(request.url());
  });
  await page.goto('/mobile/');
  await expect(page.locator('#recommendation')).toContainText('BudgetGas');
  await navigate(page, 'Vehicle');
  await expect(page.getByLabel('Tank capacity (L)')).toHaveValue('40');
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test('cached app reloads offline', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright service-worker offline navigation is supported on Chromium; verify iOS offline launch on a real device.');
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.reload();
  await expect(page.locator('#offlineBadge')).toHaveText('Offline ready');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('.logo').evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(page.locator('#recommendation')).toContainText('BudgetGas');
  await navigate(page, 'Stations');
  await expect(page.locator('#stationList')).toContainText('QuickFuel');
});
