# Импортируем стандартный модуль регулярных выражений.
# Он понадобится для чтения уже существующих title и description из HTML.
import re

# Импортируем Path для безопасной работы с путями Windows.
from pathlib import Path

# Импортируем escape, чтобы значения из HTML корректно попадали в meta-теги.
from html import escape


# Определяем корень проекта как папку, где лежит сам этот скрипт.
ROOT = Path(__file__).resolve().parent

# Определяем папку опубликованной версии сайта.
DIST = ROOT / "dist"

# Основной канонический домен сайта.
BASE_URL = "https://btsys.ru"

# Изображение, которое сейчас будет использоваться в превью ссылок.
# Это существующее изображение бака, уже находящееся в опубликованной сборке.
OG_IMAGE = f"{BASE_URL}/assets/images/hero-tank.webp"

# Общее название сайта для Open Graph.
SITE_NAME = "БТС — Бортовые топливные системы"


# Описываем все индексируемые страницы сайта.
# Ключ — путь исходного HTML.
# Значение — канонический URL этой страницы.
PAGES = {
    "index.html": f"{BASE_URL}/",
    "products/index.html": f"{BASE_URL}/products/",
    "faq/index.html": f"{BASE_URL}/faq/",
    "about/index.html": f"{BASE_URL}/about/",
    "contacts/index.html": f"{BASE_URL}/contacts/",
}


# Метки позволяют безопасно запускать скрипт повторно.
# При повторном запуске старый SEO-блок будет заменён новым, а не продублирован.
SEO_START = "<!-- BTS SEO START -->"
SEO_END = "<!-- BTS SEO END -->"


# Создаём функцию обновления одного HTML-файла.
def update_html(file_path: Path, canonical_url: str) -> None:

    # Читаем существующий HTML как UTF-8.
    html = file_path.read_text(encoding="utf-8")

    # Ищем уже существующий title страницы.
    title_match = re.search(
        r"<title>(.*?)</title>",
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Ищем уже существующий meta description страницы.
    description_match = re.search(
        r'<meta\s+name=["\']description["\']\s+content=["\'](.*?)["\']\s*/?>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )

    # Если title почему-либо отсутствует, прекращаем обработку этого файла,
    # поскольку не хотим автоматически придумывать название страницы.
    if not title_match:
        raise RuntimeError(f"Не найден <title> в файле: {file_path}")

    # Если description отсутствует, также прекращаем обработку.
    # Все текущие страницы сайта уже имеют собственные description.
    if not description_match:
        raise RuntimeError(
            f"Не найден meta description в файле: {file_path}"
        )

    # Получаем чистый текст title.
    title = title_match.group(1).strip()

    # Получаем чистый текст description.
    description = description_match.group(1).strip()

    # Экранируем значения перед вставкой в HTML-атрибуты.
    safe_title = escape(title, quote=True)

    # Аналогично экранируем description.
    safe_description = escape(description, quote=True)

    # Формируем единый SEO-блок страницы.
    seo_block = f"""
  {SEO_START}
  <link rel="canonical" href="{canonical_url}">

  <meta property="og:type" content="website">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:site_name" content="{escape(SITE_NAME, quote=True)}">
  <meta property="og:title" content="{safe_title}">
  <meta property="og:description" content="{safe_description}">
  <meta property="og:url" content="{canonical_url}">
  <meta property="og:image" content="{OG_IMAGE}">
  <meta property="og:image:type" content="image/webp">
  <meta property="og:image:width" content="1800">
  <meta property="og:image:height" content="1351">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{safe_title}">
  <meta name="twitter:description" content="{safe_description}">
  <meta name="twitter:image" content="{OG_IMAGE}">
  {SEO_END}
"""

    # Создаём регулярное выражение для ранее созданного SEO-блока.
    existing_block_pattern = re.compile(
        re.escape(SEO_START)
        + r".*?"
        + re.escape(SEO_END),
        flags=re.DOTALL,
    )

    # Если SEO-блок уже существует, заменяем его новой версией.
    if existing_block_pattern.search(html):

        # Выполняем замену существующего блока.
        html = existing_block_pattern.sub(
            seo_block.strip(),
            html,
            count=1,
        )

    # Если SEO-блока ещё нет, вставляем его непосредственно перед </head>.
    else:

        # Проверяем, что закрывающий тег head действительно присутствует.
        if "</head>" not in html:

            # Если структура HTML неожиданно нарушена, не портим файл автоматически.
            raise RuntimeError(f"Не найден </head> в файле: {file_path}")

        # Вставляем SEO-блок непосредственно перед закрытием head.
        html = html.replace(
            "</head>",
            f"{seo_block}</head>",
            1,
        )

    # Записываем обновлённый HTML обратно в файл.
    file_path.write_text(html, encoding="utf-8")


# Обрабатываем каждую страницу из нашего списка.
for relative_path, canonical_url in PAGES.items():

    # Получаем путь исходной страницы.
    source_file = ROOT / relative_path

    # Получаем путь соответствующей опубликованной страницы в dist.
    dist_file = DIST / relative_path

    # Проверяем существование исходной страницы.
    if not source_file.exists():
        raise FileNotFoundError(f"Нет исходного файла: {source_file}")

    # Проверяем существование опубликованной страницы.
    if not dist_file.exists():
        raise FileNotFoundError(f"Нет файла в dist: {dist_file}")

    # Обновляем исходный HTML.
    update_html(source_file, canonical_url)

    # Обновляем текущий опубликованный HTML.
    update_html(dist_file, canonical_url)


# Формируем robots.txt.
robots_text = f"""User-agent: *
Allow: /

Sitemap: {BASE_URL}/sitemap.xml
"""

# Сохраняем robots.txt в корень исходного проекта.
(ROOT / "robots.txt").write_text(
    robots_text,
    encoding="utf-8",
)

# Одновременно сохраняем robots.txt непосредственно в опубликованный dist.
(DIST / "robots.txt").write_text(
    robots_text,
    encoding="utf-8",
)


# Формируем список URL для sitemap.xml.
sitemap_urls = "\n".join(
    f"""  <url>
    <loc>{canonical_url}</loc>
  </url>"""
    for canonical_url in PAGES.values()
)

# Собираем стандартный XML Sitemap.
sitemap_text = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{sitemap_urls}
</urlset>
"""

# Записываем sitemap.xml в исходный проект.
(ROOT / "sitemap.xml").write_text(
    sitemap_text,
    encoding="utf-8",
)

# Записываем тот же sitemap.xml в текущий dist.
(DIST / "sitemap.xml").write_text(
    sitemap_text,
    encoding="utf-8",
)


# Получаем путь к существующему build.mjs.
build_file = ROOT / "build.mjs"

# Читаем текущий сценарий сборки.
build_text = build_file.read_text(encoding="utf-8")

# Создаём метку нашего дополнения к сборке.
build_marker = "// BTS SEO FILES"

# Проверяем, не добавляли ли мы этот код раньше.
if build_marker not in build_text:

    # Формируем дополнительный фрагмент build.mjs.
    build_addition = """

// BTS SEO FILES
// Копируем robots.txt в корень готовой публикации.
await cp("robots.txt", "dist/robots.txt");

// Копируем sitemap.xml в корень готовой публикации.
await cp("sitemap.xml", "dist/sitemap.xml");
"""

    # Добавляем этот фрагмент в конец существующего build.mjs.
    build_text += build_addition

    # Сохраняем обновлённый сценарий сборки.
    build_file.write_text(build_text, encoding="utf-8")


# Сообщаем об успешном завершении работы.
print("SEO-настройка завершена.")

# Показываем адрес robots.txt.
print(f"robots.txt: {BASE_URL}/robots.txt")

# Показываем адрес sitemap.xml.
print(f"sitemap.xml: {BASE_URL}/sitemap.xml")