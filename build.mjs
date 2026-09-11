// Подключаем обещания файловой системы из стандартной библиотеки Node.js.
import { cp, mkdir, rm } from "node:fs/promises";

// Удаляем результат предыдущей сборки, если он существует.
await rm("dist", { recursive: true, force: true });

// Создаём чистую папку для готовой статической версии сайта.
await mkdir("dist", { recursive: true });

// Копируем основной HTML-файл в корень готового сайта.
await cp("index.html", "dist/index.html");

// Каждую содержательную страницу копируем в одноимённый маршрут статического сайта.
for (const route of ["products", "faq", "about", "contacts"]) {
  await mkdir(`dist/${route}`, { recursive: true });
  await cp(`${route}/index.html`, `dist/${route}/index.html`);
}

// Копируем стили и сценарии с сохранением структуры папки assets.
await cp("assets", "dist/assets", { recursive: true });

// Копируем обычные значки сайта в корень публикации.
for (const faviconFile of [
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon-48x48.png",
  "apple-touch-icon.png",
]) {
  await cp(faviconFile, `dist/${faviconFile}`);
}

// Оптимизированные изображения уже входят в папку assets и отдельно не копируются.


// BTS SEO FILES
// Копируем robots.txt в корень готовой публикации.
await cp("robots.txt", "dist/robots.txt");

// Копируем sitemap.xml в корень готовой публикации.
await cp("sitemap.xml", "dist/sitemap.xml");
