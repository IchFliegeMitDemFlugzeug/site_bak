import { defineConfig, devices } from '@playwright/test';

// Keep every viewport explicit so a failed report names the exact device geometry.
const viewport = (width, height) => ({ width, height });

// Use one current Android Chrome identity for all Android geometry checks.
const androidUserAgent = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';

// Use a realistic modern iPhone Safari identity while WebKit supplies the engine.
const iphoneUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// Build a named desktop Chromium project without inheriting an accidental viewport.
const desktopChromium = (width, height) => ({
  name: `desktop-${width}x${height}-chromium`,
  use: {
    ...devices['Desktop Chrome'],
    viewport: viewport(width, height),
  },
});

// Build Chromium projects around the responsive tablet and breakpoint boundaries.
const chromiumViewport = (prefix, width, height) => ({
  name: `${prefix}-${width}x${height}-chromium`,
  use: {
    browserName: 'chromium',
    viewport: viewport(width, height),
  },
});

// Build touch-enabled mobile Chromium projects with a stable Android identity.
const androidChromium = (width, height) => ({
  name: `android-${width}x${height}-chromium`,
  use: {
    browserName: 'chromium',
    viewport: viewport(width, height),
    isMobile: true,
    hasTouch: true,
    userAgent: androidUserAgent,
  },
});

// Build touch-enabled iPhone projects in the actual WebKit browser engine.
const iphoneWebKit = (width, height) => ({
  name: `iphone-${width}x${height}-webkit`,
  use: {
    browserName: 'webkit',
    viewport: viewport(width, height),
    isMobile: true,
    hasTouch: true,
    userAgent: iphoneUserAgent,
  },
});

// Export the one existing Playwright system, now expanded into the requested matrix.
export default defineConfig({
  // Keep all browser checks in the existing dedicated test directory.
  testDir: './tests',

  // Allow lazy media on long pages to load without masking a genuine hang.
  timeout: 90_000,

  // Fail promptly when an interactive control or dialog never appears.
  expect: {
    timeout: 8_000,
  },

  // Protect the small staging server from a burst of parallel browser traffic.
  fullyParallel: false,
  workers: 1,

  // Do not let retries hide an intermittent staging or browser defect.
  retries: 0,

  // Keep the console output readable while retaining every project and test name.
  reporter: [['line']],

  // Store diagnostic artifacts outside the production-ready dist directory.
  outputDir: 'test-results',

  // Apply shared staging safeguards to every browser and viewport.
  use: {
    // Preserve the canonical staging address exactly as it was configured.
    baseURL: 'https://stage.btsys.ru',
    // Surface certificate problems rather than silently accepting them.
    ignoreHTTPSErrors: false,
    // Retain a trace only for failures to limit local artifact size.
    trace: 'retain-on-failure',
    // Capture the visible failure state without recording every successful run.
    screenshot: 'only-on-failure',
    // Media correctness is asserted directly, so test-run video recording is unnecessary.
    video: 'off',
  },

  // Exercise desktop, tablet, breakpoint, Android, iPhone and alternate engines.
  projects: [
    desktopChromium(1920, 1080),
    desktopChromium(1440, 900),
    desktopChromium(1366, 768),
    desktopChromium(1280, 800),
    chromiumViewport('tablet', 1366, 1024),
    chromiumViewport('tablet', 1024, 1366),
    chromiumViewport('tablet', 1024, 768),
    chromiumViewport('tablet', 768, 1024),
    chromiumViewport('breakpoint', 767, 900),
    chromiumViewport('breakpoint', 768, 900),
    chromiumViewport('breakpoint', 1023, 900),
    chromiumViewport('breakpoint', 1024, 900),
    androidChromium(360, 800),
    androidChromium(384, 854),
    androidChromium(412, 915),
    iphoneWebKit(375, 667),
    iphoneWebKit(390, 844),
    iphoneWebKit(393, 852),
    iphoneWebKit(430, 932),
    {
      name: 'desktop-1440x900-firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: viewport(1440, 900),
      },
    },
    {
      name: 'desktop-1440x900-webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: viewport(1440, 900),
      },
    },
  ],
});
