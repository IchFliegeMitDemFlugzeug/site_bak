# BTS Contact API

Самостоятельный production-компонент формы сайта. Он не входит в `dist/` и слушает только `127.0.0.1:3001`.

## Локальная/staging подготовка

```powershell
npm ci --prefix backend --omit=dev
powershell.exe -File scripts\setup-staging-backend.ps1
```

Environment-файл staging хранится вне Git по пути `C:\ProgramData\BTS\staging-contact-api.env`. Обязательный секрет — `SMTP_PASS`; остальные имена приведены в `.env.example`.

## Production service

WinSW binary не хранится в Git. Постоянный `scripts\release-prod.ps1` получает фиксированный WinSW 2.12.0 из официального GitHub release, проверяет Authenticode, сохраняет staging cache и передаёт его вместе с `config\BTS.ContactApi.xml` скрипту `scripts\production\ensure-production.ps1`. До первого валидного backend служба остаётся Manual; после строгого local `/api/health` ensure переводит её в Automatic и только тогда включает публичное IIS proxy rule.
