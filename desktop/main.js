/* main.js — تطبيق ويندوز لبرنامج إدارة المتجر
 *
 * يفتح البرنامج المنشور على الإنترنت داخل نافذة خاصة به، فتصل التحديثات تلقائيًا دون إعادة تثبيت،
 * ويعمل بدون إنترنت بعد أول تشغيل (sw.js يحفظ الصفحات على الجهاز).
 * ما يضيفه التطبيق على المتصفح:
 * - طباعة مباشرة على الطابعة المختارة بدون نافذة الطابعة (preload.js يستبدل window.print)
 * - اختيار الطابعة، والتشغيل مع ويندوز، من قائمة البرنامج
 * - روابط الواتساب والمواقع الخارجية تفتح في المتصفح
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const APP_URL = process.env.STORE_APP_URL || CONFIG.appUrl;
const APP_ORIGIN = new URL(APP_URL).origin;
const APP_BASE = APP_URL.replace(/[^/]*$/, '');

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
    win.once('ready-to-show', () => { win.maximize(); win.show(); });
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

// صفحة داخل إطار (مثل طباعة فاتورة من قائمة المبيعات): تُفتح في نافذة مخفية وتُطبع منها
const hiddenPrints = new Set();
function printFrameUrl(url) {
    const w = new BrowserWindow({
        show: false,
        width: 900,
        height: 1200,
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, additionalArguments: ['--store-hidden-print'] }
    });
    // نحفظ الرقم الآن: بعد إغلاق النافذة لا يمكن قراءة webContents
    const id = w.webContents.id;
    hiddenPrints.add(id);
    const close = () => { hiddenPrints.delete(id); if (!w.isDestroyed()) w.destroy(); };
    setTimeout(close, 60000);
    w.on('closed', () => hiddenPrints.delete(id));
    w.loadURL(url.replace(/([?&])embed=1&?/, '$1').replace(/[?&]$/, ''));
    w._closeAfterPrint = close;
}

// الإطار يطلب الطباعة مرة لكل نسخة؛ النافذة المخفية تطبع النسخ بنفسها، فنتجاهل التكرار
const recentFrames = new Map();
ipcMain.on('store-print', e => {
    const contents = e.sender;
    const frame = e.senderFrame;
    const isMain = frame && frame === contents.mainFrame;
    if (!isMain && frame) {
        const now = Date.now();
        if (now - (recentFrames.get(frame.url) || 0) < 5000) return;
        recentFrames.set(frame.url, now);
        return printFrameUrl(frame.url);
    }
    const owner = BrowserWindow.fromWebContents(contents);
    // النافذة المخفية تُغلق بعد آخر نسخة؛ النسخ المتتالية تصل خلال ثوانٍ
    if (owner && hiddenPrints.has(contents.id)) {
        clearTimeout(owner._closeTimer);
        printContents(contents, () => { owner._closeTimer = setTimeout(() => owner._closeAfterPrint && owner._closeAfterPrint(), 4000); });
        return;
    }
    printContents(contents);
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
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    w.webContents.once('did-finish-load', () => printContents(w.webContents, () => { if (!w.isDestroyed()) w.destroy(); }));
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
                { label: 'حول البرنامج', click: () => dialog.showMessageBox(win, { title: 'حول البرنامج', message: 'إدارة المتجر', detail: 'الإصدار ' + app.getVersion() + '\nIP TECH WORLD' }) },
                { label: 'أدوات المطور', accelerator: 'Ctrl+Shift+I', click: () => win && win.webContents.toggleDevTools() }
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
});

app.on('window-all-closed', () => app.quit());
