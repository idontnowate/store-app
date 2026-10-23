/* sw.js — يحفظ صفحات البرنامج وملفاته على الجهاز ليعمل بدون إنترنت
 *
 * - الصفحات: من الشبكة أولًا (لتصل التحديثات فورًا)، ومن النسخة المحفوظة عند انقطاع الإنترنت.
 * - ملفات js و css: كل نسخة (?v=) تُحفظ باسمها، فلا تختلط ملفات قديمة بصفحة جديدة.
 * - المكتبات والخطوط من الإنترنت تُحفظ عند أول تحميل.
 * - طلبات Supabase (البيانات وتسجيل الدخول) لا تمر من هنا؛ المزامنة تتكفل بها.
 */
const CACHE = 'store-app-v1';
const PAGES = [
    'index.html', 'home.html', 'cashier.html', 'sales-new_1.html', 'add-invoice.html',
    'inventory.html', 'purchases.html', 'debts.html', 'cashbox.html', 'reports.html',
    'users.html', 'log.html', 'settings.html', 'exchange-rate.html', 'scanner.html',
    'expired.html', 'terms.html'
];
const EXTRA = [
    'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
    'vendor/supabase-js-2.45.4.js',
    'vendor/html5-qrcode-2.3.8.min.js'
];
// إعادة حفظ كل الصفحات بعد التحديث، مرة كل ساعة على الأكثر
const REFRESH_EVERY = 60 * 60 * 1000;
let lastPrecache = 0;

const NO_CACHE_HOSTS = /\.supabase\.co$/;

// يحفظ الصفحات مع ملفات js و css التي تطلبها كل صفحة (بنفس رقم النسخة)
async function precache() {
    lastPrecache = Date.now();
    const cache = await caches.open(CACHE);
    const assets = new Set(EXTRA);
    await Promise.all(PAGES.map(async page => {
        try {
            const res = await fetch(page, { cache: 'no-cache' });
            if (!res.ok) return;
            const html = await res.clone().text();
            await cache.put(page, res);
            for (const m of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css)(?:\?[^"]*)?)"/g)) assets.add(m[1]);
        } catch (e) { }
    }));
    await Promise.all([...assets].map(async url => {
        try {
            if (await cache.match(url)) return;
            const res = await fetch(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' });
            if (res.ok) await cache.put(url, res);
        } catch (e) { }
    }));
}

self.addEventListener('install', e => {
    e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
        await self.clients.claim();
    })());
});

// الصفحة: من الشبكة، وإن تأخرت أكثر من 4 ثوانٍ أو انقطعت نعرض المحفوظة
async function page(req) {
    const cache = await caches.open(CACHE);
    const url = new URL(req.url);
    const name = url.pathname.split('/').pop() || 'index.html';
    const network = fetch(req).then(res => {
        if (res.ok) {
            cache.put(name, res.clone());
            if (Date.now() - lastPrecache > REFRESH_EVERY) precache();
        }
        return res;
    });
    const saved = await cache.match(name);
    if (!saved) return network.catch(() => cache.match('index.html'));
    const timeout = new Promise(resolve => setTimeout(() => resolve(saved), 4000));
    return Promise.race([network.catch(() => saved), timeout]);
}

// الملفات: المحفوظة أولًا بنفس رقم النسخة، ثم الشبكة، ثم أي نسخة محفوظة من نفس الملف
async function asset(req) {
    const cache = await caches.open(CACHE);
    const exact = await cache.match(req);
    if (exact) return exact;
    try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
    } catch (err) {
        const any = await cache.match(req, { ignoreSearch: true });
        if (any) return any;
        throw err;
    }
}

self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (NO_CACHE_HOSTS.test(url.hostname)) return;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

    if (req.mode === 'navigate') {
        e.respondWith(page(req));
    } else if (url.origin === location.origin || /fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$|cdnjs\.cloudflare\.com$/.test(url.hostname)) {
        e.respondWith(asset(req));
    }
});
