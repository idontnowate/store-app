/* storage.js — يزامن بيانات المتجر (localStorage) مع Supabase */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const API = SUPABASE_URL + '/rest/v1/kv_store';

    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;

    const isSyncKey = k => typeof k === 'string' && k.startsWith('store') && k !== 'storeSession';

    // طلب متزامن: يكتمل قبل أن تنتقل الصفحة إلى غيرها
    function request(method, url, body, extraHeaders) {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, false);
        xhr.setRequestHeader('apikey', KEY);
        xhr.setRequestHeader('Authorization', 'Bearer ' + KEY);
        if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
        if (extraHeaders) {
            Object.entries(extraHeaders).forEach(([h, v]) => xhr.setRequestHeader(h, v));
        }
        try {
            xhr.send(body);
        } catch (err) {
            console.warn('تعذر الاتصال بالسحابة:', err);
            return null;
        }
        if (xhr.status >= 300) console.warn('خطأ من السحابة:', method, xhr.status, xhr.responseText);
        return xhr;
    }

    function pushOne(key, value) {
        return request(
            'POST',
            API + '?on_conflict=key',
            JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
            { Prefer: 'resolution=merge-duplicates' }
        );
    }

    function removeOne(key) {
        return request('DELETE', API + '?key=eq.' + encodeURIComponent(key));
    }

    // ===== 1) سحب البيانات من السحابة قبل تحميل الصفحة =====
    try {
        const xhr = request('GET', API + '?select=key,value');
        if (xhr && xhr.status === 200) {
            const rows = JSON.parse(xhr.responseText);
            const remote = new Map(rows.map(r => [r.key, r.value]));

            // أي بيانات محلية غير موجودة في السحابة تُرفع إليها، ولا تُحذف
            Object.keys(localStorage).filter(isSyncKey).forEach(k => {
                if (!remote.has(k)) pushOne(k, localStorage.getItem(k));
            });

            // السحابة تحدّث البيانات المحلية الموجودة فيها
            remote.forEach((value, key) => originalSet.call(localStorage, key, value));
        }
    } catch (err) {
        console.warn('تعذر تحميل البيانات من السحابة:', err);
    }

    // ===== 2) رفع كل تغيير فور حدوثه =====
    Storage.prototype.setItem = function (key, value) {
        originalSet.call(this, key, value);
        if (this === localStorage && isSyncKey(key)) pushOne(key, String(value));
    };

    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        if (this === localStorage && isSyncKey(key)) removeOne(key);
    };
})();