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

// Run one visible smoke-test step while reporting its context, duration and failures.
async function progressStep(testInfo, pagePath, stepName, action) {
  // Keep the requested project and page labels stable for every progress message.
  const prefix = `[${testInfo.project.name}] [${pagePath}]`;
  // Use a monotonic clock so system-clock corrections cannot distort the duration.
  const startedAt = performance.now();
  // Announce the work before it starts, which makes a slow operation easy to identify.
  console.log(`${prefix} → ${stepName}`);
  // Report a heartbeat every five seconds until the operation settles.
  const heartbeat = setInterval(() => {
    // Round down to whole seconds to keep the waiting message compact and predictable.
    const elapsedSeconds = Math.floor((performance.now() - startedAt) / 1000);
    // Repeat the step name so concurrent reporter output remains understandable.
    console.log(`${prefix} … still waiting: ${stepName} (${elapsedSeconds} s)`);
  }, 5_000);

  try {
    // Return the callback result unchanged so the helper does not alter test behaviour.
    const result = await action();
    // Measure successful completion only after every operation in the callback has finished.
    const elapsedSeconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    // Print the requested success marker and the complete step duration.
    console.log(`${prefix} ✓ ${stepName} (${elapsedSeconds} s)`);
    // Preserve values such as Playwright navigation responses for the existing assertions.
    return result;
  } catch (error) {
    // Print the failed step before the underlying Playwright error is rethrown.
    console.error(`${prefix} ✗ ${stepName}`);
    // Prefer the normal Error message while still supporting non-Error thrown values.
    console.error(`${prefix} ${error instanceof Error ? error.message : String(error)}`);
    // Rethrow the original value so assertions, stacks and test outcomes stay unchanged.
    throw error;
  } finally {
    // Always stop the heartbeat, including when the callback fails.
    clearInterval(heartbeat);
  }
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

  // Keep every staging request failure except a browser-cancelled media fetch.
  page.on('requestfailed', request => {
    // Read the resource kind once so the exception remains limited to video or audio media.
    const resourceType = request.resourceType();
    // Preserve Playwright's exact failure text for both filtering and later diagnostics.
    const errorText = request.failure()?.errorText || 'unknown network failure';
    // Browsers can abort a superseded media fetch even though the video loads successfully.
    if (resourceType === 'media' && errorText.includes('ERR_ABORTED')) return;
    // Continue treating every other failed request from the staging origin as critical.
    if (isStageRequest(request.url())) {
      failedRequests.push(
        `${prefix} requestfailed: ${resourceType} ${request.url()} :: ${errorText}`
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
        // Production intentionally keeps MP4 in data-src until the video approaches the viewport.
        // Hydrate it explicitly here so the media test remains deterministic.
        if (!element.getAttribute('src') && element.dataset.src) {
          element.src = element.dataset.src;
        }
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
      add(element.currentSrc || element.src || element.dataset.src, 'video');
      add(element.poster, 'image');
    });
    document.querySelectorAll('source[src]').forEach(element => {
      add(element.src, element.parentElement?.tagName === 'PICTURE' ? 'image' : 'video');
    });
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

// Run the full document, layout and browser-media checks once per primary page.
for (const pageCase of primaryPages) {
  test(`${pageCase.name} opens correctly`, { tag: '@page-smoke' }, async ({ page }, testInfo) => {
    const prefix = diagnosticPrefix(testInfo, pageCase.path);
    const runtime = watchPage(page, testInfo, pageCase.path);
    const response = await progressStep(testInfo, pageCase.path, 'navigation', () =>
      page.goto(pageCase.path, { waitUntil: 'domcontentloaded' })
    );

    await progressStep(testInfo, pageCase.path, 'page load', async () => {
      expect(response, `${prefix} navigation returned no HTTP response`).not.toBeNull();
      expect(response.status(), `${prefix} unexpected page HTTP status URL=${page.url()}`).toBe(200);
      const robotsHeader = response.headers()['x-robots-tag'] || '';
      expect(robotsHeader.toLowerCase(), `${prefix} missing X-Robots-Tag noindex`).toContain('noindex');
      expect(robotsHeader.toLowerCase(), `${prefix} missing X-Robots-Tag nofollow`).toContain('nofollow');
      expect(robotsHeader.toLowerCase(), `${prefix} missing X-Robots-Tag noarchive`).toContain('noarchive');
      expect((await page.title()).trim().length, `${prefix} empty title`).toBeGreaterThan(0);
      const robotsMetaContent = await page.locator('meta[name="robots"]').evaluateAll(elements =>
        elements.map(element => element.getAttribute('content') || '')
      );
      expect(robotsMetaContent.join(' ').toLowerCase(), `${prefix} production noindex`).not.toContain('noindex');
    });

    await progressStep(testInfo, pageCase.path, 'navigation/menu', async () => {
      await expect(page.locator('nav[data-navigation]'), `${prefix} navigation missing`).toBeAttached();
      for (const path of navigationPaths) {
        await expect(
          page.locator(`nav[data-navigation] a[href="${path}"]`),
          `${prefix} navigation link missing URL=${path}`
        ).toHaveCount(1);
      }
    });

    await progressStep(testInfo, pageCase.path, 'horizontal overflow', async () => {
      const layout = await page.evaluate(() => ({
        rootScrollWidth: document.documentElement.scrollWidth,
        rootClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      }));
      expect(layout.rootScrollWidth, `${prefix} root horizontal overflow`).toBeLessThanOrEqual(layout.rootClientWidth + 1);
      expect(layout.bodyScrollWidth, `${prefix} body horizontal overflow`).toBeLessThanOrEqual(layout.bodyClientWidth + 1);
    });

    await progressStep(testInfo, pageCase.path, 'image checks', async () => {
      const brokenImages = await findBrokenImages(page, testInfo, pageCase.path);
      expect(brokenImages, brokenImages.join('\n')).toEqual([]);
    });
    await progressStep(testInfo, pageCase.path, 'video checks', async () => {
      const brokenVideos = await findBrokenVideos(page, testInfo, pageCase.path);
      expect(brokenVideos, brokenVideos.join('\n')).toEqual([]);
    });

    expect(runtime.pageErrors, runtime.pageErrors.join('\n')).toEqual([]);
    expect(runtime.failedRequests, runtime.failedRequests.join('\n')).toEqual([]);
    expect(runtime.badResponses, runtime.badResponses.join('\n')).toEqual([]);
  });
}

// Exercise both mobile menu navigation and the normal desktop navigation once.
test(
  'primary navigation works',
  { tag: ['@mobile-interaction', '@desktop-only'] },
  async ({ page }, testInfo) => {
    const isMobile = testInfo.project.use.isMobile === true;
    for (const path of navigationPaths.filter(path => path !== '/')) {
      await progressStep(testInfo, path, 'navigation/menu', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        if (isMobile) {
          await page.locator('[data-menu-toggle]').click();
          await expect(page.locator('nav[data-navigation]')).toHaveClass(/is-open/);
        }
        await page.locator(`nav[data-navigation] a[href="${path}"]`).click();
        await expect(page).toHaveURL(new RegExp(`${path.replaceAll('/', '\\/')}$`));
      });
    }
    if (isMobile) {
      await progressStep(testInfo, '/', 'navigation/menu reset', async () => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('nav[data-navigation]')).not.toHaveClass(/is-open/);
      });
    }
  }
);

// Keep the three focused interaction regressions on the two primary phones only.
test('FAQ details opens', { tag: '@mobile-interaction' }, async ({ page }, testInfo) => {
  const prefix = diagnosticPrefix(testInfo, '/faq/');
  await progressStep(testInfo, '/faq/', 'navigation', () => page.goto('/faq/', { waitUntil: 'domcontentloaded' }));
  await progressStep(testInfo, '/faq/', 'FAQ', async () => {
    // Resolve the first closed item to an index before clicking, because :not([open]) changes its match after the click.
    const closedDetailsIndex = await page.locator('details').evaluateAll(details =>
      details.findIndex(detail => !detail.hasAttribute('open'))
    );
    // Require a real closed FAQ item before creating the stable index-based locator.
    expect(closedDetailsIndex, `${prefix} no closed FAQ details found`).toBeGreaterThanOrEqual(0);
    // Keep pointing at the same DOM position even after the element gains its open attribute.
    const closedDetails = page.locator('details').nth(closedDetailsIndex);
    await expect(closedDetails, `${prefix} no closed FAQ details found`).toBeAttached();
    await closedDetails.locator('summary').click();
    await expect(closedDetails, `${prefix} FAQ details did not open`).toHaveAttribute('open', '');
    // Verify the answer belonging to that exact details element is actually revealed to the user.
    await expect(closedDetails.locator(':scope > :not(summary)').first(), `${prefix} FAQ answer is not visible`).toBeVisible();
  });
});

test('PhotoSwipe opens and loads its first image', { tag: '@mobile-interaction' }, async ({ page }, testInfo) => {
  await progressStep(testInfo, '/', 'navigation', () => page.goto('/', { waitUntil: 'domcontentloaded' }));
  const prefix = diagnosticPrefix(testInfo, '/');
  await progressStep(testInfo, '/', 'PhotoSwipe', async () => {
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
    expect(decoded.width, `${prefix} PhotoSwipe broken image: ${decoded.url}`).toBeGreaterThan(0);
    expect(decoded.height, `${prefix} PhotoSwipe broken image: ${decoded.url}`).toBeGreaterThan(0);
    await lightbox.locator('.pswp__button--close').click();
    await expect(lightbox).toHaveCount(0);
  });
});

test('contact dialog stays inside mobile viewport', { tag: '@mobile-interaction' }, async ({ page }, testInfo) => {
  const prefix = diagnosticPrefix(testInfo, '/');
  await progressStep(testInfo, '/', 'navigation', () => page.goto('/', { waitUntil: 'domcontentloaded' }));
  await progressStep(testInfo, '/', 'contact dialog', async () => {
    await page.locator('[data-menu-toggle]').click();
    await expect(page.locator('nav[data-navigation]')).toHaveClass(/is-open/);
    await page.locator('.nav__contact').click();
    const dialog = page.locator('[data-contact-dialog]');
    const shell = page.locator('.contact-dialog__shell');
    const firstInput = page.locator('.contact-dialog input').first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/is-open/);
    await expect(shell).toBeVisible();

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
        dialogScrollTop: dialogElement.scrollTop,
        dialogScrollHeight: dialogElement.scrollHeight,
        dialogClientHeight: dialogElement.clientHeight,
      };
    });
    // Keep the existing one-pixel horizontal tolerance for fractional browser geometry.
    const tolerance = 1;
    // Check viewport ownership and horizontal containment without requiring tall content to fit vertically.
    const assertViewportAndHorizontalState = state => {
      expect(state.dialog.left, `${prefix} dialog left outside viewport`).toBeGreaterThanOrEqual(-tolerance);
      expect(state.dialog.top, `${prefix} dialog top outside viewport`).toBeGreaterThanOrEqual(-tolerance);
      expect(state.dialog.right, `${prefix} dialog right outside viewport`).toBeLessThanOrEqual(state.viewportWidth + tolerance);
      expect(state.dialog.bottom, `${prefix} dialog bottom outside viewport`).toBeLessThanOrEqual(state.viewportHeight + tolerance);
      expect(state.shell.left, `${prefix} shell left outside dialog`).toBeGreaterThanOrEqual(state.dialog.left - tolerance);
      expect(state.shell.right, `${prefix} shell right outside dialog`).toBeLessThanOrEqual(state.dialog.right + tolerance);
      expect(state.form.left, `${prefix} form left outside shell`).toBeGreaterThanOrEqual(state.shell.left - tolerance);
      expect(state.form.right, `${prefix} form right outside shell`).toBeLessThanOrEqual(state.shell.right + tolerance);
    };
    // At scroll position zero, both the shell start and the form start must remain reachable.
    const assertTopIsAccessible = state => {
      expect(state.shell.top, `${prefix} shell top outside dialog`).toBeGreaterThanOrEqual(state.dialog.top);
      expect(state.form.top, `${prefix} form top outside shell`).toBeGreaterThanOrEqual(state.shell.top);
    };
    const beforeFocus = await readState();
    assertViewportAndHorizontalState(beforeFocus);
    assertTopIsAccessible(beforeFocus);
    expect(beforeFocus.rootOverflow, `${prefix} unexpected root scroll lock`).not.toBe('hidden');
    expect(beforeFocus.dialogOverflowY, `${prefix} dialog does not own vertical scrolling`).toBe('auto');
    expect(beforeFocus.shellTransform, `${prefix} translated mobile dialog shell`).toBe('none');
    expect(beforeFocus.inputFontSize, `${prefix} input can trigger iOS zoom`).toBeGreaterThanOrEqual(16);
    await firstInput.click();
    const afterFocus = await readState();
    assertViewportAndHorizontalState(afterFocus);
    assertTopIsAccessible(afterFocus);

    // This long mobile form must overflow the dialog so the scrolling contract is exercised rather than assumed.
    expect(afterFocus.dialogScrollHeight, `${prefix} dialog content does not overflow vertically`).toBeGreaterThan(afterFocus.dialogClientHeight);
    // Ask the dialog scroll container to move to its maximum vertical position.
    await dialog.evaluate(element => element.scrollTop = element.scrollHeight);
    // Let Playwright retry until the browser has applied the scroll position, without using a fixed sleep.
    await expect.poll(async () => (await readState()).dialogScrollTop, `${prefix} dialog did not scroll down`).toBeGreaterThan(0);
    const afterScroll = await readState();
    assertViewportAndHorizontalState(afterScroll);
    // At the maximum scroll position, the form's bottom must be reachable inside the dialog viewport.
    expect(afterScroll.form.bottom, `${prefix} form bottom is not reachable`).toBeLessThanOrEqual(afterScroll.dialog.bottom);
    expect(afterScroll.form.bottom, `${prefix} form bottom scrolled above dialog`).toBeGreaterThan(afterScroll.dialog.top);

    // Return to the start and verify that the top of the same content is reachable again.
    await dialog.evaluate(element => element.scrollTop = 0);
    await expect.poll(async () => (await readState()).dialogScrollTop, `${prefix} dialog did not return to top`).toBe(0);
    const afterReset = await readState();
    assertViewportAndHorizontalState(afterReset);
    assertTopIsAccessible(afterReset);
  });
});

// Validate the real IIS error response without repeating full-page media work.
test('real IIS 404 works', { tag: '@desktop-only' }, async ({ page }, testInfo) => {
  const response = await progressStep(testInfo, errorPage.path, 'navigation', () =>
    page.goto(errorPage.path, { waitUntil: 'domcontentloaded' })
  );
  expect(response).not.toBeNull();
  expect(response.status()).toBe(404);
  const robotsHeader = (response.headers()['x-robots-tag'] || '').toLowerCase();
  expect(robotsHeader).toContain('noindex');
  expect(robotsHeader).toContain('nofollow');
  expect(robotsHeader).toContain('noarchive');
  expect(await page.locator('html').count()).toBe(1);
  expect((await page.locator('body').innerText()).trim().length).toBeGreaterThan(0);
});

// Discover all site media across all pages, deduplicate it, then request each URL once.
test('media integrity audit', { tag: '@desktop-only' }, async ({ page, request }, testInfo) => {
  const mediaByUrl = new Map();
  for (const pageCase of primaryPages) {
    await progressStep(testInfo, pageCase.path, 'collect media', async () => {
      const response = await page.goto(pageCase.path, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      for (const entry of await collectInternalMedia(page)) {
        const previous = mediaByUrl.get(entry.url);
        expect(previous?.kind ?? entry.kind, `conflicting media kind for ${entry.url}`).toBe(entry.kind);
        mediaByUrl.set(entry.url, entry);
      }
    });
  }

  const failures = [];
  for (const entry of mediaByUrl.values()) {
    await progressStep(testInfo, '/', `media HTTP: ${new URL(entry.url).pathname}`, async () => {
      const startedAt = performance.now();
      try {
        const response = await request.get(entry.url, { failOnStatusCode: false });
        const elapsedMs = Math.round(performance.now() - startedAt);
        const contentType = response.headers()['content-type'] || '<missing>';
        const contentLength = response.headers()['content-length'] || '<missing>';
        const expectedPrefix = entry.kind === 'video' ? 'video/' : 'image/';
        if (response.status() !== 200 || !contentType.toLowerCase().startsWith(expectedPrefix)) {
          failures.push(`URL=${entry.url} status=${response.status()} Content-Type=${contentType} expected=${expectedPrefix}*`);
        }
        if (shellImagePaths.some(path => entry.url.endsWith(path))) {
          const decoded = await page.evaluate(async resourceUrl => {
            const image = new Image();
            image.src = resourceUrl;
            await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error('browser load timeout after 10000ms')), 10000);
              image.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
              image.addEventListener('error', () => { clearTimeout(timer); reject(new Error('browser image load error')); }, { once: true });
            });
            if (typeof image.decode === 'function') await image.decode();
            return { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight };
          }, entry.url);
          const diagnostic = `URL=${entry.url} status=${response.status()} Content-Type=${contentType} ` +
            `Content-Length=${contentLength} loadMs=${elapsedMs} browserDecode=ok ` +
            `dimensions=${decoded.naturalWidth}x${decoded.naturalHeight}`;
          console.log(`${diagnosticPrefix(testInfo, '/')} shell image diagnostic: ${diagnostic}`);
          expect(decoded.complete, diagnostic).toBe(true);
          expect(decoded.naturalWidth, diagnostic).toBeGreaterThan(0);
          expect(decoded.naturalHeight, diagnostic).toBeGreaterThan(0);
        }
      } catch (error) {
        failures.push(`URL=${entry.url} reason=${error.message}`);
      }
    });
  }
  expect(failures, failures.join('\n')).toEqual([]);
});

// The navigation switches to its mobile drawer through 1023px and desktop mode at 1024px.
test('responsive breakpoint sanity', { tag: '@desktop-only' }, async ({ page }, testInfo) => {
  for (const width of [767, 768, 1023, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const pageCase of primaryPages) {
      await progressStep(testInfo, pageCase.path, `breakpoint ${width}px`, async () => {
        const response = await page.goto(pageCase.path, { waitUntil: 'domcontentloaded' });
        expect(response?.status()).toBe(200);
        const state = await page.evaluate(() => {
          const root = document.documentElement;
          const body = document.body;
          const nav = document.querySelector('nav[data-navigation]');
          const toggle = document.querySelector('[data-menu-toggle]');
          return {
            overflow: root.scrollWidth > root.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1,
            navAttached: Boolean(nav),
            navDisplay: nav ? getComputedStyle(nav).display : 'none',
            toggleDisplay: toggle ? getComputedStyle(toggle).display : 'none',
          };
        });
        expect(state.overflow, `${pageCase.path} overflows at ${width}px`).toBe(false);
        expect(state.navAttached, `${pageCase.path} navigation missing at ${width}px`).toBe(true);
        expect(state.navDisplay, `${pageCase.path} navigation unavailable at ${width}px`).not.toBe('none');
        if (width <= 1023) expect(state.toggleDisplay, `mobile menu hidden at ${width}px`).not.toBe('none');
        else expect(state.toggleDisplay, `desktop menu toggle visible at ${width}px`).toBe('none');
      });
    }
  }
});

// Firefox deliberately receives only a fast cross-engine compatibility signal.
test('Firefox engine sanity', { tag: '@engine-smoke' }, async ({ page }, testInfo) => {
  const runtime = watchPage(page, testInfo, '/');
  const response = await progressStep(testInfo, '/', 'engine navigation', () =>
    page.goto('/', { waitUntil: 'domcontentloaded' })
  );
  expect(response?.status()).toBe(200);
  expect((await page.title()).trim().length).toBeGreaterThan(0);
  await expect(page.locator('nav[data-navigation]')).toBeAttached();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ||
    document.body.scrollWidth > document.body.clientWidth + 1
  );
  expect(overflow).toBe(false);
  await page.locator('nav[data-navigation] a[href="/products/"]').click();
  await expect(page).toHaveURL(/\/products\/$/);
  expect(runtime.pageErrors, runtime.pageErrors.join('\n')).toEqual([]);
});
