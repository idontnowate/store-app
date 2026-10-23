/* products.js — ربط أصناف الفواتير بالمنتجات برقم المنتج (productId) لا باسمه،
 * حتى لا يضيع حساب المخزون عند تغيير اسم منتج.
 * الأصناف القديمة التي لا تحمل productId تُربط مرة واحدة بالمنتج المطابق لاسمها.
 */
(function () {
    const INVOICES_KEY = 'storeInvoices';
    const PRODUCTS_KEY = 'storeProducts';

    function read(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    }

    // الاسم المكتوب في سطر الفاتورة
    function itemName(it) {
        return String(it.description || it.category || '').trim();
    }

    function productName(p) {
        return String(p.name || '').trim();
    }

    // هل هذا السطر من هذا المنتج؟
    function matches(item, product) {
        if (!item || !product) return false;
        if (item.productId) return item.productId === product.id;
        return itemName(item) === productName(product);
    }

    // المنتج الذي يعود له السطر، أو null
    function productOf(item, products) {
        if (!item) return null;
        if (item.productId) return products.find(p => p.id === item.productId) || null;
        const name = itemName(item);
        return products.find(p => productName(p) === name) || null;
    }

    // الكمية المباعة من المنتج في قائمة فواتير
    function soldQty(product, invoices) {
        return (invoices || []).reduce((s, inv) => {
            if (!Array.isArray(inv.items)) return s;
            return s + inv.items
                .filter(it => matches(it, product))
                .reduce((x, it) => x + Number(it.qty || 0), 0);
        }, 0);
    }

    // ترحيل لمرة واحدة: إضافة productId للأصناف القديمة حسب الاسم
    function backfill() {
        const products = read(PRODUCTS_KEY);
        if (!products.length) return;
        const byName = new Map(products.map(p => [productName(p), p.id]));

        const invoices = read(INVOICES_KEY);
        let changed = false;
        invoices.forEach(inv => {
            (inv.items || []).forEach(it => {
                if (it.productId) return;
                const id = byName.get(itemName(it));
                if (id) {
                    it.productId = id;
                    changed = true;
                }
            });
        });
        if (changed) localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices));
    }

    // ===== الدولار =====
    // منتج سعره بالدولار: currency = 'USD' وسعر البيع والتكلفة بالدولار.
    // يُحوَّل للدينار عند البيع بسعر الصرف المعتمد، وتُحفظ الفاتورة بالدينار مع سعر الصرف.
    const RATES_KEY = 'storeExchangeRates';
    const OPTIONS_KEY = 'storeOptions';
    // سعر البيع بالدينار يُقرَّب للأعلى لأقرب 250
    const ROUND_IQD = 250;

    function options() {
        try {
            return JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}') || {};
        } catch {
            return {};
        }
    }

    // سعر الدولار المعتمد: الثابت من الإعدادات، أو آخر سعر بيع مسجل في السوق المختار
    function usdRate() {
        const o = options();
        const fixed = Number(o.usdFixed || 0);
        if (fixed > 0) return { rate: fixed, date: '', source: 'fixed' };
        const market = o.usdMarket || 'baghdad';
        const entries = read(RATES_KEY).sort((a, b) =>
            (b.date || '').localeCompare(a.date || '') ||
            (b.time || '').localeCompare(a.time || '') ||
            (b.created || 0) - (a.created || 0));
        for (const e of entries) {
            const r = e.rates && e.rates[market];
            const v = r ? (r.sell ?? r.buy) : null;
            if (v > 0) return { rate: Number(v), date: e.date || '', source: market };
            // النسخة الأقدم من صفحة سعر الصرف: { rate }
            if (!e.rates && Number(e.rate) > 0 && market === 'baghdad') return { rate: Number(e.rate), date: e.date || '', source: market };
        }
        return null;
    }

    const isUSD = p => !!p && p.currency === 'USD';

    // سعر البيع بالدينار، أو null إذا كان بالدولار ولا يوجد سعر صرف
    function priceIQD(p, rateInfo) {
        if (!isUSD(p)) return Number(p.price || 0);
        const r = rateInfo === undefined ? usdRate() : rateInfo;
        if (!r) return null;
        return Math.ceil(Number(p.price || 0) * r.rate / ROUND_IQD) * ROUND_IQD;
    }

    // التكلفة بالدينار (بدون تقريب)؛ منتج بالدولار بلا سعر صرف تُحسب تكلفته صفرًا
    function costIQD(p, rateInfo) {
        if (!p) return 0;
        if (!isUSD(p)) return Number(p.cost || 0);
        const r = rateInfo === undefined ? usdRate() : rateInfo;
        return r ? Number(p.cost || 0) * r.rate : 0;
    }

    // تكلفة سطر فاتورة: المحفوظة وقت البيع، وإلا تكلفة المنتج الحالية
    function itemCost(item, products, rateInfo) {
        if (item && item.cost !== undefined && item.cost !== null && item.cost !== '') return Number(item.cost) * Number(item.qty || 0);
        return costIQD(productOf(item, products), rateInfo) * Number(item && item.qty || 0);
    }

    function fmtUSD(n) {
        const v = Number(n || 0);
        return '$' + v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
    }

    try {
        backfill();
    } catch (err) {
        console.warn('تعذر ربط الفواتير القديمة بالمنتجات:', err);
    }

    window.StoreProducts = { matches, productOf, soldQty, itemName, usdRate, isUSD, priceIQD, costIQD, itemCost, fmtUSD };
})();
