# BTS Contact API

Самостоятельный production-компонент формы сайта. Он не входит в `dist/` и слушает только `127.0.0.1:3001`.

## Локальная/staging подготовка

```powershell
npm ci --prefix backend --omit=dev
powershell.exe -File scripts\setup-staging-backend.ps1
```

Environment-файл staging хранится локально в `<repo>\backend\.env`, игнорируется Git и не входит в backend ZIP. Production использует только machine environment; обязательный секрет `SMTP_PASS` никогда не переносится из staging-файла.

## Production service

WinSW binary не хранится в Git и никогда не загружается обычным release через `incoming`. Administrator bootstrap помещает проверенный WinSW вместе с canonical worker, ensure и service XML в закрытый `C:\ProgramData\BTS\deploy\trusted`. Только trusted production worker под `SYSTEM` запускает trusted `ensure-production.ps1`. Сама `BTSContactApi` работает не от `SYSTEM`, а от встроенной низкопривилегированной учётной записи `NT AUTHORITY\LocalService`: ей выдаются read/execute на backend/runtime и write на каталог логов. До первого валидного backend служба остаётся Manual; после строгого local `/api/health` ensure переводит её в Automatic и только тогда включает публичное IIS proxy rule.
