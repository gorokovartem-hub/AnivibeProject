const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const fetch = require('node-fetch');

// ============================================================
// НАСТРОЙКИ
// ============================================================

const PHOTOS_FOLDER = './Saves/Photos';
const PHOTOSD_FOLDER = './Saves/Photosd';
const LOG_FILE = './log.json';
const QUALITY = 85;
const DELETE_ORIGINAL = true;
const MAX_TITLE_LENGTH = 50;

// ============================================================
// СОЗДАЁМ ПАПКИ
// ============================================================

function createFolders() {
    if (!fs.existsSync(PHOTOS_FOLDER)) {
        fs.mkdirSync(PHOTOS_FOLDER, { recursive: true });
        console.log(`📁 Создана папка: ${PHOTOS_FOLDER}`);
    }
    if (!fs.existsSync(PHOTOSD_FOLDER)) {
        fs.mkdirSync(PHOTOSD_FOLDER, { recursive: true });
        console.log(`📁 Создана папка: ${PHOTOSD_FOLDER}`);
    }
}

// ============================================================
// ЛОГИКА РАБОТЫ С НАЗВАНИЯМИ
// ============================================================

function getMangaTitle(manga) {
    if (!manga || !manga.attributes || !manga.attributes.title) {
        return null;
    }
    
    const titles = manga.attributes.title;
    
    // Приоритет: русский → английский → любой другой → null
    const ru = titles.ru;
    const en = titles.en;
    
    if (ru && ru.trim()) {
        return ru.trim();
    }
    
    if (en && en.trim()) {
        return en.trim();
    }
    
    for (const [lang, title] of Object.entries(titles)) {
        if (title && title.trim() && lang !== 'ru' && lang !== 'en') {
            return title.trim();
        }
    }
    
    return null;
}

function sanitizeFilename(title) {
    if (!title) return 'unknown';
    
    let cleaned = title
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    
    if (cleaned.length > MAX_TITLE_LENGTH) {
        cleaned = cleaned.substring(0, MAX_TITLE_LENGTH - 3) + '...';
    }
    
    return cleaned || 'unknown';
}

function filenameToTitle(filename) {
    return path.basename(filename, '.webp').replace(/_/g, ' ');
}

// ============================================================
// LOG.JSON
// ============================================================

function readLog() {
    try {
        if (fs.existsSync(LOG_FILE)) {
            return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('❌ Ошибка чтения log.json:', e.message);
    }
    return { images: [] };
}

function saveLog(log) {
    try {
        fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
    } catch (e) {
        console.error('❌ Ошибка записи log.json:', e.message);
    }
}

function addToLog(imagePath, title) {
    const log = readLog();
    if (!log.images) log.images = [];
    const exists = log.images.some(item => item.path === imagePath);
    if (!exists) {
        log.images.push({ 
            path: imagePath, 
            title: title || filenameToTitle(imagePath)
        });
        saveLog(log);
        console.log(`📄 Добавлен в log.json: ${title}`);
    }
}

// ============================================================
// ПОЛУЧИТЬ СПИСОК РЕАЛЬНО СУЩЕСТВУЮЩИХ ФАЙЛОВ
// ============================================================

function getExistingFiles() {
    const existing = new Set();
    try {
        if (fs.existsSync(PHOTOSD_FOLDER)) {
            const files = fs.readdirSync(PHOTOSD_FOLDER);
            for (const file of files) {
                if (file.endsWith('.webp')) {
                    existing.add(`Saves/Photosd/${file}`);
                }
            }
        }
    } catch (e) {
        console.error('❌ Ошибка чтения папки:', e.message);
    }
    return existing;
}

// ============================================================
// СКАЧИВАНИЕ С MANGADEX
// ============================================================

async function downloadFromMangadex(limit = 20) {
    console.log(`\n📡 Скачиваем ${limit} картинок с MangaDex...`);

    try {
        const url = `https://api.mangadex.org/manga?limit=${limit}&includes[]=cover_art&order[followedCount]=desc&availableTranslatedLanguage[]=ru&contentRating[]=safe&contentRating[]=suggestive`;
        
        console.log(`🔗 URL: ${url}`);

        const response = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        console.log(`📊 Статус: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            const text = await response.text();
            console.log(`⚠️ Ответ сервера: ${text.substring(0, 200)}...`);
            return;
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            console.log(`⚠️ Сервер вернул не JSON: ${text.substring(0, 200)}...`);
            return;
        }

        const data = await response.json();
        
        if (!data.data || data.data.length === 0) {
            console.log('⚠️ Нет данных от MangaDex');
            return;
        }

        const existingFiles = getExistingFiles();
        console.log(`📁 Найдено существующих файлов: ${existingFiles.size}`);

        let downloaded = 0;
        let errors = 0;
        let skipped = 0;

        for (const manga of data.data) {
            try {
                const cover = manga.relationships?.find(r => r.type === 'cover_art');
                if (!cover?.attributes?.fileName) {
                    errors++;
                    continue;
                }

                let title = getMangaTitle(manga);
                
                if (!title) {
                    title = `manga_${manga.id}`;
                    console.log(`⚠️ Название не найдено для ${manga.id}, используем ID`);
                }

                const cleanTitle = sanitizeFilename(title);
                const fileTitle = cleanTitle.replace(/\s+/g, '_');
                const filename = `${fileTitle}.webp`;
                const imagePath = `Saves/Photosd/${filename}`;

                if (existingFiles.has(imagePath)) {
                    skipped++;
                    continue;
                }

                const coverUrl = `https://uploads.mangadex.org/covers/${manga.id}/${cover.attributes.fileName}`;

                const imgRes = await fetch(coverUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });

                if (!imgRes.ok) {
                    errors++;
                    continue;
                }

                const buffer = await imgRes.arrayBuffer();
                const filepath = path.join(PHOTOSD_FOLDER, filename);

                await sharp(Buffer.from(buffer))
                    .webp({ quality: QUALITY })
                    .toFile(filepath);

                if (fs.existsSync(filepath)) {
                    addToLog(imagePath, cleanTitle);
                    downloaded++;
                    console.log(`✅ ${cleanTitle}`);
                } else {
                    errors++;
                    console.log(`⚠️ Файл не создан: ${cleanTitle}`);
                }

                // Небольшая задержка чтобы не перегружать API
                await new Promise(r => setTimeout(r, 100));

            } catch (e) {
                errors++;
                console.log(`⚠️ Ошибка: ${e.message}, пропускаем...`);
            }
        }

        console.log(`✅ Скачано: ${downloaded}, пропущено (уже есть): ${skipped}, ошибок: ${errors}`);

    } catch (error) {
        console.log(`⚠️ Общая ошибка: ${error.message}, продолжаем...`);
    }
}

// ============================================================
// ВОССТАНОВЛЕНИЕ LOG.JSON ИЗ РЕАЛЬНЫХ ФАЙЛОВ
// ============================================================

function rebuildLogFromFiles() {
    console.log('\n🔄 Восстанавливаю log.json из существующих файлов...');
    
    const log = { images: [] };
    
    try {
        if (fs.existsSync(PHOTOSD_FOLDER)) {
            const files = fs.readdirSync(PHOTOSD_FOLDER);
            for (const file of files) {
                if (file.endsWith('.webp')) {
                    const imagePath = `Saves/Photosd/${file}`;
                    const title = filenameToTitle(file);
                    log.images.push({ path: imagePath, title });
                }
            }
        }
        
        saveLog(log);
        console.log(`✅ log.json восстановлен: ${log.images.length} файлов`);
    } catch (e) {
        console.error('❌ Ошибка восстановления log.json:', e.message);
    }
}

// ============================================================
// КОНВЕРТАЦИЯ ЛОКАЛЬНЫХ ФАЙЛОВ
// ============================================================

async function convertLocalFiles() {
    console.log('\n📂 Проверяем локальные файлы...');

    if (!fs.existsSync(PHOTOS_FOLDER)) {
        console.log('⚠️ Папка не существует, создаю...');
        fs.mkdirSync(PHOTOS_FOLDER, { recursive: true });
        return;
    }

    const files = fs.readdirSync(PHOTOS_FOLDER);
    if (files.length === 0) {
        console.log('📂 Нет локальных файлов');
        return;
    }

    const existingFiles = getExistingFiles();
    let converted = 0;
    let errors = 0;
    let skipped = 0;

    for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (!['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.gif'].includes(ext)) continue;

        const inputPath = path.join(PHOTOS_FOLDER, file);
        const name = path.basename(file, ext);
        
        const cleanName = sanitizeFilename(name);
        const fileTitle = cleanName.replace(/\s+/g, '_');
        const outputFilename = fileTitle + '.webp';
        const outputPath = path.join(PHOTOSD_FOLDER, outputFilename);
        const imagePath = `Saves/Photosd/${outputFilename}`;

        if (existingFiles.has(imagePath) || fs.existsSync(outputPath)) {
            if (DELETE_ORIGINAL) {
                try {
                    fs.unlinkSync(inputPath);
                    console.log(`🗑️ Удалён оригинал (уже есть webp): ${file}`);
                } catch (e) {
                    console.log(`⚠️ Не удалось удалить ${file}: ${e.message}`);
                }
            }
            skipped++;
            continue;
        }

        try {
            await sharp(inputPath)
                .webp({ quality: QUALITY })
                .toFile(outputPath);
            
            if (fs.existsSync(outputPath)) {
                addToLog(imagePath, cleanName);
                
                if (DELETE_ORIGINAL) {
                    try {
                        fs.unlinkSync(inputPath);
                        console.log(`🗑️ Удалён оригинал: ${file}`);
                    } catch (e) {
                        console.log(`⚠️ Не удалось удалить ${file}: ${e.message}`);
                    }
                }
                
                converted++;
                console.log(`✅ ${cleanName}`);
            } else {
                errors++;
                console.log(`⚠️ Файл не создан: ${file}`);
            }
        } catch (e) {
            errors++;
            console.log(`⚠️ Ошибка ${file}: ${e.message}, пропускаем...`);
        }
    }

    console.log(`✅ Сконвертировано: ${converted}, пропущено (уже есть): ${skipped}, ошибок: ${errors}`);
}

// ============================================================
// ЗАПУСК
// ============================================================

async function start() {
    console.log(`
┌─────────────────────────────────────────────────────────────┐
│  🖼️  КОНВЕРТОР (НЕ ОСТАНАВЛИВАЕТСЯ)                       │
│  🌐 MangaDex + локальные файлы                             │
│  🔄 Ошибки пропускаются                                   │
└─────────────────────────────────────────────────────────────┘
    `);

    createFolders();
    rebuildLogFromFiles();
    await downloadFromMangadex(20);
    await convertLocalFiles();

    console.log('\n✅ ВСЁ ГОТОВО!');
    console.log(`📁 Картинки в: ${PHOTOSD_FOLDER}`);
    console.log(`📄 log.json: ${LOG_FILE}`);
    console.log(`📊 Всего файлов: ${getExistingFiles().size}`);
    console.log('🚀 Запусти сервер: node server.js');
}

start().catch(err => {
    console.error('❌ Критическая ошибка:', err.message);
});