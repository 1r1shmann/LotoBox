// ==================== I18N ====================
const I18N = {
    ru: {
        adminTitle: 'Управление призами', toLottery: 'К лототрону',
        addPrize: '+ Добавить приз', resetAll: 'Сбросить все в 0',
        fillStock: 'Остаток = Количество', spinBtn: 'КРУТИТЬ БАРАБАН',
        congrats: 'Поздравляем!', youWon: 'Вы выиграли:',
        cancel: 'Отменить результат', confirm: 'Подтвердить результат',
        noPrizes: 'Призы закончились! Обратитесь к администратору.',
        deleteConfirm: 'Удалить этот приз?',
        resetConfirm: 'ВНИМАНИЕ! Это обнулит ВСЕ призы. Продолжить?',
        fillConfirm: 'Установить остаток равным общему количеству?',
        editName: 'Наименование приза:', editTotal: 'Количество всего:',
        editRemain: 'Остаток:', newItemName: 'Название нового приза:',
        remaining: 'Остаток', total: 'Всего',
        fillDemo: 'Заполнить демо',
        fillDemoConfirm: 'Заполнить демо-данными? Текущие данные будут заменены.'
    },
    en: {
        adminTitle: 'Prize Management', toLottery: 'To Lottery',
        addPrize: '+ Add Prize', resetAll: 'Reset All to 0',
        fillStock: 'Remaining = Total', spinBtn: 'SPIN THE DRUM',
        congrats: 'Congratulations!', youWon: 'You won:',
        cancel: 'Cancel Result', confirm: 'Confirm Result',
        noPrizes: 'No prizes left! Contact administrator.',
        deleteConfirm: 'Delete this prize?',
        resetConfirm: 'WARNING! Reset ALL prizes to 0. Continue?',
        fillConfirm: 'Set remaining equal to total for all prizes?',
        editName: 'Prize name:', editTotal: 'Total quantity:',
        editRemain: 'Remaining:', newItemName: 'New prize name:',
        remaining: 'Remaining', total: 'Total',
        fillDemo: 'Fill with demo',
        fillDemoConfirm: 'Fill with demo data? Current data will be replaced.'
    }
};

const STORAGE_KEY = 'lotobox_items';
const LANG_KEY = 'lotobox_lang';
let items = [];
let isSpinning = false;
let currentWinner = null;

function getDefaultLang() {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved)
        return saved;

    // Автоопределение по языку браузера
    const browserLang = navigator.language || navigator.userLanguage;
    return browserLang.startsWith('ru') ? 'ru' : 'en';
}

let currentLang = getDefaultLang();

const t = (k) => I18N[currentLang]?.[k] || k;
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ==================== AUDIO ENGINE (Web Audio API) ====================
let audioCtx = null;
let masterGain = null;
let spinOscillator = null;
let spinGain = null;
let lastCollisionTime = 0;
let lastVertexAngle = -1; // Для отслеживания прохождения углов

function initAudio() {
    if (audioCtx)
        return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = audioCtx.createGain();
        masterGain.gain.value = 0.3;
        masterGain.connect(audioCtx.destination);
    } catch (e) {
        console.warn('Web Audio API not supported');
    }
}


// Щелчок при прохождении угла шестиугольника над ножкой
function playVertexClick() {
    if (!audioCtx)
        return;
    const now = audioCtx.currentTime;

    // Основной щелчок (короткий, чёткий)
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.02);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.035);

    // Механический шум (текстура)
    const bufferSize = audioCtx.sampleRate * 0.015;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 4);
    }

    const noise = audioCtx.createBufferSource();
    const noiseGain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    noise.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 1.5;
    noiseGain.gain.setValueAtTime(0.12, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.02);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(now);
    noise.stop(now + 0.02);
}

// Проверка прохождения угла над ножкой (вызывается каждый кадр)
function checkVertexPassage() {
    if (!isSpinning || isSettling)
        return;

    // Нормализуем угол к 0-360
    const normalizedAngle = ((drumAngle % 360) + 360) % 360;

    // Углы шестиугольника: 0, 60, 120, 180, 240, 300
    // Ножка находится внизу (270° в экранной системе, но в нашей логике 0° = верх)
    // При вращении угол проходит через 0°, 60°, 120°... относительно начальной позиции
    // Нам нужно проверить, когда угол близок к кратному 60°

    for (let vertex = 0; vertex < 360; vertex += 60) {
        const diff = Math.abs(normalizedAngle - vertex);
        const wrappedDiff = Math.min(diff, 360 - diff);

        // Если угол прошёл через вершину (был больше, стал меньше порога)
        if (wrappedDiff < 3 && lastVertexAngle !== vertex) {
            // Проверяем направление (только при движении вперёд)
            if (drumSpeed > 0) {
                playVertexClick();
                lastVertexAngle = vertex;
                break;
            }
        }
    }

    // Сбрасываем tracking если ушли далеко от всех вершин
    const minDistToAnyVertex = Math.min(...Array.from({length: 6}, (_, i) => {
        const v = i * 60;
        const d = Math.abs(normalizedAngle - v);
        return Math.min(d, 360 - d);
    }));

    if (minDistToAnyVertex > 10) {
        lastVertexAngle = -1;
    }
}

// Звук столкновения шариков (реалистичный пластик/дерево)
function playCollisionSound(intensity = 0.5) {
    if (!audioCtx)
        return;
    const now = audioCtx.currentTime;

    // Ограничиваем частоту звуков (не чаще чем каждые 25мс)
    if (now - lastCollisionTime < 0.025)
        return;
    lastCollisionTime = now;

    // Стерео-панорамирование (случайная позиция для объёма)
    const panner = audioCtx.createStereoPanner();
    panner.pan.value = (Math.random() - 0.5) * 1.2; // От -0.6 до +0.6

    // Основной тон (резонанс шарика)
    const baseFreq = 600 + Math.random() * 800; // 600-1400 Гц (вариативность)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(baseFreq, now);
    osc1.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, now + 0.08);

    // Вторая гармоника (для объёма)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(baseFreq * 2.3, now); // Негармоническая частичная частота
    osc2.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + 0.06);
    gain2.gain.value = 0.3;

    // Короткий шум удара (атака)
    const bufferSize = audioCtx.sampleRate * 0.012;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 6);
    }
    const noise = audioCtx.createBufferSource();
    const noiseGain = audioCtx.createGain();
    const noiseFilter = audioCtx.createBiquadFilter();
    noise.buffer = buffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 2000 + Math.random() * 1500;
    noiseFilter.Q.value = 1.2;
    noiseGain.gain.setValueAtTime(intensity * 0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

    // Огибающая основного тона (зависит от интенсивности)
    const attackTime = 0.003;
    const decayTime = 0.04 + intensity * 0.06; // Сильнее удар = дольше затухание
    const peakGain = Math.min(0.35, intensity * 0.5);

    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(peakGain, now + attackTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + decayTime);

    gain2.gain.setValueAtTime(0, now);
    gain2.gain.linearRampToValueAtTime(peakGain * 0.3, now + attackTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + decayTime * 0.8);

    // Подключаем всё к паннеру
    osc1.connect(gain1);
    osc2.connect(gain2);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);

    gain1.connect(panner);
    gain2.connect(panner);
    noiseGain.connect(panner);
    panner.connect(masterGain);

    // Запуск
    osc1.start(now);
    osc2.start(now);
    noise.start(now);

    osc1.stop(now + decayTime + 0.01);
    osc2.stop(now + decayTime * 0.8 + 0.01);
    noise.stop(now + 0.02);
}

// Звук выпадения шарика
function playDropSound() {
    if (!audioCtx)
        return;
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.2);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.3);
}

// Звук победы (торжественные фанфары 20th Century Fox)
function playWinSound() {
    if (!audioCtx)
        return;
    const now = audioCtx.currentTime;

    const convolver = audioCtx.createConvolver();
    const reverbTime = 2.5;
    const sampleRate = audioCtx.sampleRate;
    const length = sampleRate * reverbTime;
    const impulse = audioCtx.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < 2; channel++) {
        const channelData = impulse.getChannelData(channel);
        for (let i = 0; i < length; i++) {
            channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
        }
    }
    convolver.buffer = impulse;

    const reverbGain = audioCtx.createGain();
    reverbGain.gain.value = 0.4;
    convolver.connect(reverbGain);
    reverbGain.connect(masterGain);

    const dryGain = audioCtx.createGain();
    dryGain.gain.value = 0.6;
    dryGain.connect(masterGain);

    const notes = [
        {freq: 233.08, time: 0, dur: 2.0},
        {freq: 293.66, time: 0, dur: 2.0},
        {freq: 349.23, time: 0, dur: 2.0},
        {freq: 466.16, time: 0.15, dur: 1.8},
        {freq: 587.33, time: 0.3, dur: 1.6},
        {freq: 698.46, time: 0.45, dur: 1.4},
        {freq: 932.33, time: 0.6, dur: 1.2},
    ];

    notes.forEach(note => {
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'sawtooth';
        osc1.frequency.value = note.freq;

        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'square';
        osc2.frequency.value = note.freq * 2;
        gain2.gain.value = 0.15;

        const attackTime = 0.08;
        const releaseTime = note.dur * 0.7;
        gain1.gain.setValueAtTime(0, now + note.time);
        gain1.gain.linearRampToValueAtTime(0.25, now + note.time + attackTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + note.time + releaseTime);

        gain2.gain.setValueAtTime(0, now + note.time);
        gain2.gain.linearRampToValueAtTime(0.08, now + note.time + attackTime);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + note.time + releaseTime);

        osc1.connect(gain1);
        osc2.connect(gain2);
        gain1.connect(dryGain);
        gain1.connect(convolver);
        gain2.connect(dryGain);
        gain2.connect(convolver);

        osc1.start(now + note.time);
        osc2.start(now + note.time);
        osc1.stop(now + note.time + releaseTime + 0.1);
        osc2.stop(now + note.time + releaseTime + 0.1);
    });

    const kickOsc = audioCtx.createOscillator();
    const kickGain = audioCtx.createGain();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(120, now);
    kickOsc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
    kickGain.gain.setValueAtTime(0.5, now);
    kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

    kickOsc.connect(kickGain);
    kickGain.connect(dryGain);
    kickGain.connect(convolver);
    kickOsc.start(now);
    kickOsc.stop(now + 0.4);
}

// Звук кнопки (щелчок Windows XP)
function playClickSound() {
    if (!audioCtx)
        return;
    const now = audioCtx.currentTime;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(1800, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.015);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.04);

    const bufferSize = audioCtx.sampleRate * 0.02;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 3);
    }

    const noise = audioCtx.createBufferSource();
    const noiseGain = audioCtx.createGain();
    noise.buffer = buffer;
    noiseGain.gain.setValueAtTime(0.15, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2000;

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(masterGain);
    noise.start(now);
    noise.stop(now + 0.025);
}

// ==================== RIPPLE ====================
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.md-btn');
    if (!btn || btn.disabled)
        return;

    initAudio();
    playClickSound();

    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
});

// ==================== CORE ====================
function saveItems() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    renderAdminList();
}

function applyTranslations() {
    $$('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (I18N[currentLang][key])
            el.textContent = I18N[currentLang][key];
    });
    $('#lang-switcher').value = currentLang;
    $('#lang-switcher-main').value = currentLang;
    document.documentElement.lang = currentLang;
}

function setLang(lang) {
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    applyTranslations();
    renderAdminList();
}

function navigate() {
    if (!localStorage.getItem(STORAGE_KEY)) {
        $('#admin-view').classList.remove('hidden');
        $('#lottery-view').classList.add('hidden');
        renderAdminList();
    } else {
        $('#admin-view').classList.add('hidden');
        $('#lottery-view').classList.remove('hidden');
    }
}

// ==================== DEMO DATA ====================
function getDemoData() {
    return currentLang === 'ru' ? [
        {id: Date.now() + 1, name: 'Футболка', total: 50, remaining: 50},
        {id: Date.now() + 2, name: 'Кружка', total: 30, remaining: 30},
        {id: Date.now() + 3, name: 'Ручка', total: 100, remaining: 100},
        {id: Date.now() + 4, name: 'Блокнот', total: 40, remaining: 40},
        {id: Date.now() + 5, name: 'Брелок', total: 75, remaining: 75}
    ] : [
        {id: Date.now() + 1, name: 'T-Shirt', total: 50, remaining: 50},
        {id: Date.now() + 2, name: 'Mug', total: 30, remaining: 30},
        {id: Date.now() + 3, name: 'Pen', total: 100, remaining: 100},
        {id: Date.now() + 4, name: 'Notebook', total: 40, remaining: 40},
        {id: Date.now() + 5, name: 'Keychain', total: 75, remaining: 75}
    ];
}

// ==================== ADMIN ====================
function renderAdminList() {
    const list = $('#items-list');
    list.innerHTML = '';
    items.forEach((item, i) => {
        const card = document.createElement('div');
        card.className = 'item-card';
        card.innerHTML = `
            <div class="item-info">
                <h4>${item.name}</h4>
                <span>${t('remaining')}: ${item.remaining} / ${t('total')}: ${item.total}</span>
            </div>
            <div class="item-actions">
                <button onclick="editItem(${i})">✏️</button>
                <button onclick="deleteItem(${i})">🗑️</button>
            </div>
        `;
        list.appendChild(card);
    });
}

window.deleteItem = (i) => {
    if (confirm(t('deleteConfirm'))) {
        items.splice(i, 1);
        saveItems();
    }
};

window.editItem = (i) => {
    const item = items[i];
    const name = prompt(t('editName'), item.name);
    if (name === null)
        return;
    const total = parseInt(prompt(t('editTotal'), item.total));
    const remain = parseInt(prompt(t('editRemain'), item.remaining));
    if (!isNaN(total) && !isNaN(remain)) {
        items[i] = {...item, name, total, remaining: remain};
        saveItems();
    }
};

$('#add-item-btn').onclick = () => {
    const name = prompt(t('newItemName'));
    if (!name)
        return;
    const total = parseInt(prompt(t('editTotal'), '10'));
    if (isNaN(total))
        return;
    items.push({id: Date.now(), name, total, remaining: total});
    saveItems();
};

// ОБНОВЛЕННАЯ КНОПКА: Заполнить демо-данными с учетом языка
$('#fill-demo-btn').onclick = () => {
    if (confirm(t('fillDemoConfirm') || 'Заполнить демо-данными? Текущие данные будут заменены.')) {
        items = getDemoData();
        saveItems();
    }
};

$('#reset-all-btn').onclick = () => {
    if (confirm(t('resetConfirm'))) {
        items = items.map(i => ({...i, total: 0, remaining: 0}));
        saveItems();
    }
};

$('#fill-stock-btn').onclick = () => {
    if (confirm(t('fillConfirm'))) {
        items = items.map(i => ({...i, remaining: i.total}));
        saveItems();
    }
};

$('#to-lottery-btn').onclick = navigate;
$('#admin-link-trigger').onclick = () => {
    $('#admin-view').classList.remove('hidden');
    $('#lottery-view').classList.add('hidden');
    renderAdminList();
};

// ==================== INVISIBLE CIRCLE PHYSICS (R=125) ====================
const CX = 200, CY = 200, CIRCLE_R = 125, BALL_R = 10;
const MAX_BALLS = 50;

const SETTLE_X = CX;
const SETTLE_Y = CY + CIRCLE_R - BALL_R - 5;

let balls = [];
let drumAngle = 0;
let drumSpeed = 0;
let animFrame = null;
let physicsRunning = false;
let targetStopAngle = 0;
let isSettling = false;

function initBalls() {
    const container = $('#balls-container');
    container.innerHTML = '';
    balls = [];
    const available = items.filter(i => i.remaining > 0);

    let pool = [];
    available.forEach(item => {
        const count = Math.min(item.remaining, 12);
        for (let i = 0; i < count; i++)
            pool.push(item);
    });
    if (pool.length > MAX_BALLS) {
        const step = pool.length / MAX_BALLS;
        const reduced = [];
        for (let i = 0; i < MAX_BALLS; i++)
            reduced.push(pool[Math.floor(i * step)]);
        pool = reduced;
    }
    while (pool.length < 12)
        pool.push(available[pool.length % available.length]);

    const n = pool.length;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));

    pool.forEach((_, i) => {
        const r = (CIRCLE_R - BALL_R - 5) * Math.sqrt(i / n);
        const theta = i * goldenAngle;
        const x = CX + r * Math.cos(theta);
        const y = CY + r * Math.sin(theta);

        const ball = {x, y, vx: 0, vy: 0, el: null};
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", BALL_R);
        circle.setAttribute("fill", "url(#ballYellow)");
        circle.setAttribute("stroke", "#004D40");
        circle.setAttribute("stroke-width", "2");
        container.appendChild(circle);
        ball.el = circle;
        balls.push(ball);
    });
}

function physicsSpin() {
    balls.forEach(ball => {
        ball.vx += (Math.random() - 0.5) * 1.8;
        ball.vy += (Math.random() - 0.5) * 1.8;

        const dx = ball.x - CX, dy = ball.y - CY;
        const radSpeed = drumSpeed * Math.PI / 180;
        ball.vx += -dy * radSpeed * 0.18;
        ball.vy += dx * radSpeed * 0.18;

        ball.vx *= 0.95;
        ball.vy *= 0.95;

        ball.x += ball.vx;
        ball.y += ball.vy;
    });

    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const a = balls[i], b = balls[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const minDist = BALL_R * 2;
            if (dist < minDist && dist > 0.01) {
                const nx = dx / dist, ny = dy / dist;
                const overlap = (minDist - dist) / 2;
                a.x -= nx * overlap;
                a.y -= ny * overlap;
                b.x += nx * overlap;
                b.y += ny * overlap;
                const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
                const dot = dvx * nx + dvy * ny;
                if (dot > 0) {
                    a.vx -= dot * nx * 0.65;
                    a.vy -= dot * ny * 0.65;
                    b.vx += dot * nx * 0.65;
                    b.vy += dot * ny * 0.65;
                    playCollisionSound(Math.min(1, Math.abs(dot) * 0.3));
                }
            }
        }
    }

    balls.forEach(ball => {
        const dx = ball.x - CX, dy = ball.y - CY;
        const dist = Math.hypot(dx, dy);
        const maxDist = CIRCLE_R - BALL_R;
        if (dist > maxDist) {
            const nx = dx / dist, ny = dy / dist;
            ball.x = CX + nx * maxDist;
            ball.y = CY + ny * maxDist;
            const dot = ball.vx * nx + ball.vy * ny;
            if (dot > 0) {
                ball.vx -= 1.9 * dot * nx;
                ball.vy -= 1.9 * dot * ny;
                playCollisionSound(0.7);
            }
        }
    });

    balls.forEach(ball => {
        ball.el.setAttribute("cx", ball.x);
        ball.el.setAttribute("cy", ball.y);
    });
}

function physicsSettle() {
    balls.forEach(ball => {
        const dx = SETTLE_X - ball.x;
        const dy = SETTLE_Y - ball.y;
        const dist = Math.hypot(dx, dy);

        if (dist > 1) {
            ball.vx += (dx / dist) * 0.7;
            ball.vy += (dy / dist) * 0.7;
        }

        ball.vy += 0.3;
        ball.vx *= 0.86;
        ball.vy *= 0.86;

        ball.x += ball.vx;
        ball.y += ball.vy;

        const cdx = ball.x - CX, cdy = ball.y - CY;
        const cdist = Math.hypot(cdx, cdy);
        const maxDist = CIRCLE_R - BALL_R;
        if (cdist > maxDist) {
            const nx = cdx / cdist, ny = cdy / cdist;
            ball.x = CX + nx * maxDist;
            ball.y = CY + ny * maxDist;
            ball.vx *= 0.3;
            ball.vy *= 0.3;
        }
    });

    for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
            const a = balls[i], b = balls[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.hypot(dx, dy);
            const minDist = BALL_R * 2;
            if (dist < minDist && dist > 0.01) {
                const nx = dx / dist, ny = dy / dist;
                const overlap = (minDist - dist) / 2;
                a.x -= nx * overlap * 0.6;
                a.y -= ny * overlap * 0.6;
                b.x += nx * overlap * 0.6;
                b.y += ny * overlap * 0.6;
            }
        }
    }

    balls.forEach(ball => {
        ball.el.setAttribute("cx", ball.x);
        ball.el.setAttribute("cy", ball.y);
    });
}

function animate() {
    if (!physicsRunning)
        return;
    drumAngle += drumSpeed;
    $('#drum-rotor').style.transform = `rotate(${drumAngle}deg)`;

    checkVertexPassage(); // Проверка прохождения углов

    if (isSettling)
        physicsSettle();
    else
        physicsSpin();
    animFrame = requestAnimationFrame(animate);
}

function startPhysics(speed) {
    drumSpeed = speed;
    isSettling = false;
    lastVertexAngle = -1; // Сброс tracking
    if (!physicsRunning) {
        physicsRunning = true;
        animate();
    }
}

function stopPhysics(callback) {
    const currentMod = ((drumAngle % 360) + 360) % 360;
    targetStopAngle = drumAngle - currentMod + 360;

    if (currentMod < 30 && drumAngle > 360) {
        targetStopAngle = drumAngle - currentMod;
    }

    const slowDown = setInterval(() => {
        drumSpeed *= 0.75;

        if (Math.abs(drumSpeed) < 2.0) {
            const diff = targetStopAngle - drumAngle;
            drumSpeed += diff * 0.15;
        }

        if (Math.abs(drumSpeed) < 0.1 && Math.abs(targetStopAngle - drumAngle) < 1.0) {
            drumAngle = targetStopAngle;
            drumSpeed = 0;
            clearInterval(slowDown);
            $('#drum-rotor').style.transform = `rotate(${drumAngle}deg)`;

            isSettling = true;

            setTimeout(() => {
                physicsRunning = false;
                if (animFrame)
                    cancelAnimationFrame(animFrame);
                if (callback)
                    callback();
            }, 800);
        }
    }, 16);
}

function getWeightedWinner(available) {
    const tw = available.reduce((s, i) => s + i.remaining, 0);
    let r = Math.random() * tw;
    for (let i = 0; i < available.length; i++) {
        r -= available[i].remaining;
        if (r <= 0)
            return i;
    }
    return available.length - 1;
}

// ==================== SPIN LOGIC ====================
function startSpin() {
    const available = items.filter(i => i.remaining > 0);
    if (available.length === 0) {
        alert(t('noPrizes'));
        return;
    }
    if (isSpinning)
        return;

    initAudio();

    isSpinning = true;
    $('#spin-btn').disabled = true;
    $('#spin-btn').classList.remove('pulse-btn');

    const wg = $('#winner-group');
    wg.classList.remove('dropped');
    wg.style.opacity = '0';

    drumAngle = 0;
    $('#drum-rotor').style.transform = `rotate(0deg)`;

    initBalls();
    startPhysics(7 + Math.random() * 3);



    const winnerIdx = getWeightedWinner(available);
    currentWinner = available[winnerIdx];

    setTimeout(() => {
        stopPhysics(() => {
            wg.classList.add('dropped');
            playDropSound();

            setTimeout(() => {
                $('#win-name').textContent = currentWinner.name;
                $('#result-modal').classList.remove('hidden');
                playWinSound();
            }, 600);
        });
    }, 3500);
}

function resetState() {
    $('#result-modal').classList.add('hidden');
    isSpinning = false;
    $('#spin-btn').disabled = false;
    $('#spin-btn').classList.add('pulse-btn');
    currentWinner = null;
    const wg = $('#winner-group');
    wg.classList.remove('dropped');
    wg.style.opacity = '0';
}

$('#spin-btn').onclick = startSpin;
$('#confirm-win-btn').onclick = () => {
    if (currentWinner) {
        const idx = items.findIndex(i => i.id === currentWinner.id);
        if (idx !== -1 && items[idx].remaining > 0) {
            items[idx].remaining--;
            saveItems();
        }
    }
    resetState();
};
$('#cancel-win-btn').onclick = resetState;
$('#lang-switcher').onchange = (e) => setLang(e.target.value);
$('#lang-switcher-main').onchange = (e) => setLang(e.target.value);

document.addEventListener('DOMContentLoaded', () => {
    try {
        items = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch {
        items = [];
    }
    applyTranslations();
    navigate();

    // Гарантируем синхронизацию селектов
    $('#lang-switcher').value = currentLang;
    $('#lang-switcher-main').value = currentLang;

    if ('serviceWorker' in navigator)
        navigator.serviceWorker.register('sw.js');
});
