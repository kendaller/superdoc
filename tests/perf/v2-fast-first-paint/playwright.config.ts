import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src/browser',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:9094',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  webServer: {
    command: 'pnpm --dir ../../../packages/superdoc exec vite --host 127.0.0.1 --port 9094',
    url: 'http://127.0.0.1:9094',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
