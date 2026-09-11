// Экспортируем одну функцию.
// Sites должен вызвать её для контейнера первого экрана Hero.
export function mountBTSCloudBackground(container, userOptions = {}) {

  // Проверяем, что Sites действительно передал существующий DOM-контейнер.
  if (!container) {
    throw new Error('BTS Clouds: контейнер Hero не найден.');
  }

  // Собираем параметры по умолчанию.
  // Их можно потом слегка менять без изменения самого шейдера.
  const options = {
    // Количество/плотность видимых облачных масс.
    density: 0.58,

    // Скорость перемещения облаков снизу вверх.
    speed: 0.030,

    // Общий масштаб облачных масс.
    scale: 1.30,

    // Мягкость границ облака.
    softness: 0.20,

    // Насколько выражены серо-голубые тени внутри облака.
    contrast: 0.72,

    // Если при вызове функции переданы свои значения,
    // они заменят соответствующие значения выше.
    ...userOptions,
  };

  // Создаём отдельный Canvas программно.
  // Поэтому в существующую HTML-разметку сайта вручную добавлять Canvas не требуется.
  const canvas = document.createElement('canvas');

  // Canvas декоративный и не несёт смысловой информации.
  // Скрываем его от экранных дикторов.
  canvas.setAttribute('aria-hidden', 'true');

  // Canvas должен лежать под всем содержимым Hero.
  canvas.style.position = 'absolute';

  // Растягиваем его одновременно до всех четырёх границ Hero.
  canvas.style.inset = '0';

  // CSS-ширина всегда соответствует ширине Hero.
  canvas.style.width = '100%';

  // CSS-высота всегда соответствует высоте Hero.
  canvas.style.height = '100%';

  // Убираем стандартное inline-поведение Canvas.
  canvas.style.display = 'block';

  // Canvas не должен перехватывать мышь и касания.
  canvas.style.pointerEvents = 'none';

  // Фон находится под текстом, фотографией бака и остальными элементами.
  canvas.style.zIndex = '0';

  // Явно запрещаем браузеру применять режим пиксельного масштабирования.
  canvas.style.imageRendering = 'auto';

  // Узнаём текущее CSS-позиционирование Hero.
  const originalPosition = getComputedStyle(container).position;

  // Если Hero имеет position: static,
  // абсолютный Canvas не сможет корректно привязаться к его границам.
  if (originalPosition === 'static') {

    // Поэтому превращаем Hero в опорный контейнер.
    container.style.position = 'relative';
  }

  // Вставляем Canvas первым ребёнком Hero,
  // чтобы всё остальное содержимое естественно располагалось поверх него.
  container.prepend(canvas);

  // Получаем WebGL2.
  // alpha:false позволяет браузеру не хранить дополнительный альфа-канал framebuffer.
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });

  // Если устройство или среда предпросмотра не поддерживает WebGL2,
  // показываем лёгкий резервный облачный фон вместо однотонного градиента.
  if (!gl) {
    // Создаём небо и несколько широко перекрывающихся облачных масс.
    canvas.style.backgroundImage = `
      radial-gradient(
        ellipse 44% 31% at 9% 88%,
        rgba(137, 159, 186, .70) 0%,
        rgba(177, 194, 213, .54) 34%,
        rgba(220, 227, 236, .20) 62%,
        transparent 78%
      ),
      radial-gradient(
        ellipse 36% 26% at 33% 82%,
        rgba(244, 247, 250, .94) 0%,
        rgba(213, 222, 232, .68) 42%,
        rgba(174, 192, 213, .20) 68%,
        transparent 82%
      ),
      radial-gradient(
        ellipse 42% 30% at 67% 91%,
        rgba(247, 249, 251, .96) 0%,
        rgba(212, 221, 232, .64) 43%,
        rgba(160, 181, 204, .24) 69%,
        transparent 82%
      ),
      radial-gradient(
        ellipse 47% 33% at 96% 72%,
        rgba(149, 172, 198, .68) 0%,
        rgba(191, 206, 222, .50) 39%,
        rgba(226, 232, 240, .18) 65%,
        transparent 80%
      ),
      radial-gradient(
        ellipse 32% 21% at 73% 58%,
        rgba(247, 249, 251, .78) 0%,
        rgba(206, 217, 229, .36) 49%,
        transparent 78%
      ),
      linear-gradient(
        180deg,
        rgb(242, 243, 247) 0%,
        rgb(226, 231, 240) 52%,
        rgb(216, 222, 232) 100%
      )
    `;

    // Увеличиваем размеры фоновых слоёв, чтобы при движении не появлялись пустые края.
    canvas.style.backgroundSize =
      '128% 138%, 138% 145%, 140% 148%, 130% 140%, 135% 142%, 100% 100%';

    // Задаём начальное положение: основные облачные массы находятся снизу.
    canvas.style.backgroundPosition =
      '0 15%, 8% 21%, 18% 24%, 0 18%, 10% 18%, 0 0';

    // Запрещаем повторение градиентов за границами их слоёв.
    canvas.style.backgroundRepeat = 'no-repeat';

    // Сообщаем браузеру, что будет плавно меняться только положение фона.
    canvas.style.willChange = 'background-position';

    // Определяем системную настройку уменьшения движения.
    const fallbackReducedMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)');

    // Если браузер поддерживает Web Animations API,
    // создаём очень медленное движение облачных слоёв снизу вверх.
    const fallbackAnimation =
      typeof canvas.animate === 'function'
        ? canvas.animate(
            [
              {
                backgroundPosition:
                  '0 15%, 8% 21%, 18% 24%, 0 18%, 10% 18%, 0 0',
              },
              {
                backgroundPosition:
                  '0 -12%, 8% -8%, 18% -5%, 0 -10%, 10% -7%, 0 0',
              },
            ],
            {
              // Один полный проход занимает две минуты.
              duration: 120000,

              // После завершения движение начинается заново.
              iterations: Infinity,

              // Линейное движение исключает ускорения, торможения и рывки.
              easing: 'linear',
            }
          )
        : null;

    // Сохраняем информацию о нахождении Hero в видимой области экрана.
    let fallbackIsIntersecting = true;

    // Включаем анимацию только тогда, когда она действительно нужна.
    function updateFallbackAnimationState() {
      // Если браузер не поддерживает Web Animations API,
      // оставляем красивый статичный резервный фон.
      if (!fallbackAnimation) {
        return;
      }

      // Анимация разрешена только для видимого Hero,
      // активной вкладки и при отсутствии запроса на уменьшение движения.
      const shouldPlay =
        fallbackIsIntersecting &&
        !document.hidden &&
        !fallbackReducedMotion.matches;

      // Запускаем или останавливаем резервную анимацию.
      if (shouldPlay) {
        fallbackAnimation.play();
      } else {
        fallbackAnimation.pause();
      }
    }

    // Следим за появлением Hero в видимой области страницы.
    const fallbackIntersectionObserver =
      new IntersectionObserver(
        entries => {
          // Получаем состояние наблюдаемого Hero-блока.
          const entry = entries[0];

          // Запоминаем, виден ли сейчас Hero-блок.
          fallbackIsIntersecting = entry.isIntersecting;

          // Обновляем состояние резервной анимации.
          updateFallbackAnimationState();
        },
        {
          // Даже небольшая видимая часть Hero считается достаточной.
          threshold: 0.01,
        }
      );

    // Подключаем наблюдение за Hero-блоком.
    fallbackIntersectionObserver.observe(container);

    // При переключении вкладки обновляем состояние анимации.
    function handleFallbackVisibilityChange() {
      updateFallbackAnimationState();
    }

    // Подписываемся на изменение видимости вкладки.
    document.addEventListener(
      'visibilitychange',
      handleFallbackVisibilityChange
    );

    // При изменении системной настройки движения обновляем анимацию.
    function handleFallbackReducedMotionChange() {
      updateFallbackAnimationState();
    }

    // Подписываемся на изменение настройки prefers-reduced-motion.
    fallbackReducedMotion.addEventListener(
      'change',
      handleFallbackReducedMotionChange
    );

    // Устанавливаем правильное начальное состояние.
    updateFallbackAnimationState();

    // Создаём именованную функцию полной очистки резервного режима.
    function destroyFallbackCloudBackground() {
      // Останавливаем созданную CSS-анимацию, если она существует.
      fallbackAnimation?.cancel();

      // Отключаем наблюдение за Hero-блоком.
      fallbackIntersectionObserver.disconnect();

      // Удаляем обработчик изменения видимости вкладки.
      document.removeEventListener(
        'visibilitychange',
        handleFallbackVisibilityChange
      );

      // Удаляем обработчик системной настройки движения.
      fallbackReducedMotion.removeEventListener(
        'change',
        handleFallbackReducedMotionChange
      );

      // Удаляем Canvas со страницы.
      canvas.remove();
    }

    // Даже резервный режим принимает живое изменение скорости, если Web Animations API доступен.
    destroyFallbackCloudBackground.setOptions = nextOptions => {
      // Копируем только конечные числовые значения, чтобы случайная строка не ломала параметры.
      Object.entries(nextOptions).forEach(([name, value]) => {
        if (name in options && Number.isFinite(value)) {
          options[name] = value;
        }
      });

      // Базовой скорости 0.180 соответствует исходная длительность резервной анимации.
      if (fallbackAnimation) {
        fallbackAnimation.playbackRate = Math.max(options.speed / 0.180, 0.01);
      }
    };

    // Возвращаем совместимую функцию очистки с дополнительным методом живой настройки.
    return destroyFallbackCloudBackground;
  }

  // Вершинный шейдер максимально простой.
  // Он создаёт один огромный треугольник,
  // полностью перекрывающий экран.
  const vertexShaderSource = `#version 300 es

  // Используем высокую точность вычислений.
  precision highp float;

  // Передаём координаты пикселя во фрагментный шейдер.
  out vec2 vUv;

  void main() {

    // Для каждой из трёх вершин задаём координату вручную.
    vec2 p =
      gl_VertexID == 0 ? vec2(-1.0, -1.0) :
      gl_VertexID == 1 ? vec2( 3.0, -1.0) :
                         vec2(-1.0,  3.0);

    // Переводим диапазон координат из -1...+1 в 0...1.
    vUv = (p + 1.0) * 0.5;

    // Отправляем вершину в стандартный конвейер WebGL.
    gl_Position = vec4(p, 0.0, 1.0);
  }
  `;

  // Основной фрагментный шейдер.
  // Именно здесь формируются небо и процедурные облака.
  const fragmentShaderSource = `#version 300 es

  // High precision критически важен на мобильных GPU:
  // меньше риск полос и ошибок округления.
  precision highp float;

  // Координаты текущего пикселя в диапазоне 0...1.
  in vec2 vUv;

  // Финальный цвет текущего пикселя.
  out vec4 fragColor;

  // Физическое разрешение Canvas.
  uniform vec2 uResolution;

  // Время работы анимации.
  uniform float uTime;

  // Плотность облаков.
  uniform float uDensity;

  // Масштаб облаков.
  uniform float uScale;

  // Мягкость границ.
  uniform float uSoftness;

  // Контраст внутренней структуры.
  uniform float uContrast;

  // Скорость движения снизу вверх.
  uniform float uSpeed;


  // Очень дешёвая псевдослучайная функция.
  // Она нужна для генерации процедурного шума.
  float hash21(vec2 p) {

    // Перемешиваем координаты.
    vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));

    // Дополнительно декоррелируем компоненты.
    p3 += dot(p3, p3.yzx + 33.33);

    // Получаем число 0...1.
    return fract((p3.x + p3.y) * p3.z);
  }


  // Плавный двухмерный value-noise.
  float valueNoise(vec2 p) {

    // Целая координата ячейки.
    vec2 i = floor(p);

    // Координата внутри ячейки.
    vec2 f = fract(p);

    // Кубическая интерполяция убирает резкие переходы между ячейками.
    f = f * f * (3.0 - 2.0 * f);

    // Значение в левом нижнем углу.
    float a = hash21(i);

    // Значение в правом нижнем углу.
    float b = hash21(i + vec2(1.0, 0.0));

    // Значение в левом верхнем углу.
    float c = hash21(i + vec2(0.0, 1.0));

    // Значение в правом верхнем углу.
    float d = hash21(i + vec2(1.0, 1.0));

    // Билинейно смешиваем четыре значения.
    return mix(
      mix(a, b, f.x),
      mix(c, d, f.x),
      f.y
    );
  }


  // Трёхоктавный FBM.
  // Используется для очень крупных форм.
  float fbm3(vec2 p) {

    // Начальная сумма.
    float v = 0.0;

    // Амплитуда первой октавы.
    float a = 0.56;

    // Матрица одновременно слегка поворачивает шум
    // и не даёт октавам визуально совпадать.
    mat2 r = mat2(.82, -.57, .57, .82);

    // Первая крупная октава.
    v += a * valueNoise(p);

    // Увеличиваем частоту.
    p = r * p * 2.03;

    // Уменьшаем амплитуду.
    a *= .48;

    // Вторая октава.
    v += a * valueNoise(p);

    // Снова увеличиваем частоту.
    p = r * p * 2.02;

    // Снова уменьшаем амплитуду.
    a *= .48;

    // Третья октава.
    v += a * valueNoise(p);

    // Возвращаем итоговое поле.
    return v;
  }


  // Четырёхоктавный FBM.
  // Он отвечает за более сложный силуэт облаков.
  float fbm4(vec2 p) {

    // Начальная сумма.
    float v = 0.0;

    // Начальная амплитуда.
    float a = 0.52;

    // Незначительное вращение каждой следующей октавы.
    mat2 r = mat2(.80, -.60, .60, .80);

    // Первая октава.
    v += a * valueNoise(p);

    // Переходим к более мелкому масштабу.
    p = r * p * 2.01;

    // Ослабляем вклад.
    a *= .50;

    // Вторая октава.
    v += a * valueNoise(p);

    // Ещё увеличиваем частоту.
    p = r * p * 2.03;

    // Ослабляем вклад.
    a *= .50;

    // Третья октава.
    v += a * valueNoise(p);

    // Последний масштаб.
    p = r * p * 2.02;

    // Последнее уменьшение амплитуды.
    a *= .50;

    // Четвёртая октава.
    v += a * valueNoise(p);

    // Возвращаем результат.
    return v;
  }


  // Генерируем одно независимое облачное поле.
  float cloudField(
    vec2 p,
    float seed,
    float layerScale,
    float layerSpeed
  ) {

    // Меняем размер конкретного слоя.
    p /= layerScale;

    // Это главное движение:
    // координатное поле уходит вниз,
    // поэтому визуально облака движутся снизу вверх.
    p.y -= uTime * uSpeed * layerSpeed;

    // Добавляем практически незаметное боковое дыхание.
    // Оно не даёт эффекту выглядеть как простая прокручиваемая картинка.
    p.x += .035 * sin(uTime * .08 + seed * 9.0);

    // Очень крупное поле определяет расположение основных облачных масс.
    float macro = fbm3(
      p * .53 +
      vec2(seed * 17.3, seed * 3.1)
    );

    // Создаём первое поле деформации.
    float warpX = fbm3(
      p * .82 +
      vec2(seed * 5.2, 1.7)
    );

    // Создаём независимое второе поле деформации.
    float warpY = fbm3(
      p * .82 +
      vec2(8.1, seed * 6.4)
    );

    // Собираем двухмерную деформацию.
    vec2 warp = vec2(warpX, warpY) - .5;

    // Среднечастотный FBM формирует сам силуэт облака.
    float body = fbm4(
      p * 1.18 +
      warp * .72 +
      seed * 13.7
    );

    // Очень слабая мелкая детализация.
    // Её вклад специально минимален,
    // чтобы не появлялась цифровая крупа.
    float detail = fbm3(
      p * 3.4 +
      seed * 29.1
    );

    // Основная масса облака доминирует.
    return
      macro  * .47 +
      body   * .48 +
      detail * .05;
  }


  // Превращаем непрерывное поле плотности в мягкую маску облака.
  float cloudMask(
    float field,
    float threshold,
    float softness
  ) {

    // fwidth оценивает изменение функции между соседними физическими пикселями.
    // Это фактически бесплатное экранное антиалиасирование границы.
    float aa = max(
      fwidth(field) * 1.8,
      .0015
    );

    // Создаём плавную, а не ступенчатую границу.
    return smoothstep(
      threshold - softness - aa,
      threshold + softness + aa,
      field
    );
  }


  void main() {

    // Берём нормированные экранные координаты.
    vec2 uv = vUv;

    // Вычисляем соотношение ширины и высоты.
    float aspect = uResolution.x / uResolution.y;

    // Центрируем координаты.
    vec2 p = uv - .5;

    // Исправляем геометрию при широком экране.
    p.x *= aspect;


    // Почти белый цвет верхней части презентации.
    vec3 skyTop =
      vec3(242.0, 243.0, 247.0) / 255.0;

    // Холодный светло-голубой цвет правой/средней части слайда.
    vec3 skyMiddle =
      vec3(224.0, 229.0, 240.0) / 255.0;

    // Серо-голубой низ.
    vec3 skyBottom =
      vec3(218.0, 221.0, 231.0) / 255.0;


    // Формируем базовый вертикальный градиент.
    vec3 color = mix(
      skyBottom,
      skyMiddle,
      smoothstep(0.0, .62, uv.y)
    );

    // Верх постепенно становится почти белым.
    color = mix(
      color,
      skyTop,
      smoothstep(.44, 1.0, uv.y)
    );


    // Дополнительно создаём очень слабую горизонтальную неоднородность.
    // Именно такая лёгкая неравномерность есть на фоне презентации.
    float sideTone =
      smoothstep(.0, 1.0, uv.x) * .018;

    // Правая часть становится чуть холоднее.
    color += vec3(
      -sideTone,
      -sideTone * .55,
       sideTone * .20
    );


    // Добавляем настолько слабую атмосферную вариацию,
    // что глаз не видит её как шум.
    float skyVariation =
      (fbm3(vec2(uv.x * 1.45, uv.y * .70) + 7.2) - .5)
      * .009;

    // Эта вариация одновременно уничтожает чистые цифровые полосы градиента.
    color += skyVariation;


    // Плотность переводим в порог образования облаков.
    float threshold =
      mix(.79, .53, uDensity);


    // ---------- ДАЛЬНИЙ СЛОЙ ----------

    // Считаем крупное дальнее облачное поле.
    float fieldFar = cloudField(
      p + vec2(.18, .10),
      .17,
      uScale * 1.85,
      .60
    );

    // Получаем его мягкую маску.
    float alphaFar = cloudMask(
      fieldFar,
      threshold + .015,
      uSoftness * 1.32
    );

    // Дальний слой должен быть очень слабым.
    alphaFar *= .34;

    // Цвет дальней дымки.
    vec3 colorFar =
      vec3(218.0, 224.0, 233.0) / 255.0;

    // Подмешиваем дальний слой.
    color = mix(
      color,
      colorFar,
      alphaFar
    );


    // ---------- СРЕДНИЙ СЛОЙ ----------

    // Второе независимое облачное поле.
    float fieldMiddle = cloudField(
      p + vec2(-.11, -.10),
      .51,
      uScale * 1.27,
      .83
    );

    // Формируем маску.
    float alphaMiddle = cloudMask(
      fieldMiddle,
      threshold - .025,
      uSoftness * 1.08
    );

    // Ограничиваем непрозрачность.
    alphaMiddle *= .52;

    // Плотные области получают больше света.
    float shadeMiddle = smoothstep(
      threshold - .10,
      threshold + .18,
      fieldMiddle
    );

    // Серо-голубая тень из палитры презентации.
    vec3 middleShadow =
      vec3(193.0, 203.0, 216.0) / 255.0;

    // Почти белая освещённая часть.
    vec3 middleLight =
      vec3(242.0, 244.0, 247.0) / 255.0;

    // Получаем внутренний тон облака.
    vec3 middleColor = mix(
      middleShadow,
      middleLight,
      shadeMiddle
    );

    // Накладываем средний слой.
    color = mix(
      color,
      middleColor,
      alphaMiddle * uContrast
    );


    // ---------- ПЕРЕДНИЙ СЛОЙ ----------

    // Самое заметное облачное поле.
    float fieldFront = cloudField(
      p + vec2(.08, -.31),
      .83,
      uScale * .94,
      1.00
    );

    // Создаём его мягкую маску.
    float alphaFront = cloudMask(
      fieldFront,
      threshold + .010,
      uSoftness * .88
    );

    // Передние облака можно сделать немного выразительнее.
    alphaFront *= .61;

    // Плотность влияет на внутреннее затенение.
    float shadeFront = smoothstep(
      threshold - .12,
      threshold + .21,
      fieldFront
    );

    // Более глубокая холодная тень.
    vec3 frontShadow =
      vec3(183.0, 195.0, 210.0) / 255.0;

    // Светлая часть почти белая.
    vec3 frontLight =
      vec3(247.0, 248.0, 249.0) / 255.0;

    // Получаем цвет переднего облака.
    vec3 frontColor = mix(
      frontShadow,
      frontLight,
      shadeFront
    );

    // Накладываем передние облака.
    color = mix(
      color,
      frontColor,
      alphaFront * uContrast
    );


    // В презентации облачная дымка заметнее снизу.
    float lowerMist =
      (1.0 - smoothstep(.34, .90, uv.y)) * .055;

    // Добавляем эту дымку без какой-либо линии горизонта.
    color = mix(
      color,
      vec3(232.0, 235.0, 241.0) / 255.0,
      lowerMist
    );


    // Генерируем статичный субпиксельный dither.
    // Амплитуда меньше одного шага 8-bit цвета.
    float dither =
      (hash21(gl_FragCoord.xy) - .5)
      * (.70 / 255.0);

    // Он разбивает banding,
    // но визуально не воспринимается как зерно.
    color += dither;


    // Ограничиваем значения допустимым диапазоном
    // и записываем готовый RGB-пиксель.
    fragColor = vec4(
      clamp(color, 0.0, 1.0),
      1.0
    );
  }
  `;


  // Компилируем один GLSL-шейдер.
  function compileShader(type, source) {

    // Создаём объект нужного типа.
    const shader = gl.createShader(type);

    // Передаём GLSL-код видеодрайверу.
    gl.shaderSource(shader, source);

    // Компилируем.
    gl.compileShader(shader);

    // Проверяем результат компиляции.
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {

      // Получаем понятный текст ошибки.
      const message = gl.getShaderInfoLog(shader);

      // Освобождаем нерабочий объект.
      gl.deleteShader(shader);

      // Прерываем запуск,
      // чтобы не оставлять непонятный пустой Canvas.
      throw new Error(`BTS Clouds shader error: ${message}`);
    }

    // Возвращаем успешно скомпилированный шейдер.
    return shader;
  }


  // Компилируем вершинную программу.
  const vertexShader =
    compileShader(gl.VERTEX_SHADER, vertexShaderSource);

  // Компилируем фрагментную программу.
  const fragmentShader =
    compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

  // Создаём итоговую WebGL-программу.
  const program = gl.createProgram();

  // Подключаем вершинный шейдер.
  gl.attachShader(program, vertexShader);

  // Подключаем фрагментный шейдер.
  gl.attachShader(program, fragmentShader);

  // Линкуем программу.
  gl.linkProgram(program);

  // После линковки отдельные shader-объекты уже не нужны.
  gl.deleteShader(vertexShader);

  // То же самое для фрагментного шейдера.
  gl.deleteShader(fragmentShader);

  // Проверяем успешность линковки.
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {

    // Если что-то пошло не так,
    // выбрасываем диагностическую ошибку.
    throw new Error(
      `BTS Clouds link error: ${gl.getProgramInfoLog(program)}`
    );
  }

  // Делаем программу активной.
  gl.useProgram(program);


  // Получаем адреса uniform-параметров только один раз.
  const uniforms = {

    // Разрешение Canvas.
    resolution:
      gl.getUniformLocation(program, 'uResolution'),

    // Время.
    time:
      gl.getUniformLocation(program, 'uTime'),

    // Плотность.
    density:
      gl.getUniformLocation(program, 'uDensity'),

    // Размер.
    scale:
      gl.getUniformLocation(program, 'uScale'),

    // Мягкость.
    softness:
      gl.getUniformLocation(program, 'uSoftness'),

    // Контраст.
    contrast:
      gl.getUniformLocation(program, 'uContrast'),

    // Скорость.
    speed:
      gl.getUniformLocation(program, 'uSpeed'),
  };


  // Устройства с touch/coarse pointer считаем мобильным профилем.
  const mobileLike =
    window.matchMedia('(pointer: coarse)').matches;

  // На телефоне 24 кадра/с более чем достаточно:
  // облака двигаются очень медленно.
  const targetFPS =
    mobileLike ? 24 : 30;

  // Переводим частоту кадров во время между кадрами.
  const frameInterval =
    1000 / targetFPS;

  // На Retina-телефонах нет смысла безусловно считать DPR=3–4.
  // DPR=2 для настолько мягкого изображения визуально практически неотличим.
  const maxDPR =
    mobileLike ? 2.0 : 2.0;

  // Ограничиваем количество реально рассчитываемых пикселей.
  // Это главный предохранитель от перегрева мобильного GPU.
  const pixelBudget =
    mobileLike ? 1_600_000 : 3_200_000;


  // Текущее накопленное время анимации.
  let elapsed = 0;

  // Время предыдущего рассчитанного кадра.
  let previousTimestamp = 0;

  // Время последней фактической отрисовки.
  let previousDrawTimestamp = 0;

  // ID requestAnimationFrame.
  let animationFrame = 0;

  // Флаг нахождения Hero на экране.
  let isIntersecting = true;

  // Флаг активности цикла.
  let isRunning = false;

  // Учитываем системную настройку уменьшения движения.
  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)');


  // Выставляем правильное внутреннее разрешение Canvas.
  function resizeCanvas() {

    // Получаем текущий CSS-размер Hero.
    const rect = container.getBoundingClientRect();

    // Если Hero временно имеет нулевой размер,
    // считать изображение бессмысленно.
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }

    // Берём физический DPR экрана,
    // но ограничиваем его безопасным максимумом.
    let effectiveDPR = Math.min(
      window.devicePixelRatio || 1,
      maxDPR
    );

    // Считаем максимальный DPR,
    // при котором не превышаем установленный pixel budget.
    const budgetDPR = Math.sqrt(
      pixelBudget / (rect.width * rect.height)
    );

    // Выбираем меньшее значение.
    // Поэтому 4K-монитор не заставит считать бессмысленные 8+ млн пикселей.
    effectiveDPR = Math.min(
      effectiveDPR,
      budgetDPR
    );

    // Никогда не опускаемся ниже 1 CSS-пикселя на физический пиксель Canvas.
    effectiveDPR = Math.max(
      1,
      effectiveDPR
    );

    // Рассчитываем итоговую физическую ширину.
    const width = Math.max(
      1,
      Math.round(rect.width * effectiveDPR)
    );

    // Рассчитываем итоговую физическую высоту.
    const height = Math.max(
      1,
      Math.round(rect.height * effectiveDPR)
    );

    // Меняем framebuffer только тогда,
    // когда размер действительно изменился.
    if (
      canvas.width !== width ||
      canvas.height !== height
    ) {

      // Устанавливаем физическую ширину.
      canvas.width = width;

      // Устанавливаем физическую высоту.
      canvas.height = height;

      // Сообщаем WebGL новый размер области вывода.
      gl.viewport(0, 0, width, height);
    }
  }


  // Отрисовываем один кадр.
  function render() {

    // Проверяем/обновляем физическое разрешение.
    resizeCanvas();

    // Передаём разрешение в шейдер.
    gl.uniform2f(
      uniforms.resolution,
      canvas.width,
      canvas.height
    );

    // Передаём накопленное время.
    gl.uniform1f(
      uniforms.time,
      elapsed
    );

    // Передаём плотность облаков.
    gl.uniform1f(
      uniforms.density,
      options.density
    );

    // Передаём их масштаб.
    gl.uniform1f(
      uniforms.scale,
      options.scale
    );

    // Передаём мягкость.
    gl.uniform1f(
      uniforms.softness,
      options.softness
    );

    // Передаём контраст.
    gl.uniform1f(
      uniforms.contrast,
      options.contrast
    );

    // Передаём скорость.
    gl.uniform1f(
      uniforms.speed,
      options.speed
    );

    // Один треугольник запускает fragment shader
    // для всех пикселей Canvas.
    gl.drawArrays(
      gl.TRIANGLES,
      0,
      3
    );
  }


  // Главный цикл анимации.
  function frame(timestamp) {

    // Если цикл был остановлен,
    // не создаём новый requestAnimationFrame.
    if (!isRunning) {
      return;
    }

    // На первом кадре просто запоминаем время.
    if (!previousTimestamp) {
      previousTimestamp = timestamp;
    }

    // Вычисляем реальное прошедшее время.
    const delta =
      Math.min(
        (timestamp - previousTimestamp) / 1000,
        0.1
      );

    // Запоминаем текущий timestamp.
    previousTimestamp = timestamp;

    // Накопление времени не зависит от FPS.
    // Поэтому скорость облаков одинакова и на 24, и на 30 кадрах/с.
    elapsed += delta;

    // Проверяем, пришло ли время действительно считать следующий кадр.
    if (
      timestamp - previousDrawTimestamp >=
      frameInterval
    ) {

      // Запоминаем время фактической отрисовки.
      previousDrawTimestamp = timestamp;

      // Рисуем кадр.
      render();
    }

    // Просим браузер вызвать функцию снова.
    animationFrame =
      requestAnimationFrame(frame);
  }


  // Включаем анимацию.
  function start() {

    // Если она уже идёт,
    // ничего не делаем.
    if (isRunning) {
      return;
    }

    // Меняем состояние.
    isRunning = true;

    // Сбрасываем предыдущий timestamp,
    // чтобы после паузы не было скачка времени.
    previousTimestamp = 0;

    // Запускаем цикл.
    animationFrame =
      requestAnimationFrame(frame);
  }


  // Останавливаем вычисления.
  function stop() {

    // Меняем состояние.
    isRunning = false;

    // Отменяем уже запланированный кадр.
    cancelAnimationFrame(animationFrame);
  }


  // Решаем, нужно ли сейчас вообще считать анимацию.
  function updateRunningState() {

    // Запускаемся только если:
    // Hero виден,
    // вкладка активна,
    // пользователь не попросил уменьшить анимации.
    const shouldRun =
      isIntersecting &&
      !document.hidden &&
      !reducedMotion.matches;

    // Запускаем при выполнении условий.
    if (shouldRun) {
      start();
    } else {

      // Иначе полностью перестаём нагружать GPU.
      stop();

      // Но оставляем один красивый статичный кадр.
      render();
    }
  }


  // Следим за появлением Hero в видимой области страницы.
  const intersectionObserver =
    new IntersectionObserver(
      entries => {

        // Берём состояние нашего контейнера.
        const entry = entries[0];

        // Сохраняем факт его видимости.
        isIntersecting =
          entry.isIntersecting;

        // Перезапускаем или останавливаем рендер.
        updateRunningState();
      },
      {

        // Даже небольшой выход Hero за пределы экрана
        // допускается без мгновенного выключения.
        threshold: 0.01,
      }
    );

  // Начинаем наблюдать за Hero.
  intersectionObserver.observe(container);


  // Следим за изменением его размера.
  const resizeObserver =
    new ResizeObserver(() => {

      // Перестраиваем framebuffer.
      resizeCanvas();

      // Сразу перерисовываем,
      // чтобы resize не оставлял растянутый старый кадр.
      render();
    });

  // Подключаем ResizeObserver.
  resizeObserver.observe(container);


  // При переключении вкладки автоматически отключаем GPU-рендер.
  function handleVisibilityChange() {
    updateRunningState();
  }

  // Подписываемся на событие браузера.
  document.addEventListener(
    'visibilitychange',
    handleVisibilityChange
  );


  // Если пользователь меняет системное предпочтение reduced motion,
  // реагируем без перезагрузки страницы.
  function handleReducedMotionChange() {
    updateRunningState();
  }

  // Подписываемся на изменение media-query.
  reducedMotion.addEventListener(
    'change',
    handleReducedMotionChange
  );


  // Рисуем первый кадр сразу,
  // чтобы Canvas никогда не был пустым при загрузке.
  render();

  // После первого кадра запускаем нормальный режим.
  updateRunningState();


  // Функция обновляет только переданные числовые настройки, не пересоздавая Canvas и WebGL-контекст.
  function setBTSCloudOptions(nextOptions = {}) {

    // Проходим по парам имя-значение из панели управления.
    Object.entries(nextOptions).forEach(([name, value]) => {

      // Разрешаем менять только уже существующие параметры и только конечными числами.
      if (name in options && Number.isFinite(value)) {
        options[name] = value;
      }
    });

    // Немедленно рисуем кадр, чтобы ползунок ощущался прямым управлением, даже когда анимация остановлена.
    render();
  }


  // Создаём именованную функцию полного удаления компонента.
  // Особенно важно, если Sites использует React или повторно монтирует первый экран.
  function destroyBTSCloudBackground() {

    // Останавливаем requestAnimationFrame.
    stop();

    // Отключаем наблюдение за видимостью.
    intersectionObserver.disconnect();

    // Отключаем наблюдение за размерами.
    resizeObserver.disconnect();

    // Удаляем обработчик вкладки.
    document.removeEventListener(
      'visibilitychange',
      handleVisibilityChange
    );

    // Удаляем обработчик reduced-motion.
    reducedMotion.removeEventListener(
      'change',
      handleReducedMotionChange
    );

    // Освобождаем WebGL-программу.
    gl.deleteProgram(program);

    // Удаляем Canvas.
    canvas.remove();
  }

  // Функции в JavaScript являются объектами, поэтому добавляем метод без изменения прежнего контракта очистки.
  destroyBTSCloudBackground.setOptions = setBTSCloudOptions;

  // Возвращаем прежнюю callable-функцию очистки, теперь дополненную живым управлением параметрами.
  return destroyBTSCloudBackground;
}
