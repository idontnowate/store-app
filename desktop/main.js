/* main.js — تطبيق ويندوز لبرنامج إدارة المتجر
 *
 * يفتح البرنامج المنشور على الإنترنت داخل نافذة خاصة به، فتصل التحديثات تلقائيًا دون إعادة تثبيت،
 * ويعمل بدون إنترنت بعد أول تشغيل (sw.js يحفظ الصفحات على الجهاز).
 * ما يضيفه التطبيق على المتصفح:
 * - طباعة مباشرة على الطابعة المختارة بدون نافذة الطابعة (preload.js يستبدل window.print)
 * - اختيار الطابعة، والتشغيل مع ويندوز، من قائمة البرنامج
 * - روابط الواتساب والمواقع الخارجية تفتح في المتصفح
 * - تنبيه عند توفر إصدار جديد من التطبيق نفسه (desktop/latest.json على الموقع)
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, session, net } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const APP_URL = process.env.STORE_APP_URL || CONFIG.appUrl;
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_BASE = APP_URL.replace(/[^/]*$/, '');

// ===== مجلد بيانات التطبيق =====
// باسم إنجليزي: مسار فيه أحرف عربية قد يمنع ويندوز من حفظ نسخة العمل بدون إنترنت.
// الإصدارات السابقة كانت تحفظ في مجلد باسم البرنامج العربي، فننقل محتواه مرة واحدة
const DATA_DIR = path.join(app.getPath('appData'), 'IPStore');
const LEGACY_DIR = path.join(app.getPath('appData'), 'إدارة المتجر');
try {
    if (!fs.existsSync(DATA_DIR) && fs.existsSync(LEGACY_DIR)) {
        fs.cpSync(LEGACY_DIR, DATA_DIR, {
            recursive: true,
            filter: src => !/(^|[\\/])(Singleton\w*|lockfile|LOCK)$/.test(src)
        });
    }
} catch (e) {
    console.error('تعذر نقل بيانات الإصدار السابق:', e);
}
app.setPath('userData', DATA_DIR);

// ===== إعدادات هذا الجهاز =====
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = { silentPrint: true, printer: '', autoStart: false };
let settings = { ...DEFAULTS };

function loadSettings() {
    try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')) }; } catch (e) { settings = { ...DEFAULTS }; }
}

function saveSettings(patch) {
    settings = { ...settings, ...patch };
    try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2)); } catch (e) { }
    buildMenu();
}

// خطأ غير متوقع يُسجَّل فقط، ولا تظهر نافذة خطأ توقف البرنامج أثناء البيع
process.on('uncaughtException', err => console.error('خطأ في التطبيق:', err));

// ===== نافذة واحدة فقط =====
if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let printers = [];

const isAppUrl = url => {
    try { return new URL(url).origin === APP_ORIGIN; } catch (e) { return false; }
};

function openExternal(url) {
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) shell.openExternal(url);
}

function createWindow() {
    win = new BrowserWindow({
        width: 1366,
        height: 860,
        minWidth: 900,
        minHeight: 600,
        show: false,
        backgroundColor: '#111113',
        icon: path.join(__dirname, 'build', 'icon.png'),
        title: 'إدارة المتجر',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInSubFrames: true,
            sandbox: false,
            spellcheck: false
        }
    });
    guard(win.webContents);
    if (app.isPackaged) win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
    win.on('closed', () => { win = null; app.quit(); });
    win.loadURL(APP_URL);

    // أول تشغيل بدون إنترنت: صفحة تطلب الاتصال وتعيد المحاولة تلقائيًا
    win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
        if (!isMain || code === -3) return; // -3: تحميل أُلغي لصالح تحميل آخر
        win.loadFile(path.join(__dirname, 'offline.html'), { query: { url: url || APP_URL } });
    });
}

// قواعد مشتركة لكل نافذة: الروابط الخارجية للمتصفح، والقائمة عند الضغط بالزر الأيمن
function guard(contents) {
    contents.setWindowOpenHandler(({ url }) => {
        if (isAppUrl(url)) {
            return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: path.join(__dirname, 'build', 'icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegrationInSubFrames: true, sandbox: false } } };
        }
        openExternal(url);
        return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
        if (isAppUrl(url) || url.startsWith('file:')) return;
        e.preventDefault();
        openExternal(url);
    });
    contents.on('did-create-window', child => guard(child.webContents));
    contents.on('context-menu', (e, p) => {
        const items = [];
        if (p.isEditable) {
            items.push({ role: 'cut', label: 'قص' }, { role: 'copy', label: 'نسخ' }, { role: 'paste', label: 'لصق' }, { type: 'separator' }, { role: 'selectAll', label: 'تحديد الكل' });
        } else if (p.selectionText) {
            items.push({ role: 'copy', label: 'نسخ' });
        }
        if (items.length) Menu.buildFromTemplate(items).popup();
    });
}

// ===== الطباعة =====
function printOptions(silent) {
    const opts = { silent, printBackground: true };
    if (silent && settings.printer && printers.some(p => p.name === settings.printer)) opts.deviceName = settings.printer;
    return opts;
}

function printContents(contents, done) {
    const silent = settings.silentPrint;
    contents.print(printOptions(silent), (ok, reason) => {
        if (!ok && silent && reason && !/cancel/i.test(reason)) {
            dialog.showMessageBox({ type: 'warning', title: 'الطباعة', message: 'تعذرت الطباعة', detail: 'تأكد أن الطابعة متصلة ومختارة من قائمة «الطباعة».\n' + reason });
        }
        if (done) done();
    });
}

// صفحة داخل إطار (مثل طباعة فاتورة من قائمة المبيعات): تُفتح في نافذة مخفية وتُطبع منها.
// كل نافذة مخفية تُغلق بعد آخر نسخة تطبعها، أو بعد دقيقة كحد أقصى
const hiddenPrints = new Map(); // webContents.id => { close, timer }

function printFrameUrl(url) {
    const w = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false }
    });
    // نحفظ الرقم الآن: بعد إغلاق النافذة لا يمكن قراءة webContents
    const id = w.webContents.id;
    const entry = { timer: null };
    entry.close = () => {
        clearTimeout(entry.timer);
        hiddenPrints.delete(id);
        if (!w.isDestroyed()) w.destroy();
    };
    entry.timer = setTimeout(entry.close, 60000);
    hiddenPrints.set(id, entry);
    w.on('closed', () => { clearTimeout(entry.timer); hiddenPrints.delete(id); });
    w.loadURL(url.replace(/([?&])embed=1&?/, '$1').replace(/[?&]$/, ''));
}

// الإطار يطلب الطباعة مرة لكل نسخة؛ النافذة المخفية تطبع النسخ بنفسها، فنتجاهل التكرار
const recentFrames = new Map();
ipcMain.on('store-print', e => {
    const contents = e.sender;
    const frame = e.senderFrame;
    if (frame && frame !== contents.mainFrame) {
        const now = Date.now();
        for (const [u, t] of recentFrames) if (now - t > 5000) recentFrames.delete(u);
        if (recentFrames.has(frame.url)) return;
        recentFrames.set(frame.url, now);
        printFrameUrl(frame.url);
        return;
    }
    const hidden = hiddenPrints.get(contents.id);
    if (!hidden) return printContents(contents);
    // النسخ المتتالية تصل خلال ثوانٍ، فنؤجل الإغلاق بعد كل نسخة
    clearTimeout(hidden.timer);
    printContents(contents, () => { hidden.timer = setTimeout(hidden.close, 4000); });
});

ipcMain.on('store-desktop-info', e => {
    e.returnValue = { desktop: true, version: app.getVersion(), silentPrint: settings.silentPrint, printer: settings.printer };
});

async function refreshPrinters() {
    try { printers = win ? await win.webContents.getPrintersAsync() : []; } catch (e) { printers = []; }
    buildMenu();
}

function testPrint() {
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>@page{size:80mm auto;margin:4mm}body{font-family:Tahoma,Arial;font-size:14px;text-align:center}</style></head>
        <body><h3>طباعة تجريبية</h3><p>إذا ظهرت هذه الورقة فالطابعة تعمل مع البرنامج.</p><p>${new Date().toLocaleString('ar-IQ')}</p></body></html>`;
    const close = () => { if (!w.isDestroyed()) w.destroy(); };
    setTimeout(close, 60000);
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    w.webContents.once('did-finish-load', () => printContents(w.webContents, close));
}

// ===== تحديث التطبيق =====
// الصفحات تتحدث وحدها من الموقع. هذا للتطبيق نفسه فقط: نقرأ latest.json من الموقع،
// وإذا كان الإصدار أحدث نعرض رسالة فيها رابط ملف التثبيت الجديد
const UPDATE_URL = APP_BASE + 'desktop/latest.json';
const UPDATE_EVERY = 6 * 60 * 60 * 1000;
let updateShown = '';

const newer = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
};

async function checkForUpdate(manual) {
    let info = null;
    try {
        const res = await net.fetch(UPDATE_URL + '?t=' + Date.now());
        if (res.ok) info = await res.json();
    } catch (e) { }
    if (!win || win.isDestroyed()) return;
    if (!info || !info.version) {
        if (manual) dialog.showMessageBox(win, { type: 'warning', title: 'التحديث', message: 'تعذر البحث عن تحديث', detail: 'تحقق من الإنترنت ثم حاول مرة أخرى.' });
        return;
    }
    if (!newer(info.version, app.getVersion())) {
        if (manual) dialog.showMessageBox(win, { title: 'التحديث', message: 'أنت تستخدم آخر إصدار', detail: 'الإصدار ' + app.getVersion() });
        return;
    }
    // نذكّر مرة واحدة لكل إصدار في كل تشغيل، إلا إذا بحث المستخدم بنفسه
    if (!manual && updateShown === info.version) return;
    updateShown = info.version;
    const hasLink = /^https:\/\//i.test(info.url || '');
    const { response } = await dialog.showMessageBox(win, {
        type: 'info',
        title: 'تحديث جديد',
        message: 'يتوفر إصدار جديد من البرنامج: ' + info.version,
        detail: (info.notes ? info.notes + '\n\n' : '') + (hasLink
            ? 'حمّل ملف التثبيت وشغّله. بياناتك وإعدادات الطابعة تبقى كما هي.'
            : 'تواصل مع المزود للحصول على ملف التثبيت الجديد. بياناتك تبقى كما هي.'),
        buttons: hasLink ? ['تحميل التحديث', 'لاحقًا'] : ['حسنًا'],
        defaultId: 0,
        cancelId: hasLink ? 1 : 0
    });
    if (hasLink && response === 0) shell.openExternal(info.url);
}

// يجلب آخر نسخة من البرنامج من الموقع ويعيد التحميل، دون حذف نسخة العمل بدون إنترنت.
// بيانات المتجر (localStorage) وتسجيل الدخول لا تُمس
async function hardRefresh() {
    if (!win) return;
    if (!net.isOnline()) {
        dialog.showMessageBox(win, { type: 'warning', title: 'التحديث', message: 'لا يوجد اتصال بالإنترنت', detail: 'تحتاج إنترنت لتحميل آخر نسخة من البرنامج.' });
        return;
    }
    try {
        await win.webContents.session.clearCache();
        if (isAppUrl(win.webContents.getURL())) {
            await win.webContents.executeJavaScript(`(async () => {
                const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
                if (!reg) return;
                await reg.update();
                const w = reg.installing || reg.waiting;
                if (w) await new Promise(r => { w.addEventListener('statechange', () => { if (w.state === 'activated' || w.state === 'redundant') r(); }); setTimeout(r, 15000); });
            })()`);
        }
    } catch (e) { }
    const current = win.webContents.getURL();
    if (isAppUrl(current)) win.webContents.reloadIgnoringCache();
    else win.loadURL(APP_URL);
}

// حالة العمل بدون إنترنت على هذا الجهاز، لمعرفة سبب أي مشكلة دون الوصول إليه
async function offlineStatus() {
    if (!win || !isAppUrl(win.webContents.getURL())) return { ready: false, note: 'صفحة البرنامج غير مفتوحة الآن' };
    try {
        return await win.webContents.executeJavaScript(`(async () => {
            const sw = 'serviceWorker' in navigator;
            const reg = sw ? await navigator.serviceWorker.getRegistration() : null;
            let pages = 0, files = 0;
            if (window.caches) for (const k of await caches.keys()) {
                for (const r of await (await caches.open(k)).keys()) (/\.html$/.test(new URL(r.url).pathname) ? pages++ : files++);
            }
            return { sw, active: !!(reg && reg.active), controlled: !!navigator.serviceWorker?.controller, pages, files, build: window.StoreApp ? StoreApp.build : null };
        })()`);
    } catch (e) {
        return { ready: false, note: String(e && e.message || e) };
    }
}

async function showAbout() {
    const st = await offlineStatus();
    const ready = st.active && st.pages >= 3;
    const lines = [
        'الإصدار ' + app.getVersion() + (st.build ? ' — البرنامج ' + st.build : ''),
        '',
        'العمل بدون إنترنت: ' + (ready ? 'جاهز' : 'غير جاهز بعد'),
        st.note ? st.note : `صفحات محفوظة: ${st.pages || 0} — ملفات: ${st.files || 0} — الحفظ ${st.active ? 'مفعّل' : 'غير مفعّل'}${st.controlled ? '' : ' (يكتمل عند إعادة فتح البرنامج)'}`,
        ready ? '' : 'افتح البرنامج والإنترنت متصل واتركه دقيقة، ثم أعد فتحه.',
        '',
        'مجلد البيانات: ' + app.getPath('userData'),
        'IP TECH WORLD'
    ].filter((l, i, a) => l || a[i - 1]);
    dialog.showMessageBox(win, { title: 'حول البرنامج', message: 'إدارة المتجر', detail: lines.join('\n') });
}

// ===== القائمة =====
function buildMenu() {
    const printerItems = [
        { label: 'الطابعة الافتراضية في ويندوز', type: 'radio', checked: !settings.printer, click: () => saveSettings({ printer: '' }) },
        ...printers.map(p => ({ label: p.displayName || p.name, type: 'radio', checked: settings.printer === p.name, click: () => saveSettings({ printer: p.name }) })),
        { type: 'separator' },
        { label: 'تحديث قائمة الطابعات', click: refreshPrinters }
    ];
    const template = [
        {
            label: 'البرنامج',
            submenu: [
                { label: 'الصفحة الرئيسية', accelerator: 'Alt+Home', click: () => win && win.loadURL(APP_BASE + 'home.html') },
                { label: 'الكاشير', accelerator: 'F3', click: () => win && win.loadURL(APP_BASE + 'cashier.html') },
                { type: 'separator' },
                { label: 'إعادة تحميل', accelerator: 'F5', click: () => win && win.webContents.reload() },
                { label: 'تحديث البرنامج من الإنترنت', accelerator: 'Ctrl+F5', click: hardRefresh },
                { label: 'ملء الشاشة', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
                { type: 'separator' },
                { label: 'تشغيل البرنامج مع ويندوز', type: 'checkbox', checked: settings.autoStart, click: item => { saveSettings({ autoStart: item.checked }); applyAutoStart(); } },
                { type: 'separator' },
                { label: 'خروج', accelerator: 'Alt+F4', role: 'quit' }
            ]
        },
        {
            label: 'الطباعة',
            submenu: [
                { label: 'طباعة مباشرة بدون نافذة الطابعة', type: 'checkbox', checked: settings.silentPrint, click: item => saveSettings({ silentPrint: item.checked }) },
                { label: 'الطابعة', submenu: printerItems },
                { type: 'separator' },
                { label: 'طباعة تجريبية', click: testPrint }
            ]
        },
        {
            label: 'عرض',
            submenu: [
                { label: 'تكبير', role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
                { label: 'تصغير', role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
                { label: 'الحجم الأصلي', role: 'resetZoom', accelerator: 'CmdOrCtrl+0' }
            ]
        },
        {
            label: 'مساعدة',
            submenu: [
                { label: 'البحث عن تحديث', click: () => checkForUpdate(true) },
                { label: 'حول البرنامج والعمل بدون إنترنت', click: showAbout }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function applyAutoStart() {
    try { app.setLoginItemSettings({ openAtLogin: !!settings.autoStart }); } catch (e) { }
}

// ===== التشغيل =====
app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
});

app.whenReady().then(() => {
    loadSettings();
    // الكاميرا لماسح الباركود، والنسخ للحافظة، مسموحة لصفحات البرنامج فقط
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
        cb(isAppUrl(details.requestingUrl || wc.getURL()) && ['media', 'clipboard-sanitized-write', 'clipboard-read', 'notifications', 'fullscreen'].includes(permission));
    });
    session.defaultSession.setUserAgent(session.defaultSession.getUserAgent() + ' StoreDesktop/' + app.getVersion());
    buildMenu();
    createWindow();
    refreshPrinters();
    applyAutoStart();
    setTimeout(() => checkForUpdate(false), 15000);
    setInterval(() => checkForUpdate(false), UPDATE_EVERY);
});

// إغلاق النافذة الرئيسية يغلق البرنامج، حتى لو بقيت نافذة طباعة مخفية
app.on('window-all-closed', () => app.quit());
