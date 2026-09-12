# Инфраструктура сайта БТС

Статус: каноническое описание двухкомпонентной архитектуры после выполнения однократной миграции. Миграционные скрипты подготовлены в репозитории, но не запускаются автоматически.

Репозиторий: `IchFliegeMitDemFlugzeug/site_bak`. Основная ветка: `main`.

## 1. Общая схема

```text
frontend sources -> npm run build -> dist/ -------------------+
                                                              |
backend sources  -> npm ci --prefix backend --omit=dev -------+-> manual staging check
                                                                    -> release-prod.ps1
                                                                    -> ZIP(s), SHA-256
                                                                    -> SSH/SCP request-last
                                                                    -> production worker
                                                                    -> health / rollback
```

Frontend и backend — независимые версионируемые компоненты одного commit. Автодеплоя и автоматического pull нет. Пользователь вручную проверяет staging до production release.

## 2. Frontend

`dist/` — готовый статический production frontend. Корневой `npm run build` собирает только его. В `dist/` нет backend, Express, Nodemailer, Node runtime, `node_modules`, SMTP-настроек, `.env`, WinSW или backend release-файлов.

Staging и production получают один и тот же `dist/`. Staging noindex существует только в IIS. `dist/web.config` остаётся production-safe и содержит MIME `.webp`, security headers, CSP `connect-src 'self'` и 404. Site-level API proxy в него не входит.

Production frontend releases неизменяемы:

```text
C:\Sites\BTS\releases\<release_id>\
```

Активный frontend выбирается physical path корневого vdir IIS site `BTS`.

## 3. Backend

Самостоятельный компонент:

```text
backend\server.js
backend\package.json
backend\package-lock.json
backend\tests\
backend\config\
```

Зависимости Express, Nodemailer и express-rate-limit принадлежат только backend. На staging/build machine выполняется `npm ci --prefix backend --omit=dev`. Production backend ZIP содержит `server.js`, package/lock и production `node_modules`; production не обращается к npm registry.

Процесс слушает только `127.0.0.1:3001` и предоставляет:

- `GET /api/health` -> `{"ok":true}`;
- `POST /api/contact` -> SMTP form delivery.

SMTP берётся только из environment: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `CONTACT_TO`. Production secret находится в machine environment и не входит в Git/ZIP/log frontend.

Express отключает `x-powered-by`, ограничивает JSON, валидирует поля, использует honeypot и 5 запросов/15 минут. `trust proxy` доверяет forwarded chain только когда непосредственный peer — loopback IIS, поэтому limiter использует client IP от ARR и не доверяет внешнему заголовку при прямом соединении.

## 4. IIS

Production site/app pool: `BTS`; public URL: `https://btsys.ru`. Статические URL остаются IIS frontend. Постоянное site-level правило в applicationHost.config:

```text
/api/* -> http://127.0.0.1:3001/api/*
```

Используются только IIS URL Rewrite + ARR. Правило не привязано к immutable frontend release. Bindings, HTTPS, certificates, HSTS и DNS миграция/release не меняют. Порт 3001 наружу не открывается.

## 5. Backend Windows Service и storage

Production имеет постоянный Node.js runtime только для backend. Git, npm registry и build на production не используются.

```text
C:\Sites\BTS\backend-releases\<release_id>\  immutable releases
C:\Sites\BTS\backend-current              NTFS junction
C:\ProgramData\BTS\contact-api\           WinSW config/binary/logs
```

WinSW binary не хранится в Git. Шаблон `backend/config/BTS.ContactApi.xml` регистрирует automatic service `BTS Contact API` (`BTSContactApi`), запускающий `C:\Sites\BTS\backend-current\server.js`.

## 6. Component versions и state

Локальные идентификаторы:

```text
git rev-parse HEAD:dist
git rev-parse HEAD:backend
```

Production state в `C:\ProgramData\BTS\deploy\state`:

```text
current-frontend-tree.txt
current-frontend-commit.txt
current-backend-tree.txt
current-backend-commit.txt
current-backend-release.txt
```

Backward compatibility:

- `current-release.txt` остаётся активным frontend path;
- `current-commit.txt` остаётся commit последнего успешного frontend switch.

Если `current-frontend-tree.txt` ещё отсутствует, release client читает старый `current-commit.txt` и локально вычисляет `<commit>:dist`. Если commit недоступен, безопасный fallback — frontend `CHANGED`.

## 7. Selective release plan

`scripts/release-prod.ps1` сравнивает local/production trees и выводит DEPLOY/SKIP отдельно.

| Frontend | Backend | Действие |
|---|---|---|
| unchanged | unchanged | ничего не создавать и не отправлять |
| changed | unchanged | только frontend ZIP/switch/health/state |
| unchanged | changed | только backend ZIP/service switch/health/state |
| changed | changed | оба компонента транзакционно |

Для SKIP запрещены ZIP, upload, release directory, IIS/junction switch, service restart и state update.

До упаковки обязательны clean `main`, `HEAD == origin/main`, preflight и повторная GitHub-проверка. Frontend ZIP содержит текущий `dist`. Backend ZIP создаётся только после `npm ci --prefix backend --omit=dev` и tests. SHA-256 и tree/commit/archive/release_id записываются в request manifest. Все нужные архивы загружаются первыми; request JSON — последним.

`-DryRun` выполняет безопасные проверки, показывает план и готовит только необходимые локальные artifacts, но ничего не загружает/переключает/перезапускает.

## 8. Production worker

Source: `scripts/production/worker-v2.ps1`. Installed path: `C:\ProgramData\BTS\deploy\worker.ps1`. Existing Scheduled Task запускает его как SYSTEM. SSH account `bts-deploy` остаётся непривилегированным с Modify на incoming и Read на outbox.

Worker:

1. валидирует release id, commit, component flags/tree/archive/SHA-256;
2. проверяет наличие и hash всех changed archives;
3. сохраняет snapshot обоих active components;
4. распаковывает changed artifacts в новые immutable directories;
5. переключает backend, запускает service, проверяет local `/api/health`;
6. переключает frontend и выполняет прежние sitemap URL + 404 internal checks;
7. только после успеха атомарно публикует result и обновляет state.

## 9. Rollback

Backend-only failure: service stop -> junction назад -> service start -> old health. Frontend-only failure: IIS physical path назад -> old sitemap/404 health.

Combined release выполняет backend первым, затем frontend. Ошибка любого этапа до state commit восстанавливает оба компонента из snapshot и проверяет восстановленное состояние. Production не остаётся в половинчатой комбинации.

После server PASS release client проверяет public frontend URLs, отсутствие production `X-Robots-Tag`, public `/api/health` и 404. После трёх неудачных попыток отправляет rollback request. Worker проверяет, что active paths всё ещё принадлежат этому release, и откатывает все изменённые компоненты. Неизменившийся компонент не трогается.

## 10. Staging

German server working copy:

```text
C:\Users\Administrator\Desktop\Our_Projects\site_bak
```

IIS site: `BTS-STAGE`; URL: `https://stage.btsys.ru`; frontend path: `<repo>\dist`. Сайт `POTOK_WebApp` / `potok-crm.ru` не затрагивается.

Однократно Administrator запускает `scripts/configure-staging-iis.ps1`: prerequisite ARR/URL Rewrite проверяется, создаётся IIS backup, site-level `/api/*` proxy добавляется только для `BTS-STAGE`.

Backend запускается `scripts/setup-staging-backend.ps1`. Отдельный secret config хранится вне Git: `C:\ProgramData\BTS\staging-contact-api.env`. Production secrets staging не использует. При обновлении backend скрипт детерминированно выполняет npm ci и запускает текущий `backend/server.js`.

## 11. Однократная production migration

Migration не выполняется автоматически. Перед ней на staging создают initial backend ZIP:

```powershell
powershell.exe -File .\scripts\package-backend.ps1
$backendTree = git rev-parse HEAD:backend
$commit = git rev-parse HEAD
```

На Selectel Administrator запускает из полученной versioned рабочей папки:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\production\migrate-two-component.ps1 `
  -InitialBackendZip <backend-initial.zip> `
  -InitialBackendTree $backendTree `
  -InitialBackendCommit $commit `
  -WinSWExe <WinSW-x64.exe>
```

Script проверяет Administrator, Node.js, IIS, URL Rewrite, ARR, WinSW input и machine `SMTP_PASS`; делает IIS backup и копии worker/state; не меняет active frontend; не пересобирает production; не удаляет releases/baseline; создаёт backend directories/junction/service/logs/state; задаёт минимальные ACL incoming/outbox; добавляет постоянный `BTS` API proxy; устанавливает worker; запускает service и проверяет health. Повторный запуск не удаляет working releases и не дублирует IIS rule/service.

При ошибке выполнить путь backup, выведенный migration:

```powershell
powershell.exe -File .\scripts\production\rollback-migration.ps1 -BackupRoot <backup-path>
```

Rollback удаляет новую service, возвращает прежний junction (если был), worker, deployment state и IIS backup. Active frontend не удаляется. Legacy baseline `C:\Sites\BTS\releases\20260911-193310_legacy-prod` и старый `C:\Sites\BTS_Site\bts-fuel-tanks\dist` никогда не удаляются.

## 12. SSH, VPN и release safety

Production IP `135.106.194.75`; staging source `142.132.205.110`; user `bts-deploy`; private key `C:\ProgramData\BTS\ssh\bts_prod_ed25519` вне Git. Account не Administrator. SSH остаётся key-only/source-restricted.

Перед live release AmneziaVPN на Selectel выключается вручную; script не управляет VPN. Архивы идут первыми, manifest последним. Никакого automatic pull, push deploy или копирования поверх active immutable release нет.

## 13. Обычный процесс

1. Изменить frontend и/или backend.
2. Для frontend выполнить `npm run build`; для backend — `npm ci --prefix backend` и tests.
3. Закоммитить согласованные sources, `dist`, `backend`, scripts/docs.
4. На Germany вручную Pull через GitHub Desktop.
5. Запустить staging backend; проверить `stage.btsys.ru`, форму, `/api/health`, Playwright.
6. Выключить Selectel VPN.
7. Запустить `scripts/release-prod.ps1` или сначала `-DryRun`.
8. Проверить plan и финальный PASS. При ошибке worker/client выполняют rollback.
