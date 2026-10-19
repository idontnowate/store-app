/* scanbridge.js — يستقبل الباركود المرسل من الهاتف ويضعه في خانة الباركود المفتوحة */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const API = SUPABASE_URL + '/rest/v1/kv_store';
    const headers = { apikey: KEY, Authorization: 'Bearer ' + KEY };
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

    async function poll() {
        if (document.hidden || busy) return;
        busy = true;
        try {
            const res = await fetch(`${API}?key=like.scan-*&select=key,value&order=updated_at.asc`, { headers });
            if (!res.ok) return;
            const rows = await res.json();
            for (const r of rows) {
                await fetch(`${API}?key=eq.${encodeURIComponent(r.key)}`, { method: 'DELETE', headers });
                deliver(String(r.value));
            }
        } catch (err) {
            console.warn('تعذر استقبال المسح من الهاتف:', err);
        } finally {
            busy = false;
        }
    }

    setInterval(poll, 1000);
})();