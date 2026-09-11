// Подключаем операции с файлами из стандартной библиотеки Node.js.
import { cp, mkdir, rm } from "node:fs/promises";

// В dist есть служебный BIMI-ресурс, которого пока нет среди обычных исходников assets.
// Перед полной пересборкой временно сохраняем его, чтобы не потерять при удалении dist.
const preservedBimi = ".build-preserved-bimi";
let hasPreservedBimi = false;

try {
  await cp("dist/assets/bimi", preservedBimi, { recursive: true });
  hasPreservedBimi = true;
} catch {
  // На самой первой сборке BIMI-папки может не быть. Это не должно останавливать сборку сайта.
}

// Удаляем предыдущую публикационную папку целиком, чтобы в production не оставались устаревшие файлы.
await rm("dist", { recursive: true, force: true });

// Создаём чистую папку готового сайта.
await mkdir("dist", { recursive: true });

// Копируем главную страницу.
await cp("index.html", "dist/index.html");

// Копируем все отдельные маршруты сайта.
for (const route of ["products", "faq", "about", "contacts"]) {
  await mkdir(`dist/${route}`, { recursive: true });
  await cp(`${route}/index.html`, `dist/${route}/index.html`);
}

// Копируем стили, сценарии, шрифты, изображения и медиаматериалы.
await cp("assets", "dist/assets", { recursive: true });

// Возвращаем BIMI-ресурс, который хранится как часть готовой публикации.
if (hasPreservedBimi) {
  await mkdir("dist/assets", { recursive: true });
  await cp(preservedBimi, "dist/assets/bimi", { recursive: true });
  await rm(preservedBimi, { recursive: true, force: true });
}

// Копируем значки сайта.
for (const faviconFile of [
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon-48x48.png",
  "apple-touch-icon.png",
]) {
  await cp(faviconFile, `dist/${faviconFile}`);
}

// Копируем страницу 404, чтобы IIS мог отдавать фирменную страницу ошибки.
await cp("404.html", "dist/404.html");

// Копируем SEO-файлы production-сайта.
await cp("robots.txt", "dist/robots.txt");
await cp("sitemap.xml", "dist/sitemap.xml");

// Копируем файлы подтверждения прав на сайт для поисковых сервисов.
await cp("mailru-verificationfc8f8bca4c54a0bd.html", "dist/mailru-verificationfc8f8bca4c54a0bd.html");
await cp("yandex_2b6b54d15f078bc5.html", "dist/yandex_2b6b54d15f078bc5.html");

// Копируем production-safe конфигурацию IIS.
// В ней намеренно НЕТ X-Robots-Tag: noindex — запрет индексации staging задаётся только в IIS staging-сайта.
await cp("web.config", "dist/web.config");
