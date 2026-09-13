# Инфраструктура сайта БТС

Статус документа: канонический технический слепок инфраструктуры.

Дата контрольной фиксации: 2026-09-11.

Репозиторий: `IchFliegeMitDemFlugzeug/site_bak`

Основная ветка: `main`

Этот документ описывает фактически настроенную и проверенную цепочку разработки, staging, production-релиза и rollback. Он предназначен для пользователя, ChatGPT, Codex, Sites и других агентов.

## CURRENT STATE

До ручного успешного запуска `scripts\production\migrate-two-component.ps1` production работает по описанной ниже проверенной static-only схеме. Все исторические сведения, пути, проверки и failure cases в разделах 1–30 относятся к этому фактическому состоянию.

## TARGET STATE AFTER MIGRATION

После отдельно согласованной миграции к существующему статическому frontend добавляются Node.js backend runtime, immutable backend releases, junction `backend-current`, WinSW-служба `BTSContactApi`, постоянный IIS `/api/*` proxy и selective deployment по tree hash. Подробное целевое состояние описано в разделе 31. До реального выполнения и проверки миграции оно не считается текущим production state.

---

## 1. Назначение и главный принцип

Сайт БТС — небольшой статический корпоративный сайт.

Инфраструктура намеренно построена без сложного CI/CD: пользователь должен вручную увидеть и проверить staging перед production.

Каноническая цепочка:

```text
Codex / Sites / ручные изменения
        ↓
изменение исходников
        ↓
npm run build
        ↓
исходники + соответствующий dist в одном Git commit
        ↓
GitHub main
        ↓
ручной Pull через GitHub Desktop на немецком сервере
        ↓
stage.btsys.ru показывает локальный dist
        ↓
ручная визуальная проверка пользователем
        ↓
scripts/release-prod.ps1
        ↓
автоматический preflight + Playwright
        ↓
повторная сверка локального HEAD с origin/main
        ↓
упаковка именно текущего dist + SHA-256
        ↓
SSH/SCP на Selectel
        ↓
production worker
        ↓
новая immutable release-папка
        ↓
переключение IIS physical path
        ↓
внутренние health checks
        ↓
внешние health checks с немецкого сервера
        ↓
PASS
```

Если проверка после переключения не проходит, выполняется автоматический rollback.

Автоматической публикации по `git push` нет.

---

## 2. Основные инварианты

`dist/`:

- является готовым production-артефактом;
- хранится в Git;
- соответствует исходникам того же commit;
- не требует сборки или ручной правки на production;
- одинаков для staging и production.

Production:

- не собирает проект;
- не использует Git;
- не использует Node.js/npm;
- получает только готовый артефакт;
- каждый релиз размещает в новой immutable-папке;
- переключает IIS только изменением physical path;
- сохраняет предыдущую версию для rollback.

Staging:

- показывает тот же `dist/`, который потенциально уйдёт в production;
- имеет staging-специфичную поисковую изоляцию только на уровне IIS;
- не вносит staging-настройки в `dist/`.

GitHub:

- является канонической системой версий;
- используется одна основная ветка `main`;
- production release разрешён только когда локальный `HEAD` точно совпадает с `origin/main`;
- `git fetch` допустим автоматически;
- `git pull` перед релизом автоматически не выполняется.

---

## 3. Репозиторий и структура проекта

GitHub:

```text
IchFliegeMitDemFlugzeug/site_bak
```

Основная ветка:

```text
main
```

Рабочая копия на немецком staging-сервере:

```text
C:\Users\Administrator\Desktop\Our_Projects\site_bak
```

Ключевые файлы:

```text
AGENTS.md
INFRASTRUCTURE.md
build.mjs
package.json
package-lock.json
playwright.config.mjs

scripts\
    preflight.ps1
    release-prod.ps1

tests\
    stage-smoke.spec.mjs

dist\
    ...
```

Локальные release-артефакты:

```text
.release\
```

`.release/` игнорируется Git.

Локальный ярлык релиза может находиться в:

```text
.local\RELEASE BTS TO PROD.lnk
```

`.local/` может быть исключена только локально через `.git\info\exclude` и не является частью канонического репозитория.

---

## 4. Сборка

Node.js на staging-сервере: `v24.21.0`.

npm: `11.19.0`.

Сборка:

```powershell
npm run build
```

Основная логика сборки:

```text
build.mjs
```

После изменения сайта обязательно:

```text
исходники → npm run build → проверка dist → один commit
```

Не допускается ситуация, когда исходники одного состояния, а `dist/` — другого.

Не допускается ручное исправление только `dist/`, если соответствующее изменение не отражено в исходниках.

---

## 5. Production-safe `dist/`

`dist/` является единственным переносимым веб-артефактом.

В нём находятся, в частности:

```text
index.html
products\index.html
faq\index.html
about\index.html
contacts\index.html
404.html
robots.txt
sitemap.xml
web.config
Mail.ru verification
Yandex verification
assets\bimi\
CSS / JS / изображения / шрифты / favicon
```

`dist/web.config` содержит production-safe настройки IIS, включая MIME mapping `.webp`, защитные HTTP-заголовки, Content-Security-Policy и фирменную обработку `404.html`.

В `dist/` не должно быть:

```text
stage.btsys.ru
localhost
127.0.0.1
C:\Users\
X-Robots-Tag
```

Глобального `noindex` для staging в `dist/` быть не должно.

`404.html` может иметь собственный `noindex`.

---

## 6. Немецкий staging-сервер

### 6.1. Назначение

Сервер используется для рабочей Git-копии, GitHub Desktop, инструментов разработки, сборки сайта, staging IIS, Playwright, запуска production release-клиента и SSH/SCP-передачи артефакта на Selectel.

На этом же сервере находится другое приложение:

```text
POTOK_WebApp
potok-crm.ru
```

Оно не относится к БТС.

**POTOK_WebApp запрещено останавливать, перенастраивать, переносить, использовать для БТС или затрагивать при обслуживании сайта БТС.**

### 6.2. Рабочий проект

```text
C:\Users\Administrator\Desktop\Our_Projects\site_bak
```

### 6.3. Staging

IIS site:

```text
BTS-STAGE
```

Адрес:

```text
https://stage.btsys.ru
```

Physical path:

```text
C:\Users\Administrator\Desktop\Our_Projects\site_bak\dist
```

Staging обслуживает непосредственно текущий локальный `dist/`. Отдельного копирования staging-артефакта нет.

### 6.4. HTTPS

Для staging настроен Let's Encrypt через win-acme.

Контрольная использовавшаяся версия win-acme: `2.2.9.1701`.

### 6.5. Поисковая изоляция staging

В `dist/` staging-noindex отсутствует.

На уровне IIS/applicationHost только для `BTS-STAGE` добавлен:

```text
X-Robots-Tag: noindex, nofollow, noarchive
```

Этот header нельзя переносить в `dist/web.config`.

Для корректной локальной фирменной 404 на staging также настроено:

```text
system.webServer/httpErrors
errorMode = Custom
```

только для `BTS-STAGE`.

IIS backups:

```text
BEFORE_BTS_STAGE_NOINDEX_20260911
BEFORE_BTS_STAGE_CUSTOM_404_20260911
```

---

## 7. Автоматические проверки staging

Playwright: `@playwright/test 1.63.0`.

Конфигурация:

```text
playwright.config.mjs
```

Тесты:

```text
tests\stage-smoke.spec.mjs
```

npm-команда:

```powershell
npm run test:stage
```

На момент контрольной фиксации набор выполнял 14 тестов.

Проверяются основные страницы, реальный 404, desktop Chromium, mobile-профиль Pixel 7, title, staging `X-Robots-Tag`, отсутствие production-опасного `noindex` на основных страницах, навигация, изображения, JavaScript errors, критические CSS/JS/image requests, навигационные взаимодействия и lazy images после прокрутки в viewport.

---

## 8. Preflight перед production

Скрипт:

```text
scripts\preflight.ps1
```

npm-команда:

```powershell
npm run preflight
```

Preflight проверяет:

- наличие Git и npm;
- ветку `main`;
- чистоту Git working tree;
- наличие `dist/`;
- обязательные production-файлы;
- BIMI;
- отсутствие staging/локальных маркеров;
- отсутствие `X-Robots-Tag` в `dist`;
- отсутствие `noindex` вне 404;
- корректность `robots.txt`;
- корректность `sitemap.xml`;
- canonical URLs;
- реальные Playwright-тесты staging.

Preflight сам по себе не выполняет production deployment.

---

## 9. Правило Git перед release

Production release-клиент выполняет `git fetch origin main --prune`.

Он сравнивает `local HEAD` и `origin/main` до preflight и повторно после preflight.

Если GitHub изменился во время тестов, релиз останавливается.

Это гарантирует:

```text
новый remote commit
→ release STOP
→ пользователь вручную Pull
→ пользователь снова смотрит staging
→ только потом новый release
```

Автоматический `git pull` запрещён, потому что он мог бы опубликовать состояние, которое пользователь не видел на staging.

---

## 10. Production-сервер Selectel

### 10.1. ОС и адрес

Windows Server 2019 Standard.

Имя машины:

```text
ELYZA
```

Production IPv4:

```text
135.106.194.75
```

Публичный сайт:

```text
https://btsys.ru
```

### 10.2. IIS

IIS site: `BTS`.

Site ID: `2`.

Application pool: `BTS`.

Bindings:

```text
http  :80  btsys.ru
http  :80  www.btsys.ru
https :443 btsys.ru
https :443 www.btsys.ru
```

HTTPS bindings и существующие сертификаты релизный механизм не пересоздаёт.

HSTS:

```text
enabled
max-age = 31536000
includeSubDomains = false
preload = false
```

Anonymous authentication:

```text
enabled = true
userName = IUSR
```

Поэтому production release-папки должны иметь `IUSR` Read & Execute.

---

## 11. Production release storage

Корень:

```text
C:\Sites\BTS
```

Release-папки:

```text
C:\Sites\BTS\releases\<release_id>\
```

Формат `release_id`:

```text
yyyyMMdd-HHmmss_<short_git_sha>
```

Каждая release-папка immutable после публикации. Новый релиз не перезаписывает предыдущий.

### 11.1. ACL

Для release tree должны сохраняться как минимум:

```text
SYSTEM                 FullControl
Administrators         FullControl
ELYZA\BTS-MGR-47       FullControl
IIS APPPOOL\BTS        ReadAndExecute
IUSR                    ReadAndExecute
```

`IUSR` принципиален: без него IIS anonymous authentication выдавал `401.3 / Win32 5`.

Этот отказ был реально обнаружен первым тестовым релизом, после чего worker автоматически откатил IIS. ACL был исправлен на `C:\Sites\BTS` как наследуемый для будущих релизов.

---

## 12. Аварийный baseline

До первого переключения был создан byte-for-byte baseline старого production:

```text
C:\Sites\BTS\releases\20260911-193310_legacy-prod
```

Исходный старый production path:

```text
C:\Sites\BTS_Site\bts-fuel-tanks\dist
```

Оба пути пока сохраняются.

State-файлы:

```text
C:\ProgramData\BTS\deploy\state\baseline-release-path.txt
C:\ProgramData\BTS\deploy\state\legacy-production-path.txt
```

Baseline был проверен SHA-256 manifest-сравнением:

```text
SourceFiles = 58
CopyFiles   = 58
Differences = 0
RESULT      = PASS
```

IIS backups:

```text
BEFORE_BTS_RELEASE_SYSTEM_20260911-193310
BTS_WORKING_2026-09-06
```

Baseline и исходный production не удалять без отдельного решения.

---

## 13. Текущее переключение production

Production release не копируется поверх активного сайта.

При публикации изменяется только physical path корневого IIS virtual directory сайта `BTS`.

Принцип:

```text
C:\Sites\BTS\releases\release_A
          ↓
IIS BTS physical path = release_A

следующий релиз:

C:\Sites\BTS\releases\release_B
          ↓
IIS BTS physical path = release_B
```

Bindings, HTTPS, сертификаты, HSTS и app pool при этом остаются прежними.

На момент контрольного аудита 2026-09-11 рабочим был:

```text
C:\Sites\BTS\releases\20260911-113218_e281904ad372
```

Git commit:

```text
e281904ad37286622d0fe4948316d9c90e861d32
```

После этого могут появляться более новые release_id. Актуальный live path всегда следует определять через IIS и `state\current-release.txt`, а не считать приведённый timestamp вечным.

---

## 14. Production deploy state

Корень:

```text
C:\ProgramData\BTS\deploy
```

Структура:

```text
C:\ProgramData\BTS\deploy\
    incoming\
    outbox\
    state\
        processed\
        current-release.txt
        current-commit.txt
        baseline-release-path.txt
        legacy-production-path.txt
    logs\
        worker.log
    worker.ps1
```

`incoming\` — зона загрузки ZIP и request/rollback JSON.

`outbox\` — результат обработки конкретного release_id.

`state\` — текущее состояние production и аварийные пути.

`state\processed\` — обработанные request-файлы.

`logs\worker.log` — журнал worker.

---

## 15. Production worker

Worker:

```text
C:\ProgramData\BTS\deploy\worker.ps1
```

Scheduled Task:

```text
Task name: bts deploy worker
Task path: \bts\
Account: SYSTEM
```

Запуск — примерно раз в минуту.

MultipleInstances: `IgnoreNew`.

Worker обладает правами на переключение IIS. SSH-пользователь этих прав не имеет.

### 15.1. Обработка release request

Worker:

1. находит `*.request.json`;
2. валидирует `release_id`;
3. валидирует полный 40-символьный Git commit;
4. валидирует SHA-256;
5. валидирует имя ZIP;
6. проверяет наличие архива;
7. пересчитывает SHA-256 архива;
8. распаковывает во временную release-папку;
9. проверяет обязательные файлы;
10. создаёт новую release-папку;
11. запоминает предыдущий IIS physical path;
12. переключает IIS на новый path;
13. выполняет внутренние health checks;
14. при успехе записывает state и результат;
15. при ошибке возвращает предыдущий IIS path.

После обработки request переносится в `processed`, а архив из `incoming` удаляется.

---

## 16. Внутренние production health checks

Worker проверяет production после переключения IIS.

Для обхода внешней сети используется:

```text
curl --resolve btsys.ru:443:127.0.0.1
```

URL берутся из `sitemap.xml`.

Для каждого production URL ожидается `HTTP 200`.

Также проверяется заведомо отсутствующий URL и ожидается `HTTP 404`.

Если внутренняя проверка не проходит, worker немедленно переключает IIS обратно на предыдущий path.

Реальный первый неудачный релиз был автоматически откатан после:

```text
HTTP 401.3
Win32 5
```

Причиной был отсутствующий `IUSR` Read & Execute на новом release tree. После исправления ACL следующий релиз прошёл успешно.

---

## 17. SSH-транспорт Germany → Selectel

### 17.1. Production OpenSSH

Windows OpenSSH Server установлен на Selectel.

Service: `sshd`.

Startup: `Automatic`.

Port: `22/TCP`.

Конфигурация:

```text
C:\ProgramData\ssh\sshd_config
```

Ключевые ограничения:

```text
PubkeyAuthentication yes
PasswordAuthentication no
AuthenticationMethods publickey
AllowUsers bts-deploy@142.132.205.110
AllowTcpForwarding no
PermitTTY no
```

### 17.2. Deployment account

Пользователь:

```text
bts-deploy
```

Он обычный локальный пользователь, не Administrator.

Authorized keys:

```text
C:\ProgramData\BTS\ssh\bts-deploy_authorized_keys
```

Ему разрешена запись в `C:\ProgramData\BTS\deploy\incoming` и чтение результата из `outbox`, но не выдаются административные права на IIS.

### 17.3. Firewall

Windows Firewall rule:

```text
BTS-SSH-From-Staging
```

Разрешено:

```text
TCP 22
source = 142.132.205.110
```

Широкое стандартное правило `OpenSSH-Server-In-TCP` было отключено, чтобы порт 22 не был открыт всему интернету.

---

## 18. Deployment key

На немецком staging-сервере приватный ключ:

```text
C:\ProgramData\BTS\ssh\bts_prod_ed25519
```

Public key зарегистрирован на Selectel.

Private key намеренно хранится вне Git-репозитория.

Его нельзя коммитить, копировать в `site_bak`, показывать в логах или передавать в чат.

---

## 19. Влияние AmneziaVPN на production SSH

На Selectel работает AmneziaVPN/AmneziaWG.

Немецкий сервер имеет публичный IP:

```text
142.132.205.110
```

При включённом AmneziaVPN на Selectel Windows выбирает для этого адреса маршрут через интерфейс `AmneziaVPN`.

В результате SYN от Германии до Selectel доходит, но ответный трафик уходит через VPN-туннель.

Это было подтверждено `pktmon`.

При отключении VPN:

```text
Test-NetConnection 135.106.194.75 -Port 22
TcpTestSucceeded = True
```

Операционное правило:

```text
перед live release:
AmneziaVPN на Selectel = OFF

после успешного release:
AmneziaVPN можно снова включить
```

Release-скрипт проверяет SSH и останавливается, если production недоступен.

Release-скрипт не должен самостоятельно управлять VPN.

---

## 20. Production release client

Канонический клиент:

```text
scripts\release-prod.ps1
```

Запускается на немецком staging-сервере из корня репозитория.

Dry run:

```powershell
powershell.exe -noprofile -executionpolicy bypass -file ".\scripts\release-prod.ps1" -dryrun
```

Live release:

```powershell
powershell.exe -noprofile -executionpolicy bypass -file ".\scripts\release-prod.ps1"
```

### 20.1. Dry run

Dry run:

- проверяет Git;
- делает fetch;
- проверяет `HEAD == origin/main`;
- запускает preflight;
- запускает Playwright через preflight;
- снова проверяет GitHub;
- упаковывает текущий `dist`;
- считает SHA-256;
- создаёт request JSON;
- ничего не отправляет на production.

### 20.2. Live release

Live release дополнительно:

1. проверяет SSH-доступность production;
2. загружает ZIP через SCP;
3. только после завершения ZIP загружает request JSON;
4. ожидает результат worker;
5. требует status `deployed`;
6. выполняет внешние production checks;
7. при внешней ошибке создаёт rollback request;
8. ждёт подтверждения rollback;
9. выдаёт PASS только при полном успехе.

ZIP передаётся первым, request JSON — последним. Это не позволяет worker начать обработку недокачанного архива.

---

## 21. Local release artifacts

Release-клиент создаёт локальные пакеты в:

```text
.release\<release_id>\
```

Внутри:

```text
<release_id>.zip
<release_id>.request.json
<release_id>.rollback.json
```

Rollback JSON появляется только если требуется rollback.

`.release/` находится в `.gitignore`.

---

## 22. Внешние production checks

После того как worker сообщил `deployed`, немецкий сервер независимо проверяет production по публичному интернету.

Проверяются URL из локального `dist/sitemap.xml`.

Ожидается:

```text
https://btsys.ru/           → 200
https://btsys.ru/products/  → 200
https://btsys.ru/faq/       → 200
https://btsys.ru/about/     → 200
https://btsys.ru/contacts/  → 200
```

Также заведомо отсутствующий URL должен вернуть `404`.

Production не должен отдавать staging `X-Robots-Tag`.

Внешняя проверка имеет несколько попыток, чтобы краткая задержка после переключения не вызвала ложный rollback.

---

## 23. External rollback

Если server-side проверки прошли, но внешние production checks не прошли, release-клиент загружает:

```text
<release_id>.rollback.json
```

Production worker:

1. проверяет, что release был в состоянии `deployed`;
2. проверяет текущий IIS path;
3. получает `previous_path`;
4. переключает IIS назад;
5. проверяет восстановленный предыдущий release;
6. записывает status `rolled_back_external`.

Если сам rollback не проходит health check, worker пытается вернуть только что опубликованный working release и пишет аварийный status.

---

## 24. State после успешного релиза

После успешного deployment обновляются:

```text
C:\ProgramData\BTS\deploy\state\current-release.txt
C:\ProgramData\BTS\deploy\state\current-commit.txt
```

На момент контрольного аудита:

```text
current release:
C:\Sites\BTS\releases\20260911-113218_e281904ad372

current commit:
e281904ad37286622d0fe4948316d9c90e861d32
```

Эти значения исторические для контрольного состояния документа. При последующих релизах они закономерно меняются.

---

## 25. Контрольный успешный релиз

Контрольный релиз, которым была подтверждена вся цепочка:

```text
release id:
20260911-113218_e281904ad372

commit:
e281904ad37286622d0fe4948316d9c90e861d32

files:
58

dist bytes:
15013690
```

Server-side result:

```text
deployed
deployment and health checks passed
```

External result:

```text
https://btsys.ru/          200
/products/                 200
/faq/                      200
/about/                    200
/contacts/                 200
404 probe                  404
```

Final:

```text
release result: pass
server checks: pass
external checks: pass
```

Перед этим был фактический failure case: релиз с неправильным ACL получил 401.3, и автоматический rollback успешно вернул старый production.

Таким образом проверен не только happy path, но и server-side rollback.

---

## 26. Обычный рабочий процесс пользователя

```text
1. Codex / Sites / пользователь меняет исходники.
2. Выполняется npm run build.
3. Проверяется dist.
4. Исходники + dist коммитятся и отправляются в GitHub main.
5. На немецком сервере пользователь делает Pull через GitHub Desktop.
6. stage.btsys.ru автоматически показывает полученный dist.
7. Пользователь визуально проверяет staging.
8. На Selectel выключается AmneziaVPN.
9. Запускается scripts\release-prod.ps1.
10. Пользователь ждёт финального PASS.
11. После PASS AmneziaVPN на Selectel можно снова включить.
```

Никаких ручных копирований в active IIS path при штатном релизе не требуется.

---

## 27. Что нельзя делать

Без отдельного осознанного изменения архитектуры нельзя:

- включать автодеплой по push;
- автоматически делать `git pull` перед production release;
- собирать сайт на production;
- ставить Git/Node/npm на production ради публикации;
- копировать новый `dist` поверх активной release-папки;
- использовать staging-only noindex в `dist`;
- менять production bindings при релизе;
- пересоздавать production сертификаты при релизе;
- пересоздавать IIS site/app pool при каждом релизе;
- делать `bts-deploy` локальным администратором;
- открывать SSH/22 всему интернету;
- коммитить deployment private key;
- удалять baseline;
- удалять старый production path без отдельного решения;
- затрагивать `POTOK_WebApp`;
- отключать rollback.

---

## 28. Проверка текущего production состояния

Актуальный physical path:

```powershell
& "$env:windir\system32\inetsrv\appcmd.exe" list vdir "BTS/" /text:physicalPath
```

Текущий commit:

```powershell
get-content "c:\programdata\bts\deploy\state\current-commit.txt"
```

Текущий release:

```powershell
get-content "c:\programdata\bts\deploy\state\current-release.txt"
```

Worker:

```powershell
get-scheduledtaskinfo -taskname "bts deploy worker" -taskpath "\bts\"
```

Production:

```powershell
curl.exe -sS -o nul -w "%{http_code}" https://btsys.ru/
```

---

## 29. Где находится источник истины

```text
исходный код сайта          → GitHub main
готовая публикация          → dist/ того же commit
что пользователь проверяет  → stage.btsys.ru
какой commit разрешён        → local HEAD == origin/main
production release logic    → scripts/release-prod.ps1
preflight logic             → scripts/preflight.ps1
production switch logic     → C:\ProgramData\BTS\deploy\worker.ps1
активный production path    → IIS BTS physical path
активный release metadata   → C:\ProgramData\BTS\deploy\state\
архитектура инфраструктуры  → INFRASTRUCTURE.md
правила для агентов         → AGENTS.md
```

Если источники противоречат друг другу, не угадывать. Сначала проверить фактическое состояние и затем обновить документацию.

---

## 30. Правило изменения инфраструктуры

При любом намеренном изменении deployment-инфраструктуры:

1. определить, что именно изменяется и зачем;
2. создать rollback/backup для критичных production-настроек;
3. не затрагивать работающий production без необходимости;
4. проверить изменение отдельно;
5. проверить happy path;
6. проверить rollback;
7. обновить `INFRASTRUCTURE.md`;
8. при изменении обязательных правил обновить `AGENTS.md`;
9. закоммитить документацию вместе с соответствующими versioned-изменениями.

Этот документ должен оставаться описанием фактической, а не планируемой инфраструктуры.

---

## 31. Целевая двухкомпонентная схема после миграции

### 31.1. Компоненты и production runtime

Frontend остаётся готовым статическим `dist/`, собираемым только командой `npm run build`. Backend — самостоятельный `backend/` со своими `package.json` и полным npm lockfile. Backend никогда не попадает в `dist/`.

На staging выполняется `npm ci --prefix backend --omit=dev`, после чего готовый backend runtime вместе с production `node_modules` упаковывается в ZIP. Production использует Node.js только как runtime backend-службы, не использует npm registry, не выполняет `npm install`/`npm ci` и ничего не собирает.

### 31.2. Backend storage, WinSW и IIS

```text
C:\Sites\BTS\backend-releases\<release_id>\
C:\Sites\BTS\backend-current
C:\ProgramData\BTS\contact-api\BTSContactApi.exe
C:\ProgramData\BTS\contact-api\BTSContactApi.xml
```

`backend-current` — стабильный NTFS junction на immutable release. WinSW binary хранится вне Git; automatic service `BTSContactApi` запускает `C:\Sites\BTS\backend-current\server.js`. Backend слушает только `127.0.0.1:3001`.

IIS URL Rewrite + ARR хранит постоянное site-level правило вне `dist`: `/api/*` → `http://127.0.0.1:3001/api/*`. ARR добавляет фактический client IP в `X-Forwarded-For`; Express доверяет эту цепочку только когда непосредственный peer — loopback IIS. Bindings, HTTPS и certificates не меняются.

### 31.3. Версии, selective deploy и state

Локальные версии — `git rev-parse HEAD:dist` и `git rev-parse HEAD:backend`. Production хранит marker `deployment-schema-version.txt` со значением `2`, а также `current-frontend-tree.txt`, `current-frontend-commit.txt`, `current-backend-tree.txt`, `current-backend-commit.txt`, `current-backend-release.txt`. Старые `current-release.txt` и `current-commit.txt` сохраняют значение frontend path/commit. Пока marker отсутствует или отличается от `2`, новый release-клиент немедленно останавливается до preflight, упаковки и любых production-изменений.

Компонент с совпавшим tree получает настоящий `SKIP`: без `npm ci`, упаковки, upload, новой release-папки, switch/restart и state update. Если оба совпали, release завершает `PASS: nothing changed`. Для точного плана `-DryRun` читает production state через SSH, поэтому также требует доступного SSH и выключенного AmneziaVPN на Selectel.

При первом запуске без `current-frontend-tree.txt` клиент использует старый `current-commit.txt` и локально вычисляет `<commit>:dist`. Если commit нельзя безопасно разрешить, frontend считается изменившимся.

### 31.4. Release protocol и rollback

Для изменившихся компонентов manifest содержит release id, commit, tree, archive и SHA-256. Все архивы загружаются первыми, request JSON — последним. Worker проверяет hashes, разворачивает backend первым, проверяет `GET http://127.0.0.1:3001/api/health` → `{"ok":true}`, затем переключает и проверяет frontend прежними sitemap/404 checks.

Ошибка backend-only откатывает backend; frontend-only — frontend. При совместном release любой внутренний или внешний failure восстанавливает оба изменённых компонента и проверяет восстановленное состояние. Перед внешним rollback worker проверяет, что active paths всё ещё принадлежат этому release.

### 31.5. Staging backend

Frontend staging остаётся `<repo>\dist` сайта `BTS-STAGE`. `scripts\configure-staging-iis.ps1` один раз добавляет только staging site-level `/api/*` proxy после IIS backup. `scripts\setup-staging-backend.ps1` запускает backend с отдельным `C:\ProgramData\BTS\staging-contact-api.env`; production secrets не используются, порт 3001 наружу не открывается, `POTOK_WebApp` не затрагивается.

### 31.6. Однократная migration и её rollback

Administrator вручную запускает `scripts\production\migrate-two-component.ps1` с готовым backend ZIP и внешним WinSW. До любых изменений script проверяет Administrator, Node.js, IIS, URL Rewrite, ARR, WinSW input, backend ZIP и все непустые `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `CONTACT_TO`; порт обязан быть числом 1–65535. Затем создаются IIS backup, backup worker/state и migration metadata, не меняющие active frontend.

Только после backup создаются backend storage/junction/service, постоянный API proxy и worker v2; затем выполняется backend health. `scripts\production\rollback-migration.ps1` восстанавливает IIS backup, worker, state, прежний junction и прежнее состояние службы. Frontend releases, baseline `20260911-193310_legacy-prod` и legacy production не удаляются.

SMTP values находятся только в machine environment production. Пароли не входят в Git, ZIP или frontend. После фактической миграции и проверки заголовок CURRENT STATE должен быть обновлён отдельным осознанным изменением документации.
