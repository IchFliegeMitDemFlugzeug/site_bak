import { defineConfig, devices } from '@playwright/test';

// Build a mobile project from Playwright's maintained device identity while
// overriding only the geometry used as this suite's stable regression point.
const mobileProject = (name, descriptorName, browserName, width, height, grep) => ({
  name,
  grep,
  use: {
    ...devices[descriptorName],
    browserName,
    viewport: { width, height },
    screen: { width, height },
  },
});

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['line']],
  outputDir: 'test-results',
  preserveOutput: 'failures-only',
  use: {
    baseURL: 'https://stage.btsys.ru',
    ignoreHTTPSErrors: false,
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    mobileProject('android-small-chromium', 'Pixel 5', 'chromium', 360, 800, /@page-smoke/),
    mobileProject(
      'android-primary-chromium',
      'Pixel 5',
      'chromium',
      412,
      915,
      /@page-smoke|@mobile-interaction/
    ),
    mobileProject('iphone-small-webkit', 'iPhone 8', 'webkit', 375, 667, /@page-smoke/),
    mobileProject(
      'iphone-primary-webkit',
      'iPhone 13',
      'webkit',
      390,
      844,
      /@page-smoke|@mobile-interaction/
    ),
    {
      name: 'desktop-1440x900-chromium',
      grep: /@page-smoke|@desktop-only/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'desktop-1440x900-firefox',
      grep: /@engine-smoke/,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
