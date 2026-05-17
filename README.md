# Local Media Viewer

Local Media Viewer - легковесное локальное веб-приложение для просмотра медиатеки с фото и видео. Оно читает файлы из указанной директории, показывает дерево папок, сетку превью и полноэкранный просмотрщик, не копируя оригинальные медиафайлы в отдельное хранилище.

Приложение рассчитано на простой запуск дома, на локальном сервере или в небольшой локальной сети. Основной сценарий - Docker Compose, но локальный запуск через npm тоже поддерживается.

## Запуск

### Docker Compose

Скопируйте Docker-шаблон окружения:

```bash
cp docker.example.env .env
```

Откройте `.env` и задайте основные значения:

```bash
MEDIA_HOST_DIR=/path/to/media
PIN_CODE=1234
PORT=3000
UPLOAD_TMP_HOST_DIR=/tmp/local-media-viewer-uploads
CACHE_HOST_DIR=media-viewer-cache
```

Что важно отредактировать:

- `MEDIA_HOST_DIR` - директория с фото и видео на host-машине.
- `PIN_CODE` - пинкод для входа, только цифры, длина от 4 до 16 символов.
- `PORT` - порт, на котором приложение будет доступно на host.
- `UPLOAD_TMP_HOST_DIR` - host-директория для временных файлов загрузки. По умолчанию удобно держать в `/tmp`.
- `CACHE_HOST_DIR` - место для кеша превью и индекса. Значение `media-viewer-cache` означает Docker named volume; для обычной host-директории укажите путь, например `/mnt/storage/media-viewer-cache`.

Запустите:

```bash
docker compose up -d --build
```

Откройте:

```text
http://localhost:3000
```

Внутри контейнера приложение всегда использует фиксированные пути:

```text
/media        оригинальные медиа
/cache        превью и metadata.json
/uploads-tmp  временные файлы загрузки
```

Оригинальные медиа не копируются в кеш. `/cache` и `/uploads-tmp` вынесены в volume или bind mount, поэтому приложение не должно писать runtime-данные во внутренний слой контейнера.

### npm

Скопируйте npm-шаблон окружения:

```bash
cp npm.example.env .env
```

Откройте `.env` и задайте основные значения:

```bash
MEDIA_ROOT=/path/to/media
PIN_CODE=1234
PORT=3000
UPLOAD_TMP_DIR=/tmp/local-media-viewer-uploads
CACHE_DIR=/tmp/local-media-viewer-cache
```

Что важно отредактировать:

- `MEDIA_ROOT` - локальная директория с фото и видео.
- `PIN_CODE` - пинкод для входа, только цифры, длина от 4 до 16 символов.
- `PORT` - порт backend-сервера.
- `UPLOAD_TMP_DIR` - директория для временных файлов загрузки.
- `CACHE_DIR` - директория для превью и локального индекса метаданных.

Установите зависимости:

```bash
npm install
```

Для генерации кадров-превью видео при локальном запуске нужен `ffmpeg` в системе:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg
```

В Docker-образе `ffmpeg` устанавливается автоматически.

Для разработки:

```bash
npm run dev
```

В dev-режиме backend запускается на `http://localhost:3000`, Vite-клиент - на `http://localhost:5173`.

Для production-запуска без Docker:

```bash
npm run build
npm start
```

После запуска откройте `http://localhost:3000`, если в `.env` не указан другой `PORT`.

## Что Умеет

- вход по PIN-коду;
- дерево папок внутри медиатеки;
- сетка фото и видео с маленькими, средними и большими превью;
- ленивое создание и переиспользование превью;
- полноэкранный просмотр фото и видео;
- zoom, reset и pan для фото;
- видео с нативными controls и HTTP Range-запросами для перемотки;
- загрузка файлов и папок;
- drag & drop загрузки;
- создание папок;
- перемещение файлов и папок;
- удаление файлов и папок после подтверждения;
- защита от path traversal и выдачи файлов вне медиатеки.

Поддерживаемые фото: `jpg`, `jpeg`, `png`, `gif`, `webp`, `avif`.

Поддерживаемые видео: `mp4`, `webm`, `mov`, `m4v`.

Остальные файлы игнорируются.

## Как Работает

Сервер читает директорию медиатеки, фильтрует поддерживаемые файлы и отдает интерфейсу список элементов. Оригинальные файлы остаются на месте: приложение не дублирует всю медиатеку и не переносит ее в отдельное хранилище.

Превью создаются лениво: только когда карточка файла появляется в интерфейсе и браузер запрашивает `/preview/...`. Готовые превью сохраняются на диске в cache-директории и переиспользуются при повторном открытии. Если оригинальный файл изменился, кеш считается устаревшим по пути, размеру, времени изменения, типу, размеру превью, формату и `CACHE_VERSION`.

Кеш хранит:

- файлы превью;
- легковесный индекс метаданных;
- время последнего обращения к элементам кеша.

Размер кеша ограничивается через `CACHE_MAX_BYTES`. При превышении лимита старые превью удаляются по LRU-политике. Очистка выполняется в фоне и не должна блокировать просмотр медиатеки.

Генерация превью идет через очередь с ограничением параллелизма `THUMB_CONCURRENCY`. Повторные запросы одного и того же превью объединяются в одну задачу. Для видео сервер сохраняет один JPEG-кадр, извлеченный через `ffmpeg` на отметке `VIDEO_THUMB_SECONDS`; если `ffmpeg` недоступен или файл не декодируется, используется легковесный placeholder.

Подробная схема кеша описана в [docs/cache-architecture.md](docs/cache-architecture.md).

## Основные Настройки

Общие:

```bash
SESSION_TTL_MINUTES=720
LOGIN_WINDOW_MINUTES=10
LOGIN_MAX_ATTEMPTS=8
MAX_UPLOAD_FILES=200
MAX_UPLOAD_FILE_MB=250
ALLOWED_ORIGINS=https://media.example.local,http://localhost:5173
```

Кеш и превью:

```bash
CACHE_VERSION=1
CACHE_MAX_BYTES=1073741824
CACHE_CLEANUP_INTERVAL_MINUTES=30
METADATA_CACHE_ENABLED=true
THUMB_SIZES=240,480,720
THUMB_DEFAULT_SIZE=480
THUMB_FORMAT=webp
THUMB_QUALITY=68
THUMB_EFFORT=4
THUMB_CONCURRENCY=2
VIDEO_THUMBNAILS=true
VIDEO_THUMB_SECONDS=1
FFMPEG_PATH=ffmpeg
VIDEO_THUMB_QUALITY=72
```

`ALLOWED_ORIGINS` нужен, если приложение открывается через нестандартный домен, reverse proxy или отдельный dev-origin. Без него сервер принимает same-origin запросы и localhost в dev-режиме.

## API

- `POST /api/login` с JSON `{ "pin": "1234" }`
- `POST /api/logout`
- `GET /api/tree`
- `GET /api/media?path=/relative/path`
- `POST /api/upload?path=/relative/path`
- `POST /api/folder` с JSON `{ "parentPath": "/target", "name": "New folder" }`
- `POST /api/move-file` с JSON `{ "from": "/old/file.jpg", "toDir": "/target" }`
- `POST /api/move-folder` с JSON `{ "from": "/old/folder", "toDir": "/target" }`
- `DELETE /api/media` с JSON `{ "path": "/file.jpg" }`
- `DELETE /api/folder` с JSON `{ "path": "/folder" }`
- `GET /media/...`
- `GET /preview/...`

Все API-запросы, кроме login/logout, и все файлы `/media/...` и `/preview/...` требуют авторизации.
