/* storage.js — يزامن بيانات المتجر (localStorage) مع Supabase */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const API = SUPABASE_URL + '/rest/v1/kv_store';
    const HEADERS = {
        apikey: KEY,
        Authorization: 'Bearer ' + KEY,
        'Content-Type': 'application/json'
    };

    // الجلسة تبقى محلية لكل جهاز، ولا تُرفع
    const isSyncKey = k => typeof k === 'string' && k.startsWith('store') && k !== 'storeSession';

    // ===== 1) سحب البيانات من السحابة قبل تحميل الصفحة =====
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', API + '?select=key,value', false); // طلب متزامن ليصل قبل سكربتات الصفحة
        xhr.setRequestHeader('apikey', KEY);
        xhr.setRequestHeader('Authorization', 'Bearer ' + KEY);
        xhr.send();

        if (xhr.status === 200) {
            const rows = JSON.parse(xhr.responseText);
            const remoteKeys = new Set(rows.map(r => r.key));

            if (rows.length === 0) {
                // أول مرة: نرفع البيانات المحلية الموجودة إلى السحابة
                Object.keys(localStorage).filter(isSyncKey).forEach(k => {
                    pushOne(k, localStorage.getItem(k));
                });
            } else {
                // السحابة هي المصدر الأساسي: نحدّث المحلي ونحذف ما حُذف من السحابة
                Object.keys(localStorage).filter(isSyncKey).forEach(k => {
                    if (!remoteKeys.has(k)) localStorage.removeItem(k);
                });
                rows.forEach(r => originalSet.call(localStorage, r.key, r.value));
            }
        }
    } catch (err) {
        console.warn('تعذر الاتصال بالسحابة، سيعمل المتجر بالبيانات المحلية:', err);
    }

    // ===== 2) رفع التغييرات تلقائيًا =====
    function pushOne(key, value) {
        fetch(API + '?on_conflict=key', {
            method: 'POST',
            headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
        }).catch(() => { });
    }

    function removeOne(key) {
        fetch(API + '?key=eq.' + encodeURIComponent(key), {
            method: 'DELETE',
            headers: HEADERS
        }).catch(() => { });
    }

    // نحتفظ بالدوال الأصلية، ثم نضيف الرفع بعد كل حفظ أو حذف
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;

    Storage.prototype.setItem = function (key, value) {
        originalSet.call(this, key, value);
        if (this === localStorage && isSyncKey(key)) pushOne(key, String(value));
    };

    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        if (this === localStorage && isSyncKey(key)) removeOne(key);
    };
})();