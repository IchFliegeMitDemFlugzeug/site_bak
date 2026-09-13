# BTS Contact API

Самостоятельный production-компонент формы сайта. Он не входит в `dist/` и слушает только `127.0.0.1:3001`.

## Локальная/staging подготовка

```powershell
npm ci --prefix backend --omit=dev
powershell.exe -File scripts\setup-staging-backend.ps1
```

Environment-файл staging хранится локально в `<repo>\backend\.env`, игнорируется Git и не входит в backend ZIP. Production использует только machine environment; обязательный секрет `SMTP_PASS` никогда не переносится из staging-файла.

## Production service

WinSW binary не хранится в Git. Постоянный `scripts\release-prod.ps1` получает фиксированный WinSW 2.12.0 из официального GitHub release, проверяет Authenticode и передаёт assets через reconcile request. Только production worker под `SYSTEM` запускает `scripts\production\ensure-production.ps1`. Сама `BTSContactApi` работает не от `SYSTEM`, а от встроенной низкопривилегированной учётной записи `NT AUTHORITY\LocalService`: ей выдаются read/execute на backend/runtime и write на каталог логов. До первого валидного backend служба остаётся Manual; после строгого local `/api/health` ensure переводит её в Automatic и только тогда включает публичное IIS proxy rule.
