const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const sharp = require('sharp');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// ПАПКИ
// ============================================================

const PHOTOSD_FOLDER = './Saves/Photosd';

if (!fs.existsSync(PHOTOSD_FOLDER)) {
    fs.mkdirSync(PHOTOSD_FOLDER, { recursive: true });
    console.log(`📁 Создана папка: ${PHOTOSD_FOLDER}`);
}

// ============================================================
// ПОЛУЧИТЬ ВСЕ КАРТИНКИ ИЗ ПАПКИ
// ============================================================

function getImagesFromFolder() {
    const images = [];
    try {
        if (fs.existsSync(PHOTOSD_FOLDER)) {
            const files = fs.readdirSync(PHOTOSD_FOLDER);
            console.log(`📂 Найдено файлов в папке: ${files.length}`);
            
            for (const file of files) {
                if (file.endsWith('.webp')) {
                    // Красиво форматируем название
                    let title = path.basename(file, '.webp')
                        .replace(/_/g, ' ')
                        .replace(/-/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    // Делаем первую букву заглавной
                    if (title.length > 0) {
                        title = title.charAt(0).toUpperCase() + title.slice(1);
                    }
                    
                    images.push({
                        path: `/Saves/Photosd/${file}`,
                        title: title,
                        filename: file
                    });
                }
            }
        }
    } catch (e) {
        console.error('❌ Ошибка чтения папки:', e.message);
    }
    return images;
}

// ============================================================
// API: ПОЛУЧИТЬ ВСЕ КАРТИНКИ
// ============================================================

app.get('/api/images', (req, res) => {
    try {
        const images = getImagesFromFolder();
        console.log(`📸 Отправлено ${images.length} картинок из папки`);
        res.json({ success: true, data: images });
    } catch (e) {
        console.error('❌ Ошибка в /api/images:', e.message);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============================================================
// РАЗДАЁМ SAVES (ВАЖНО: ДОЛЖНО БЫТЬ ДО API)
// ============================================================

app.use('/Saves', express.static(path.join(__dirname, 'Saves')));

// ============================================================
// API: ПОЛУЧИТЬ СПИСОК МАНГИ С MANGADEX
// ============================================================

app.get('/api/manga-list', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        console.log(`📡 Запрос списка манги: страница ${page}, лимит ${limit}`);

        // Сортируем по популярности и добавляем русский язык
        const url = `https://api.mangadex.org/manga?limit=${limit}&offset=${offset}&includes[]=cover_art&order[followedCount]=desc&availableTranslatedLanguage[]=ru&contentRating[]=safe&contentRating[]=suggestive`;

        const response = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            console.log(`⚠️ HTTP ${response.status} от MangaDex`);
            return res.status(response.status).json({ 
                success: false, 
                error: `Ошибка MangaDex: ${response.status}` 
            });
        }

        const data = await response.json();
        
        if (!data.data || data.data.length === 0) {
            return res.json({ 
                success: true, 
                data: [], 
                hasMore: false,
                total: 0
            });
        }

        const formattedData = data.data.map(manga => {
            const cover = manga.relationships?.find(r => r.type === 'cover_art');
            
            // Получаем название на русском или английском
            let title = manga.attributes?.title?.ru || 
                       manga.attributes?.title?.en || 
                       'Без названия';
            
            // Форматируем название
            if (title !== 'Без названия') {
                // Если есть русское название, используем его
                if (manga.attributes?.title?.ru) {
                    title = manga.attributes.title.ru;
                } else {
                    // Иначе красиво форматируем английское
                    title = title.split(' ').map(word => 
                        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                    ).join(' ');
                }
            }
            
            const coverUrl = cover?.attributes?.fileName ? 
                `https://uploads.mangadex.org/covers/${manga.id}/${cover.attributes.fileName}` : 
                null;

            // Получаем жанры
            const genres = manga.attributes?.tags
                ?.filter(tag => tag.attributes?.name?.en)
                .map(tag => tag.attributes.name.en)
                .slice(0, 3) // Берём только первые 3 жанра
                .join(', ') || '';

            return {
                id: manga.id,
                title: title,
                cover: coverUrl,
                description: manga.attributes?.description?.ru || 
                             manga.attributes?.description?.en || 
                             '',
                year: manga.attributes?.year || null,
                status: manga.attributes?.status || 'unknown',
                rating: manga.attributes?.rating?.bayesian || 0,
                genres: genres,
                followers: manga.attributes?.followedCount || 0
            };
        });

        const total = data.total || 0;
        const hasMore = offset + limit < total;

        console.log(`✅ Отправлено ${formattedData.length} манги, всего ${total}, hasMore: ${hasMore}`);

        res.json({
            success: true,
            data: formattedData,
            hasMore: hasMore,
            total: total,
            page: page,
            limit: limit
        });

    } catch (error) {
        console.error('❌ Ошибка получения списка манги:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// API: ПОИСК МАНГИ
// ============================================================

app.get('/api/search', async (req, res) => {
    try {
        const query = req.query.q;
        if (!query || query.trim().length < 2) {
            return res.json({ success: true, data: [], hasMore: false, total: 0 });
        }

        console.log(`🔍 Поиск: "${query}"`);

        const url = `https://api.mangadex.org/manga?limit=20&includes[]=cover_art&title=${encodeURIComponent(query)}&availableTranslatedLanguage[]=ru`;

        const response = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ 
                success: false, 
                error: `Ошибка MangaDex: ${response.status}` 
            });
        }

        const data = await response.json();
        
        const formattedData = data.data?.map(manga => {
            const cover = manga.relationships?.find(r => r.type === 'cover_art');
            
            let title = manga.attributes?.title?.ru || 
                       manga.attributes?.title?.en || 
                       'Без названия';
            
            if (title !== 'Без названия' && !manga.attributes?.title?.ru) {
                title = title.split(' ').map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                ).join(' ');
            }
            
            const coverUrl = cover?.attributes?.fileName ? 
                `https://uploads.mangadex.org/covers/${manga.id}/${cover.attributes.fileName}` : 
                null;

            const genres = manga.attributes?.tags
                ?.filter(tag => tag.attributes?.name?.en)
                .map(tag => tag.attributes.name.en)
                .slice(0, 3)
                .join(', ') || '';

            return {
                id: manga.id,
                title: title,
                cover: coverUrl,
                description: manga.attributes?.description?.ru || 
                             manga.attributes?.description?.en || 
                             '',
                year: manga.attributes?.year || null,
                status: manga.attributes?.status || 'unknown',
                rating: manga.attributes?.rating?.bayesian || 0,
                genres: genres,
                followers: manga.attributes?.followedCount || 0
            };
        }) || [];

        res.json({
            success: true,
            data: formattedData,
            hasMore: false,
            total: formattedData.length
        });

    } catch (error) {
        console.error('❌ Ошибка поиска:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// API: ПОЛУЧИТЬ ГЛАВЫ
// ============================================================

app.get('/api/chapters', async (req, res) => {
    try {
        const mangaId = req.query.id;
        if (!mangaId) {
            return res.status(400).json({ success: false, error: 'ID не указан' });
        }

        console.log(`📖 Запрос глав для: ${mangaId}`);

        const url = `https://api.mangadex.org/chapter?manga=${mangaId}&limit=100&order[chapter]=asc&translatedLanguage[]=ru`;

        const response = await fetch(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            return res.status(response.status).json({ 
                success: false, 
                error: `Ошибка MangaDex: ${response.status}` 
            });
        }

        const data = await response.json();
        
        const chapters = data.data?.map(ch => ({
            id: ch.id,
            title: ch.attributes?.title || `Глава ${ch.attributes?.chapter || '?'}`,
            chapter: ch.attributes?.chapter || '?',
            pages: ch.attributes?.pages || 0,
            volume: ch.attributes?.volume || '?'
        })) || [];

        console.log(`✅ Найдено ${chapters.length} глав`);

        res.json({
            success: true,
            data: chapters
        });

    } catch (error) {
        console.error('❌ Ошибка получения глав:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// API: ПОЛУЧИТЬ СТРАНИЦЫ ГЛАВЫ
// ============================================================

app.get('/api/pages', async (req, res) => {
    try {
        const chapterId = req.query.id;
        if (!chapterId) {
            return res.status(400).json({ success: false, error: 'ID главы не указан' });
        }

        console.log(`📄 Запрос страниц для главы: ${chapterId}`);

        const chapterRes = await fetch(`https://api.mangadex.org/chapter/${chapterId}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!chapterRes.ok) {
            return res.status(chapterRes.status).json({ 
                success: false, 
                error: `Ошибка MangaDex: ${chapterRes.status}` 
            });
        }

        const chapterData = await chapterRes.json();
        const chapter = chapterData.data;
        
        if (!chapter) {
            return res.json({ success: true, data: [] });
        }

        const atHomeRes = await fetch(`https://api.mangadex.org/at-home/server/${chapterId}`, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!atHomeRes.ok) {
            return res.status(atHomeRes.status).json({ 
                success: false, 
                error: `Ошибка получения сервера: ${atHomeRes.status}` 
            });
        }

        const atHomeData = await atHomeRes.json();
        const baseUrl = atHomeData.baseUrl;
        const hash = atHomeData.chapter.hash;
        const data = atHomeData.chapter.data || [];

        const pages = data.map(filename => `${baseUrl}/data/${hash}/${filename}`);

        console.log(`✅ Найдено ${pages.length} страниц`);

        res.json({
            success: true,
            data: pages
        });

    } catch (error) {
        console.error('❌ Ошибка получения страниц:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// ПРОКСИ-КОНВЕРТОР
// ============================================================

app.get('/api/fetch', async (req, res) => {
    try {
        const mangaId = req.query.id;
        const title = req.query.title || 'unknown';

        if (!mangaId) {
            return res.status(400).json({ success: false, error: 'ID не указан' });
        }

        console.log(`📡 Запрос на скачивание: ${title} (${mangaId})`);

        let info = null;
        try {
            const infoRes = await fetch(`https://api.mangadex.org/manga/${mangaId}?includes[]=cover_art`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (!infoRes.ok) {
                console.log(`⚠️ HTTP ${infoRes.status} для ${mangaId}`);
                return res.status(404).json({ success: false, error: 'Манга не найдена' });
            }
            info = await infoRes.json();
        } catch (e) {
            console.log(`⚠️ Ошибка запроса для ${mangaId}: ${e.message}`);
            return res.status(500).json({ success: false, error: e.message });
        }

        const cover = info.data.relationships?.find(r => r.type === 'cover_art');
        if (!cover?.attributes?.fileName) {
            console.log(`⚠️ Нет обложки у ${mangaId}`);
            return res.status(404).json({ success: false, error: 'Обложка не найдена' });
        }

        const coverUrl = `https://uploads.mangadex.org/covers/${mangaId}/${cover.attributes.fileName}`;

        let imgBuffer = null;
        try {
            const imgRes = await fetch(coverUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (!imgRes.ok) {
                console.log(`⚠️ HTTP ${imgRes.status} при скачивании ${mangaId}`);
                return res.status(404).json({ success: false, error: 'Не удалось скачать обложку' });
            }
            const buffer = await imgRes.arrayBuffer();
            imgBuffer = Buffer.from(buffer);
        } catch (e) {
            console.log(`⚠️ Ошибка скачивания ${mangaId}: ${e.message}`);
            return res.status(500).json({ success: false, error: e.message });
        }

        // Форматируем название для файла
        const safeTitle = (title || 'unknown')
            .replace(/[^a-zA-Zа-яА-Я0-9]/g, '_')
            .replace(/_+/g, '_')
            .substring(0, 50);
            
        const filename = `${safeTitle}.webp`;
        const filepath = path.join(PHOTOSD_FOLDER, filename);

        try {
            console.log(`🔄 Конвертация: ${filename}`);
            await sharp(imgBuffer)
                .webp({ quality: 85 })
                .toFile(filepath);
        } catch (e) {
            console.log(`⚠️ Ошибка конвертации ${filename}: ${e.message}`);
            return res.status(500).json({ success: false, error: e.message });
        }

        console.log(`✅ Готово: ${filename}`);
        res.sendFile(path.resolve(filepath));

    } catch (error) {
        console.error(`❌ Общая ошибка для ${req.query.id}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// ЗАПУСК СЕРВЕРА
// ============================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 AnimeVibe Server запущен!');
    console.log('='.repeat(50));
    console.log(`📍 http://localhost:${PORT}`);
    console.log('\n📡 Доступные эндпоинты:');
    console.log(`  GET /api/images - список картинок из папки`);
    console.log(`  GET /api/manga-list?page=1 - список манги с MangaDex`);
    console.log(`  GET /api/search?q=... - поиск манги`);
    console.log(`  GET /api/chapters?id=... - список глав`);
    console.log(`  GET /api/pages?id=... - страницы главы`);
    console.log(`  GET /api/fetch?id=...&title=... - скачать обложку`);
    
    // Показываем сколько файлов есть
    const images = getImagesFromFolder();
    console.log(`\n📁 В папке ${PHOTOSD_FOLDER}: ${images.length} файлов`);
    if (images.length > 0) {
        console.log(`📸 Первые 5 файлов:`);
        images.slice(0, 5).forEach((img, i) => {
            console.log(`   ${i+1}. ${img.filename} → ${img.title}`);
        });
        if (images.length > 5) {
            console.log(`   ... и ещё ${images.length - 5} файлов`);
        }
    } else {
        console.log(`   ℹ️ Папка пуста. Добавьте .webp файлы или скачайте через /api/fetch`);
    }
    console.log('\n✅ Сервер готов к работе!');
    console.log('='.repeat(50) + '\n');
});

// ============================================================
// ОБРАБОТКА ОШИБОК
// ============================================================

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});