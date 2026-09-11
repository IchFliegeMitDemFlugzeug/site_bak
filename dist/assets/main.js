/* ========================================================================== */
/* ОБЩАЯ ОБОЛОЧКА САЙТА                                                       */
/* ========================================================================== */

// Получаем короткое имя текущей страницы из атрибута body.
const currentPage = document.body.dataset.page || 'home';

// Находим места, куда будут вставлены одинаковые элементы всех страниц.
const headerMount = document.querySelector('[data-site-header]');
const footerMount = document.querySelector('[data-site-footer]');
const overlaysMount = document.querySelector('[data-site-overlays]');

// Функция добавляет aria-current только ссылке, соответствующей открытой странице.
function activeAttribute(pageName) {
  return currentPage === pageName ? ' aria-current="page"' : '';
}

// Вставляем единую матовую шапку, чтобы состав и порядок пунктов не расходились между страницами.
if (headerMount) {
  headerMount.innerHTML = `
    <header class="site-header" data-header>
      <a class="brand" href="/" aria-label="БТС — перейти на главную страницу">
        <img class="brand__logo" src="/assets/images/bts-logo.png" alt="БТС — Бортовые топливные системы" width="360" height="171">
      </a>

      <button class="menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="site-navigation">Меню</button>

      <nav class="nav" id="site-navigation" data-navigation aria-label="Основная навигация">
        <!-- Отдельная кнопка внутри выезжающей панели остаётся доступной даже на длинном мобильном меню. -->
        <button class="menu-close" type="button" data-menu-close aria-label="Скрыть меню">
          Скрыть <span aria-hidden="true">×</span>
        </button>
        <a href="/"${activeAttribute('home')}>Главная</a>
        <a href="/products/"${activeAttribute('products')}>Продукция</a>
        <a href="/contacts/"${activeAttribute('contacts')}>Контакты</a>
        <a href="/faq/"${activeAttribute('faq')}>Вопросы</a>
        <a href="/about/"${activeAttribute('about')}>О нас</a>
        <button class="nav__contact" type="button" data-contact-open>Связаться с нами</button>
      </nav>
    </header>
    <button class="nav-backdrop" type="button" data-menu-backdrop aria-label="Закрыть меню"></button>
  `;
}

// Вставляем общий подвал с ключевыми переходами и прямым адресом электронной почты.
if (footerMount) {
  footerMount.innerHTML = `
    <footer class="site-footer">
      <div class="footer-layout">
        <p>БТС / Бортовые топливные системы</p>
        <nav class="footer-links" aria-label="Навигация в подвале">
          <a href="/">Главная</a>
          <a href="/products/">Продукция</a>
          <a href="/faq/">Вопросы</a>
          <a href="/about/">О нас</a>
        </nav>
        <a href="mailto:info@btsystems.ru">info@btsystems.ru</a>
      </div>
    </footer>
  `;
}

// Общая форма связи остаётся единственным нативным dialog; фотографии обслуживает PhotoSwipe.
if (overlaysMount) {
  overlaysMount.innerHTML = `
    <dialog class="contact-dialog" data-contact-dialog data-component="contact-dialog" aria-labelledby="contact-dialog-title">
      <div class="contact-dialog__shell">
        <button class="dialog-close" type="button" data-contact-close aria-label="Закрыть форму">×</button>

        <div class="contact-dialog__header">
          <p class="eyebrow">ПЕРВЫЙ КОНТАКТ / БТС</p>
          <h2 id="contact-dialog-title">Обсудим<br><span>ваш проект.</span></h2>
          <p>Для первого разговора достаточно нескольких предложений о БВС, требуемом запасе топлива и предполагаемом месте установки бака.</p>
        </div>

        <form class="contact-form" data-contact-form novalidate>
          <div class="contact-form__grid">
            <label class="contact-field">
              <span>Имя <strong aria-hidden="true">*</strong></span>
              <input type="text" name="name" autocomplete="name" required placeholder="Как к вам обращаться">
            </label>

            <label class="contact-field">
              <span>Компания</span>
              <input type="text" name="company" autocomplete="organization" placeholder="Название организации">
            </label>

            <fieldset class="contact-methods" data-contact-methods>
              <legend>Как с вами связаться <strong aria-hidden="true">*</strong></legend>
              <div class="contact-methods__grid">
                <label class="contact-field">
                  <span>Почта</span>
                  <input type="email" name="email" autocomplete="email" inputmode="email" placeholder="name@company.ru" data-contact-email>
                </label>
                <label class="contact-field">
                  <span>Телефон</span>
                  <input type="tel" name="phone" autocomplete="tel" inputmode="tel" placeholder="+7 900 000-00-00" data-contact-phone>
                </label>
              </div>
              <p class="contact-methods__hint">Укажите почту или номер телефона — достаточно одного способа связи.</p>
            </fieldset>

            <label class="contact-field contact-field--wide">
              <span>Задача и исходные данные</span>
              <textarea name="request" rows="5" placeholder="Тип БВС, силовая установка, примерный объём топлива и место установки бака"></textarea>
            </label>
          </div>

          <div class="contact-form__footer">
            <p>После отправки откроется подготовленное письмо на адрес info@btsystems.ru. Данные не сохраняются на сайте.</p>
            <button class="primary-button" type="submit">Отправить запрос <span aria-hidden="true">↗</span></button>
          </div>
          <p class="contact-form__status" data-contact-status aria-live="polite"></p>
        </form>
      </div>
    </dialog>
  `;
}

/* ========================================================================== */
/* ЕДИНЫЙ КОМПОНЕНТ СТАНДАРТНОЙ КНОПКИ                                       */
/* ========================================================================== */

// Все обычные CTA используют одну геометрию; специальные медиа-кнопки и круглые кнопки закрытия исключены.
document.querySelectorAll('.primary-button, .nav__contact').forEach(button => {
  button.classList.add('c-button', 'c-button--primary');
  button.dataset.component = [...new Set(`${button.dataset.component || ''} C-BUTTON`.trim().split(/\s+/))].join(' ');
});

// Вторичные текстовые кнопки используют тот же размер, но отдельный визуальный вариант.
document.querySelectorAll('.text-button, .menu-toggle, .menu-close, .dialog-close').forEach(button => {
  button.classList.add('c-button', 'c-button--secondary');
  button.dataset.component = [...new Set(`${button.dataset.component || ''} C-BUTTON`.trim().split(/\s+/))].join(' ');
});

document.querySelectorAll('.dialog-close').forEach(button => {
  button.classList.add('c-button--icon');
});

// Полная ширина разрешена только как явно названный мобильный вариант кнопки отправки формы.
document.querySelector('.contact-form__footer .primary-button')?.classList.add('c-button--wide-mobile');

// Текстовые роли формы также берутся только из канонического набора SETTINGS.TYPE.
document.querySelector('[data-contact-dialog] h2')?.setAttribute('data-type', 'T-DISPLAY-M');
document.querySelectorAll('[data-contact-dialog] .eyebrow, [data-contact-dialog] label > span, [data-contact-dialog] legend').forEach(element => {
  element.dataset.type = 'T-EYEBROW';
});
document.querySelectorAll('[data-contact-dialog] p, [data-contact-dialog] input, [data-contact-dialog] textarea').forEach(element => {
  if (!element.dataset.type) element.dataset.type = 'T-BODY-S';
});

/* ========================================================================== */
/* ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ                                                    */
/* ========================================================================== */

/* ========================================================================== */
/* ПОЯВЛЕНИЕ ЭЛЕМЕНТОВ                                                        */
/* ========================================================================== */

// Находим все элементы, которые должны один раз проявиться при входе в видимую область.
const revealItems = document.querySelectorAll('.reveal');

// Наблюдатель экономнее постоянного перебора элементов в событии scroll.
const revealObserver = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
  });
}, { threshold: .1, rootMargin: '0px 0px -7% 0px' });

// Подключаем каждый подготовленный элемент к одному наблюдателю.
revealItems.forEach(item => revealObserver.observe(item));

/* ========================================================================== */
/* ШАПКА И МОБИЛЬНОЕ МЕНЮ                                                     */
/* ========================================================================== */

// Получаем созданные выше элементы шапки и мобильной навигации.
const header = document.querySelector('[data-header]');
const menuToggle = document.querySelector('[data-menu-toggle]');
const menuClose = document.querySelector('[data-menu-close]');
const navigation = document.querySelector('[data-navigation]');
const menuBackdrop = document.querySelector('[data-menu-backdrop]');

// После небольшой прокрутки повышаем плотность матового стекла для читаемости.
function updateHeader() {
  header?.classList.toggle('is-scrolled', window.scrollY > 24);
}

// Единая функция открывает и закрывает мобильное меню и синхронизирует aria-expanded.
function setMenuOpen(isOpen) {
  navigation?.classList.toggle('is-open', isOpen);
  menuBackdrop?.classList.toggle('is-visible', isOpen);
  menuToggle?.setAttribute('aria-expanded', String(isOpen));
  document.body.classList.toggle('menu-open', isOpen);
}

// Кнопка меню переключает текущее состояние панели.
menuToggle?.addEventListener('click', () => {
  setMenuOpen(!navigation?.classList.contains('is-open'));
});

// Явная кнопка «Скрыть» закрывает боковую панель без необходимости тянуться к затемнению.
menuClose?.addEventListener('click', () => setMenuOpen(false));

// Нажатие на затемнение закрывает меню.
menuBackdrop?.addEventListener('click', () => setMenuOpen(false));

// Переход по любому пункту также закрывает мобильную панель.
navigation?.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => setMenuOpen(false));
});

// Escape — дополнительный предсказуемый способ закрыть мобильную навигацию с клавиатуры.
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigation?.classList.contains('is-open')) {
    setMenuOpen(false);
  }
});

// Первичное состояние шапки рассчитываем сразу после построения оболочки.
updateHeader();

/* ========================================================================== */
/* PHOTOSWIPE V5 / ЕДИНЫЙ ПОЛНОЭКРАННЫЙ ПРОСМОТР                             */
/* ========================================================================== */

// Получаем все открываемые изображения после того, как архитектурный реестр назначил им BLOCK_ID.
const lightboxOpeners = [...document.querySelectorAll('[data-lightbox]')];

// Один экземпляр PhotoSwipe обслуживает весь сайт; данные меняются только при открытии конкретного блока.
const PhotoSwipeCore = window.PhotoSwipe;
const PhotoSwipeLightboxClass = window.PhotoSwipeLightbox;
let siteLightbox = null;

if (PhotoSwipeCore && PhotoSwipeLightboxClass && lightboxOpeners.length) {
  // Группируем фотографии по ближайшему смысловому BLOCK_ID независимо от их положения в сетке.
  const lightboxGroups = new Map();

  lightboxOpeners.forEach((opener, openerIndex) => {
    const sourceImage = opener.querySelector('img');
    const source = opener.dataset.lightboxSrc || sourceImage?.currentSrc || sourceImage?.src;
    if (!source || !sourceImage) return;

    const blockId = opener.closest('[data-block-id]')?.dataset.blockId || `${currentPage}-UNMAPPED-${openerIndex}`;
    const mediaId = opener.dataset.mediaId || sourceImage.dataset.mediaId;
    const architectureRegistry = document.body.BTSSiteArchitecture || window.BTSSiteArchitecture;
    const mediaRecord = mediaId ? architectureRegistry?.media?.[mediaId] : null;
    if (mediaRecord?.openable === false) return;

    const width = mediaRecord?.width || Number(sourceImage.getAttribute('width')) || sourceImage.naturalWidth || 1600;
    const height = mediaRecord?.height || Number(sourceImage.getAttribute('height')) || sourceImage.naturalHeight || 1200;
    const item = {
      src: source,
      msrc: sourceImage.currentSrc || sourceImage.src,
      width,
      height,
      alt: sourceImage.alt || 'Фотография БТС',
      element: opener,
      mediaId,
    };

    if (!lightboxGroups.has(blockId)) lightboxGroups.set(blockId, []);
    lightboxGroups.get(blockId).push({ opener, item });
  });

  // Канонические параметры обеспечивают клавиатуру, жесты, масштабирование и отсутствие цикла.
  siteLightbox = new PhotoSwipeLightboxClass({
    pswpModule: PhotoSwipeCore,
    mainClass: 'bts-photoswipe',
    bgOpacity: 0.96,
    spacing: 0.08,
    loop: false,
    wheelToZoom: true,
    arrowKeys: true,
    escKey: true,
    counter: true,
    indexIndicatorSep: ' / ',
    bgClickAction: 'close',
    imageClickAction: false,
    doubleTapAction: 'zoom',
    tapAction: 'toggle-controls',
    allowPanToNext: true,
    pinchToClose: true,
    closeOnVerticalDrag: true,
    returnFocus: true,
    closeTitle: 'Закрыть просмотр',
    zoomTitle: 'Изменить масштаб',
    arrowPrevTitle: 'Предыдущее изображение',
    arrowNextTitle: 'Следующее изображение',
    errorMsg: 'Не удалось загрузить изображение',
  });

  // Недоступные стрелки скрываются на границах, а у одиночного изображения отсутствуют обе.
  const updateBoundaryControls = () => {
    const photoswipe = siteLightbox?.pswp;
    if (!photoswipe?.element) return;

    const total = photoswipe.getNumItems();
    const previousButton = photoswipe.element.querySelector('.pswp__button--arrow--prev');
    const nextButton = photoswipe.element.querySelector('.pswp__button--arrow--next');
    const hidePrevious = total <= 1 || photoswipe.currIndex === 0;
    const hideNext = total <= 1 || photoswipe.currIndex === total - 1;

    if (previousButton) {
      previousButton.hidden = hidePrevious;
      previousButton.setAttribute('aria-disabled', String(hidePrevious));
    }
    if (nextButton) {
      nextButton.hidden = hideNext;
      nextButton.setAttribute('aria-disabled', String(hideNext));
    }
  };

  // При уходе со слайда возвращаем его к начальному масштабу и центральному положению.
  let previousSlide = null;
  siteLightbox.on('change', () => {
    const currentSlide = siteLightbox?.pswp?.currSlide;
    if (previousSlide && previousSlide !== currentSlide) {
      previousSlide.zoomAndPanToInitial();
      previousSlide.applyCurrentZoomPan();
    }
    previousSlide = currentSlide;
    window.requestAnimationFrame(updateBoundaryControls);
  });
  siteLightbox.on('afterInit', () => {
    updateBoundaryControls();

    // PhotoSwipe обрабатывает double tap на touch; для мыши добавляем эквивалентный double-click.
    const photoswipe = siteLightbox?.pswp;
    photoswipe?.element?.addEventListener('dblclick', event => {
      if (!event.target.closest('.pswp__img, .pswp__zoom-wrap')) return;
      event.preventDefault();
      photoswipe.currSlide?.toggleZoom({
        x: event.pageX - photoswipe.offset.x,
        y: event.pageY - photoswipe.offset.y,
      });
    });
  });
  siteLightbox.on('destroy', () => {
    previousSlide = null;
  });
  siteLightbox.init();

  // Открываем только группу текущего BLOCK_ID и сохраняем стартовую точку анимации.
  lightboxGroups.forEach(group => {
    const dataSource = group.map(entry => entry.item);
    group.forEach((entry, index) => {
      entry.opener.addEventListener('click', event => {
        event.preventDefault();
        const initialPoint = event.clientX || event.clientY
          ? { x: event.clientX, y: event.clientY }
          : null;
        siteLightbox.loadAndOpen(index, dataSource, initialPoint);
      });
    });
  });
}

/* ========================================================================== */
/* ФОРМА ОБРАТНОЙ СВЯЗИ                                                      */
/* ========================================================================== */

// Находим форму и все элементы, участвующие в открытии, закрытии и проверке данных.
const contactDialog = document.querySelector('[data-contact-dialog]');
const contactOpeners = [...document.querySelectorAll('[data-contact-open]')];
const contactCloser = document.querySelector('[data-contact-close]');
const contactForm = document.querySelector('[data-contact-form]');
const contactEmail = document.querySelector('[data-contact-email]');
const contactPhone = document.querySelector('[data-contact-phone]');
const contactMethods = document.querySelector('[data-contact-methods]');
const contactStatus = document.querySelector('[data-contact-status]');
let contactCloseTimer = 0;

// Панель въезжает справа после перехода dialog в модальный режим.
function openContactDialog() {
  if (!contactDialog || contactDialog.open) return;
  setMenuOpen(false);
  window.clearTimeout(contactCloseTimer);
  contactDialog.classList.remove('is-closing');
  contactDialog.showModal();
  document.documentElement.classList.add('dialog-open');
  requestAnimationFrame(() => contactDialog.classList.add('is-open'));
}

// Закрытие ждёт завершения CSS-перехода, поэтому панель действительно уплывает за край экрана.
function closeContactDialog() {
  if (!contactDialog?.open) return;
  contactDialog.classList.remove('is-open');
  contactDialog.classList.add('is-closing');
  contactCloseTimer = window.setTimeout(() => {
    contactDialog.close();
    contactDialog.classList.remove('is-closing');
    document.documentElement.classList.remove('dialog-open');
  }, 480);
}

// Все целевые кнопки сайта открывают одну и ту же форму.
contactOpeners.forEach(opener => opener.addEventListener('click', openContactDialog));
contactCloser?.addEventListener('click', closeContactDialog);
contactDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  closeContactDialog();
});
contactDialog?.addEventListener('click', event => {
  if (event.target === contactDialog) closeContactDialog();
});

// Пользователь обязан оставить хотя бы один способ связи: почту или телефон.
function validateContactMethod() {
  const hasEmail = Boolean(contactEmail?.value.trim());
  const hasPhone = Boolean(contactPhone?.value.trim());
  const isMissing = !hasEmail && !hasPhone;

  contactEmail?.setCustomValidity(isMissing ? 'Укажите почту или номер телефона.' : '');
  contactMethods?.classList.toggle('has-error', isMissing);
  return !isMissing;
}

contactEmail?.addEventListener('input', validateContactMethod);
contactPhone?.addEventListener('input', validateContactMethod);

// После проверки формируем понятное структурированное письмо в почтовом приложении посетителя.
contactForm?.addEventListener('submit', event => {
  event.preventDefault();
  validateContactMethod();

  if (!contactForm.checkValidity()) {
    contactForm.reportValidity();
    return;
  }

  const formData = new FormData(contactForm);
  const name = String(formData.get('name') || '').trim();
  const company = String(formData.get('company') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const phone = String(formData.get('phone') || '').trim();
  const request = String(formData.get('request') || '').trim();
  const subject = company ? `Запрос с сайта БТС — ${company}` : `Запрос с сайта БТС — ${name}`;
  const body = [
    `Имя: ${name}`,
    `Компания: ${company || 'не указана'}`,
    `Почта: ${email || 'не указана'}`,
    `Телефон: ${phone || 'не указан'}`,
    '',
    'Задача и исходные данные:',
    request || 'не указаны',
  ].join('\n');

  if (contactStatus) contactStatus.textContent = 'Открываем подготовленное письмо…';
  window.location.href = `mailto:info@btsystems.ru?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

/* ========================================================================== */
/* ВИДЕО И ВНУТРЕННЯЯ НАВИГАЦИЯ ПРОДУКЦИИ                                   */
/* ========================================================================== */

// Видеоролики запускаются без звука только в видимой области и останавливаются вне неё.
const smartVideos = document.querySelectorAll('[data-smart-video]');
const videoObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  });
}, { threshold: .35 });

smartVideos.forEach(video => videoObserver.observe(video));

// Компактная навигация продукции появляется после первого смыслового экрана.
const productSubnav = document.querySelector('[data-product-subnav]');
function updateProductSubnav() {
  productSubnav?.classList.toggle('is-visible', window.scrollY > window.innerHeight * .62);
}
updateProductSubnav();

// Один пассивный обработчик обслуживает шапку и поднавигацию без лишних вычислений.
window.addEventListener('scroll', () => {
  updateHeader();
  updateProductSubnav();
}, { passive: true });

// Escape закрывает мобильное меню, когда не открыт нативный dialog.
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !contactDialog?.open && !siteLightbox?.pswp) setMenuOpen(false);
});
