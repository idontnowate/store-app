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
    addLink('apple-touch-icon', 'icons/apple-touch-icon.png');
    addLink('icon', 'icons/icon-192.png', { type: 'image/png' });
    if (!head.querySelector('meta[name="theme-color"]')) {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        m.content = '#0b0c0e';
        head.appendChild(m);
    }

    // حفظ الصفحات على الجهاز (يحتاج https أو localhost)
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(err => console.warn('تعذر تفعيل العمل بدون إنترنت:', err));
        });
    }

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
        const pending = st.pending || 0;
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
