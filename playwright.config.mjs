import { defineConfig, devices } from '@playwright/test';

// Keep the release gate intentionally small.
// The site is static, so one Chromium engine with desktop and mobile profiles
// gives useful coverage without turning the deployment process into a CI farm.
export default defineConfig({
  // All browser checks live in one dedicated directory.
  testDir: './tests',

  // A hanging page must not block a release indefinitely.
  timeout: 30_000,

  // Assertions should fail reasonably quickly when an expected element is absent.
  expect: {
    timeout: 5_000,
  },

  // Run tests sequentially because this is a small staging server
  // and parallel browser instances provide little benefit here.
  fullyParallel: false,
  workers: 1,

  // A failed test is a release blocker; automatic retry could hide instability.
  retries: 0,

  // Keep terminal output compact and human-readable.
  reporter: [['line']],

  // Put temporary failure artifacts outside the production dist directory.
  outputDir: 'test-results',

  use: {
    // Every relative URL in the tests resolves against the real staging site.
    baseURL: 'https://stage.btsys.ru',

    // TLS errors must remain visible instead of being silently ignored.
    ignoreHTTPSErrors: false,

    // Preserve a trace only when something fails.
    trace: 'retain-on-failure',

    // Capture a screenshot only when something fails.
    screenshot: 'only-on-failure',

    // Video is unnecessary for this lightweight release gate.
    video: 'off',
  },

  projects: [
    {
      // Normal desktop Chromium validation.
      name: 'desktop-chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: {
          width: 1440,
          height: 900,
        },
      },
    },
    {
      // Realistic mobile Chromium characteristics including touch and mobile layout.
      name: 'mobile-chromium',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});