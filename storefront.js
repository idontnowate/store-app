/* storefront.js — نشر صفحة المتجر الإلكتروني وجلب طلبات الزبائن (انظر supabase/storefront.sql)
 *
 * عند تفعيل المتجر الإلكتروني (من الإعدادات) ينشر كل جهاز في المتجر نسخة مختصرة من المنتجات
 * كلما تغيّرت: الاسم، الفئة، سعر البيع بالدينار، الصورة، ومتوفر/نفد. لا تُنشر التكلفة ولا الكميات.
 */
(function () {
    // مهلة لكل طلب: اتصال ضعيف لا يُبقي النشر معلقًا
    const timeout = () => (AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined);

    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const SESSION_TOKEN_KEY = 'sb-pxxgydllfustqkpkfiqn-auth-token';
    const CATALOG = SUPABASE_URL + '/rest/v1/store_catalog';
    const ORDERS = SUPABASE_URL + '/rest/v1/store_orders';
    // صور أكبر من هذا لا تُنشر (تبطئ الصفحة على الموبايل)
    const MAX_IMAGE = 250000;
    const CHECK_EVERY = 20000;

    function readJSON(key, fallback) {
        try {
            const v = JSON.parse(localStorage.getItem(key));
            return v ?? fallback;
        } catch {
            return fallback;
        }
    }

    const list = key => {
        const v = readJSON(key, []);
        return Array.isArray(v) ? v : [];
    };

    function storeId() {
        const m = readJSON('appMembership', null);
        return m && m.store_id ? m.store_id : null;
    }

    function token() {
        const s = readJSON(SESSION_TOKEN_KEY, null);
        return s && s.access_token ? s.access_token : null;
    }

    function options() {
        return readJSON('storeOptions', {}) || {};
    }

    function headers(extra) {
        const t = token();
        return { apikey: KEY, Authorization: 'Bearer ' + (t || KEY), 'Content-Type': 'application/json', ...(extra || {}) };
    }

    // ===== الرابط =====
    function shopUrl(slug) {
        const base = location.href.replace(/[^/]*([?#].*)?$/, '');
        return base + 'shop.html?s=' + encodeURIComponent(slug || storeId() || '');
    }

    const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,39}$/;

    // ===== النسخة المنشورة =====
    function snapshot() {
        const info = { name: '', phone: '', address: '', logo: '', ...readJSON('storeSettings', {}) };
        const products = list('storeProducts');
        const invoices = list('storeInvoices');
        const adjustments = list('storeStockAdjustments');
        const allowNegative = !!options().allowNegativeStock;
        const rate = window.StoreProducts ? StoreProducts.usdRate() : null;

        // المباع لكل منتج في مرور واحد على الفواتير
        const sold = new Map();
        const byName = new Map(products.map(p => [String(p.name || '').trim(), p.id]));
        invoices.forEach(inv => (inv.items || []).forEach(it => {
            const id = it.productId || byName.get(String(it.description || it.category || '').trim());
            if (id) sold.set(id, (sold.get(id) || 0) + Number(it.qty || 0));
        }));
        const adjusted = new Map();
        adjustments.forEach(a => adjusted.set(a.productId, (adjusted.get(a.productId) || 0) + Number(a.change || 0)));

        const items = products
            .map(p => {
                const price = window.StoreProducts ? StoreProducts.priceIQD(p, rate) : Number(p.price || 0);
                if (!(price > 0)) return null;
                const qty = Number(p.openingQty || 0) + (adjusted.get(p.id) || 0) - (sold.get(p.id) || 0);
                const img = typeof p.image === 'string' && p.image.length <= MAX_IMAGE ? p.image : '';
                return {
                    id: p.id,
                    name: String(p.name || ''),
                    category: String(p.category || ''),
                    price,
                    image: img,
                    available: allowNegative || qty > 0
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.category.localeCompare(b.category, 'ar') || a.name.localeCompare(b.name, 'ar'));

        return {
            v: 1,
            name: String(info.name || ''),
            phone: String(info.phone || ''),
            address: info.address && info.address !== 'المدينة - الشارع' ? String(info.address) : '',
            logo: typeof info.logo === 'string' && info.logo.length <= MAX_IMAGE ? info.logo : '',
            products: items
        };
    }

    function hash(text) {
        let h = 5381;
        for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
        return (h >>> 0).toString(36) + ':' + text.length;
    }

    const hashKey = sid => 'appShopHash_' + sid;

    let publishing = false;

    // ينشر إذا تغيّرت المنتجات أو الأسعار منذ آخر نشر من هذا الجهاز. force: ينشر دائمًا
    async function publish(force) {
        const sid = storeId();
        const o = options();
        if (!sid || !o.shopEnabled || !token() || publishing || navigator.onLine === false) return false;
        const data = snapshot();
        const json = JSON.stringify(data);
        const h = hash(json);
        if (!force && localStorage.getItem(hashKey(sid)) === h) return false;

        publishing = true;
        try {
            const res = await fetch(CATALOG + '?store_id=eq.' + encodeURIComponent(sid), {
                signal: timeout(),
                method: 'PATCH',
                headers: headers({ Prefer: 'return=representation' }),
                body: JSON.stringify({ data }),
                keepalive: json.length < 60000
            });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const rows = await res.json();
            if (!rows.length) return false; // لم يُفعَّل على الخادم بعد
            localStorage.setItem(hashKey(sid), h);
            localStorage.setItem('appShopPublished_' + sid, new Date().toISOString());
            return true;
        } catch (err) {
            console.warn('تعذر نشر المتجر الإلكتروني:', err);
            return false;
        } finally {
            publishing = false;
        }
    }

    // تفعيل أو إيقاف المتجر وتغيير رابطه (للمدير). يرمي خطأ برسالة مفهومة
    async function configure({ enabled, slug }) {
        const sid = storeId();
        if (!sid || !token()) throw new Error('سجّل الدخول من جديد');
        slug = String(slug || '').trim().toLowerCase();
        if (slug && !SLUG_RE.test(slug)) {
            throw new Error('الرابط من 3 إلى 40 حرفًا إنجليزيًا صغيرًا أو رقمًا أو شرطة (-)، ويبدأ بحرف أو رقم');
        }
        const body = { store_id: sid, enabled: !!enabled, slug: slug || null, data: snapshot() };
        const res = await fetch(CATALOG + '?on_conflict=store_id', {
            signal: timeout(),
            method: 'POST',
            headers: headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
            body: JSON.stringify(body)
        }).catch(() => null);
        if (!res) throw new Error('تعذر الاتصال بالخادم. تحقق من الإنترنت');
        if (!res.ok) {
            const text = await res.text();
            if (res.status === 409 || /23505|duplicate/.test(text)) throw new Error('هذا الرابط مستخدم لمتجر آخر، اختر غيره');
            if (/store_catalog|relation|does not exist|42P01|PGRST20/.test(text)) throw new Error('شغّل الملف supabase/storefront.sql في Supabase أولًا');
            if (res.status === 401 || res.status === 403) throw new Error('هذا الإعداد للمدير فقط');
            throw new Error('تعذر حفظ إعدادات المتجر الإلكتروني');
        }
        localStorage.setItem(hashKey(sid), hash(JSON.stringify(body.data)));
        localStorage.setItem('appShopPublished_' + sid, new Date().toISOString());
        return { slug: slug || null, url: shopUrl(slug) };
    }

    // ===== الطلبات =====
    async function request(url, init) {
        const res = await fetch(url, { signal: timeout(), ...init, headers: headers(init && init.headers) }).catch(() => null);
        if (!res) throw new Error('تعذر الاتصال بالخادم. تحقق من الإنترنت');
        if (!res.ok) {
            const text = await res.text();
            if (/store_orders|relation|does not exist|42P01|PGRST20/.test(text)) throw new Error('شغّل الملف supabase/storefront.sql في Supabase أولًا');
            throw new Error('تعذر تحميل الطلبات');
        }
        return res.status === 204 ? null : res.json();
    }

    function orders(status) {
        const sid = storeId();
        if (!sid) return Promise.resolve([]);
        let url = ORDERS + '?store_id=eq.' + encodeURIComponent(sid) + '&order=created_at.desc&limit=200';
        if (status) url += '&status=eq.' + encodeURIComponent(status);
        return request(url);
    }

    function setStatus(id, status) {
        return request(ORDERS + '?id=eq.' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ status })
        });
    }

    async function newOrdersCount() {
        if (!options().shopEnabled || navigator.onLine === false) return 0;
        try {
            return (await orders('new')).length;
        } catch {
            return 0;
        }
    }

    // ===== النشر التلقائي =====
    let timer = null;
    function schedule(delay) {
        clearTimeout(timer);
        timer = setTimeout(() => publish(false), delay);
    }

    if (storeId()) {
        // تغيير المنتجات أو المبيعات في هذه الصفحة نفسها (حدث storage يصل من الصفحات الأخرى فقط)
        const WATCH = /^store(Products|Invoices|StockAdjustments|Settings|Options|ExchangeRates)$/;
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            set.call(this, key, value);
            if (this === localStorage && WATCH.test(key) && options().shopEnabled) schedule(3000);
        };
        window.addEventListener('load', () => schedule(2500));
        window.addEventListener('storage', e => {
            if (!e.key || WATCH.test(e.key)) schedule(4000);
        });
        window.addEventListener('online', () => schedule(3000));
        // سعر صرف جديد من المزود يغيّر أسعار منتجات الدولار
        window.addEventListener('marketrates', () => schedule(3000));
        document.addEventListener('visibilitychange', () => { if (document.hidden) publish(false); });
        setInterval(() => { if (!document.hidden) publish(false); }, CHECK_EVERY);
    }

    window.StoreShop = {
        SLUG_RE,
        shopUrl,
        snapshot,
        publish,
        configure,
        orders,
        setStatus,
        newOrdersCount,
        lastPublished: () => localStorage.getItem('appShopPublished_' + storeId())
    };
})();
