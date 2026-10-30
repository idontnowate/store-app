/* pwa.js — تثبيت البرنامج كتطبيق، وحفظه للعمل بدون إنترنت، ومؤشر الاتصال */
(function () {
    const head = document.head;

    // ملف التطبيق والأيقونات (للتثبيت على الكمبيوتر والموبايل)
    function addLink(rel, href, extra) {
        if (head.querySelector(`link[rel="${rel}"]`)) return;
        const l = document.createElement('link');
        l.rel = rel;
        l.href = href;
        Object.assign(l, extra || {});
        head.appendChild(l);
    }
    addLink('manifest', 'manifest.webmanifest');
    applyStoreName();
    addLink('apple-touch-icon', 'icons/apple-touch-icon.png');
    addLink('icon', 'icons/icon-192.png', { type: 'image/png' });
    if (!head.querySelector('meta[name="theme-color"]')) {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        m.content = '#0b0c0e';
        head.appendChild(m);
    }

    // ===== اسم التطبيق = اسم المتجر =====
    // ملف التطبيق ثابت على الخادم، فنبنيه هنا باسم المتجر المحفوظ على الجهاز.
    // الاسم يُعتمد وقت التثبيت؛ إن تغيّر اسم المتجر بعدها يظهر الجديد بعد إعادة التثبيت.
    function storeName() {
        try {
            const v = JSON.parse(localStorage.getItem('storeSettings') || '{}');
            const n = String(v && v.name || '').trim();
            return n && n !== 'اسم المتجر' ? n.slice(0, 40) : '';
        } catch {
            return '';
        }
    }

    function setMeta(name, content) {
        let m = head.querySelector(`meta[name="${name}"]`);
        if (!m) {
            m = document.createElement('meta');
            m.name = name;
            head.appendChild(m);
        }
        m.content = content;
    }

    function applyStoreName() {
        const name = storeName();
        if (!name) return;
        // آيفون: الاسم تحت الأيقونة عند «إضافة إلى الشاشة الرئيسية»
        setMeta('apple-mobile-web-app-title', name);
        setMeta('application-name', name);
        setMeta('apple-mobile-web-app-capable', 'yes');
        setMeta('mobile-web-app-capable', 'yes');
        // أندرويد والكمبيوتر: ملف التطبيق بالاسم الجديد. المسارات كاملة لأن الملف يُقرأ من عنوان مؤقت
        const base = new URL('./', location.href).href;
        const abs = path => new URL(path, base).href;
        const manifest = {
            id: abs('home.html'),
            name,
            short_name: name.length > 14 ? name.slice(0, 14) : name,
            description: 'الكاشير والمخزن والديون والصندوق والتقارير',
            lang: 'ar',
            dir: 'rtl',
            start_url: abs('home.html'),
            scope: base,
            display: 'standalone',
            background_color: '#0b0c0e',
            theme_color: '#0b0c0e',
            icons: [
                { src: abs('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
                { src: abs('icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
                { src: abs('icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
            ],
            shortcuts: [
                { name: 'الكاشير', url: abs('cashier.html'), icons: [{ src: abs('icons/icon-192.png'), sizes: '192x192' }] },
                { name: 'المخزن', url: abs('inventory.html'), icons: [{ src: abs('icons/icon-192.png'), sizes: '192x192' }] }
            ]
        };
        try {
            const url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
            const link = head.querySelector('link[rel="manifest"]');
            if (link) link.href = url;
        } catch (e) { }
    }

    // حفظ الصفحات على الجهاز (يحتاج https أو localhost)
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(err => console.warn('تعذر تفعيل العمل بدون إنترنت:', err));
        });
    }

    // ===== وصول التحديثات =====
    // رقم نسخة هذه الملفات. يُرفع مع version.json في كل تحديث للبرنامج.
    // إذا وجد الجهاز على الموقع نسخة أحدث من التي فتحها (صفحة محفوظة قديمة) يعرض زر "تحديث الآن"
    const BUILD = 202610340;
    let updateBar = null;

    async function checkVersion() {
        if (navigator.onLine === false || location.protocol === 'file:') return;
        try {
            const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined });
            if (!res.ok) return;
            const remote = Number((await res.json()).build) || 0;
            if (remote > BUILD) showUpdateBar();
            return remote;
        } catch (e) { }
    }

    function showUpdateBar() {
        if (updateBar || !document.body) return;
        updateBar = document.createElement('div');
        updateBar.className = 'update-bar';
        updateBar.setAttribute('role', 'status');
        updateBar.innerHTML = '<span>يتوفر تحديث جديد للبرنامج</span><button type="button">تحديث الآن</button>';
        updateBar.querySelector('button').addEventListener('click', applyUpdate);
        document.body.appendChild(updateBar);
    }

    // نحذف النسخ المحفوظة على الجهاز ونعيد التحميل من الموقع. بيانات المتجر لا تُمس (localStorage)
    async function applyUpdate() {
        const btn = updateBar && updateBar.querySelector('button');
        if (btn) { btn.disabled = true; btn.textContent = 'جارِ التحديث…'; }
        try {
            if (window.StoreSync && StoreSync.flush) await StoreSync.flush(8000);
        } catch (e) { }
        try {
            if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
            const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
            if (reg) await reg.update();
        } catch (e) { }
        location.reload();
    }

    window.addEventListener('load', () => setTimeout(checkVersion, 3000));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
    setInterval(checkVersion, 30 * 60 * 1000);

    // ===== التثبيت =====
    let installEvent = null;
    const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

    window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        installEvent = e;
        window.dispatchEvent(new CustomEvent('appinstallable'));
    });
    window.addEventListener('appinstalled', () => {
        installEvent = null;
        window.dispatchEvent(new CustomEvent('appinstallable'));
    });

    window.StoreApp = {
        build: BUILD,
        checkVersion,
        installed,
        // 'installed' | 'ready' (زر التثبيت يعمل) | 'ios' (من زر المشاركة) | 'unavailable'
        installState() {
            if (installed()) return 'installed';
            if (installEvent) return 'ready';
            if (isIOS) return 'ios';
            return 'unavailable';
        },
        async install() {
            if (!installEvent) return false;
            installEvent.prompt();
            const choice = await installEvent.userChoice;
            installEvent = null;
            window.dispatchEvent(new CustomEvent('appinstallable'));
            return choice.outcome === 'accepted';
        }
    };

    // ===== مؤشر الاتصال =====
    // يظهر فقط عند انقطاع الإنترنت أو وجود تغييرات لم تُرفع، ثم "تمت المزامنة" لثوانٍ
    let pill = null;
    let hideTimer = null;
    let wasPending = false;
    let okUntil = 0;

    function ensurePill() {
        if (pill) return pill;
        pill = document.createElement('div');
        pill.className = 'net-pill';
        pill.setAttribute('role', 'status');
        pill.setAttribute('aria-live', 'polite');
        pill.innerHTML = '<i aria-hidden="true"></i><span></span>';
        document.body.appendChild(pill);
        return pill;
    }

    function update() {
        if (!document.body) return;
        const st = window.StoreSync ? StoreSync.status() : { pending: 0 };
        const offline = navigator.onLine === false;
        // ما يُرفع الآن في الخلفية لا يُعرض؛ نعرض فقط ما تأخر رفعه أو فشل
        const pending = offline ? (st.pending || 0) : (st.failed || 0);
        let text = '';
        let mode = '';

        if (offline) {
            mode = 'offline';
            text = pending > 0
                ? `بدون إنترنت · ${pending} تغيير محفوظ على الجهاز`
                : 'بدون إنترنت · البيع مستمر';
        } else if (pending > 0) {
            mode = 'pending';
            text = `جارِ رفع ${pending} تغيير…`;
        } else if (wasPending) {
            mode = 'ok';
            text = 'تمت المزامنة';
        }
        wasPending = offline || pending > 0;

        if (!mode) {
            // نترك رسالة "تمت المزامنة" حتى تنتهي مدتها
            if (pill && Date.now() >= okUntil) pill.classList.remove('show');
            return;
        }
        clearTimeout(hideTimer);
        const el = ensurePill();
        el.dataset.mode = mode;
        el.querySelector('span').textContent = text;
        requestAnimationFrame(() => el.classList.add('show'));
        if (mode === 'ok') {
            okUntil = Date.now() + 2500;
            hideTimer = setTimeout(() => el.classList.remove('show'), 2500);
        }
    }

    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    window.addEventListener('storesync', () => setTimeout(update, 0));
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update);
    else update();
})();
