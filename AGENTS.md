# Правила работы с проектом БТС

## 1. Источник истины

Перед изменениями `dist/`, `backend/`, staging, production, IIS, release, SSH/SCP, worker или rollback обязательно прочитать `INFRASTRUCTURE.md`. Если фактическая инфраструктура намеренно меняется, одновременно обновлять этот файл и `INFRASTRUCTURE.md`.

## 2. Два независимых компонента

Frontend — статический готовый артефакт `dist/`. Backend — самостоятельный готовый компонент `backend/`. Их версии определяются Git tree hash: `HEAD:dist` и `HEAD:backend`.

`npm run build` собирает только frontend. В `dist/` запрещены backend, Node runtime, `node_modules`, SMTP-конфигурация, `.env`, WinSW и backend release-файлы. Backend-зависимости принадлежат только `backend/package.json` и устанавливаются на staging через `npm ci --prefix backend --omit=dev`.

Компонент с совпавшим production tree hash нельзя упаковывать, загружать, переключать, перезапускать или записывать в state. При отсутствии изменений обоих компонентов release ничего не публикует.

## 3. Проверенная публикация

Frontend и backend могут попасть в production только после commit, ручного Pull через GitHub Desktop на немецком сервере, проверки `https://stage.btsys.ru`, preflight/Playwright и совпадения локального HEAD с `origin/main`. Автодеплой и автоматический `git pull` запрещены.

Основная ветка — `main`. Перед release дерево чистое; `release-prod.ps1` делает fetch, но не pull. Merge/rebase/force/reset/clean автоматически не выполнять.

## 4. Frontend artifact

После изменения сайта: изменить исходники, выполнить `npm run build`, проверить `dist/`, включить исходники и соответствующий `dist/` в один commit. Не исправлять только `dist/`.

`dist/` production-safe и одинаков для staging/production. В нём запрещены `stage.btsys.ru`, `localhost`, `127.0.0.1`, локальные пути и staging noindex. `404.html` имеет собственный noindex. Не ломать `.webp`, security headers, CSP и 404 в `web.config`.

Обязательны `index.html`, маршруты products/faq/about/contacts, `404.html`, robots, sitemap, `web.config`, Mail.ru/Yandex verification и BIMI.

## 5. Backend и секреты

Backend слушает только `127.0.0.1:3001`; IIS site-level проксирует только `/api/*`. Express доверяет forwarded IP только loopback IIS. Обязательны `/api/health`, server validation, honeypot, rate limit, JSON limit и безопасные 400/429/500.

SMTP-переменные: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `CONTACT_TO`. Пароль хранится только вне Git в production/staging environment. Никогда не читать/печатать/коммитить приватные ключи, пароли или токены.

Production имеет постоянный Node.js runtime только для backend. Production не использует npm registry, не выполняет `npm install`/`npm ci`, не содержит Git/исходную рабочую копию и ничего не собирает. Backend ZIP приезжает с production `node_modules`.

## 6. Staging

Рабочая копия: `C:\Users\Administrator\Desktop\Our_Projects\site_bak`. IIS site: `BTS-STAGE`; URL: `https://stage.btsys.ru`; frontend path: `<repo>\dist`. Backend запускается отдельно с environment вне Git, а постоянное IIS правило `/api/*` настраивается `scripts/configure-staging-iis.ps1`.

Не затрагивать `POTOK_WebApp` / `potok-crm.ru` на том же сервере.

## 7. Production

IIS site/app pool: `BTS`; URL: `https://btsys.ru`. Frontend releases: `C:\Sites\BTS\releases\<release_id>`. Backend releases: `C:\Sites\BTS\backend-releases\<release_id>`; active junction: `C:\Sites\BTS\backend-current`; WinSW service: `BTS Contact API` (`BTSContactApi`).

Не удалять `C:\Sites\BTS\releases\20260911-193310_legacy-prod` и `C:\Sites\BTS_Site\bts-fuel-tanks\dist`. Immutable release нельзя менять после публикации.

Постоянное IIS `/api/*` правило находится в applicationHost.config, не в frontend `web.config`. Не менять bindings, HTTPS, certificates, HSTS, DNS или весь сайт proxy.

## 8. Release и worker

Канонический клиент: `scripts/release-prod.ps1`. Он сравнивает component trees, запускает preflight, готовит только изменившиеся ZIP, считает SHA-256, загружает все ZIP первыми и request JSON последним.

Канонический versioned worker: `scripts/production/worker-v2.ps1`; установленный путь: `C:\ProgramData\BTS\deploy\worker.ps1`; запуск как SYSTEM через существующую Scheduled Task. `bts-deploy` остаётся непривилегированным и имеет только транспортные права incoming/outbox.

Worker разворачивает backend первым, проверяет `/api/health`, затем переключает frontend и выполняет прежние sitemap/404 health checks. State обновляется только после успеха. Ошибка откатывает все компоненты, изменённые release; неизменившийся компонент не затрагивается. External failure вызывает rollback request.

State сохраняет отдельные frontend/backend tree, commit и backend release; старые `current-release.txt`/`current-commit.txt` сохраняют frontend-совместимость.

## 9. Migration и rollback

Однократную миграцию выполняет только Administrator вручную: `scripts/production/migrate-two-component.ps1`. Она делает IIS/worker/state backup, проверяет Node, URL Rewrite, ARR, WinSW и SMTP_PASS, не переключает активный frontend, создаёт backend storage/service/proxy и устанавливает worker.

Откат миграции: `scripts/production/rollback-migration.ps1`. Не выполнять миграцию, live release или production rollback автоматически из задач разработки.

## 10. SSH и VPN

Deployment key: `C:\ProgramData\BTS\ssh\bts_prod_ed25519`, строго вне Git. Production SSH пользователь `bts-deploy`, source Germany `142.132.205.110`, production IP `135.106.194.75`. Перед live release AmneziaVPN на Selectel должен быть выключен; release script не управляет VPN.

## 11. Временные файлы и проверки

`.release/` игнорируется Git. `*.before-*` не коммитить. Перед завершением проверить build, backend lock/install/tests (если сеть доступна), frontend routes/form, dist separation, PowerShell syntax, secrets, `git status --short`, `git diff --stat` и собственный diff.
