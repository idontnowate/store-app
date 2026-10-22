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

    try {
        backfill();
    } catch (err) {
        console.warn('تعذر ربط الفواتير القديمة بالمنتجات:', err);
    }

    window.StoreProducts = { matches, productOf, soldQty, itemName };
})();
