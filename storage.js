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

    // نحتفظ بالدوال الأصلية أولًا قبل أي استخدام
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;

    const isSyncKey = k => typeof k === 'string' && k.startsWith('store') && k !== 'storeSession';

    function pushOne(key, value) {
        fetch(API + '?on_conflict=key', {
            method: 'POST',
            headers: { ...HEADERS, Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
        }).catch(err => console.warn('فشل رفع', key, err));
    }

    function removeOne(key) {
        fetch(API + '?key=eq.' + encodeURIComponent(key), {
            method: 'DELETE',
            headers: HEADERS
        }).catch(err => console.warn('فشل حذف', key, err));
    }

    // ===== 1) سحب البيانات من السحابة قبل تحميل الصفحة =====
    try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', API + '?select=key,value', false);
        xhr.setRequestHeader('apikey', KEY);
        xhr.setRequestHeader('Authorization', 'Bearer ' + KEY);
        xhr.send();

        if (xhr.status === 200) {
            const rows = JSON.parse(xhr.responseText);

            if (rows.length === 0) {
                // أول مرة: نرفع البيانات المحلية إلى السحابة
                Object.keys(localStorage).filter(isSyncKey).forEach(k => pushOne(k, localStorage.getItem(k)));
            } else {
                // السحابة هي المصدر: نحدّث المحلي ونحذف ما لم يعد موجودًا فيها
                const remoteKeys = new Set(rows.map(r => r.key));
                Object.keys(localStorage).filter(isSyncKey).forEach(k => {
                    if (!remoteKeys.has(k)) originalRemove.call(localStorage, k);
                });
                rows.forEach(r => originalSet.call(localStorage, r.key, r.value));
            }
        } else {
            console.warn('تعذر جلب البيانات من السحابة، الحالة:', xhr.status, xhr.responseText);
        }
    } catch (err) {
        console.warn('تعذر الاتصال بالسحابة، سيعمل المتجر بالبيانات المحلية:', err);
    }

    // ===== 2) رفع التغييرات تلقائيًا =====
    Storage.prototype.setItem = function (key, value) {
        originalSet.call(this, key, value);
        if (this === localStorage && isSyncKey(key)) pushOne(key, String(value));
    };

    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        if (this === localStorage && isSyncKey(key)) removeOne(key);
    };
})();
