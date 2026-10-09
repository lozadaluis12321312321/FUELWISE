import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://127.0.0.1:5501' },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:5501',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'android-layout', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
    { name: 'iphone-layout', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
