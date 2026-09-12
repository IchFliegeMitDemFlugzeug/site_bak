# BTS Contact API

Самостоятельный production-компонент формы сайта. Он не входит в `dist/` и слушает только `127.0.0.1:3001`.

## Локальная/staging подготовка

```powershell
npm ci --prefix backend --omit=dev
powershell.exe -File scripts\setup-staging-backend.ps1
```

Environment-файл staging хранится вне Git по пути `C:\ProgramData\BTS\staging-contact-api.env`. Обязательный секрет — `SMTP_PASS`; остальные имена приведены в `.env.example`.

## Production service

WinSW binary не хранится в Git. Администратор кладёт проверенный `WinSW-x64.exe` вне репозитория и передаёт его путь в `scripts\production\migrate-two-component.ps1`. Миграция копирует binary и шаблон `config\BTS.ContactApi.xml` в `C:\ProgramData\BTS\contact-api`, регистрирует automatic service и проверяет `/api/health`.
