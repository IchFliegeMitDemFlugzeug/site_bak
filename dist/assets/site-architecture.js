/* ========================================================================== */
/* БТС / ЕДИНЫЙ АРХИТЕКТУРНЫЙ РЕЕСТР                                         */
/* Реестр связывает текущий DOM с PAGE → BLOCK_ID → PATTERN → MEDIA_ID.       */
/* Текст и пути медиа остаются в существующей разметке до этапа переноса.      */
/* ========================================================================== */

(() => {
  'use strict';

  // Рекурсивно замораживаем конфигурацию, чтобы прикладные сценарии не меняли каноническую схему.
  const deepFreeze = value => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };

  // Общие настройки являются машинно-читаемым отражением раздела SETTINGS канонического TXT.
  const settings = deepFreeze({
    version: 3,
    font: 'Onest Variable',
    breakpoints: {
      mobileMax: 767,
      tabletMin: 768,
      tabletMax: 1023,
      desktopMin: 1024,
    },
    grid: {
      columns: 12,
      gap: 24,
      containerMax: 1440,
    },
    components: [
      'C-CONTAINER',
      'C-STACK',
      'C-SPLIT',
      'C-SECTION-HEADER',
      'C-FEATURE-LIST',
      'C-FEATURE-ITEM',
      'C-METRIC-CARD',
      'C-INFO-CARD',
      'C-MEDIA',
      'C-BUTTON',
      'C-TEXT-LINK',
      'C-GALLERY',
      'C-FAQ-ITEM',
    ],
    patterns: [
      'S-HERO',
      'S-STATEMENT',
      'S-EDITORIAL',
      'S-EDITORIAL-MEDIA',
      'S-SPLIT',
      'S-MEDIA-COPY',
      'S-METRICS',
      'S-GALLERY',
      'S-SPECS',
      'S-FAQ',
      'S-CTA',
    ],
  });

  // Единый MEDIA-реестр: PAGE хранит только ссылки на MEDIA_ID и DOM-binding.
  const mediaRegistry = deepFreeze({
    'MEDIA-GLOBAL-LOGO': { type: 'logo', src: '/assets/images/bts-logo.png', openable: false, crop: 'deny', role: 'M-NATIVE' },
    'MEDIA-HOME-01-HERO-TANK': { type: 'photo', src: '/assets/images/hero-tank.webp', openable: true, crop: 'deny', role: 'M-NATIVE', width: 1800, height: 1351 },
    'MEDIA-HOME-01-CLOUDS': { type: 'procedural-canvas', src: '/assets/btsCloudBackground.js', openable: false, crop: 'n/a', locked: true },
    'MEDIA-HOME-01-GRID': { type: 'decorative-css', openable: false, crop: 'n/a' },
    'MEDIA-HOME-04-FUTURE-VISUAL': { type: 'decorative-css', openable: false, crop: 'n/a' },
    'MEDIA-HOME-05-KIT': { type: 'photo', src: '/assets/media/tank-kit.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-HOME-05-TANK-COVER': { type: 'photo', src: '/assets/media/product-hero.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-HOME-05-MATERIAL-EDGE': { type: 'photo', src: '/assets/media/rubberized-fabric.webp', openable: true, crop: 'allow', width: 1440, height: 1440 },
    'MEDIA-PRODUCTS-01-HERO-TANK': { type: 'photo', src: '/assets/media/product-hero.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-PRODUCTS-02-VIDEO-FLEXIBILITY': { type: 'video', src: '/assets/media/flexibility.mp4', openable: false, crop: 'cover', role: 'M-WIDE' },
    'MEDIA-PRODUCTS-03-INNER-LAYER': { type: 'photo', src: '/assets/media/shell-inner.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-PRODUCTS-03-OUTER-LAYER': { type: 'photo', src: '/assets/media/shell-outer.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-PRODUCTS-03-EDGE-MACRO': { type: 'photo', src: '/assets/media/shell-edge.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-PRODUCTS-04-VIDEO-CATIA': { type: 'video', src: '/assets/media/catia-rotation.mp4', openable: false, crop: 'contain', role: 'M-STANDARD' },
    'MEDIA-PRODUCTS-05-01': { type: 'photo', src: '/assets/media/neck-open.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-PRODUCTS-05-02': { type: 'photo', src: '/assets/media/neck-parts.webp', openable: true, crop: 'allow', width: 2048, height: 1638 },
    'MEDIA-PRODUCTS-05-03': { type: 'photo', src: '/assets/media/neck-assembled.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-PRODUCTS-06-01': { type: 'photo', src: '/assets/media/airframe-bay-a.webp', openable: true, crop: 'allow', width: 1537, height: 2048 },
    'MEDIA-PRODUCTS-06-02': { type: 'photo', src: '/assets/media/airframe-bay-b.webp', openable: true, crop: 'allow' },
    'MEDIA-PRODUCTS-06-03': { type: 'photo', src: '/assets/media/airframe-bay-c.webp', openable: true, crop: 'allow' },
    'MEDIA-PRODUCTS-06-04': { type: 'photo', src: '/assets/media/airframe-detail.webp', openable: true, crop: 'allow' },
    'MEDIA-PRODUCTS-07-TECH-VISUAL': { type: 'decorative-css', openable: false, crop: 'n/a' },
    'MEDIA-PRODUCTS-08-PICKUP': { type: 'photo', src: '/assets/media/pickup-module.webp', openable: true, crop: 'deny', role: 'M-PORTRAIT', width: 1236, height: 2047 },
    'MEDIA-PRODUCTS-08-DETAIL': { type: 'photo', src: '/assets/media/pickup-detail.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-PRODUCTS-09-FITTINGS': { type: 'photo', src: '/assets/media/fittings-top.webp', openable: true, crop: 'allow', width: 2048, height: 1365 },
    'MEDIA-PRODUCTS-10-BACKGROUND': { type: 'background-photo', src: '/assets/media/fuel-background.webp', openable: false, crop: 'allow' },
    'MEDIA-PRODUCTS-11-SCHEME': { type: 'scheme', src: '/assets/media/self-sealing.webp', openable: true, crop: 'deny', role: 'M-NATIVE', width: 1671, height: 941 },
    'MEDIA-PRODUCTS-13-MOCKUP-01': { type: 'photo', src: '/assets/media/mockup-full.webp', openable: true, crop: 'allow', width: 941, height: 1672 },
    'MEDIA-PRODUCTS-13-MOCKUP-02': { type: 'photo', src: '/assets/media/mockup-close.webp', openable: true, crop: 'allow', width: 1122, height: 1402 },
    'MEDIA-PRODUCTS-15-MATERIAL': { type: 'photo', src: '/assets/media/rubberized-fabric.webp', openable: true, crop: 'allow', width: 1440, height: 1440 },
  });

  // Каждая media binding указывает только на уже существующий элемент текущего блока.
  // Отсутствующий selector фиксирует расхождение, но не создаёт и не подменяет медиа автоматически.
  const pages = deepFreeze({
    home: {
      pageId: 'HOME',
      blocks: [
        {
          id: 'HOME-01',
          selector: '.hero',
          pattern: 'S-HERO',
          titleRole: 'T-DISPLAY-XL',
          theme: 'light',
          variants: ['clouds', 'media-right'],
          media: [
            { id: 'MEDIA-HOME-01-HERO-TANK', selector: '.hero-object__image' },
            { id: 'MEDIA-HOME-01-CLOUDS', selector: '.hero' },
            { id: 'MEDIA-HOME-01-GRID', selector: '.hero__grid' },
          ],
        },
        {
          id: 'HOME-02',
          selector: '[aria-labelledby="responsibility-title"]',
          pattern: 'S-STATEMENT',
          titleRole: 'T-DISPLAY-L',
          theme: 'light',
          variants: ['statement-offset'],
          media: [],
        },
        {
          id: 'HOME-03',
          selector: '[aria-labelledby="integration-copy-title"]',
          pattern: 'S-SPLIT',
          titleRole: 'T-DISPLAY-M',
          theme: 'paper',
          variants: ['copy-right'],
          media: [],
        },
        {
          id: 'HOME-04',
          selector: '[aria-labelledby="result-title"]',
          pattern: 'S-METRICS',
          titleRole: 'T-DISPLAY-L',
          theme: 'contrast-light',
          variants: ['three-cards'],
          media: [
            { id: 'MEDIA-HOME-04-FUTURE-VISUAL', selector: '.future-visual' },
          ],
        },
        {
          id: 'HOME-05',
          selector: '[aria-labelledby="production-title"]',
          pattern: 'S-EDITORIAL-MEDIA',
          titleRole: 'T-DISPLAY-L',
          theme: 'light',
          variants: ['cards-above-media', 'two-media-centered'],
          media: [
            { id: 'MEDIA-HOME-05-TANK-COVER', selector: 'img[src$="/product-hero.webp"]' },
            { id: 'MEDIA-HOME-05-MATERIAL-EDGE', selector: 'img[src$="/rubberized-fabric.webp"]' },
          ],
        },
        {
          id: 'HOME-06',
          selector: '[aria-labelledby="start-title"]',
          pattern: 'S-CTA',
          titleRole: 'T-DISPLAY-M',
          theme: 'accent-light',
          variants: ['copy-right'],
          media: [],
        },
      ],
    },

    products: {
      pageId: 'PRODUCTS',
      blocks: [
        {
          id: 'PRODUCTS-01',
          selector: '[aria-labelledby="product-hero-title"]',
          pattern: 'S-HERO',
          titleRole: 'T-DISPLAY-XL',
          theme: 'light',
          variants: ['media-right'],
          media: [{ id: 'MEDIA-PRODUCTS-01-HERO-TANK', selector: '.product-hero__media img' }],
        },
        {
          id: 'PRODUCTS-02',
          selector: '[aria-labelledby="system-title"]',
          pattern: 'S-EDITORIAL-MEDIA',
          titleRole: 'T-DISPLAY-L',
          theme: 'light',
          variants: ['copy-left', 'media-right'],
          media: [{ id: 'MEDIA-PRODUCTS-02-VIDEO-FLEXIBILITY', selector: 'video[src$="/flexibility.mp4"]' }],
        },
        {
          id: 'PRODUCTS-03',
          selector: '[aria-labelledby="shell-title"]',
          pattern: 'S-GALLERY',
          titleRole: 'T-DISPLAY-L',
          theme: 'contrast-light',
          variants: ['two-layers', 'thickness-feature'],
          media: [
            { id: 'MEDIA-PRODUCTS-03-INNER-LAYER', selector: 'img[src$="/shell-inner.webp"]' },
            { id: 'MEDIA-PRODUCTS-03-OUTER-LAYER', selector: 'img[src$="/shell-outer.webp"]' },
            { id: 'MEDIA-PRODUCTS-03-EDGE-MACRO', selector: 'img[src$="/shell-edge.webp"]' },
          ],
        },
        {
          id: 'PRODUCTS-04',
          selector: '[aria-labelledby="flexibility-title"]',
          pattern: 'S-SPLIT',
          titleRole: 'T-DISPLAY-M',
          theme: 'paper',
          variants: ['video-after-copy'],
          media: [{ id: 'MEDIA-PRODUCTS-04-VIDEO-CATIA', selector: 'video[src$="/catia-rotation.mp4"]' }],
        },
        {
          id: 'PRODUCTS-05',
          selector: '[aria-labelledby="neck-title"]',
          pattern: 'S-GALLERY',
          titleRole: 'T-DISPLAY-L',
          theme: 'dark',
          variants: ['three-columns'],
          media: [
            { id: 'MEDIA-PRODUCTS-05-01', selector: 'img[src$="/neck-open.webp"]' },
            { id: 'MEDIA-PRODUCTS-05-02', selector: 'img[src$="/neck-parts.webp"]' },
            { id: 'MEDIA-PRODUCTS-05-03', selector: 'img[src$="/neck-assembled.webp"]' },
          ],
        },
        {
          id: 'PRODUCTS-06',
          selector: '[aria-labelledby="individual-title"]',
          pattern: 'S-SPECS S-GALLERY',
          titleRole: 'T-DISPLAY-L',
          theme: 'light',
          variants: ['four-media'],
          media: [
            { id: 'MEDIA-PRODUCTS-06-01', selector: 'img[src$="/airframe-bay-a.webp"]' },
            { id: 'MEDIA-PRODUCTS-06-02', selector: 'img[src$="/airframe-bay-b.webp"]' },
            { id: 'MEDIA-PRODUCTS-06-03', selector: 'img[src$="/airframe-bay-c.webp"]' },
            { id: 'MEDIA-PRODUCTS-06-04', selector: 'img[src$="/airframe-detail.webp"]' },
          ],
        },
        {
          id: 'PRODUCTS-07',
          selector: '[aria-labelledby="integration-title"]',
          pattern: 'S-SPLIT',
          titleRole: 'T-DISPLAY-M',
          theme: 'contrast-light',
          variants: ['copy-right', 'technical-visual-after'],
          media: [{ id: 'MEDIA-PRODUCTS-07-TECH-VISUAL', selector: '.future-visual--tall' }],
        },
        {
          id: 'PRODUCTS-08',
          selector: '[aria-labelledby="pickup-title"]',
          pattern: 'S-EDITORIAL-MEDIA',
          titleRole: 'T-DISPLAY-M',
          theme: 'light-gradient',
          variants: ['multi-media', 'pickup'],
          media: [
            { id: 'MEDIA-PRODUCTS-08-PICKUP', selector: 'img[src$="/pickup-module.webp"]' },
            { id: 'MEDIA-PRODUCTS-08-DETAIL', selector: 'img[src$="/pickup-detail.webp"]' },
          ],
        },
        {
          id: 'PRODUCTS-09',
          selector: '[aria-labelledby="fittings-title"]',
          pattern: 'S-MEDIA-COPY',
          titleRole: 'T-DISPLAY-M',
          theme: 'dark',
          variants: ['media-left'],
          media: [{ id: 'MEDIA-PRODUCTS-09-FITTINGS', selector: 'img[src$="/fittings-top.webp"]' }],
        },
        {
          id: 'PRODUCTS-10',
          selector: '[aria-labelledby="conditions-title"]',
          pattern: 'S-STATEMENT',
          titleRole: 'T-DISPLAY-L',
          theme: 'dark-background-photo',
          variants: ['full-media'],
          media: [{ id: 'MEDIA-PRODUCTS-10-BACKGROUND', selector: '.conditions-section__background' }],
        },
        {
          id: 'PRODUCTS-11',
          selector: '[aria-labelledby="special-title"]',
          pattern: 'S-MEDIA-COPY',
          titleRole: 'T-DISPLAY-M',
          theme: 'light',
          variants: ['reverse'],
          media: [{ id: 'MEDIA-PRODUCTS-11-SCHEME', selector: 'img[src$="/self-sealing.webp"]' }],
        },
        {
          id: 'PRODUCTS-12',
          selector: '[aria-labelledby="development-title"]',
          pattern: 'S-SPLIT',
          titleRole: 'T-DISPLAY-M',
          theme: 'contrast-light',
          variants: ['copy-right'],
          media: [],
        },
        {
          id: 'PRODUCTS-13',
          selector: '[aria-labelledby="mockup-title"]',
          pattern: 'S-EDITORIAL-MEDIA',
          titleRole: 'T-DISPLAY-M',
          theme: 'light',
          variants: ['mockup', 'prototype-after'],
          media: [
            { id: 'MEDIA-PRODUCTS-13-MOCKUP-01', selector: 'img[src$="/mockup-full.webp"]' },
            { id: 'MEDIA-PRODUCTS-13-MOCKUP-02', selector: 'img[src$="/mockup-close.webp"]' },
          ],
        },
        {
          id: 'PRODUCTS-14',
          selector: '[aria-labelledby="testing-title"]',
          pattern: 'S-METRICS',
          titleRole: 'T-DISPLAY-L',
          theme: 'contrast-light',
          variants: ['two-cards'],
          media: [],
        },
        {
          id: 'PRODUCTS-15',
          selector: '[aria-labelledby="russian-title"]',
          pattern: 'S-MEDIA-COPY',
          titleRole: 'T-DISPLAY-M',
          theme: 'dark',
          variants: ['media-left'],
          media: [{ id: 'MEDIA-PRODUCTS-15-MATERIAL', selector: 'img[src$="/rubberized-fabric.webp"]' }],
        },
        {
          id: 'PRODUCTS-16',
          selector: '[aria-labelledby="delivery-title"]',
          pattern: 'S-SPLIT',
          titleRole: 'T-DISPLAY-M',
          theme: 'light',
          variants: ['copy-right'],
          media: [],
        },
        {
          id: 'PRODUCTS-17',
          selector: '[aria-labelledby="final-title"]',
          pattern: 'S-CTA',
          titleRole: 'T-DISPLAY-L',
          theme: 'accent-light',
          variants: ['copy-right'],
          media: [],
        },
      ],
    },

    contacts: {
      pageId: 'CONTACTS',
      blocks: [
        {
          id: 'CONTACTS-01',
          selector: '[aria-labelledby="contacts-title"]',
          pattern: 'S-HERO',
          titleRole: 'T-DISPLAY-L',
          theme: 'light',
          variants: ['compact', 'copy-right'],
          media: [],
        },
        {
          id: 'CONTACTS-02',
          selector: '.contact-details',
          pattern: 'S-SPLIT',
          titleRole: 'T-DISPLAY-M',
          theme: 'light',
          variants: ['contact-data'],
          media: [],
        },
      ],
    },

    faq: {
      pageId: 'FAQ',
      blocks: [
        {
          id: 'FAQ-01',
          selector: '[aria-labelledby="faq-title"]',
          pattern: 'S-HERO',
          titleRole: 'T-DISPLAY-L',
          theme: 'light',
          variants: ['compact'],
          media: [],
        },
        {
          id: 'FAQ-02',
          selector: '.faq-section',
          pattern: 'S-FAQ',
          titleRole: 'none',
          theme: 'light',
          variants: ['native-details'],
          media: [],
        },
        {
          id: 'FAQ-03',
          selector: '[aria-labelledby="faq-contact-title"]',
          pattern: 'S-CTA',
          titleRole: 'T-DISPLAY-M',
          theme: 'accent-light',
          variants: ['copy-right'],
          media: [],
        },
      ],
    },

    about: {
      pageId: 'ABOUT',
      blocks: [
        {
          id: 'ABOUT-01',
          selector: '[aria-labelledby="about-title"]',
          pattern: 'S-HERO',
          titleRole: 'ACCESSIBILITY-ONLY',
          theme: 'light',
          variants: ['compact', 'logo-primary'],
          media: [
            { id: 'MEDIA-GLOBAL-LOGO', selector: '.about-hero__logo' },
          ],
        },
        {
          id: 'ABOUT-02',
          selector: '[aria-labelledby="origin-title"]',
          pattern: 'S-SPLIT',
          titleRole: 'T-DISPLAY-M',
          theme: 'light',
          variants: ['copy-right'],
          media: [],
        },
        {
          id: 'ABOUT-03',
          selector: '[aria-labelledby="engineering-title"]',
          pattern: 'S-SPLIT',
          titleRole: 'T-DISPLAY-M',
          theme: 'contrast-light',
          variants: ['copy-right'],
          media: [],
        },
      ],
    },
  });

  // Добавляем архитектурные метаданные к текущему DOM без перестройки и удаления рабочей разметки.
  const pageName = document.body.dataset.page || 'home';
  const currentPage = pages[pageName];

  // Назначаем только роли из SETTINGS.TYPE; локальные размеры не кодируются в PAGE-блоках.
  const assignTypeRoles = (section, block) => {
    /*
     * Канонический [BR] является предпочтительным переносом desktop. На mobile
     * сам BR скрывается общим responsive-правилом, поэтому после него должен
     * оставаться обычный пробел: иначе соседние русские слова визуально
     * склеиваются. Пробел после видимого BR на desktop схлопывается браузером и
     * не меняет текст, порядок или авторскую разбивку заголовка.
     */
    section.querySelectorAll('h1 br, h2 br, h3 br').forEach(lineBreak => {
      const spacer = document.createElement('span');
      spacer.className = 'responsive-break-space';
      spacer.textContent = ' ';
      lineBreak.after(spacer);
    });

    /*
     * Цветовой span в сбалансированном display-заголовке некоторые движки
     * воспринимают как единую строку. Невидимый WBR после уже существующего
     * пробела сохраняет textContent один в один, но гарантирует естественный
     * перенос между словами без аварийного разрыва русской лексемы.
     */
    section.querySelectorAll('h1 > span:not(.responsive-break-space), h2 > span:not(.responsive-break-space), h3 > span:not(.responsive-break-space)').forEach(toneSpan => {
      [...toneSpan.childNodes].forEach(textNode => {
        if (textNode.nodeType !== Node.TEXT_NODE || !/\s/.test(textNode.textContent || '')) return;
        const fragment = document.createDocumentFragment();
        textNode.textContent.split(/(\s+)/).forEach(part => {
          if (!part) return;
          fragment.append(document.createTextNode(part));
          if (/^\s+$/.test(part)) fragment.append(document.createElement('wbr'));
        });
        textNode.replaceWith(fragment);
      });
    });

    // Сначала весь обычный текст получает базовую роль.
    section.querySelectorAll('p, li, summary, figcaption').forEach(element => {
      element.dataset.type = 'T-BODY';
    });

    // Затем смысловые разновидности текста уточняют базовую роль.
    const roleSelectors = [
      ['.eyebrow', 'T-EYEBROW'],
      ['.body-lead, .lead-line, .hero__lead, .about-hero__lead', 'T-LEAD'],
      ['h3, .fact-list, .faq-item summary, .oversize-note', 'T-H3'],
      ['.responsibility__statement p', 'T-DISPLAY-M'],
      ['.pressure-card strong, .temperature, .thickness-feature strong', 'T-METRIC'],
      ['.result-card p, .layer-card p, .mockup-copy p, .prototype-copy p, .pickup-notes p, .neck-copy p', 'T-BODY-S'],
      /* Один FeatureList использует одну роль описания независимо от того,
       * находится абзац прямо в Stack или внутри FeatureItem. PRODUCTS-02
       * поэтому содержит три обычных текстовых типа плюс display-акцент. */
      ['.system-copy p', 'T-BODY'],
      ['.service-note, .testing-note, .gallery-item figcaption, .result-card > span, .layer-card > span, .thickness-feature > div > span', 'T-NOTE'],
      ['.result-card strong', 'T-BODY'],
      ['.contact-page__facts span', 'T-BODY-S'],
      ['.contact-details a[href^="mailto:"]', 'T-DISPLAY-M'],
    ];

    roleSelectors.forEach(([selector, role]) => {
      section.querySelectorAll(selector).forEach(element => {
        element.dataset.type = role;
      });
    });

    /* Mockup + Prototype использует три обычные текстовые роли: Eyebrow, H3
     * и Body. Крупный H2 остаётся разрешённым четвёртым акцентом. Вводный,
     * списочный и завершающий текст поэтому имеют идентичную Body-геометрию. */
    if (block.variants.includes('mockup')) {
      section.querySelectorAll('.section-intro > .body-lead, .mockup-copy p, .mockup-copy li, .prototype-copy > p:not(.eyebrow)').forEach(element => {
        element.dataset.type = 'T-BODY';
      });
      section.querySelectorAll('.prototype-copy > .eyebrow').forEach(element => {
        element.dataset.type = 'T-EYEBROW';
      });
    }

    // Каноническая роль заголовка блока применяется к первому H1/H2 этого блока.
    if (block.titleRole.startsWith('T-')) {
      const title = section.querySelector('h1, h2');
      if (title) title.dataset.type = block.titleRole;
    }
  };

  // Добавляет один или несколько C-компонентов без перезаписи уже назначенных ролей элемента.
  const addComponents = (element, ...componentNames) => {
    if (!element) return;
    const components = new Set((element.dataset.component || '').split(' ').filter(Boolean));
    componentNames.forEach(componentName => components.add(componentName));
    element.dataset.component = [...components].join(' ');
  };

  // Назначает семантический слот существующему узлу; содержимое и порядок DOM при этом не меняются.
  const assignSlot = (section, selector, slotName) => {
    section.querySelectorAll(selector).forEach(element => {
      element.dataset.slot = slotName;
    });
  };

  // Монтирует существующий PAGE CONTENT на общие primitives, components и pattern slots.
  const mountBlockArchitecture = (section, block) => {
    const patternClasses = {
      'S-HERO': 'p-hero',
      'S-STATEMENT': 'p-statement',
      'S-EDITORIAL': 'p-editorial',
      'S-EDITORIAL-MEDIA': 'p-editorial-media',
      'S-SPLIT': 'p-split',
      'S-MEDIA-COPY': 'p-media-copy',
      'S-METRICS': 'p-metrics',
      'S-GALLERY': 'p-gallery',
      'S-SPECS': 'p-specs',
      'S-FAQ': 'p-faq',
      'S-CTA': 'p-cta',
    };

    section.classList.add('l-section', 'p-section');
    block.pattern.split(' ').forEach(patternName => {
      const patternClass = patternClasses[patternName];
      if (patternClass) section.classList.add(patternClass);
    });

    // Все существующие оболочки страницы становятся экземплярами единого Container primitive.
    section.querySelectorAll(':scope > .section-shell').forEach(container => {
      container.classList.add('l-container');
      addComponents(container, 'C-CONTAINER');
    });

    // Композиционные классы связываются со стандартными primitives без создания CSS по BLOCK_ID.
    section.querySelectorAll('.split-copy, .media-copy-grid, .start-layout, .contact-page__layout, .about-hero__layout, .production-layout, .system-grid, .pickup-layout, .mockup-grid, .thickness-feature').forEach(layout => {
      layout.classList.add('l-split');
      layout.dataset.slot = 'layout';
      addComponents(layout, 'C-SPLIT');
    });
    section.querySelectorAll('.production-copy, .system-copy, .split-copy__body, .start-layout__body, .pickup-notes').forEach(stack => {
      stack.classList.add('l-stack');
      addComponents(stack, 'C-STACK');
    });
    section.querySelectorAll('.result-grid, .layer-grid, .specification-grid, .pressure-grid, .faq-list, .contact-page__facts, .contact-details__grid').forEach(grid => {
      grid.classList.add('l-grid');
    });

    // Повторяемые смысловые элементы получают C-компоненты из SETTINGS.COMPONENTS.
    section.querySelectorAll('.section-intro').forEach(header => {
      header.classList.add('c-section-header');
      header.dataset.slot = 'header';
      addComponents(header, 'C-SECTION-HEADER');
    });
    section.querySelectorAll('.production-copy, .system-copy').forEach(list => {
      list.classList.add('c-feature-list');
      addComponents(list, 'C-FEATURE-LIST');
    });
    section.querySelectorAll('.text-block').forEach(item => {
      item.classList.add('c-feature-item');
      addComponents(item, 'C-FEATURE-ITEM');
    });
    section.querySelectorAll('.result-card, .pressure-card').forEach(card => {
      card.classList.add('c-metric-card');
      addComponents(card, 'C-METRIC-CARD');
    });
    section.querySelectorAll('.layer-card, .contact-page__facts span').forEach(card => {
      card.classList.add('c-info-card');
      addComponents(card, 'C-INFO-CARD');
    });
    section.querySelectorAll('.contact-details__grid > div').forEach(card => {
      card.classList.add('c-info-card');
      addComponents(card, 'C-INFO-CARD');
    });
    section.querySelectorAll('.faq-item').forEach(item => {
      item.classList.add('c-faq-item');
      addComponents(item, 'C-FAQ-ITEM');
    });
    section.querySelectorAll('.gallery-grid').forEach(gallery => {
      gallery.classList.add('c-gallery');
      gallery.dataset.slot = 'items';
      addComponents(gallery, 'C-GALLERY');
      gallery.style.setProperty('--gallery-columns', gallery.classList.contains('gallery-grid--four') ? '4' : '3');
    });
    section.querySelectorAll('.production-media, .layer-grid').forEach(gallery => {
      gallery.classList.add('c-gallery');
      addComponents(gallery, 'C-GALLERY');
      gallery.style.setProperty('--gallery-columns', gallery.classList.contains('layer-grid') ? '2' : '1');
    });
    section.querySelectorAll('.text-link').forEach(link => {
      link.classList.add('c-text-link', 'c-button', 'c-button--secondary');
      addComponents(link, 'C-TEXT-LINK', 'C-BUTTON');
    });
    section.querySelectorAll('.primary-button, .text-button, [data-contact-open]').forEach(button => {
      addComponents(button, 'C-BUTTON');
    });

    // Если паттерн не имеет отдельной обёртки layout, сам блок остаётся его layout-контекстом.
    if (!section.querySelector('[data-slot="layout"]') && /S-(?:HERO|SPLIT|MEDIA-COPY|CTA)/.test(block.pattern)) {
      section.dataset.slot = 'layout';
    }

    // Pattern slots описывают назначение существующих узлов и не задают уникальную сетку блока.
    assignSlot(section, '.responsibility__statement', 'statement');
    assignSlot(section, '.split-copy__body, .system-copy, .production-copy, .start-layout__body, .contact-page__body, .pickup-notes, .conditions-content', 'body');
    assignSlot(section, '.result-grid, .layer-grid, .pressure-grid, .faq-list, .contact-page__facts, .contact-details__grid', 'items');
    assignSlot(section, '.specification-grid', 'specs');

    section.dataset.architecture = 'mounted';
  };

  const migrationAudit = {
    pageId: currentPage?.pageId || null,
    expectedBlocks: currentPage?.blocks.length || 0,
    mountedBlocks: [],
    missingBlocks: [],
    missingMediaBindings: [],
    unmappedLightboxes: [],
  };

  // Реестр публикуется до обхода DOM, а отчёт наполняется в том же объекте по мере миграции.
  // Это гарантирует доступность MEDIA/PAGE данных для следующего общего сценария страницы.
  const architectureRegistry = { settings, media: mediaRegistry, pages, migrationAudit };
  window.BTSSiteArchitecture = architectureRegistry;
  document.body.BTSSiteArchitecture = architectureRegistry;
  document.body.dataset.architectureRegistry = 'assigned';

  if (currentPage) {
    document.body.dataset.pageId = currentPage.pageId;

    currentPage.blocks.forEach(block => {
      const section = document.querySelector(block.selector);
      if (!section) {
        migrationAudit.missingBlocks.push(block.id);
        return;
      }

      section.dataset.blockId = block.id;
      section.dataset.pattern = block.pattern;
      section.dataset.titleRole = block.titleRole;
      section.dataset.theme = block.theme;
      section.dataset.variants = block.variants.join(' ');
      section.dataset.mediaIds = block.media.map(item => item.id).join(' ');

      assignTypeRoles(section, block);
      mountBlockArchitecture(section, block);
      migrationAudit.mountedBlocks.push(block.id);

      block.media.forEach(binding => {
        const target = section.matches(binding.selector) ? section : section.querySelector(binding.selector);
        if (!target) {
          migrationAudit.missingMediaBindings.push(`${block.id}:${binding.id}`);
          return;
        }

        const mediaRecord = mediaRegistry[binding.id];
        if (!mediaRecord) {
          migrationAudit.missingMediaBindings.push(`${block.id}:${binding.id}:registry`);
          return;
        }

        // Процедурный canvas HOME-01 создаётся позднее защищённым модулем.
        // Внешний observer только присваивает MEDIA_ID и не меняет генератор, параметры или алгоритм.
        if (target === section && mediaRecord.type === 'procedural-canvas') {
          section.dataset.proceduralMediaId = binding.id;
          const markCanvas = () => {
            const canvas = section.querySelector('canvas');
            if (!canvas) return false;
            canvas.dataset.mediaId = binding.id;
            canvas.dataset.mediaType = mediaRecord.type;
            addComponents(canvas, 'C-MEDIA');
            return true;
          };

          if (!markCanvas()) {
            const canvasObserver = new MutationObserver(() => {
              if (!markCanvas()) return;
              canvasObserver.disconnect();
            });
            canvasObserver.observe(section, { childList: true });
          }
          return;
        }

        target.dataset.mediaId = binding.id;

        // Фактический источник также читается из реестра; существующий DOM остаётся fallback без JS.
        if (mediaRecord.src && target.matches('img, video') && target.getAttribute('src') !== mediaRecord.src) {
          target.setAttribute('src', mediaRecord.src);
        }
        if (mediaRecord.src && mediaRecord.type === 'background-photo') {
          target.style.setProperty('--media-source', `url("${mediaRecord.src}")`);
        }

        target.dataset.mediaType = mediaRecord.type;
        target.dataset.mediaCrop = mediaRecord.crop;
        if (mediaRecord.role) target.dataset.mediaRole = mediaRecord.role;

        // Интерактивная оболочка является экземпляром C-MEDIA и получает политику из реестра.
        const mediaHost = target.matches('img, video')
          ? target.closest('button, figure, [class*="media"]') || target
          : target;
        if (mediaHost && mediaHost !== section) {
          const components = new Set((mediaHost.dataset.component || '').split(' ').filter(Boolean));
          components.add('C-MEDIA');
          mediaHost.dataset.component = [...components].join(' ');
          mediaHost.dataset.mediaId = binding.id;
          mediaHost.dataset.mediaCrop = mediaRecord.crop;
          if (mediaRecord.role) mediaHost.dataset.mediaRole = mediaRecord.role;
          mediaHost.dataset.slot = 'media';
          mediaHost.classList.add('l-media');
          if (mediaRecord.openable && mediaHost.matches('button, a')) {
            mediaHost.dataset.lightbox = '';
            if (mediaRecord.src) mediaHost.dataset.lightboxSrc = mediaRecord.src;
          } else if (mediaRecord.openable === false) {
            mediaHost.removeAttribute('data-lightbox');
            mediaHost.removeAttribute('data-lightbox-src');
          }
        }
      });
    });

    document.querySelectorAll('[data-lightbox]').forEach(opener => {
      if (opener.closest('[data-block-id]') && opener.dataset.mediaId) return;
      migrationAudit.unmappedLightboxes.push(opener.getAttribute('aria-label') || opener.tagName);
    });

    document.body.dataset.architecture = 'mounted';
    document.querySelector('main')?.setAttribute('data-page-content', currentPage.pageId);
    document.body.dataset.architectureBlocks = String(document.querySelectorAll('[data-block-id][data-architecture="mounted"]').length);
    document.body.dataset.migrationStage9 = migrationAudit.mountedBlocks.length === migrationAudit.expectedBlocks
      && migrationAudit.missingBlocks.length === 0
      && migrationAudit.missingMediaBindings.length === 0
      && migrationAudit.unmappedLightboxes.length === 0
      ? 'complete'
      : 'incomplete';
  }

  // После наполнения отчёта конфигурация становится неизменяемой.
  deepFreeze(architectureRegistry);
})();
