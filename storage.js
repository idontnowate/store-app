/* storage.js — يزامن بيانات المتجر مع Supabase، ويعزل كل متجر ببياناته
 *
 * كيف تعمل المزامنة:
 * - كل مفتاح يبدأ بـ store يُحفظ كصف في جدول kv_store.
 * - القوائم (مثل الفواتير والمنتجات) تُدمج مع نسخة السحابة عند كل حفظ بدل الكتابة فوقها،
 *   فلا تضيع فاتورة أضافها جهاز آخر في نفس الوقت.
 * - الحفظ يتم بشرط ألا يكون الصف قد تغيّر منذ قراءته (updated_at)، وإلا نعيد الدمج.
 * - الحذف يكتب علامة حذف بدل حذف الصف، حتى يعرف كل جهاز أن المفتاح حُذف ولا يعيد رفعه.
 * - السحب يقارن updated_at لكل مفتاح مع آخر نسخة عرفها الجهاز، فلا يعتمد على ساعة الجهاز.
 */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const PROJECT_REF = 'pxxgydllfustqkpkfiqn';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const API = SUPABASE_URL + '/rest/v1/kv_store';

    const SESSION_TOKEN_KEY = 'sb-' + PROJECT_REF + '-auth-token';
    const MEMBERSHIP_KEY = 'appMembership';
    const SYNCED_STORE_KEY = 'appSyncedStore';
    // المتجر الذي تعود له البيانات المحلية على هذا الجهاز؛ لا تُخلط بيانات متجرين أبدًا
    const OWNER_KEY = 'appDataOwner';
    // علامة الحذف تُكتب مكان القيمة
    const DELETED = '__deleted__';
    const MAX_RETRIES = 5;

    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;

    // storePrefs (المظهر واللغة) خاص بكل جهاز ولا يُزامن
    const isSyncKey = k => typeof k === 'string' && k.startsWith('store') && k !== 'storeSession' && k !== 'storePrefs';

    function getLocal(key) {
        return originalGet.call(localStorage, key);
    }

    function setLocal(key, value) {
        originalSet.call(localStorage, key, value);
    }

    function removeLocal(key) {
        originalRemove.call(localStorage, key);
    }

    // يمسح كل بيانات المتجر من الجهاز مع حالة مزامنتها (لا يمس السحابة)
    function wipeLocal() {
        Object.keys(localStorage)
            .filter(k => isSyncKey(k) || k.startsWith('appSync') || k === SYNCED_STORE_KEY || k === OWNER_KEY)
            .forEach(removeLocal);
    }

    function readJSON(key) {
        try {
            return JSON.parse(getLocal(key));
        } catch {
            return null;
        }
    }

    function parseArray(raw) {
        if (raw === null || raw === undefined || raw === DELETED) return null;
        try {
            const v = JSON.parse(raw);
            return Array.isArray(v) ? v : null;
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

    // ===== حالة المزامنة المحفوظة على الجهاز (لا تبدأ بـ store حتى لا تُزامن) =====
    // versions: آخر updated_at عرفه الجهاز لكل مفتاح
    // dirty: مفاتيح فشل رفعها، مع السجلات التي كانت الصفحة تعرفها وقتها
    function stateKey(name, storeId) {
        return 'appSync' + name + '_' + storeId;
    }

    function loadState(name, storeId) {
        return readJSON(stateKey(name, storeId)) || {};
    }

    function saveState(name, storeId, value) {
        try {
            setLocal(stateKey(name, storeId), JSON.stringify(value));
        } catch (err) {
            console.warn('تعذر حفظ حالة المزامنة:', err);
        }
        // مؤشر الاتصال (pwa.js) يعرض عدد التغييرات التي تنتظر الرفع
        if (name === 'Dirty') {
            try { window.dispatchEvent(new CustomEvent('storesync')); } catch (e) { }
        }
    }

    // ===== السجلات التي رأتها هذه الصفحة لكل قائمة =====
    // نستخدمها لمعرفة ما أضافته الصفحة وما حذفته، بدل اعتبار كل ما ينقصها محذوفًا
    const known = {};
    const lastSeenRaw = {};

    function remember(key, raw) {
        if (lastSeenRaw[key] === raw) return;
        lastSeenRaw[key] = raw;
        const arr = parseArray(raw);
        if (!arr) return;
        const set = known[key] || (known[key] = new Set());
        arr.forEach(item => set.add(JSON.stringify(item)));
    }

    // دمج ثلاثي: نسخة السحابة − ما حذفته الصفحة + ما أضافته الصفحة
    function mergeArrays(remoteArr, localArr, knownSet) {
        const remoteStr = remoteArr.map(x => JSON.stringify(x));
        const localStr = localArr.map(x => JSON.stringify(x));
        const remoteSet = new Set(remoteStr);
        const localSet = new Set(localStr);
        const seen = knownSet || new Set();

        const deleted = new Set([...seen].filter(s => !localSet.has(s)));
        const added = new Set(localStr.filter(s => !seen.has(s)));

        const out = [];
        const used = new Set();
        // نحافظ على ترتيب الصفحة
        localArr.forEach((item, i) => {
            const s = localStr[i];
            if (used.has(s)) return;
            if (remoteSet.has(s) || added.has(s)) {
                out.push(item);
                used.add(s);
            }
        });
        // ثم ما أضافته الأجهزة الأخرى
        remoteArr.forEach((item, i) => {
            const s = remoteStr[i];
            if (used.has(s) || deleted.has(s)) return;
            out.push(item);
            used.add(s);
        });
        return out;
    }

    // ===== الاتصال بالسحابة =====
    // طلب متزامن: يكتمل قبل أن تنتقل الصفحة إلى غيرها
    function request(method, url, body, extraHeaders) {
        // بدون إنترنت: لا ننتظر الشبكة، والتغيير يُحفظ على الجهاز ويُرفع عند عودة الاتصال
        if (navigator.onLine === false) return null;
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

    function ok(xhr) {
        return !!xhr && xhr.status >= 200 && xhr.status < 300;
    }

    function rowFilter(storeId, key) {
        return 'store_id=eq.' + encodeURIComponent(storeId) + '&key=eq.' + encodeURIComponent(key);
    }

    function inList(keys) {
        return encodeURIComponent('(' + keys.map(k => '"' + k.replace(/"/g, '\\"') + '"').join(',') + ')');
    }

    // يعيد { value, updated_at } أو null إن لم يوجد الصف، أو undefined عند فشل الاتصال
    function fetchRow(storeId, key) {
        const xhr = request('GET', API + '?select=value,updated_at&' + rowFilter(storeId, key));
        if (!ok(xhr)) return undefined;
        const rows = JSON.parse(xhr.responseText);
        return rows[0] || null;
    }

    // وقت جديد أكبر دائمًا من الوقت السابق للصف، حتى لو كانت ساعة الجهاز متأخرة
    function nextTimestamp(prev) {
        const now = Date.now();
        const prevMs = prev ? Date.parse(prev) : 0;
        return new Date(Math.max(now, (prevMs || 0) + 1)).toISOString();
    }

    // كتابة مشروطة: تنجح فقط إذا لم يتغير الصف منذ قراءته.
    // تعيد { updatedAt } عند النجاح، أو { retry } للتعارض، أو { denied } إذا رفضتها قواعد الحماية،
    // أو { failed } عند انقطاع الاتصال أو انتهاء الجلسة (يُعاد لاحقًا)
    function writeRow(storeId, key, value, row) {
        const updated_at = nextTimestamp(row && row.updated_at);
        const xhr = row
            ? request(
                'PATCH',
                API + '?' + rowFilter(storeId, key) + '&updated_at=eq.' + encodeURIComponent(row.updated_at),
                JSON.stringify({ value, updated_at }),
                { Prefer: 'return=representation' }
            )
            : request(
                'POST',
                API,
                JSON.stringify({ store_id: storeId, key, value, updated_at }),
                { Prefer: 'return=representation' }
            );

        if (!xhr || xhr.status === 0) return { failed: true };
        if (xhr.status === 409) return { retry: true }; // أنشأه جهاز آخر للتو
        if (xhr.status === 403) return { denied: true };
        if (!ok(xhr)) return { failed: true };

        const rows = JSON.parse(xhr.responseText);
        if (rows[0]) return { updatedAt: rows[0].updated_at };
        if (!row) return { updatedAt: updated_at };
        // لا صفوف: إما أن جهازًا آخر عدّل الصف، أو أن قواعد الحماية لا تسمح بتعديله
        return { retry: true, unchangedSince: row.updated_at };
    }

    // قواعد الحماية رفضت التعديل (مثل موظف يعدّل إعدادات المتجر):
    // نعيد قيمة السحابة إلى الجهاز ولا نحاول مجددًا
    function reject(storeId, key, row, versions) {
        console.warn('لا تملك صلاحية تعديل هذه البيانات، أُعيدت قيمتها من السحابة:', key);
        clearDirty(storeId, key);
        if (row === undefined) return;

        const old = getLocal(key);
        const value = !row || row.value === null || row.value === DELETED ? null : String(row.value);
        if (value === null) removeLocal(key);
        else setLocal(key, value);
        if (row) {
            versions[key] = row.updated_at;
            saveState('Versions', storeId, versions);
        }
        lastSeenRaw[key] = undefined;
        if (old !== value) notifyPage(key, old, value);
    }

    // ===== الرفع =====
    function notifyPage(key, oldValue, newValue) {
        // بعد انتهاء الحفظ الحالي في الصفحة، حتى لا نقاطع عملية حفظ من عدة خطوات
        setTimeout(() => {
            try {
                window.dispatchEvent(new StorageEvent('storage', {
                    key, oldValue, newValue, storageArea: localStorage, url: location.href
                }));
            } catch (err) {
                console.warn(err);
            }
        }, 0);
    }

    // نحفظ السجلات التي كانت الصفحة تعرفها من السحابة عند أول فشل فقط.
    // لو أضفنا ما عرفته بعد ذلك لاعتُبرت فاتورة جديدة لم تُرفع بعد "معروفة" فتُحذف عند الدمج
    function markDirty(storeId, key) {
        const dirty = loadState('Dirty', storeId);
        if (key in dirty) return;
        dirty[key] = [...(known[key] || new Set())];
        saveState('Dirty', storeId, dirty);
    }

    function clearDirty(storeId, key) {
        const dirty = loadState('Dirty', storeId);
        if (!(key in dirty)) return;
        delete dirty[key];
        saveState('Dirty', storeId, dirty);
    }

    // يرفع قيمة مفتاح (أو علامة حذفه) مع الدمج عند الحاجة. يعيد true عند النجاح
    function push(storeId, key, localValue, knownSet) {
        const localArr = parseArray(localValue);
        const versions = loadState('Versions', storeId);

        let unchangedSince = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            // مفتاح جديد لم يعرفه الجهاز (مثل سطر في سجل العمليات): نحاول الإنشاء مباشرة دون قراءة
            const row = attempt === 0 && !(key in versions) ? null : fetchRow(storeId, key);
            if (row === undefined) break;

            // التعديل السابق لم يُطبَّق مع أن الصف لم يتغير: قواعد الحماية تمنعه
            if (unchangedSince && row && row.updated_at === unchangedSince) {
                reject(storeId, key, row, versions);
                return false;
            }

            let value = localValue;
            if (localArr && row) {
                // إذا حُذف المفتاح في السحابة نعتبره قائمة فارغة: لا يبقى إلا ما أضافته الصفحة
                const remoteArr = row.value === DELETED || row.value === null ? [] : parseArray(row.value);
                if (remoteArr) value = JSON.stringify(mergeArrays(remoteArr, localArr, knownSet));
            }

            const res = writeRow(storeId, key, value, row);
            if (res.denied) {
                reject(storeId, key, row || fetchRow(storeId, key), versions);
                return false;
            }
            if (res.failed) break;
            if (res.retry) {
                unchangedSince = res.unchangedSince || null;
                continue;
            }
            const updatedAt = res.updatedAt;

            versions[key] = updatedAt;
            saveState('Versions', storeId, versions);
            clearDirty(storeId, key);

            // الدمج أضاف ما غيّرته الأجهزة الأخرى: نحدّث الجهاز ونبلغ الصفحة لتعيد التحميل
            if (value !== localValue && value !== DELETED) {
                const old = getLocal(key);
                setLocal(key, value);
                lastSeenRaw[key] = undefined;
                notifyPage(key, old, value);
            }
            return true;
        }

        console.warn('تعذر رفع التغيير إلى السحابة، سيُعاد عند الاتصال:', key);
        markDirty(storeId, key);
        return false;
    }

    // ===== السحب =====
    // يجلب updated_at لكل المفاتيح، ثم قيم المفاتيح التي تغيّرت فقط. يعيد قائمة المفاتيح التي تغيّرت محليًا
    function pull(storeId) {
        const xhr = request('GET', API + '?select=key,updated_at&store_id=eq.' + encodeURIComponent(storeId) + '&key=like.store*');
        if (!ok(xhr)) return null;
        const remote = JSON.parse(xhr.responseText).filter(r => isSyncKey(r.key));

        const versions = loadState('Versions', storeId);
        const dirty = loadState('Dirty', storeId);
        const changed = remote.filter(r => versions[r.key] !== r.updated_at && !(r.key in dirty)).map(r => r.key);

        const applied = [];
        for (let i = 0; i < changed.length; i += 50) {
            const chunk = changed.slice(i, i + 50);
            const res = request('GET', API + '?select=key,value,updated_at&store_id=eq.' + encodeURIComponent(storeId) + '&key=in.' + inList(chunk));
            if (!ok(res)) return null;
            JSON.parse(res.responseText).forEach(r => {
                const value = r.value === null || r.value === undefined ? DELETED : String(r.value);
                const old = getLocal(r.key);
                if (value === DELETED) {
                    if (old !== null) removeLocal(r.key);
                } else if (old !== value) {
                    setLocal(r.key, value);
                }
                if (old !== (value === DELETED ? null : value)) applied.push([r.key, old, value === DELETED ? null : value]);
                versions[r.key] = r.updated_at;
            });
        }
        saveState('Versions', storeId, versions);
        return { remoteKeys: new Set(remote.map(r => r.key)), applied };
    }

    // يرفع ما فشل رفعه سابقًا (انقطاع الإنترنت مثلًا)
    function pushDirty(storeId) {
        const dirty = loadState('Dirty', storeId);
        Object.keys(dirty).forEach(key => {
            const value = getLocal(key);
            push(storeId, key, value === null ? DELETED : value, new Set(dirty[key] || []));
        });
    }

    function sync(storeId, notify) {
        pushDirty(storeId);
        const result = pull(storeId);
        if (!result) return false;
        setLocal(stateKey('Last', storeId), new Date().toISOString());
        if (notify) result.applied.forEach(([k, o, n]) => notifyPage(k, o, n));
        return result;
    }

    // ===== 1) قبل تحميل الصفحة: عزل المتجر ثم مزامنته =====
    // تعيد true عند النجاح. notify: إبلاغ الصفحة بما تغيّر (عند الإعادة بعد ظهورها)
    function startupSync(storeId, notify) {
        // البيانات المحلية لا تُستخدم إلا إذا كان مؤكدًا أنها لهذا المتجر.
        // إن كانت لمتجر آخر أو مجهولة المصدر نمسحها ولا نرفعها، ثم نحمّل المتجر من السحابة
        const owner = getLocal(OWNER_KEY) || getLocal(SYNCED_STORE_KEY);
        const ownedHere = owner === storeId;
        if (!ownedHere) {
            wipeLocal();
            setLocal(OWNER_KEY, storeId);
        }

        // أجهزة النسخة القديمة: نرفع مرة واحدة بيانات هذا المتجر المحلية التي ليست في السحابة
        const firstSync = ownedHere && getLocal(stateKey('Versions', storeId)) === null;

        const result = sync(storeId, notify);
        if (!result) return false;

        const dirty = loadState('Dirty', storeId);
        Object.keys(localStorage)
            .filter(k => isSyncKey(k) && !result.remoteKeys.has(k) && !(k in dirty))
            .forEach(k => {
                if (firstSync) {
                    push(storeId, k, getLocal(k), new Set());
                } else {
                    // حُذف من السحابة بالطريقة القديمة
                    const old = getLocal(k);
                    removeLocal(k);
                    if (notify) notifyPage(k, old, null);
                }
            });
        setLocal(SYNCED_STORE_KEY, storeId);
        return true;
    }

    // إذا فشلت مزامنة البداية (جلسة منتهية بعد غياب طويل أو انقطاع) يعيدها auth.js بعد تجديد الجلسة
    let startupFailed = false;

    const storeId = currentStoreId();
    if (storeId) {
        try {
            startupFailed = !startupSync(storeId, false);
        } catch (err) {
            startupFailed = true;
            console.warn('تعذر تحميل البيانات من السحابة:', err);
        }

        // عند الرجوع إلى الصفحة نجلب ما تغيّر من الأجهزة الأخرى قبل أن تعيد الصفحة العرض
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) return;
            try {
                const sid = currentStoreId();
                if (sid) sync(sid, true);
            } catch (err) {
                console.warn('تعذر تحديث البيانات من السحابة:', err);
            }
        });
    }

    // ===== 2) تتبّع القراءة، ورفع كل تغيير فور حدوثه =====
    Storage.prototype.getItem = function (key) {
        const value = originalGet.call(this, key);
        if (this === localStorage && isSyncKey(key)) remember(key, value);
        return value;
    };

    Storage.prototype.setItem = function (key, value) {
        originalSet.call(this, key, value);
        const sid = currentStoreId();
        if (this === localStorage && isSyncKey(key) && sid) {
            const raw = String(value);
            push(sid, key, raw, known[key]);
            // نتذكر ما كتبته الصفحة فقط، لا ما أضافه الدمج، لأن الصفحة لم تره بعد
            remember(key, raw);
        }
    };

    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        const sid = currentStoreId();
        if (this === localStorage && isSyncKey(key) && sid) {
            push(sid, key, DELETED, null);
            delete known[key];
            delete lastSeenRaw[key];
        }
    };

    // تستدعيها الصفحات قبل عمليات تحتاج أحدث البيانات (مثل ترقيم الفواتير)
    window.StoreSync = {
        // يحاول رفع ما لم يُرفع؛ يعيد عدد المفاتيح التي بقيت دون رفع
        flush() {
            const sid = currentStoreId();
            if (!sid) return 0;
            try {
                pushDirty(sid);
            } catch (err) {
                console.warn(err);
            }
            return Object.keys(loadState('Dirty', sid)).length;
        },
        // عند تسجيل الخروج: لا تبقى بيانات المتجر على الجهاز للمستخدم التالي
        clearLocal: wipeLocal,
        // يعيد مزامنة البداية إن كانت قد فشلت؛ يستدعيه auth.js بعد التحقق من الجلسة وتجديدها
        retryIfFailed() {
            const sid = currentStoreId();
            if (!startupFailed || !sid) return false;
            try {
                startupFailed = !startupSync(sid, true);
            } catch (err) {
                console.warn('تعذر تحميل البيانات من السحابة:', err);
            }
            return !startupFailed;
        },
        // حالة المزامنة لصفحة الإعدادات: عدد التغييرات التي لم تُرفع، ووقت آخر مزامنة ناجحة
        status() {
            const sid = currentStoreId();
            const offline = navigator.onLine === false;
            if (!sid) return { pending: 0, lastSync: null, offline };
            return {
                pending: Object.keys(loadState('Dirty', sid)).length,
                lastSync: getLocal(stateKey('Last', sid)),
                offline
            };
        },
        refresh() {
            const sid = currentStoreId();
            if (!sid) return false;
            try {
                return !!sync(sid, true);
            } catch (err) {
                console.warn('تعذر تحديث البيانات من السحابة:', err);
                return false;
            }
        }
    };
})();
