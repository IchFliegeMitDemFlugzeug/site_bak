/* ========================================================================== */
/* ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ                                                    */
/* ========================================================================== */

// Ограничиваем любое числовое значение диапазоном от min до max.
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Переводим текущее положение секции относительно окна браузера в прогресс 0…1.
function sectionProgress(section) {
  // Получаем прямоугольник секции относительно текущего окна браузера.
  const rect = section.getBoundingClientRect();
  // Высота окна нужна для расчёта полной прокручиваемой дистанции.
  const viewport = window.innerHeight;
  // Общая дистанция равна высоте секции минус один экран.
  const distance = Math.max(section.offsetHeight - viewport, 1);
  // Когда верх секции находится в верхней границе окна, progress должен начать расти.
  const travelled = clamp(-rect.top, 0, distance);
  // Возвращаем нормированное значение от 0 до 1.
  return travelled / distance;
}

/* ========================================================================== */
/* REVEAL ПРИ ПОЯВЛЕНИИ                                                       */
/* ========================================================================== */

// Находим все элементы, которые должны один раз появиться при входе в экран.
const revealItems = document.querySelectorAll('.reveal, .reveal-dark');

// IntersectionObserver работает эффективнее постоянной проверки каждого элемента в scroll-событии.
const revealObserver = new IntersectionObserver((entries, observer) => {
  // Обрабатываем каждое изменение видимости отслеживаемого элемента.
  entries.forEach((entry) => {
    // Если элемент вошёл примерно в нижние 88% экрана, запускаем его появление.
    if (entry.isIntersecting) {
      // CSS-класс переводит opacity и transform в конечное состояние.
      entry.target.classList.add('is-visible');
      // Повторно отслеживать элемент после первого появления не требуется.
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

// Подключаем каждый элемент к наблюдателю.
revealItems.forEach((item) => revealObserver.observe(item));

/* ========================================================================== */
/* СЧЁТЧИК НА ПЕРВОМ ЭКРАНЕ                                                   */
/* ========================================================================== */

// Находим контейнер счётчика и само числовое поле.
const counterWrap = document.querySelector('[data-counter-wrap]');
const counter = document.querySelector('[data-counter]');

// Запускаем счётчик только тогда, когда он реально виден пользователю.
if (counterWrap && counter) {
  // Создаём отдельный наблюдатель для счётчика.
  const counterObserver = new IntersectionObserver((entries, observer) => {
    // Нам достаточно первой записи, потому что наблюдается один контейнер.
    const entry = entries[0];
    // Если счётчик ещё не вошёл в экран, ничего не делаем.
    if (!entry.isIntersecting) return;
    // Конечное значение берём из data-counter в HTML.
    const target = Number(counter.dataset.counter) || 0;
    // Запоминаем время старта анимации.
    const start = performance.now();
    // Длительность анимации в миллисекундах.
    const duration = 900;

    // Функция одного кадра вызывается requestAnimationFrame.
    function tick(now) {
      // Переводим прошедшее время в прогресс 0…1.
      const progress = clamp((now - start) / duration, 0, 1);
      // Нелинейная функция делает финиш более мягким.
      const eased = 1 - Math.pow(1 - progress, 3);
      // Округляем промежуточное значение до целого числа.
      counter.textContent = String(Math.round(target * eased));
      // Пока прогресс меньше единицы, просим браузер нарисовать следующий кадр.
      if (progress < 1) requestAnimationFrame(tick);
    }

    // Запускаем первый кадр.
    requestAnimationFrame(tick);
    // Повторный запуск счётчика не нужен.
    observer.disconnect();
  }, { threshold: 0.4 });

  // Начинаем наблюдать контейнер счётчика.
  counterObserver.observe(counterWrap);
}

/* ========================================================================== */
/* HEADER                                                                     */
/* ========================================================================== */

// Получаем шапку страницы.
const header = document.querySelector('[data-header]');

// Функция меняет состояние шапки после первых нескольких пикселей прокрутки.
function updateHeader() {
  // classList.toggle со вторым аргументом явно задаёт, должен ли класс существовать.
  header?.classList.toggle('is-scrolled', window.scrollY > 24);
}

// Сразу синхронизируем состояние после загрузки.
updateHeader();

/* ========================================================================== */
/* ПАРАЛЛАКС                                                                  */
/* ========================================================================== */

// Находим элементы с коэффициентом параллакса в data-parallax.
const parallaxItems = [...document.querySelectorAll('[data-parallax]')];

// Рассчитываем мягкое смещение относительно центра окна.
function updateParallax() {
  // Проходим по каждому независимому объекту.
  parallaxItems.forEach((item) => {
    // Считываем коэффициент из HTML; положительный и отрицательный знак меняют направление.
    const factor = Number(item.dataset.parallax) || 0;
    // Положение элемента относительно экрана.
    const rect = item.getBoundingClientRect();
    // Расстояние центра элемента от центра окна.
    const centerDelta = rect.top + rect.height / 2 - window.innerHeight / 2;
    // Ограничиваем амплитуду, чтобы объект не улетал далеко за макет.
    const y = clamp(-centerDelta * factor, -90, 90);
    // Используем translate3d: браузер обычно композитит его плавнее обычного top/left.
    item.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
  });
}

/* ========================================================================== */
/* ТЁМНАЯ СЦЕНА ИНТЕГРАЦИИ                                                    */
/* ========================================================================== */

// Получаем секцию, визуал и дочерние элементы, состояние которых зависит от scroll progress.
const integration = document.querySelector('.integration');
const integrationVisual = document.querySelector('[data-integration-visual]');
const fuelZones = [...document.querySelectorAll('.fuel-zone')];
const integrationLabels = [...document.querySelectorAll('.integration-label')];
const progressBar = document.querySelector('[data-progress-bar]');

// Функция обновляет всю сцену на основе положения прокрутки внутри секции.
function updateIntegration() {
  // Если секция отсутствует, безопасно выходим.
  if (!integration) return;
  // Получаем нормированный прогресс от 0 до 1.
  const p = sectionProgress(integration);
  // Визуал слегка увеличивается и поднимается по мере истории.
  if (integrationVisual) {
    const scale = 0.93 + p * 0.09;
    const y = 36 - p * 60;
    integrationVisual.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
  }
  // Каждая топливная зона проявляется с небольшим временным сдвигом.
  fuelZones.forEach((zone, index) => {
    const local = clamp((p - (0.16 + index * 0.09)) / 0.28, 0, 1);
    zone.style.opacity = local.toFixed(3);
    zone.style.transform = `scale(${(0.72 + local * 0.28).toFixed(3)})`;
  });
  // Подписи появляются позднее самих зон, чтобы сцена читалась последовательно.
  integrationLabels.forEach((label, index) => {
    const local = clamp((p - (0.35 + index * 0.10)) / 0.20, 0, 1);
    label.style.opacity = local.toFixed(3);
    label.style.transform = `translateY(${((1 - local) * 12).toFixed(2)}px)`;
  });
  // Высота индикатора показывает фактический прогресс сцены.
  if (progressBar) progressBar.style.height = `${(p * 100).toFixed(2)}%`;
}

/* ========================================================================== */
/* ГОРИЗОНТАЛЬНАЯ ИСТОРИЯ ПРОЦЕССА                                            */
/* ========================================================================== */

// Получаем большую секцию процесса и её длинную горизонтальную ленту.
const processSection = document.querySelector('.process');
const processTrack = document.querySelector('[data-process-track]');

// Вертикальную прокрутку секции переводим в горизонтальное движение карточек.
function updateProcess() {
  // Без секции или ленты ничего рассчитывать не нужно.
  if (!processSection || !processTrack) return;
  // Получаем прогресс прокрутки внутри трёхэкранной секции.
  const p = sectionProgress(processSection);
  // Максимальное смещение вычисляется из реальной ширины контента и ширины окна.
  const maxShift = Math.max(processTrack.scrollWidth - window.innerWidth + window.innerWidth * 0.08, 0);
  // Начало и конец движения слегка смягчаем простой smoothstep-функцией.
  const eased = p * p * (3 - 2 * p);
  // Перемещаем всю ленту влево.
  processTrack.style.transform = `translate3d(${(-maxShift * eased).toFixed(2)}px, 0, 0)`;
}

/* ========================================================================== */
/* ЕДИНЫЙ ЦИКЛ ОБНОВЛЕНИЯ                                                     */
/* ========================================================================== */

// Флаг предотвращает десятки вычислений между двумя кадрами браузера.
let ticking = false;

// Все scroll-зависимые эффекты пересчитываются одним пакетом.
function updateScrollEffects() {
  // Синхронизируем компактную шапку.
  updateHeader();
  // Обновляем лёгкий параллакс крупных объектов.
  updateParallax();
  // Обновляем сцену интеграции.
  updateIntegration();
  // Обновляем горизонтальный процесс.
  updateProcess();
  // Разрешаем планирование следующего кадра.
  ticking = false;
}

// Обработчик прокрутки только планирует один кадр, а не выполняет тяжёлые расчёты немедленно.
window.addEventListener('scroll', () => {
  // Если кадр уже запланирован, второй не создаём.
  if (ticking) return;
  // Ставим флаг до следующего requestAnimationFrame.
  ticking = true;
  // Браузер вызовет функцию перед ближайшей отрисовкой.
  requestAnimationFrame(updateScrollEffects);
}, { passive: true });

// При изменении размера окна нужно пересчитать ширину горизонтального трека и параллакс.
window.addEventListener('resize', () => requestAnimationFrame(updateScrollEffects));

// Выполняем первоначальный расчёт сразу после загрузки скрипта.
requestAnimationFrame(updateScrollEffects);
