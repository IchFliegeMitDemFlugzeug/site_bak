import { test, expect } from '@playwright/test';

// These five production pages receive the complete layout and media validation.
const primaryPages = [
  { name: 'home', path: '/', status: 200 },
  { name: 'products', path: '/products/', status: 200 },
  { name: 'faq', path: '/faq/', status: 200 },
  { name: 'about', path: '/about/', status: 200 },
  { name: 'contacts', path: '/contacts/', status: 200 },
];

// This deliberately nonexistent route preserves the existing real-IIS-404 check.
const errorPage = {
  name: '404',
  path: '/__bts_release_smoke_missing_page__',
  status: 404,
};

// The generated common navigation must continue to expose every main destination.
const navigationPaths = ['/', '/products/', '/contacts/', '/faq/', '/about/'];

// CSS, JavaScript, images and video are the resources that can break the rendered site.
const criticalResourceTypes = new Set(['stylesheet', 'script', 'image', 'media']);

// Direct resource checks run once, on this representative desktop Chromium project.
const mediaAuditProject = 'desktop-1440x900-chromium';

// The three high-value shell photographs also receive a dedicated timed diagnostic.
const shellImagePaths = [
  '/assets/media/shell-inner.webp',
  '/assets/media/shell-outer.webp',
  '/assets/media/shell-edge.webp',
];

// Recognise only resources served by the staging origin under test.
function isStageRequest(url) {
  try {
    return new URL(url).origin === 'https://stage.btsys.ru';
  } catch {
    return false;
  }
}

// Build the mandatory diagnostic prefix from the active project and page.
function diagnosticPrefix(testInfo, pagePath) {
  const size = testInfo.project.use.viewport;
  const dimensions = size ? `${size.width}x${size.height}` : 'unknown viewport';
  return `[${testInfo.project.name}] ${pagePath} viewport=${dimensions}`;
}

// Monitor browser exceptions and network failures from before navigation begins.
function watchPage(page, testInfo, pagePath) {
  const prefix = diagnosticPrefix(testInfo, pagePath);
  const pageErrors = [];
  const failedRequests = [];
  const badResponses = [];

  // Preserve uncaught JavaScript exception text together with project and page context.
  page.on('pageerror', error => {
    pageErrors.push(`${prefix} JavaScript exception: ${error.message}`);
  });

  // Any failed staging request is noteworthy, including a browser media request.
  page.on('requestfailed', request => {
    if (isStageRequest(request.url())) {
      failedRequests.push(
        `${prefix} requestfailed: ${request.resourceType()} ${request.url()} :: ` +
        `${request.failure()?.errorText || 'unknown network failure'}`
      );
    }
  });

  // Keep the original 4xx/5xx gate and extend it from images to browser video media.
  page.on('response', response => {
    const request = response.request();
    if (
      criticalResourceTypes.has(request.resourceType()) &&
      isStageRequest(response.url()) &&
      response.status() >= 400
    ) {
      badResponses.push(
        `${prefix} HTTP error: ${response.status()} ${request.resourceType()} ${response.url()}`
      );
    }
  });

  // Return mutable arrays so the test can assert them after lazy media has loaded.
  return { pageErrors, failedRequests, badResponses };
}

// Scroll through and decode every image, including images initially outside the viewport.
async function findBrokenImages(page, testInfo, pagePath) {
  const prefix = diagnosticPrefix(testInfo, pagePath);
  const images = page.locator('img');
  const count = await images.count();
  const brokenImages = [];

  // Check each concrete DOM image separately for precise source and alt diagnostics.
  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();

    // Capture all identifying attributes even if waiting or decoding later throws.
    const identity = await image.evaluate(element => ({
      currentSrc: element.currentSrc,
      src: element.getAttribute('src') || '',
      alt: element.getAttribute('alt') || '',
    }));

    try {
      // Wait for native lazy loading to settle and require both intrinsic dimensions.
      await image.evaluate(async element => {
        if (!element.complete) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('load timeout after 8000ms')), 8000);
            element.addEventListener('load', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
            element.addEventListener('error', () => {
              clearTimeout(timer);
              reject(new Error('browser load event reported an error'));
            }, { once: true });
          });
        }
        if (!element.complete) throw new Error('complete=false');
        if (element.naturalWidth <= 0) throw new Error(`naturalWidth=${element.naturalWidth}`);
        if (element.naturalHeight <= 0) throw new Error(`naturalHeight=${element.naturalHeight}`);
        if (typeof element.decode === 'function') await element.decode();
      });
    } catch (error) {
      brokenImages.push(
        `${prefix} broken image: page=${page.url()} currentSrc=${identity.currentSrc || '<empty>'} ` +
        `src=${identity.src || '<empty>'} alt=${JSON.stringify(identity.alt)} reason=${error.message}`
      );
    }
  }

  // Return all failures together so one bad image does not hide the next one.
  return brokenImages;
}

// Load every video in the browser and validate decoded metadata without requiring autoplay.
async function findBrokenVideos(page, testInfo, pagePath) {
  const prefix = diagnosticPrefix(testInfo, pagePath);
  const videos = page.locator('video');
  const count = await videos.count();
  const brokenVideos = [];

  // Validate each video element, its selected source and its poster identity.
  for (let index = 0; index < count; index += 1) {
    const video = videos.nth(index);
    await video.scrollIntoViewIfNeeded();
    try {
      const result = await video.evaluate(async element => {
        element.preload = 'metadata';
        // Start an untouched video, but never restart an in-flight request and create a false requestfailed.
        if (element.networkState === HTMLMediaElement.NETWORK_EMPTY) element.load();
        if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('loadedmetadata timeout after 10000ms')), 10000);
            element.addEventListener('loadedmetadata', () => {
              clearTimeout(timer);
              resolve();
            }, { once: true });
            element.addEventListener('error', () => {
              clearTimeout(timer);
              reject(new Error(`media error code=${element.error?.code || 'unknown'}`));
            }, { once: true });
          });
        }
        return {
          source: element.currentSrc || element.src || '<empty>',
          poster: element.poster || '<empty>',
          videoWidth: element.videoWidth,
          videoHeight: element.videoHeight,
        };
      });
      if (result.videoWidth <= 0 || result.videoHeight <= 0) {
        throw new Error(`decoded dimensions=${result.videoWidth}x${result.videoHeight}`);
      }
    } catch (error) {
      const identity = await video.evaluate(element => ({
        source: element.currentSrc || element.src || '<empty>',
        poster: element.poster || '<empty>',
      }));
      brokenVideos.push(
        `${prefix} broken video: URL=${identity.source} poster=${identity.poster} reason=${error.message}`
      );
    }
  }

  // Return every video metadata failure for one consolidated assertion.
  return brokenVideos;
}

// Collect every internal media URL represented by HTML, lightbox data or page icons.
async function collectInternalMedia(page) {
  return page.evaluate(() => {
    const origin = window.location.origin;
    const entries = [];
    const add = (value, kind) => {
      if (!value) return;
      const url = new URL(value, document.baseURI);
      if (url.origin === origin) entries.push({ url: url.href, kind });
    };

    document.querySelectorAll('img').forEach(element => {
      add(element.currentSrc || element.src, 'image');
    });
    document.querySelectorAll('video').forEach(element => {
      add(element.currentSrc || element.src, 'video');
      add(element.poster, 'image');
    });
    document.querySelectorAll('source[src]').forEach(element => add(element.src, 'video'));
    document.querySelectorAll('[data-lightbox]').forEach(element => {
      add(element.dataset.lightboxSrc, 'image');
      add(element.querySelector('img')?.currentSrc || element.querySelector('img')?.src, 'image');
    });
    document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]').forEach(element => {
      add(element.href, 'image');
    });

    return [...new Map(entries.map(entry => [`${entry.kind}:${entry.url}`, entry])).values()];
  });
}

// Request HTML media directly once and verify transport status plus declared MIME type.
async function auditMediaUrls(request, entries, testInfo, pagePath) {
  const prefix = diagnosticPrefix(testInfo, pagePath);
  const failures = [];

  // Keep requests sequential to avoid turning the media audit into staging load testing.
  for (const entry of entries) {
    try {
      const response = await request.get(entry.url, { failOnStatusCode: false });
      const status = response.status();
      const contentType = response.headers()['content-type'] || '<missing>';
      const expectedPrefix = entry.kind === 'video' ? 'video/' : 'image/';
      if (status !== 200 || !contentType.toLowerCase().startsWith(expectedPrefix)) {
        failures.push(
          `${prefix} direct media error: URL=${entry.url} status=${status} ` +
          `Content-Type=${contentType} expected=${expectedPrefix}*`
        );
      }
    } catch (error) {
      failures.push(`${prefix} direct media requestfailed: URL=${entry.url} reason=${error.message}`);
    }
  }

  // Return transport and MIME failures without stopping after the first resource.
  return failures;
}

// Preserve the original smoke checks and add layout/media checks for every project.
for (const pageCase of [...primaryPages, errorPage]) {
  test(`${pageCase.name} opens correctly`, async ({ page, request }, testInfo) => {
    const prefix = diagnosticPrefix(testInfo, pageCase.path);
    const runtime = watchPage(page, testInfo, pageCase.path);
    const response = await page.goto(pageCase.path, { waitUntil: 'domcontentloaded' });

    // Navigation must yield a real response with the established 200 or 404 status.
    expect(response, `${prefix} navigation returned no HTTP response`).not.toBeNull();
    expect(response.status(), `${prefix} unexpected page HTTP status URL=${page.url()}`).toBe(pageCase.status);

    // Staging crawler isolation must remain an IIS header, not production HTML.
    const robotsHeader = response.headers()['x-robots-tag'] || '';
    expect(robotsHeader.toLowerCase(), `${prefix} missing X-Robots-Tag noindex`).toContain('noindex');
    expect(robotsHeader.toLowerCase(), `${prefix} missing X-Robots-Tag nofollow`).toContain('nofollow');
    expect(robotsHeader.toLowerCase(), `${prefix} missing X-Robots-Tag noarchive`).toContain('noarchive');

    // Allow synchronous scripts to mount the navigation before checking the document.
    await page.waitForTimeout(750);
    expect((await page.title()).trim().length, `${prefix} empty title`).toBeGreaterThan(0);

    // Production pages must not accidentally acquire a deployable meta noindex.
    if (pageCase.status === 200) {
      const robotsMetaContent = await page.locator('meta[name="robots"]').evaluateAll(elements =>
        elements.map(element => element.getAttribute('content') || '')
      );
      expect(robotsMetaContent.join(' ').toLowerCase(), `${prefix} production noindex`).not.toContain('noindex');
    }

    // Preserve attachment and destination checks for the generated global navigation.
    await expect(page.locator('nav[data-navigation]'), `${prefix} navigation missing`).toBeAttached();
    for (const path of navigationPaths) {
      await expect(
        page.locator(`nav[data-navigation] a[href="${path}"]`),
        `${prefix} navigation link missing URL=${path}`
      ).toHaveCount(1);
    }

    // All main pages must fit both the root element and body at this exact viewport.
    if (pageCase.status === 200) {
      const layout = await page.evaluate(() => ({
        rootScrollWidth: document.documentElement.scrollWidth,
        rootClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      }));
      expect(
        layout.rootScrollWidth,
        `${prefix} horizontal overflow: documentElement ${layout.rootScrollWidth}>${layout.rootClientWidth}+1`
      ).toBeLessThanOrEqual(layout.rootClientWidth + 1);
      expect(
        layout.bodyScrollWidth,
        `${prefix} horizontal overflow: body ${layout.bodyScrollWidth}>${layout.bodyClientWidth}+1`
      ).toBeLessThanOrEqual(layout.bodyClientWidth + 1);
    }

    // Trigger every lazy image and require complete, dimensions and decode success.
    const brokenImages = await findBrokenImages(page, testInfo, pageCase.path);
    expect(brokenImages, brokenImages.join('\n')).toEqual([]);

    // Validate browser video metadata and decoded dimensions without asserting autoplay.
    const brokenVideos = await findBrokenVideos(page, testInfo, pageCase.path);
    expect(brokenVideos, brokenVideos.join('\n')).toEqual([]);

    // Direct status and MIME requests intentionally run on only one desktop project.
    if (testInfo.project.name === mediaAuditProject) {
      const mediaEntries = await collectInternalMedia(page);
      const directFailures = await auditMediaUrls(request, mediaEntries, testInfo, pageCase.path);
      expect(directFailures, directFailures.join('\n')).toEqual([]);
    }

    // Finish with the existing runtime gates after all lazy media requests have fired.
    expect(runtime.pageErrors, runtime.pageErrors.join('\n')).toEqual([]);
    expect(runtime.failedRequests, runtime.failedRequests.join('\n')).toEqual([]);
    expect(runtime.badResponses, runtime.badResponses.join('\n')).toEqual([]);
  });
}

// Exercise real navigation and explicitly cover mobile menu open-state behaviour.
test('primary navigation works', async ({ page }, testInfo) => {
  const isMobile = testInfo.project.use.isMobile === true;

  // Start each destination from a clean home state, which also restores a mobile menu.
  for (const path of navigationPaths.filter(path => path !== '/')) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    if (isMobile) {
      await page.locator('[data-menu-toggle]').click();
      await expect(page.locator('nav[data-navigation]')).toHaveClass(/is-open/);
    }
    await page.locator(`nav[data-navigation] a[href="${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
  }

  // Return mobile projects to the initial closed-menu home state after navigation.
  if (isMobile) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('nav[data-navigation]')).not.toHaveClass(/is-open/);
  }
});

// Open one closed FAQ disclosure and verify the native details state really changes.
test('FAQ details opens', async ({ page }, testInfo) => {
  const prefix = diagnosticPrefix(testInfo, '/faq/');
  await page.goto('/faq/', { waitUntil: 'domcontentloaded' });
  const closedDetails = page.locator('details:not([open])').first();
  await expect(closedDetails, `${prefix} no closed FAQ details found`).toBeAttached();
  await closedDetails.locator('summary').click();
  await expect(closedDetails, `${prefix} FAQ details did not open`).toHaveAttribute('open', '');
});

// Open the first available gallery item, validate its PhotoSwipe image, then close it.
test('PhotoSwipe opens and loads its first image', async ({ page }, testInfo) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const prefix = diagnosticPrefix(testInfo, '/');
  const opener = page.locator('[data-lightbox]').first();
  await opener.scrollIntoViewIfNeeded();
  await opener.click();
  const lightbox = page.locator('.pswp--open');
  await expect(lightbox, `${prefix} PhotoSwipe did not open`).toBeVisible();
  const image = lightbox.locator('.pswp__img').first();
  await expect(image, `${prefix} PhotoSwipe image missing`).toBeVisible();
  const decoded = await image.evaluate(async element => {
    if (typeof element.decode === 'function') await element.decode();
    return { url: element.currentSrc || element.src, width: element.naturalWidth, height: element.naturalHeight };
  });
  expect(decoded.width, `${prefix} PhotoSwipe broken image: ${decoded.url} naturalWidth=0`).toBeGreaterThan(0);
  expect(decoded.height, `${prefix} PhotoSwipe broken image: ${decoded.url} naturalHeight=0`).toBeGreaterThan(0);
  await lightbox.locator('.pswp__button--close').click();
  await expect(lightbox).toHaveCount(0);
});

// Keep the existing dialog geometry regression test on every mobile project.
test('contact dialog stays inside mobile viewport', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.isMobile !== true, 'This check belongs to every mobile project.');
  const prefix = diagnosticPrefix(testInfo, '/');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('[data-menu-toggle]').click();
  await expect(page.locator('nav[data-navigation]')).toHaveClass(/is-open/);
  await page.locator('.nav__contact').click();

  const dialog = page.locator('[data-contact-dialog]');
  const shell = page.locator('.contact-dialog__shell');
  const firstInput = page.locator('.contact-dialog input').first();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/is-open/);
  await expect(shell).toBeVisible();
  await page.waitForTimeout(550);

  // Read all nested geometry in one browser evaluation for a consistent snapshot.
  const readState = () => page.evaluate(() => {
    const dialogElement = document.querySelector('[data-contact-dialog]');
    const shellElement = document.querySelector('.contact-dialog__shell');
    const formElement = document.querySelector('.contact-form');
    const inputElement = document.querySelector('.contact-dialog input');
    const dialogRect = dialogElement.getBoundingClientRect();
    const shellRect = shellElement.getBoundingClientRect();
    const formRect = formElement.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dialog: { left: dialogRect.left, top: dialogRect.top, right: dialogRect.right, bottom: dialogRect.bottom },
      shell: { left: shellRect.left, top: shellRect.top, right: shellRect.right, bottom: shellRect.bottom },
      form: { left: formRect.left, top: formRect.top, right: formRect.right, bottom: formRect.bottom },
      rootOverflow: getComputedStyle(document.documentElement).overflow,
      dialogOverflowY: getComputedStyle(dialogElement).overflowY,
      shellTransform: getComputedStyle(shellElement).transform,
      inputFontSize: Number.parseFloat(getComputedStyle(inputElement).fontSize),
    };
  });

  // Assert dialog, shell and form containment both before and after focusing an input.
  const assertState = state => {
    const tolerance = 1;
    expect(state.dialog.left, `${prefix} dialog left outside viewport`).toBeGreaterThanOrEqual(-tolerance);
    expect(state.dialog.top, `${prefix} dialog top outside viewport`).toBeGreaterThanOrEqual(-tolerance);
    expect(state.dialog.right, `${prefix} dialog right outside viewport`).toBeLessThanOrEqual(state.viewportWidth + tolerance);
    expect(state.dialog.bottom, `${prefix} dialog bottom outside viewport`).toBeLessThanOrEqual(state.viewportHeight + tolerance);
    expect(state.shell.left, `${prefix} shell left outside dialog`).toBeGreaterThanOrEqual(state.dialog.left - tolerance);
    expect(state.shell.top, `${prefix} shell top outside dialog`).toBeGreaterThanOrEqual(state.dialog.top - tolerance);
    expect(state.shell.right, `${prefix} shell right outside dialog`).toBeLessThanOrEqual(state.dialog.right + tolerance);
    expect(state.shell.bottom, `${prefix} shell bottom outside dialog`).toBeLessThanOrEqual(state.dialog.bottom + tolerance);
    expect(state.form.left, `${prefix} form left outside shell`).toBeGreaterThanOrEqual(state.shell.left - tolerance);
    expect(state.form.top, `${prefix} form top outside shell`).toBeGreaterThanOrEqual(state.shell.top - tolerance);
    expect(state.form.right, `${prefix} form right outside shell`).toBeLessThanOrEqual(state.shell.right + tolerance);
    expect(state.form.bottom, `${prefix} form bottom outside shell`).toBeLessThanOrEqual(state.shell.bottom + tolerance);
  };

  const beforeFocus = await readState();
  assertState(beforeFocus);
  expect(beforeFocus.rootOverflow, `${prefix} unexpected root scroll lock`).not.toBe('hidden');
  expect(beforeFocus.dialogOverflowY, `${prefix} dialog does not own vertical scrolling`).toBe('auto');
  expect(beforeFocus.shellTransform, `${prefix} translated mobile dialog shell`).toBe('none');
  expect(beforeFocus.inputFontSize, `${prefix} input font can trigger iOS zoom`).toBeGreaterThanOrEqual(16);
  await firstInput.click();
  await page.waitForTimeout(150);
  assertState(await readState());
});

// Diagnose transport timing and browser decode for the three shell photographs once.
test('shell photographs load and decode', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== mediaAuditProject, 'Shell diagnostics run once on desktop Chromium.');
  const prefix = diagnosticPrefix(testInfo, '/');

  // Report every file independently while retaining exact status, headers and duration.
  for (const imagePath of shellImagePaths) {
    const url = new URL(imagePath, 'https://stage.btsys.ru').href;
    const startedAt = Date.now();
    const response = await request.get(url, { failOnStatusCode: false });
    const elapsedMs = Date.now() - startedAt;
    const contentType = response.headers()['content-type'] || '<missing>';
    const contentLength = response.headers()['content-length'] || '<missing>';
    const transport = `URL=${url} status=${response.status()} Content-Type=${contentType} ` +
      `Content-Length=${contentLength} loadMs=${elapsedMs}`;
    expect(response.status(), `${prefix} shell image HTTP failure: ${transport}`).toBe(200);
    expect(contentType.toLowerCase(), `${prefix} shell image MIME failure: ${transport}`).toMatch(/^image\//);

    // Create an actual browser image so HTTP success alone cannot hide decode corruption.
    const decoded = await page.evaluate(async resourceUrl => {
      const image = new Image();
      image.src = resourceUrl;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('browser load timeout after 10000ms')), 10000);
        image.addEventListener('load', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
        image.addEventListener('error', () => {
          clearTimeout(timer);
          reject(new Error('browser image load error'));
        }, { once: true });
      });
      if (typeof image.decode === 'function') await image.decode();
      return { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
    }, url).catch(error => ({ error: error.message, complete: false, naturalWidth: 0, naturalHeight: 0 }));
    const browserDiagnostic = `${transport} browserDecode=${decoded.error || 'ok'} ` +
      `dimensions=${decoded.naturalWidth}x${decoded.naturalHeight}`;
    console.log(`${prefix} shell image diagnostic: ${browserDiagnostic}`);
    expect(decoded.error, `${prefix} shell image decode failure: ${browserDiagnostic}`).toBeUndefined();
    expect(decoded.complete, `${prefix} shell image incomplete: ${browserDiagnostic}`).toBe(true);
    expect(decoded.naturalWidth, `${prefix} shell image width failure: ${browserDiagnostic}`).toBeGreaterThan(0);
    expect(decoded.naturalHeight, `${prefix} shell image height failure: ${browserDiagnostic}`).toBeGreaterThan(0);
  }
});
