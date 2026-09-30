Правила работы с проектом БТС

Этот файл содержит обязательные правила для ChatGPT, Codex, Sites и других агентов, работающих с репозиторием сайта БТС.

1. Каноническое описание инфраструктуры

Перед любыми изменениями, связанными с публикацией сайта, dist/, staging, production, IIS, Git/GitHub-процессом, release-скриптами, SSH/SCP, проверками перед публикацией, rollback или серверными путями, обязательно прочитать INFRASTRUCTURE.md.

INFRASTRUCTURE.md является каноническим техническим описанием текущей инфраструктуры. Если фактическая инфраструктура была намеренно изменена, нужно одновременно обновить INFRASTRUCTURE.md.

Не придумывать новую схему публикации, пока существующая рабочая схема не изучена и явно не признана неподходящей.

2. Главный принцип публикации

Production получает только тот dist/, который:

собран из исходников;

сохранён в Git вместе с соответствующими исходниками;

вручную получен на немецком staging-сервере через GitHub Desktop;

реально показан на https://stage.btsys.ru;

визуально проверен пользователем;

прошёл автоматический preflight и Playwright;

связан с конкретным Git commit;

передан на production без пересборки на production-сервере.

Автодеплоя по git push нет и добавлять его без отдельного решения пользователя нельзя.

3. Правила работы с Git

Основная ветка: main.

Перед production-релизом:

рабочее дерево должно быть чистым;

локальная ветка должна быть main;

локальный HEAD должен совпадать с origin/main;

scripts/release-prod.ps1 делает git fetch, но не делает git pull;

если в GitHub появился более новый commit, релиз обязан остановиться;

пользователь должен вручную сделать Pull, снова проверить staging и только потом выпускать релиз.

Нельзя автоматически подтягивать новый commit непосредственно перед production-релизом.

4. dist/ — готовый production-артефакт

dist/ хранится в Git и является готовой публикацией сайта.

После любых изменений, влияющих на сайт:

изменить исходные файлы;

выполнить npm run build;

убедиться, что обновлённый dist/ соответствует исходникам;

включить исходники и соответствующий dist/ в один commit.

Не вносить изменения только в dist/ без соответствующих изменений исходников.

Production может начинать релиз в static-only состоянии. Постоянный scripts/release-prod.ps1 сам проверяет и идемпотентно восстанавливает application-level инфраструктуру backend; отдельного ручного migration workflow нет. Production не использует Git, GitHub Desktop, npm registry, npm install/npm ci при обычном deploy и не выполняет frontend/backend build: готовый backend приезжает со staging вместе с production-зависимостями.

5. dist/ должен быть production-safe

Один и тот же dist/ используется на staging и production.

Поэтому в dist/ нельзя добавлять staging-специфичные настройки, включая:

X-Robots-Tag: noindex;

глобальный noindex для staging;

stage.btsys.ru;

localhost;

127.0.0.1;

локальные Windows-пути;

временные staging-заглушки.

Изоляция stage.btsys.ru от поисковиков задаётся только в IIS на staging-сервере.

Страница 404.html может и должна иметь собственный noindex.

6. IIS и web.config

dist/web.config — production-safe конфигурация IIS.

Без отдельной причины не удалять и не ломать:

MIME-тип .webp;

защитные HTTP-заголовки;

Content-Security-Policy;

обработку фирменной 404.html.

Staging-специфичные IIS-настройки не переносить в web.config.

Production-релиз не должен пересоздавать сайт IIS, application pool, bindings, сертификаты, HSTS или DNS. При релизе меняется только physical path корневого virtual directory сайта BTS.

7. Служебные production-файлы

Сборка обязана сохранять в dist/ как минимум:

index.html;

страницы products/, faq/, about/, contacts/;

404.html;

robots.txt;

sitemap.xml;

web.config;

файлы подтверждения Mail.ru и Яндекса;

BIMI-ресурс в dist/assets/bimi/.

Preflight уже контролирует эти требования. Не ослаблять проверки без явной причины.

8. Staging-сервер

Staging работает на немецком Windows-сервере.

Рабочий проект:

C:\Users\Administrator\Desktop\Our_Projects\site_bak

Staging IIS-сайт:

BTS-STAGE

Публичный адрес:

https://stage.btsys.ru

IIS staging указывает непосредственно на:

C:\Users\Administrator\Desktop\Our_Projects\site_bak\dist

На этом же сервере работает чужой для данного проекта сайт/приложение POTOK_WebApp / potok-crm.ru.

Его нельзя останавливать, перенастраивать, использовать для БТС или затрагивать при обслуживании БТС.

9. Production-сервер

Production — отдельный Windows Server 2019 в Selectel.

IIS-сайт: BTS.

Application pool: BTS.

Публичный сайт: https://btsys.ru.

Production использует immutable release-папки:

C:\Sites\BTS\releases\<release_id>\

Нельзя заменять содержимое активной release-папки после публикации. Новый релиз всегда создаётся в новой папке.

Нельзя удалять аварийный baseline:

C:\Sites\BTS\releases\20260911-193310_legacy-prod

Также без отдельного решения не удалять исходный старый production:

C:\Sites\BTS_Site\bts-fuel-tanks\dist

10. Production-релиз

Канонический клиент релиза:

scripts/release-prod.ps1

Обычный production-релиз запускается с немецкого staging-сервера.

-dryrun обязан выполнять проверки через mode=check request к SYSTEM worker. Кроме служебных request/result-файлов он ничего не загружает, не упаковывает для отправки и не изменяет application infrastructure, component state или сайт.

Живой релиз обязан использовать существующий механизм:

preflight;

Playwright;

проверку GitHub;

упаковку текущего dist/;

SHA-256;

SSH/SCP;

production worker;

server-side health checks;

external health checks;

автоматический rollback при ошибке.

Не заменять эту цепочку прямым копированием файлов в активную папку IIS.

11. Production worker

Привилегированное переключение IIS выполняет не SSH-пользователь, а локальный worker на production.

Worker:

C:\ProgramData\BTS\deploy\trusted\worker.ps1

Он запускается как SYSTEM через Task Scheduler.

Worker является единственным production-исполнителем ensure-production.ps1: SSH-пользователь передаёт через incoming только reconcile JSON и обычные component artifacts, затем читает результат из outbox. Исполняемые infrastructure assets находятся только в закрытом C:\ProgramData\BTS\deploy\trusted и обновляются исключительно Administrator bootstrap. Единственный ручной bootstrap допускается для первоначальной замены legacy worker и последующего осознанного обновления trusted worker/ensure/WinSW/XML; он не является миграцией сайта/backend.

SSH-пользователь bts-deploy не является администратором. Не выдавать ему административные права, если это специально не согласовано.

12. SSH и секреты

Приватный deployment-ключ намеренно хранится вне Git-репозитория:

C:\ProgramData\BTS\ssh\bts_prod_ed25519

Это допустимое исключение из правила «всё внутри папки проекта», потому что приватный ключ нельзя хранить в Git.

Никогда не коммитить приватный ключ, не печатать его содержимое в лог, не переносить его в репозиторий и не отправлять его в чат.

Public key, IP-адреса, имена пользователей и пути к ключам секретами не являются.

13. VPN на Selectel

На production-сервере используется AmneziaVPN/AmneziaWG.

При включённом VPN обратный маршрут к немецкому серверу 142.132.205.110 уходит в туннель, из-за чего входящий SSH Germany → Selectel не работает.

Поэтому перед живым production-релизом:

AmneziaVPN на Selectel должен быть выключен.

После успешного релиза VPN можно снова включить.

Не пытаться автоматически менять VPN из release-скрипта без отдельного решения пользователя.

14. Rollback

Rollback — обязательная часть схемы.

Если внутренняя production-проверка после переключения IIS не проходит, production worker должен автоматически вернуть предыдущий physical path.

Если внутренняя проверка прошла, но внешняя проверка с немецкого сервера не прошла, release-клиент должен отправить rollback-заявку production worker.

Не убирать rollback ради упрощения процесса.

15. Локальные временные файлы

.release/ содержит локальные ZIP/JSON артефакты релизов и игнорируется Git.

Локальный ярлык запуска релиза может находиться в .local/; .local/ может быть исключена через .git/info/exclude и не обязана храниться в Git.

Резервные копии скриптов вида *.before-* не должны попадать в репозиторий.

16. Обновление документации

Если намеренно изменены сервер, IP, домен, путь, IIS-site/app pool, SSH-схема, release flow, worker, rollback, VPN-зависимость, staging-изоляция или preflight, в том же наборе изменений обновить INFRASTRUCTURE.md, а при необходимости и AGENTS.md.

Если намеренно изменена frontend-архитектура конструктора, дизайн-система, набор системных patterns/components/variants, правила MEDIA registry или их контракт, в том же наборе изменений обновить AGENTS.md и машинно-читаемое описание архитектуры.

17. Приоритет правил и фактического состояния

AGENTS.md задаёт обязательные правила работы, а INFRASTRUCTURE.md описывает фактически настроенную инфраструктуру.

Если эти файлы противоречат друг другу или фактическому состоянию серверов:

не выполнять потенциально разрушительные изменения;

проверить реальное состояние Git, IIS, серверных путей и release-механизма;

определить, какой документ устарел;

исправить документацию вместе с осознанным изменением инфраструктуры.

Нельзя «исправлять» production только ради приведения его к тексту документации без проверки фактического рабочего состояния.

Для frontend аналогично: нельзя механически переписывать работающую страницу только ради формального соответствия документации. Сначала проверить фактический DOM, assets/site-architecture.js, assets/design-system.css и существующую реализацию, определить источник расхождения и затем осознанно синхронизировать код и архитектурное описание.

18. Два независимых компонента и постоянный reconcile

Frontend — готовый статический артефакт dist/; backend — самостоятельный артефакт backend/. Корневой npm run build собирает только frontend. Backend-зависимости принадлежат только backend/package.json; backend, node_modules, SMTP-конфигурация, WinSW и backend release-файлы запрещены в dist/.

Версии компонентов определяются отдельно через Git tree hash HEAD:dist и HEAD:backend. Компонент со статусом UNCHANGED нельзя паковать, загружать, переключать, перезапускать или записывать в production state.

Backend хранится в immutable C:\Sites\BTS\backend-releases\<release_id>, активируется junction C:\Sites\BTS\backend-current, работает как WinSW-служба BTSContactApi под NT AUTHORITY\LocalService и слушает только 127.0.0.1:3001. IIS /api/* proxy находится вне dist и включается только после строгого local backend health. Backend-секреты хранятся только во внешнем environment.

Backend rollback обязателен; при релизе двух компонентов ошибка должна восстановить оба изменённых компонента. scripts/production/ensure-production.ps1 — единственный постоянный способ проверки и восстановления application infrastructure; component rollback не откатывает выполненный им ремонт инфраструктуры.

19. Каноническая frontend-архитектура: сайт как конструктор

Frontend сайта должен развиваться как конструктор из переиспользуемых системных сущностей, а не как набор независимо оформленных страниц и блоков.

Обязательная иерархия:

PAGE → BLOCK_ID → PATTERN → VARIANT → SLOT → COMPONENT → TYPE/MEDIA → DESIGN TOKEN

Смысл уровней:

PAGE определяет состав, порядок и содержание страницы;

BLOCK_ID идентифицирует конкретный экземпляр блока;

PATTERN определяет тип композиции блока;

VARIANT задаёт допустимую системную разновидность pattern;

SLOT определяет логическое место контента внутри pattern;

COMPONENT задаёт переиспользуемый UI-компонент;

TYPE задаёт типографическую роль;

MEDIA задаёт медиа через единый реестр;

DESIGN TOKEN задаёт системное визуальное значение.

Конкретная страница не должна становиться самостоятельным источником дизайна.

20. Источники истины frontend

Перед любыми изменениями структуры или внешнего вида страниц обязательно изучить:

assets/design-system.css — канонические design tokens, typography roles, layout primitives, reusable components, section patterns, variants и themes;

assets/site-architecture.js — машинно-читаемый реестр PAGE → BLOCK_ID → PATTERN → MEDIA_ID и связанные архитектурные параметры;

HTML соответствующей страницы — фактический контент, порядок блоков и DOM;

assets/styles.css — текущий compatibility/legacy-слой реализации.

Приоритет для новой или изменяемой frontend-реализации:

design-system.css + site-architecture.js → HTML-композиция → минимальный compatibility CSS.

assets/styles.css нельзя превращать в новое место хранения индивидуального дизайна страниц.

21. PAGE хранит содержание, а не дизайн

В PAGE/HTML разрешено определять:

состав и порядок блоков;

текст;

ссылки;

медиа;

BLOCK_ID;

PATTERN;

VARIANT;

THEME;

содержимое SLOT;

используемые reusable components.

PAGE/HTML не должен самостоятельно определять:

цвета;

размеры шрифтов;

line-height;

letter-spacing;

системные отступы;

размеры кнопок;

border-radius;

ширину базового контейнера;

основную grid-сетку;

стандартные gap;

фон секции через произвольный HEX/RGB;

стандартные aspect ratio медиа;

отдельные desktop/mobile версии одного и того же контента.

Принцип:

PAGE описывает, что находится на странице. Design system определяет, как это выглядит.

Inline style и локальные <style> в HTML для оформления страницы запрещены.

22. Design tokens обязательны

Для новых и изменяемых частей интерфейса запрещено вводить произвольные локальные значения, если соответствующее значение уже описано в дизайн-системе.

Это относится к:

цветам;

шрифтам;

font-weight;

размерам текста;

line-height;

letter-spacing;

spacing;

section padding;

grid gap;

размерам controls;

padding controls;

border;

divider;

radius;

card background;

media ratio.

Использовать существующие системные токены, в том числе:

--color-bg;

--color-paper;

--color-white;

--color-ink;

--color-muted;

--color-metal;

--color-copy-secondary;

--color-wet-asphalt;

--color-wet-asphalt-strong;

--color-dark;

--color-dark-2;

--color-accent;

--color-accent-strong;

--color-line-light;

--color-line-dark;

--ds-space-1 ... --ds-space-11;

--grid-gap;

--split-gap;

--stack-gap;

--section-padding-y;

control tokens;

media ratio tokens.

Не создавать переменные вида:

--home-*;

--products-*;

--block-*;

--page-* для оформления отдельного блока;

токены, нужные только одному конкретному экземпляру секции.

Новый design token допустим только если существующая система объективно не выражает необходимое значение и новый token является семантическим, системным и повторно используемым.

Для обычного изменения контента или перекомпоновки существующей страницы целевой результат — новых design tokens нет.

23. Типографика только через системные роли

Новые и изменяемые текстовые элементы должны использовать существующие typography roles:

T-EYEBROW;

T-DISPLAY-XL;

T-DISPLAY-L;

T-DISPLAY-M;

T-H3;

T-LEAD;

T-BODY;

T-BODY-S;

T-NOTE;

T-METRIC.

Не задавать для конкретного блока собственные font-size, font-weight, line-height или letter-spacing, если требуемая роль уже существует.

Цветовой тон текста также должен идти через существующую систему, например metal, muted или foreground текущей theme, а не через локальный HEX.

24. PATTERN определяет композицию блока

Перед написанием собственного layout сначала выбрать существующий системный pattern.

Канонический набор patterns:

S-HERO;

S-STATEMENT;

S-EDITORIAL;

S-EDITORIAL-MEDIA;

S-SPLIT;

S-MEDIA-COPY;

S-METRICS;

S-GALLERY;

S-SPECS;

S-FAQ;

S-CTA.

Если требуемая композиция выражается существующим pattern, нельзя создавать отдельную grid/flex-схему специально для конкретного BLOCK_ID.

BLOCK_ID идентифицирует экземпляр блока, но не является дизайн-компонентом.

Запрещено создавать стили вида:

[data-block-id="HOME-02"] { ... }
[data-block-id="PRODUCTS-04"] { ... }
.home-02 { ... }
.block-04-special { ... }

Внешний вид должен определяться через:

PATTERN + VARIANT + THEME + COMPONENT + DESIGN TOKEN.

25. VARIANT изменяет pattern, а не отдельный BLOCK_ID

Различия внутри одного pattern задаются через системные variants.

Использовать уже существующие variants, когда они подходят, включая, но не ограничиваясь:

clouds;

media-right;

copy-right;

statement-offset;

two-cards;

three-cards;

three-columns;

four-media;

media-left;

reverse;

другие уже зарегистрированные варианты.

Новый variant допустим только если:

требуемая композиция не выражается существующим pattern;

её нельзя собрать существующими primitives/components;

существующего variant недостаточно;

новый variant описывает общий композиционный смысл;

новый variant потенциально пригоден другим страницам.

Название нового variant не должно содержать HOME, PRODUCTS, номер блока или иное указание на конкретную страницу.

Допустимо: featured-metric, media-after, gallery-featured.

Недопустимо: home-02-layout, products-special, block4-tech.

Для обычных изменений страниц целевой результат — новых variants нет, если существующая система достаточна.

26. Reusable components обязательны

Сначала использовать существующие компоненты:

C-CONTAINER;

C-STACK;

C-SPLIT;

C-SECTION-HEADER;

C-FEATURE-LIST;

C-FEATURE-ITEM;

C-METRIC-CARD;

C-INFO-CARD;

C-MEDIA;

C-BUTTON;

C-TEXT-LINK;

C-GALLERY;

C-FAQ-ITEM.

Не создавать page-specific компоненты вроде:

HomeProductCard;

HomeBenefit;

HomeTechnicalCard;

ProductsCustomMetric.

Если элемент по смыслу является существующим системным компонентом, нужно использовать его.

Новый component допустим только для действительно нового повторно используемого UI-примитива, который нельзя корректно выразить существующими компонентами.

Для обычного обновления контента страницы целевой результат — новых components нет.

27. SLOT должен отражать структуру PATTERN

Внутри patterns использовать их логические slots, например:

layout;

body;

statement;

items;

media;

specs.

Не создавать дополнительную DOM-иерархию только ради позиционирования, если существующий pattern уже предоставляет нужный slot.

Структура должна позволять другой PAGE использовать тот же pattern и те же components без копирования CSS конкретной страницы.

28. Цвета, themes, spacing и controls

Фон секции задавать через существующую THEME, а не локальным цветом.

Использовать существующие themes:

light;

paper;

contrast-light;

dark;

accent-light;

light-gradient;

dark-background-photo.

Стандартные отступы должны использовать системную шкалу spacing и layout primitives. Не вводить произвольные значения вроде 19px, 27px, 37px, 53px, если они не являются частью существующего legacy-кода, который задача не затрагивает.

Однотипные вертикальные последовательности собирать через C-STACK или соответствующий primitive вместо набора индивидуальных margin.

Все CTA и стандартные кнопки должны использовать общий button component и системные control tokens.

Не создавать для конкретной страницы собственные:

высоту кнопки;

padding;

font-size;

radius;

hover-state;

цвет кнопки.

29. MEDIA только через единый registry

Каждое системно используемое изображение, видео, схема, procedural media или декоративное media должно быть связано с единым MEDIA registry в assets/site-architecture.js.

Для media должны быть корректно описаны применимые параметры:

MEDIA_ID;

type;

src;

crop;

role;

width/height, если известны;

DOM binding.

Если media уже зарегистрировано, переиспользовать существующую запись или корректно связать тот же ресурс с новой PAGE без дублирования сущности без причины.

Нельзя превращать HTML и локальный CSS в отдельный параллельный источник media-правил.

Использовать существующие media roles и системные aspect ratio:

M-WIDE;

M-STANDARD;

M-NATIVE;

16 / 9;

4 / 3;

1 / 1;

native.

Для preview допускается системный crop: allow, если это предусмотрено композицией. Полноэкранный просмотр через PhotoSwipe должен сохранять доступ к исходному изображению.

30. Ограничения для assets/styles.css

Существующий assets/styles.css содержит legacy/compatibility-реализацию и может сохраняться для уже работающих частей сайта.

При новых изменениях нельзя расширять его как набор индивидуальных дизайнов конкретных PAGE/BLOCK.

Допускается:

исправить legacy-правило, которое мешает системной композиции;

удалить или упростить устаревшее page-specific правило после перехода на системный pattern/component;

обеспечить compatibility между существующим DOM и дизайн-системой.

Не допускается:

новый CSS по BLOCK_ID;

новый CSS-класс .home-*, .products-* или аналогичный только ради оформления конкретной секции;

новые page-specific custom properties;

локальные HEX/RGB;

локальные размеры шрифтов/controls;

копирование системного component в page-specific класс.

Если для нового/перекомпонованного блока требуется существенный объём уникального CSS, сначала считать это признаком неверного архитектурного решения и повторно проверить возможность собрать блок через существующий constructor.

31. Адаптив — состояние той же системы, а не отдельный дизайн

Mobile/tablet/desktop должны быть адаптивными состояниями тех же patterns и components.

Канонические breakpoints:

mobile: до 767px;

tablet: 768–1023px;

desktop: от 1024px.

Не дублировать контент для mobile.

Не создавать отдельную HTML-структуру страницы под mobile.

Если адаптивное поведение относится к общему pattern/component, правило должно находиться на системном уровне и быть применимо ко всем экземплярам этого pattern/component.

Индивидуальные media query только ради одного BLOCK_ID запрещены.

32. site-architecture.js обязан соответствовать реальному DOM

После любого изменения структуры страницы проверить каждый затронутый блок.

Для каждого блока в assets/site-architecture.js должны соответствовать реальному DOM:

id;

selector;

pattern;

titleRole;

theme;

variants;

media.

Нельзя оставлять registry в состоянии исторической документации старой страницы.

Если фактический pattern изменился, registry должен быть обновлён в том же наборе изменений.

Если media удалено, добавлено или перенесено, bindings должны быть синхронизированы.

assets/site-architecture.js — машинно-читаемое описание текущей архитектуры сайта.

33. Политика расширения конструктора

Перед созданием новой системной сущности применять следующий порядок:

проверить существующий PATTERN;

проверить существующий VARIANT;

проверить существующие layout primitives;

проверить существующие reusable components;

проверить существующие typography/media/theme tokens;

только после этого рассматривать расширение системы.

Любая новая сущность должна быть:

семантической;

общей;

повторно используемой;

не привязанной к конкретной странице;

не привязанной к номеру блока.

Запрещено маскировать page-specific решение под якобы generic component/variant.

Для типовой редакции страницы ожидаемый результат:

новые design tokens: нет;

новые components: нет;

новые patterns: нет;

новые page-specific CSS rules: нет;

новые inline styles: нет.

34. Обязательная архитектурная проверка после frontend-изменений

После изменений страницы, помимо build/preflight/Playwright, проверить архитектуру конструктора.

В затронутом коде не должно появиться без отдельного обоснования:

новых HEX/RGB для оформления конкретной страницы;

новых произвольных font-size;

новых произвольных section padding/gap;

новых размеров кнопок;

CSS selectors по BLOCK_ID;

новых .home-*, .products-* и аналогичных классов, созданных только ради дизайна;

page-specific CSS custom properties;

inline style;

локальных <style>;

дублирования существующих components;

необоснованного дублирования MEDIA;

отдельных desktop/mobile DOM-реализаций одного блока.

В итоговом отчёте по существенному frontend-изменению добавлять краткий раздел ARCHITECTURE CHECK:

новые design tokens: нет / перечислить и обосновать;

новые components: нет / перечислить и обосновать;

новые patterns: нет / перечислить и обосновать;

новые variants: нет / перечислить и обосновать;

page-specific CSS: нет / перечислить и обосновать;

inline styles: нет;

MEDIA registry синхронизирован: да/нет;

site-architecture.js соответствует DOM: да/нет.

35. Критерий правильной frontend-архитектуры

Frontend-изменение считается архитектурно корректным только если одновременно выполнены два условия:

страница визуально и функционально соответствует поставленной задаче;

аналогичную страницу можно собрать из тех же PATTERN / VARIANT / COMPONENT / TYPE / MEDIA / TOKEN без копирования CSS из уже сделанной страницы.

Если второе условие не выполняется, решение не соответствует принципу конструктора и должно быть переработано до завершения задачи.