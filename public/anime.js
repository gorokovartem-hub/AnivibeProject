// Состояние
let state = {
    page: 1,
    loading: false,
    allLoaded: false,
    items: [],
    searchMode: false,
    searchResults: [],
    sort: 'default'
};

// DOM элементы
const grid = document.getElementById('grid');
const loadMoreBtn = document.getElementById('loadMore');
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const resetBtn = document.getElementById('resetBtn');
const sortSelect = document.getElementById('sortSelect');
const countSpan = document.getElementById('count');

// ==================== ОСНОВНЫЕ ФУНКЦИИ ====================

// Загрузка аниме
async function loadAnime(page = 1, append = false) {
    if (state.loading || state.allLoaded) return;
    state.loading = true;
    
    loadMoreBtn.disabled = true;
    loadMoreBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
    
    try {
        const response = await fetch(`/api/anime?page=${page}`);
        const data = await response.json();
        
        if (data.success) {
            if (append) {
                state.items = [...state.items, ...data.data];
            } else {
                state.items = data.data;
            }
            
            renderItems(state.items);
            updateStats();
            
            if (data.hasMore) {
                loadMoreBtn.style.display = 'block';
                loadMoreBtn.disabled = false;
                loadMoreBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Показать ещё';
                state.allLoaded = false;
            } else {
                loadMoreBtn.style.display = 'none';
                state.allLoaded = true;
            }
        }
    } catch (error) {
        console.error('❌ Ошибка:', error);
        grid.innerHTML = `
            <div class="empty">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Ошибка загрузки: ${error.message}</p>
                <button onclick="loadAnime(1, false)" style="margin-top:16px;padding:8px 24px;background:#ff6b9d;border:none;border-radius:20px;color:#0a0b14;font-weight:600;cursor:pointer;">
                    Попробовать снова
                </button>
            </div>
        `;
    }
    
    state.loading = false;
}

// Рендер карточек
function renderItems(items) {
    if (!items || items.length === 0) {
        grid.innerHTML = `
            <div class="empty">
                <i class="fas fa-search"></i>
                <p>Ничего не найдено</p>
            </div>
        `;
        return;
    }
    
    // Применяем сортировку
    const sorted = sortItems(items);
    
    grid.innerHTML = '';
    sorted.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';
        
        const imageHtml = item.image 
            ? `<img src="${item.image}" alt="${item.title}" loading="lazy" onerror="this.parentElement.innerHTML = '<div class=\\'placeholder\\'><i class=\\'fas fa-image\\'></i><span>${item.title.substring(0, 15)}</span></div>'">`
            : `<div class="placeholder"><i class="fas fa-image"></i><span>${item.title.substring(0, 15)}</span></div>`;
        
        card.innerHTML = `
            <div class="card-image">${imageHtml}</div>
            <div class="card-info">
                <h3 title="${item.title}">${item.title}</h3>
                <div class="meta">
                    <span><i class="fas fa-star" style="color:#fbbf24;"></i> ${item.score}</span>
                    <span><i class="fas fa-film"></i> ${item.episodes}</span>
                    <span><i class="fas fa-calendar"></i> ${item.year}</span>
                </div>
                ${item.genres ? `<div class="genres">${item.genres}</div>` : ''}
            </div>
        `;
        
        card.addEventListener('click', () => {
            window.open(`https://yandex.ru/search/?text=${encodeURIComponent(item.title)}+смотреть+онлайн`, '_blank');
        });
        
        grid.appendChild(card);
    });
}

// Сортировка
function sortItems(items) {
    const sorted = [...items];
    
    switch (state.sort) {
        case 'score':
            sorted.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
            break;
        case 'year':
            sorted.sort((a, b) => (b.year || 0) - (a.year || 0));
            break;
        case 'episodes':
            sorted.sort((a, b) => (b.episodes || 0) - (a.episodes || 0));
            break;
        case 'title':
            sorted.sort((a, b) => a.title.localeCompare(b.title));
            break;
        default:
            // По умолчанию - как пришло
            break;
    }
    
    return sorted;
}

// Обновление статистики
function updateStats() {
    const count = state.searchMode ? state.searchResults.length : state.items.length;
    countSpan.textContent = count;
}

// ==================== ПОИСК ====================

async function search() {
    const query = searchInput.value.trim();
    
    if (!query) {
        state.searchMode = false;
        loadMoreBtn.style.display = 'block';
        renderItems(state.items);
        updateStats();
        return;
    }
    
    state.searchMode = true;
    loadMoreBtn.style.display = 'none';
    grid.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i><p>Поиск...</p></div>';
    
    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await response.json();
        
        if (data.success) {
            state.searchResults = data.data;
            renderItems(state.searchResults);
            updateStats();
        }
    } catch (error) {
        console.error('❌ Ошибка поиска:', error);
        grid.innerHTML = `
            <div class="empty">
                <i class="fas fa-exclamation-triangle"></i>
                <p>Ошибка поиска: ${error.message}</p>
            </div>
        `;
    }
}

// ==================== СБРОС ====================

function resetAll() {
    state.searchMode = false;
    state.searchResults = [];
    state.page = 1;
    state.allLoaded = false;
    searchInput.value = '';
    grid.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i><p>Загрузка...</p></div>';
    loadAnime(1, false);
}

// ==================== СОБЫТИЯ ====================

// Загрузка при открытии
document.addEventListener('DOMContentLoaded', () => {
    loadAnime(1, false);
});

// Поиск
searchBtn.addEventListener('click', search);
searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') search();
});

// Сброс
resetBtn.addEventListener('click', resetAll);

// Сортировка
sortSelect.addEventListener('change', (e) => {
    state.sort = e.target.value;
    if (state.searchMode) {
        renderItems(state.searchResults);
    } else {
        renderItems(state.items);
    }
});

// Кнопка "Показать ещё"
loadMoreBtn.addEventListener('click', () => {
    if (!state.searchMode) {
        state.page++;
        loadAnime(state.page, true);
    }
});