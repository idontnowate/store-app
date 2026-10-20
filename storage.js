/* storage.js — يزامن بيانات المتجر مع Supabase، ويعزل كل متجر ببياناته */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const PROJECT_REF = 'pxxgydllfustqkpkfiqn';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const API = SUPABASE_URL + '/rest/v1/kv_store';

    const SESSION_TOKEN_KEY = 'sb-' + PROJECT_REF + '-auth-token';
    const MEMBERSHIP_KEY = 'appMembership';
    const SYNCED_STORE_KEY = 'appSyncedStore';

    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;

    const isSyncKey = k => typeof k === 'string' && k.startsWith('store') && k !== 'storeSession';

    function readJSON(key) {
        try {
            return JSON.parse(localStorage.getItem(key));
        } catch {
            return null;
        }
    }

    function accessToken() {
        const session = readJSON(SESSION_TOKEN_KEY);
        return session && session.access_token ? session.access_token : KEY;
    }

    function currentStoreId() {
        const m = readJSON(MEMBERSHIP_KEY);
        return m && m.store_id ? m.store_id : null;
    }

    // طلب متزامن: يكتمل قبل أن تنتقل الصفحة إلى غيرها
    function request(method, url, body, extraHeaders) {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, false);
        xhr.setRequestHeader('apikey', KEY);
        xhr.setRequestHeader('Authorization', 'Bearer ' + accessToken());
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

    function pushOne(storeId, key, value) {
        return request(
            'POST',
            API + '?on_conflict=store_id,key',
            JSON.stringify({ store_id: storeId, key, value, updated_at: new Date().toISOString() }),
            { Prefer: 'resolution=merge-duplicates' }
        );
    }

    function removeOne(storeId, key) {
        return request(
            'DELETE',
            API + '?store_id=eq.' + encodeURIComponent(storeId) + '&key=eq.' + encodeURIComponent(key)
        );
    }

    // ===== 1) قبل تحميل الصفحة: عزل المتجر ثم سحب بياناته =====
    const storeId = currentStoreId();
    if (storeId) {
        try {
            // إذا كان هذا الجهاز قد عمل سابقًا على متجر آخر نمسح بياناته المحلية حتى لا تختلط
            const previousStore = localStorage.getItem(SYNCED_STORE_KEY);
            if (previousStore && previousStore !== storeId) {
                Object.keys(localStorage)
                    .filter(isSyncKey)
                    .forEach(k => originalRemove.call(localStorage, k));
            }

            const xhr = request('GET', API + '?select=key,value');
            if (xhr && xhr.status === 200) {
                const rows = JSON.parse(xhr.responseText);
                const remote = new Map(rows.map(r => [r.key, r.value]));

                // بيانات محلية غير موجودة في السحابة تُرفع إليها ولا تُحذف
                Object.keys(localStorage)
                    .filter(isSyncKey)
                    .forEach(k => {
                        if (!remote.has(k)) pushOne(storeId, k, localStorage.getItem(k));
                    });

                // السحابة تحدّث البيانات المحلية
                remote.forEach((value, key) => {
                    if (value !== null && value !== undefined) {
                        originalSet.call(localStorage, key, String(value));
                    }
                });

                originalSet.call(localStorage, SYNCED_STORE_KEY, storeId);
            }
        } catch (err) {
            console.warn('تعذر تحميل البيانات من السحابة:', err);
        }
    }

    // ===== 2) رفع كل تغيير فور حدوثه (فقط عند وجود متجر مسجّل) =====
    Storage.prototype.setItem = function (key, value) {
        originalSet.call(this, key, value);
        const sid = currentStoreId();
        if (this === localStorage && isSyncKey(key) && sid) {
            pushOne(sid, key, String(value));
        }
    };

    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        const sid = currentStoreId();
        if (this === localStorage && isSyncKey(key) && sid) {
            removeOne(sid, key);
        }
    };
})();
