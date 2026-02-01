// LocalStorageから読み込み
let favorites = JSON.parse(localStorage.getItem('favorites')) || [];
let useCounts = JSON.parse(localStorage.getItem('useCounts')) || {};

// 現在のフィルター
let currentCategory = 'all';
let selectedSeasons = []; // 複数の季節を選択可能
let searchQuery = '';

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    initPageAnimations();
    renderCommands();
    updateStats();
    setupEventListeners();
});

// ページ読み込み時のアニメーション
function initPageAnimations() {
    // ロゴアニメーション
    anime({
        targets: '.logo-icon',
        scale: [0, 1],
        rotate: ['-180deg', '0deg'],
        opacity: [0, 1],
        duration: 1200,
        easing: 'easeOutElastic(1, 0.5)'
    });

    // ヘッダータイトル
    anime({
        targets: 'h1',
        translateY: [-30, 0],
        opacity: [0, 1],
        duration: 800,
        delay: 300,
        easing: 'easeOutQuad'
    });

    // 検索ボックス
    anime({
        targets: '.search-container',
        translateY: [-20, 0],
        opacity: [0, 1],
        duration: 600,
        delay: 500,
        easing: 'easeOutQuad'
    });

    // フィルターセクション
    anime({
        targets: '.filter-section',
        translateY: [30, 0],
        opacity: [0, 1],
        duration: 600,
        delay: anime.stagger(150, {start: 600}),
        easing: 'easeOutQuad'
    });

    // 統計情報
    anime({
        targets: '.stat-item',
        scale: [0.8, 1],
        opacity: [0, 1],
        duration: 600,
        delay: anime.stagger(100, {start: 900}),
        easing: 'easeOutBack'
    });
}

// 統計数値のカウントアップアニメーション
function animateStatsCount(element, targetValue) {
    const obj = { count: 0 };
    anime({
        targets: obj,
        count: targetValue,
        duration: 1000,
        easing: 'easeOutExpo',
        round: 1,
        update: function() {
            element.textContent = obj.count;
        }
    });
}

// イベントリスナーの設定
function setupEventListeners() {
    // カテゴリータブクリック
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // タブ切り替えアニメーション
            anime({
                targets: tab,
                scale: [0.95, 1],
                duration: 300,
                easing: 'easeOutQuad'
            });

            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentCategory = tab.dataset.category;
            renderCommandsWithAnimation();
        });
    });

    // 季節タグクリック（複数選択可能）
    document.querySelectorAll('.season-tag').forEach(tag => {
        tag.addEventListener('click', () => {
            const season = tag.dataset.season;
            tag.classList.toggle('active');

            // クリックアニメーション
            anime({
                targets: tag,
                scale: [0.9, 1],
                duration: 300,
                easing: 'easeOutBack'
            });

            if (selectedSeasons.includes(season)) {
                selectedSeasons = selectedSeasons.filter(s => s !== season);
            } else {
                selectedSeasons.push(season);
            }

            renderCommandsWithAnimation();
        });
    });

    // 検索
    document.getElementById('searchInput').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderCommandsWithAnimation();
    });
}

// アニメーション付きコマンド描画
function renderCommandsWithAnimation() {
    const container = document.getElementById('commandsContainer');

    // フェードアウト
    anime({
        targets: '.command-card',
        opacity: [1, 0],
        scale: [1, 0.9],
        duration: 300,
        easing: 'easeInQuad',
        complete: function() {
            renderCommands();

            // フェードイン
            anime({
                targets: '.command-card',
                opacity: [0, 1],
                scale: [0.9, 1],
                translateY: [20, 0],
                duration: 500,
                delay: anime.stagger(50, {start: 100}),
                easing: 'easeOutQuad'
            });
        }
    });
}

// コマンドの描画
function renderCommands() {
    const container = document.getElementById('commandsContainer');
    const noResults = document.getElementById('noResults');
    container.innerHTML = '';

    let filteredCommands = commands;

    // カテゴリーフィルター
    if (currentCategory === 'favorites') {
        filteredCommands = commands.filter(cmd => favorites.includes(cmd.id));
    } else if (currentCategory === 'karaoke') {
        // カラオケタブでは、karaoke-start、karaoke-free、karaokeすべてを表示
        filteredCommands = commands.filter(cmd =>
            cmd.category === 'karaoke' ||
            cmd.category === 'karaoke-free' ||
            cmd.category === 'karaoke-start'
        );
    } else if (currentCategory !== 'all') {
        filteredCommands = commands.filter(cmd => cmd.category === currentCategory);
    }

    // 季節フィルター（複数選択の場合はOR条件）
    if (selectedSeasons.length > 0) {
        filteredCommands = filteredCommands.filter(cmd => {
            return cmd.tags && cmd.tags.some(tag => selectedSeasons.includes(tag));
        });
    }

    // 検索フィルター
    if (searchQuery) {
        filteredCommands = filteredCommands.filter(cmd =>
            cmd.name.toLowerCase().includes(searchQuery) ||
            cmd.command.toLowerCase().includes(searchQuery) ||
            (cmd.tags && cmd.tags.some(tag => tag.toLowerCase().includes(searchQuery)))
        );
    }

    if (filteredCommands.length === 0) {
        noResults.style.display = 'block';

        // No resultsアニメーション
        anime({
            targets: '#noResults',
            opacity: [0, 1],
            translateY: [20, 0],
            duration: 500,
            easing: 'easeOutQuad'
        });

        updateStats(0);
        return;
    }

    noResults.style.display = 'none';

    filteredCommands.forEach(cmd => {
        const card = createCommandCard(cmd);
        container.appendChild(card);
    });

    updateStats(filteredCommands.length);
}

// コマンドカードの作成
function createCommandCard(cmd) {
    const card = document.createElement('div');
    card.className = 'command-card';

    const isFavorite = favorites.includes(cmd.id);
    const useCount = useCounts[cmd.id] || 0;

    // タグのHTML生成
    const tagsHTML = cmd.tags && cmd.tags.length > 0
        ? cmd.tags.map(tag => `<span class="tag-badge tag-${tag}">${tag}</span>`).join('')
        : '';

    card.innerHTML = `
        <div class="card-tags">
            <div class="category-badge category-${cmd.category}">
                ${categoryNames[cmd.category]}
            </div>
            ${tagsHTML}
        </div>
        <div class="command-name">${cmd.name}</div>
        <div class="command-text">${cmd.command}</div>
        <div class="command-actions">
            <button class="btn-favorite ${isFavorite ? 'active' : ''}" data-id="${cmd.id}">
                ${isFavorite ? '⭐' : '☆'}
            </button>
            <button class="btn-use" data-id="${cmd.id}">使った</button>
            <div class="use-count">
                <span>📊 ${useCount}回</span>
            </div>
        </div>
    `;

    // お気に入りボタン
    const favoriteBtn = card.querySelector('.btn-favorite');
    favoriteBtn.addEventListener('click', (e) => {
        // お気に入りアニメーション
        anime({
            targets: favoriteBtn,
            scale: [1, 1.5, 1],
            rotate: [0, 360],
            duration: 600,
            easing: 'easeOutElastic(1, 0.6)'
        });

        toggleFavorite(cmd.id);

        // 遅延してカード再描画
        setTimeout(() => {
            renderCommands();
        }, 300);
    });

    // 使ったボタン
    const useBtn = card.querySelector('.btn-use');
    useBtn.addEventListener('click', (e) => {
        // ボタンクリックアニメーション
        anime({
            targets: useBtn,
            scale: [1, 0.9, 1],
            duration: 300,
            easing: 'easeOutQuad'
        });

        // +1アニメーション
        const plusOne = document.createElement('div');
        plusOne.textContent = '+1';
        plusOne.style.cssText = `
            position: absolute;
            color: #667eea;
            font-weight: bold;
            font-size: 20px;
            pointer-events: none;
        `;
        useBtn.parentElement.appendChild(plusOne);

        anime({
            targets: plusOne,
            translateY: [0, -30],
            opacity: [1, 0],
            duration: 800,
            easing: 'easeOutQuad',
            complete: () => plusOne.remove()
        });

        incrementUseCount(cmd.id);

        // 使用回数表示を更新
        setTimeout(() => {
            const newCount = useCounts[cmd.id];
            card.querySelector('.use-count span').textContent = `📊 ${newCount}回`;
        }, 100);
    });

    return card;
}

// お気に入りのトグル
function toggleFavorite(id) {
    const index = favorites.indexOf(id);
    if (index === -1) {
        favorites.push(id);
    } else {
        favorites.splice(index, 1);
    }
    localStorage.setItem('favorites', JSON.stringify(favorites));
}

// 使用回数のインクリメント
function incrementUseCount(id) {
    useCounts[id] = (useCounts[id] || 0) + 1;
    localStorage.setItem('useCounts', JSON.stringify(useCounts));
}

// 統計の更新
function updateStats(filteredCount = null) {
    const totalElement = document.getElementById('totalCount');
    const filteredElement = document.getElementById('filteredCount');
    const favoriteElement = document.getElementById('favoriteCount');

    // カウントアップアニメーション
    animateStatsCount(totalElement, commands.length);
    animateStatsCount(favoriteElement, favorites.length);

    if (filteredCount !== null) {
        animateStatsCount(filteredElement, filteredCount);
    } else {
        animateStatsCount(filteredElement, commands.length);
    }
}

// スクロールアニメーション（Intersection Observer）
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            anime({
                targets: entry.target,
                translateY: [30, 0],
                opacity: [0, 1],
                duration: 600,
                easing: 'easeOutQuad'
            });
            observer.unobserve(entry.target);
        }
    });
}, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
});

// カード表示時に監視を開始
const observeCards = () => {
    document.querySelectorAll('.command-card').forEach(card => {
        observer.observe(card);
    });
};

// renderCommands後に呼び出す
setTimeout(observeCards, 100);
