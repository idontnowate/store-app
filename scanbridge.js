/* scanbridge.js — يستقبل الباركود المرسل من الهاتف ويضعه في خانة الباركود المفتوحة */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const API = SUPABASE_URL + '/rest/v1/kv_store';
    const SELECTOR = '#barcodeInput, #barcodeField, input[name="barcode"]';

    let lastTarget = null;
    let busy = false;

    function isTarget(el) {
        return !!el && el.matches && el.matches(SELECTOR) && !el.disabled;
    }

    // نتذكر آخر خانة باركود اختارها المستخدم على الكمبيوتر
    document.addEventListener('focusin', e => {
        if (isTarget(e.target)) lastTarget = e.target;
    });

    function findTarget() {
        if (isTarget(document.activeElement)) return document.activeElement;
        if (isTarget(lastTarget) && document.contains(lastTarget)) return lastTarget;
        return [...document.querySelectorAll(SELECTOR)].find(el => !el.disabled && el.offsetParent !== null) || null;
    }

    function deliver(code) {
        const target = findTarget();
        if (!target) {
            alert('لا توجد خانة باركود مفتوحة. افتح الفاتورة أو الصفحة أولا ثم امسح مجددا.');
            return;
        }
        target.focus();
        target.value = code;
        // نحاكي الماسح: Enter يشغّل نفس المنطق الموجود في الصفحة
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }

    // نتصل بجلسة المستخدم (لا بالمفتاح العام) وبمتجره فقط، حتى لا يقرأ أحد مسح متجر آخر
    async function context() {
        if (!window.StoreAuth) return null;
        const user = StoreAuth.currentUser();
        const session = await StoreAuth.getSession();
        if (!user || !user.store_id || !session) return null;
        return {
            store: 'store_id=eq.' + encodeURIComponent(user.store_id),
            headers: { apikey: KEY, Authorization: 'Bearer ' + session.access_token }
        };
    }

    async function poll() {
        if (document.hidden || busy) return;
        busy = true;
        try {
            const ctx = await context();
            if (!ctx) return;
            const res = await fetch(`${API}?${ctx.store}&key=like.scan-*&select=key,value&order=updated_at.asc`, { headers: ctx.headers });
            if (!res.ok) return;
            const rows = await res.json();
            for (const r of rows) {
                const del = await fetch(`${API}?${ctx.store}&key=eq.${encodeURIComponent(r.key)}`, {
                    method: 'DELETE',
                    headers: { ...ctx.headers, Prefer: 'return=representation' }
                });
                // لا نسلّم المسح إلا إذا حذفناه نحن، حتى لا يُضاف مرتين على جهازين
                if (del.ok && (await del.json()).length) deliver(String(r.value));
            }
        } catch (err) {
            console.warn('تعذر استقبال المسح من الهاتف:', err);
        } finally {
            busy = false;
        }
    }

    if (window.StoreAuth) StoreAuth.ready.then(ok => { if (ok) setInterval(poll, 1500); });
})();
