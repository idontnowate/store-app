/* theme.js — الوضع الداكن واللغة. الألوان والتنسيق في design.css */
(function () {
    // لوحة المزود لها مظهرها الخاص، منفصل عن مظهر المتجر على نفس الجهاز
    const PREFS_KEY = /(^|\/)provider\.html$/i.test(location.pathname) ? 'providerPrefs' : 'storePrefs';
    // إعدادات خاصة بهذا الجهاز (لا تُزامن): المظهر، اللغة، الحركة، الطباعة
    const DEFAULTS = { theme: 'dark', lang: 'ar', motion: 'on', autoPrint: true, receiptWidth: '80' };
    const REDUCED = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

    // القاموس في i18n-en.js
    const I18N = window.STORE_I18N_EN || { TEXT: {}, NOUNS: {}, PATTERNS: [] };
    const AR = /[\u0600-\u06FF]/;

    function getPrefs() {
        try {
            return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
        } catch {
            return { ...DEFAULTS };
        }
    }

    // الحركة متوقفة إذا أوقفها المستخدم أو طلب الجهاز تقليل الحركة
    function motionOff(p) {
        return (p || getPrefs()).motion === 'off' || REDUCED.matches;
    }

    // «زجاج» (glass.css) مبني على ألوان الوضع الداكن، و«زجاجي ملوّن» (aurora.css) مبني على الزجاج
    function applyRoot(p) {
        const root = document.documentElement;
        const aurora = p.theme === 'aurora';
        const glass = p.theme === 'glass' || aurora;
        root.dataset.theme = glass ? 'dark' : p.theme;
        root.dataset.glass = glass ? 'on' : 'off';
        root.dataset.aurora = aurora ? 'on' : 'off';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = aurora ? '#070912' : glass ? '#161618' : '#0b0c0e';
        root.dataset.motion = p.motion === 'off' ? 'off' : 'on';
        root.lang = p.lang;
        root.dir = p.lang === 'en' ? 'ltr' : 'rtl';
    }

    // الانتقال بين الصفحات: لا حركة إذا كانت متوقفة
    ['pageswap', 'pagereveal'].forEach(type => {
        window.addEventListener(type, e => {
            if (e.viewTransition && motionOff()) e.viewTransition.skipTransition();
        });
    });

    // ===== الترجمة =====
    const originalText = new WeakMap();
    const originalAttr = new WeakMap();
    const ATTRS = ['placeholder', 'title', 'aria-label'];
    let originalTitle = null;

    function currency(text) {
        return text.replace(/د\.ع/g, 'IQD');
    }

    // جزء ملتقط من نمط: يُترجم إن كان كلمة معروفة، وإلا يبقى كما هو
    function part(text) {
        if (text == null) return '';
        const t = text.trim();
        return I18N.NOUNS[t] ?? I18N.TEXT[t] ?? currency(t);
    }

    // يعيد الترجمة الإنجليزية لنص عربي، أو null إن لم توجد
    function lookup(key) {
        if (!key || !AR.test(key)) return null;
        if (I18N.TEXT[key] != null) return I18N.TEXT[key];

        const colon = key.match(/^(.+?)\s*:$/);
        if (colon && I18N.TEXT[colon[1]] != null) return I18N.TEXT[colon[1]] + ':';

        for (const [re, tpl] of I18N.PATTERNS) {
            const m = key.match(re);
            if (m) return tpl.replace(/\{(\d)\}/g, (_, i) => part(m[Number(i)])).replace(/\s{2,}/g, ' ').trim();
        }

        // مبالغ مثل "76,000 د.ع"
        const money = currency(key);
        if (money !== key && !AR.test(money)) return money;
        return null;
    }

    function tr(text, lang) {
        if (lang !== 'en' || typeof text !== 'string') return text;
        const key = text.trim();
        // النص قد يمتد على عدة أسطر في الصفحة؛ نطابقه بعد توحيد المسافات
        const out = lookup(key.replace(/\s+/g, ' '));
        if (out != null) return text.replace(key, out);
        // مبلغ داخل نص غير مترجم، مثل: اسم الزبون (19,000 د.ع)
        return text.replace(/(\d[\d,.]*)\s*د\.ع/g, '$1 IQD');
    }

    function translate(root, lang) {
        if (!root) return;

        const nodes = [];
        if (root.nodeType === Node.TEXT_NODE) nodes.push(root);
        else {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) nodes.push(walker.currentNode);
        }

        nodes.forEach(node => {
            const parent = node.parentNode;
            if (!parent || /^(SCRIPT|STYLE|TEXTAREA)$/.test(parent.nodeName)) return;

            if (!originalText.has(node)) originalText.set(node, node.nodeValue);
            const orig = originalText.get(node);

            // خيار بلا value تؤخذ قيمته من نصه: نثبّت القيمة العربية حتى لا تتغير البيانات المحفوظة
            if (parent.nodeName === 'OPTION' && !parent.hasAttribute('value')) {
                parent.setAttribute('value', orig.trim());
            }

            const next = tr(orig, lang);
            if (node.nodeValue !== next) node.nodeValue = next;
        });

        if (!root.querySelectorAll) return;
        const els = root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(','));
        [root, ...els].forEach(el => {
            if (!el.getAttribute) return;
            ATTRS.forEach(attr => {
                if (!el.hasAttribute(attr)) return;
                let saved = originalAttr.get(el);
                if (!saved) originalAttr.set(el, saved = {});
                if (!(attr in saved)) saved[attr] = el.getAttribute(attr);
                const next = tr(saved[attr], lang);
                if (el.getAttribute(attr) !== next) el.setAttribute(attr, next);
            });
        });

        if (originalTitle === null) originalTitle = document.title;
        const title = tr(originalTitle, lang);
        if (document.title !== title) document.title = title;
    }

    // ===== إخفاء عناوين الروابط =====
    // المتصفح يعرض عنوان أي رابط أسفل الشاشة عند المرور عليه. ننقل العنوان من href إلى data-href
    // ونتنقل بالكود، فلا يظهر شيء. (شريط العنوان أعلى المتصفح يبقى كما هو في كل المواقع)
    function hideLinks(root) {
        if (!root || !root.querySelectorAll) return;
        const links = [...root.querySelectorAll('a[href]')];
        if (root.matches && root.matches('a[href]')) links.push(root);
        links.forEach(a => {
            const href = a.getAttribute('href');
            if (!href || a.hasAttribute('download') || a.target || /^(https?:|mailto:|tel:|blob:|data:|javascript:)/i.test(href)) return;
            a.dataset.href = href;
            a.removeAttribute('href');
            a.setAttribute('role', 'link');
            if (!a.hasAttribute('tabindex')) a.tabIndex = 0;
        });
    }

    function follow(a, newTab) {
        const href = a.dataset.href;
        if (href.startsWith('#') && !newTab) return; // الصفحة تتولى روابط الأقسام
        if (newTab) window.open(href, '_blank');
        else location.href = href;
    }

    document.addEventListener('click', e => {
        const a = e.target.closest && e.target.closest('a[data-href]');
        if (!a || e.defaultPrevented) return;
        e.preventDefault();
        follow(a, e.ctrlKey || e.metaKey || e.shiftKey);
    });
    document.addEventListener('auxclick', e => {
        const a = e.button === 1 && e.target.closest && e.target.closest('a[data-href]');
        if (a) {
            e.preventDefault();
            follow(a, true);
        }
    });
    document.addEventListener('keydown', e => {
        const a = e.key === 'Enter' && e.target.closest && e.target.closest('a[data-href]');
        if (a) {
            e.preventDefault();
            follow(a, false);
        }
    });

    // رسائل التأكيد والتنبيه تظهر بلغة الواجهة
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    window.alert = msg => nativeAlert(tr(String(msg ?? ''), getPrefs().lang));
    window.confirm = msg => nativeConfirm(tr(String(msg ?? ''), getPrefs().lang));

    // نعالج ما أُضيف إلى الصفحة فقط، لا الصفحة كلها مع كل تغيير، حتى لا تبطؤ الجداول الكبيرة
    const observer = new MutationObserver(mutations => {
        const lang = getPrefs().lang;
        const added = new Set();
        mutations.forEach(m => m.addedNodes.forEach(n => {
            if (n.isConnected && (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE)) added.add(n);
        }));
        added.forEach(n => {
            // داخل عنصر أُضيف هو الآخر: يُعالج معه
            for (let a = n.parentNode; a; a = a.parentNode) if (added.has(a)) return;
            if (lang === 'en') translate(n, lang);
            if (n.nodeType === Node.ELEMENT_NODE) hideLinks(n);
        });
    });

    function init() {
        const p = getPrefs();
        applyRoot(p);
        translate(document.body, p.lang);
        hideLinks(document.body);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // آخر نقطة ضغط: منها تنتشر دائرة المظهر الجديد
    let lastPoint = null;
    document.addEventListener('pointerdown', e => { lastPoint = { x: e.clientX, y: e.clientY }; }, true);

    // origin: نقطة بداية الدائرة {x, y}؛ بدونها آخر نقطة ضغط، أو وسط أعلى الشاشة
    function setPrefs(changes, origin) {
        const prev = getPrefs();
        const next = { ...prev, ...changes };
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));

        const apply = () => {
            applyRoot(next);
            translate(document.body, next.lang);
        };
        const visual = prev.theme !== next.theme || prev.lang !== next.lang;
        if (!visual || !document.startViewTransition || motionOff(next)) return apply();

        // تغيير المظهر: المظهر الجديد ينتشر بدائرة من نقطة الضغط. اللغة: تلاشٍ ناعم
        const root = document.documentElement;
        const circle = prev.theme !== next.theme;
        if (circle) {
            const p = origin || lastPoint || { x: innerWidth / 2, y: 0 };
            const r = Math.hypot(Math.max(p.x, innerWidth - p.x), Math.max(p.y, innerHeight - p.y));
            root.style.setProperty('--vt-x', p.x + 'px');
            root.style.setProperty('--vt-y', p.y + 'px');
            root.style.setProperty('--vt-r', Math.ceil(r) + 'px');
            root.classList.add('vt-circle');
        }
        const vt = document.startViewTransition(apply);
        vt.finished.finally(() => root.classList.remove('vt-circle'));
    }

    // زر التبديل السريع بين الفاتح والداكن: يعود للمظهر الداكن الذي اختاره المستخدم آخر مرة (داكن، زجاج، زجاجي ملوّن)
    function toggleTheme(origin) {
        const p = getPrefs();
        const dark = p.theme !== 'light';
        setPrefs(dark ? { theme: 'light', darkTheme: p.theme } : { theme: p.darkTheme || 'dark' }, origin);
    }

    // هل يدعم المتصفح الضبابية؟ (بدونها يظهر الزجاج بطبقات معتمة)، وتقدير قوة الجهاز
    function glassSupport() {
        const blur = !!(window.CSS && CSS.supports && (CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')));
        const memory = navigator.deviceMemory || null;
        const cores = navigator.hardwareConcurrency || null;
        const weak = (memory !== null && memory < 4) || (cores !== null && cores < 4);
        return { blur, weak };
    }

    window.StoreTheme = { get: getPrefs, set: setPrefs, toggle: toggleTheme, motionOff, glassSupport };

    applyRoot(getPrefs());
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
