/* storage.js — يزامن بيانات المتجر مع Supabase، ويعزل كل متجر ببياناته
 *
 * كيف تعمل المزامنة:
 * - كل مفتاح يبدأ بـ store يُحفظ كصف في جدول kv_store.
 * - القوائم الكبيرة (الفواتير، التسديدات، المشتريات، تعديلات المخزون، حركات الصندوق) تُقسَّم في السحابة
 *   إلى صفوف حسب التاريخ: الفواتير صف لكل يوم (storeInvoices@2026-10-23) والباقي صف لكل شهر.
 *   الصفحات تبقى ترى قائمة واحدة كما هي، وكل بيعة ترفع صف يومها فقط بدل كل الفواتير.
 * - القوائم تُدمج مع نسخة السحابة عند كل حفظ بدل الكتابة فوقها،
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

    // القوائم المقسّمة في السحابة حسب تاريخ السجل (date): day أو month
    const CHUNKED = {
        storeInvoices: 'day',
        storeDebtPayments: 'month',
        storePurchases: 'month',
        storeStockAdjustments: 'month',
        storeCashManual: 'month'
    };
    const SEP = '@';

    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    const originalRemove = Storage.prototype.removeItem;

    // storePrefs (المظهر واللغة) خاص بكل جهاز ولا يُزامن
    const isSyncKey = k => typeof k === 'string' && k.startsWith('store') && k !== 'storeSession' && k !== 'storePrefs';
    const isChunked = k => Object.prototype.hasOwnProperty.call(CHUNKED, k);
    const chunkBase = k => {
        if (typeof k !== 'string') return null;
        const i = k.indexOf(SEP);
        return i > 0 && isChunked(k.slice(0, i)) ? k.slice(0, i) : null;
    };
    const chunkKey = (base, bucket) => base + SEP + bucket;

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

    // المتجر التجريبي (demo.js): لا متجر في السحابة، فلا مزامنة ولا رفع إطلاقًا
    function currentStoreId() {
        if (getLocal('appDemo') === '1') return null;
        const m = readJSON(MEMBERSHIP_KEY);
        return m && m.store_id ? m.store_id : null;
    }

    // ===== التقسيم حسب التاريخ =====
    // الصف الذي ينتمي له السجل: 2026-10-23 للفواتير، 2026-10 للباقي، و 0000 لسجل بلا تاريخ
    function bucketOf(base, item) {
        const d = item && typeof item.date === 'string' ? item.date : '';
        if (CHUNKED[base] === 'day' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
        if (/^\d{4}-\d{2}/.test(d)) return d.slice(0, 7);
        return '0000';
    }

    // نفس الحساب لسجل محفوظ كنص، مع ذاكرة حتى لا نحلل النص نفسه مرارًا
    const bucketCache = new Map();
    function bucketOfString(base, s) {
        const k = base + '|' + s;
        let b = bucketCache.get(k);
        if (b === undefined) {
            try {
                b = bucketOf(base, JSON.parse(s));
            } catch {
                b = '0000';
            }
            if (bucketCache.size > 50000) bucketCache.clear();
            bucketCache.set(k, b);
        }
        return b;
    }

    // سجلات صف واحد من القائمة المحلية
    function localChunk(base, bucket) {
        const arr = parseArray(getLocal(base)) || [];
        return arr.filter(item => bucketOf(base, item) === bucket);
    }

    // يستبدل سجلات صفوف في القائمة المحلية بمكانها، دون تغيير ترتيب باقي القائمة
    function replaceChunks(base, arr, chunks) {
        const out = [];
        const inserted = new Set();
        arr.forEach(item => {
            const b = bucketOf(base, item);
            if (!chunks.has(b)) return out.push(item);
            if (!inserted.has(b)) {
                inserted.add(b);
                chunks.get(b).forEach(x => out.push(x));
            }
        });
        chunks.forEach((items, b) => {
            if (!inserted.has(b)) items.forEach(x => out.push(x));
        });
        return out;
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

    // ===== تطبيق قيمة من السحابة على الجهاز =====
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

    // يكتب قيمة صف من السحابة في الجهاز: المفتاح نفسه، أو جزء القائمة إن كان صفًا مقسّمًا
    function applyRemote(key, value, notify) {
        const base = chunkBase(key);
        const target = base || key;
        const old = getLocal(target);
        let next;
        if (base) {
            const items = parseArray(value) || [];
            const arr = parseArray(old) || [];
            const out = replaceChunks(base, arr, new Map([[key.slice(base.length + 1), items]]));
            // قائمة فرغت كلها (تصفير من جهاز آخر) تُحذف كما كانت قبل التقسيم
            next = out.length ? JSON.stringify(out) : null;
        } else {
            next = value === null || value === undefined || value === DELETED ? null : String(value);
        }
        if (next === null) {
            if (old !== null) removeLocal(target);
        } else if (old !== next) {
            setLocal(target, next);
        }
        lastSeenRaw[target] = undefined;
        if (notify && old !== next) notifyPage(target, old, next);
    }

    function markDirty(storeId, key, knownSet) {
        const dirty = loadState('Dirty', storeId);
        // نحفظ السجلات التي كانت الصفحة تعرفها من السحابة عند أول فشل فقط.
        // لو أضفنا ما عرفته بعد ذلك لاعتُبرت فاتورة جديدة لم تُرفع بعد "معروفة" فتُحذف عند الدمج
        if (key in dirty) return;
        dirty[key] = [...(knownSet || new Set())];
        saveState('Dirty', storeId, dirty);
    }

    function clearDirty(storeId, key) {
        const dirty = loadState('Dirty', storeId);
        if (!(key in dirty)) return;
        delete dirty[key];
        saveState('Dirty', storeId, dirty);
    }

    // قواعد الحماية رفضت التعديل (مثل موظف يعدّل إعدادات المتجر):
    // نعيد قيمة السحابة إلى الجهاز ولا نحاول مجددًا
    function reject(storeId, key, row, versions) {
        console.warn('لا تملك صلاحية تعديل هذه البيانات، أُعيدت قيمتها من السحابة:', key);
        clearDirty(storeId, key);
        if (row === undefined) return;
        applyRemote(key, row ? row.value : null, true);
        if (row) {
            versions[key] = row.updated_at;
            saveState('Versions', storeId, versions);
        }
    }

    // ===== الرفع =====
    /* يرفع قيمة صف واحد (أو علامة حذفه) مع الدمج عند الحاجة. يعيد true عند النجاح.
     * synced: قيمة الصف كما كانت على الجهاز قبل هذا الحفظ، وهي نسخة السحابة الأخيرة التي عرفها الجهاز.
     * معها نكتب مباشرة دون قراءة الصف أولًا (ندمج عليها، فلا يُحذف ما لم تره الصفحة)،
     * وإن تغيّر الصف في السحابة منذها ترجع الكتابة بلا صفوف فنقرأ وندمج */
    function pushKey(storeId, key, localValue, knownSet, synced) {
        const localArr = parseArray(localValue);
        const versions = loadState('Versions', storeId);
        const canSkipRead = key in versions && (localValue === DELETED || synced !== undefined) &&
            !(key in loadState('Dirty', storeId));

        let unchangedSince = null;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            let row;
            let value = localValue;
            if (attempt === 0 && (canSkipRead || !(key in versions))) {
                // مفتاح جديد: نحاول الإنشاء مباشرة. مفتاح نعرف نسخته: نكتب عليها مباشرة
                row = key in versions ? { updated_at: versions[key] } : null;
                if (row && localArr) {
                    const base = parseArray(synced);
                    if (base) value = JSON.stringify(mergeArrays(base, localArr, knownSet));
                }
            } else {
                row = fetchRow(storeId, key);
                if (row === undefined) break;

                // التعديل السابق لم يُطبَّق مع أن الصف لم يتغير: قواعد الحماية تمنعه
                if (unchangedSince && row && row.updated_at === unchangedSince) {
                    reject(storeId, key, row, versions);
                    return false;
                }

                if (localArr && row) {
                    // إذا حُذف المفتاح في السحابة نعتبره قائمة فارغة: لا يبقى إلا ما أضافته الصفحة
                    const remoteArr = row.value === DELETED || row.value === null ? [] : parseArray(row.value);
                    if (remoteArr) value = JSON.stringify(mergeArrays(remoteArr, localArr, knownSet));
                }
            }

            const res = writeRow(storeId, key, value, row);
            if (res.denied) {
                reject(storeId, key, fetchRow(storeId, key), versions);
                return false;
            }
            if (res.failed) break;
            if (res.retry) {
                unchangedSince = res.unchangedSince || null;
                continue;
            }

            versions[key] = res.updatedAt;
            saveState('Versions', storeId, versions);
            clearDirty(storeId, key);

            // الدمج أضاف ما غيّرته الأجهزة الأخرى: نحدّث الجهاز ونبلغ الصفحة لتعيد التحميل
            if (value !== localValue && value !== DELETED) applyRemote(key, value, true);
            return true;
        }

        console.warn('تعذر رفع التغيير إلى السحابة، سيُعاد عند الاتصال:', key);
        markDirty(storeId, key, knownSet);
        return false;
    }

    /* يرفع مفتاحًا كما تراه الصفحة. القوائم المقسّمة: نرفع فقط الصفوف التي تغيّر فيها شيء.
     * previous: قيمة المفتاح على الجهاز قبل هذا الحفظ (إن عُرفت) */
    function push(storeId, key, localValue, knownSet, previous) {
        if (!isChunked(key)) return pushKey(storeId, key, localValue, knownSet, previous === undefined ? undefined : (previous === null ? '[]' : previous));

        if (localValue === DELETED) {
            // تصفير القائمة: علامة حذف لكل صفوفها، وللصف القديم غير المقسّم إن وُجد
            const versions = loadState('Versions', storeId);
            let all = true;
            Object.keys(versions)
                .filter(k => chunkBase(k) === key)
                .forEach(k => { all = pushKey(storeId, k, DELETED, null) && all; });
            if (key in versions) all = pushKey(storeId, key, DELETED, null) && all;
            return all;
        }

        const localArr = parseArray(localValue);
        if (!localArr) return pushKey(storeId, key, localValue, knownSet);

        // نجمع سجلات الصفحة وما كانت تعرفه حسب الصف، ونحدد الصفوف التي أُضيف إليها أو حُذف منها شيء
        const local = new Map();
        const localStrings = new Set();
        const changed = new Set();
        localArr.forEach(item => {
            const s = JSON.stringify(item);
            const b = bucketOf(key, item);
            localStrings.add(s);
            if (!local.has(b)) local.set(b, []);
            local.get(b).push(item);
            if (!knownSet || !knownSet.has(s)) changed.add(b);
        });
        const knownBy = new Map();
        (knownSet || new Set()).forEach(s => {
            const b = bucketOfString(key, s);
            if (!knownBy.has(b)) knownBy.set(b, new Set());
            knownBy.get(b).add(s);
            if (!localStrings.has(s)) changed.add(b);
        });

        // ما كان في كل صف على الجهاز قبل هذا الحفظ
        let prevBy = null;
        if (previous !== undefined) {
            prevBy = new Map();
            (parseArray(previous) || []).forEach(item => {
                const b = bucketOf(key, item);
                if (!prevBy.has(b)) prevBy.set(b, []);
                prevBy.get(b).push(item);
            });
        }

        let all = true;
        changed.forEach(b => {
            const items = local.get(b) || [];
            const synced = prevBy ? JSON.stringify(prevBy.get(b) || []) : undefined;
            const ok = pushKey(storeId, chunkKey(key, b), JSON.stringify(items), knownBy.get(b) || new Set(), synced);
            // بعد رفع الحذف لا داعي لتذكّر السجلات المحذوفة، وإلا يُعاد رفع صفها مع كل حفظ
            if (ok && knownSet && knownBy.has(b)) knownBy.get(b).forEach(s => { if (!localStrings.has(s)) knownSet.delete(s); });
            all = ok && all;
        });
        return all;
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

        const before = {};
        const chunks = new Map(); // القائمة -> (الصف -> سجلاته)
        const legacy = []; // صفوف كاملة قديمة لقوائم صارت مقسّمة
        const snapshot = key => { if (!(key in before)) before[key] = getLocal(key); };

        for (let i = 0; i < changed.length; i += 50) {
            const part = changed.slice(i, i + 50);
            const res = request('GET', API + '?select=key,value,updated_at&store_id=eq.' + encodeURIComponent(storeId) + '&key=in.' + inList(part));
            if (!ok(res)) return null;
            JSON.parse(res.responseText).forEach(r => {
                const value = r.value === null || r.value === undefined ? DELETED : String(r.value);
                const base = chunkBase(r.key);
                if (base) {
                    snapshot(base);
                    if (!chunks.has(base)) chunks.set(base, new Map());
                    chunks.get(base).set(r.key.slice(base.length + 1), parseArray(value) || []);
                } else if (isChunked(r.key)) {
                    // جهاز بنسخة قديمة كتب القائمة كاملة: ندمجها في الصفوف المقسّمة بعد السحب
                    if (parseArray(value)) legacy.push({ key: r.key, row: { value, updated_at: r.updated_at } });
                } else {
                    snapshot(r.key);
                    const old = getLocal(r.key);
                    if (value === DELETED) {
                        if (old !== null) removeLocal(r.key);
                    } else if (old !== value) {
                        setLocal(r.key, value);
                    }
                }
                versions[r.key] = r.updated_at;
            });
        }
        saveState('Versions', storeId, versions);

        chunks.forEach((map, base) => {
            const arr = parseArray(getLocal(base)) || [];
            const out = replaceChunks(base, arr, map);
            if (out.length) setLocal(base, JSON.stringify(out));
            else removeLocal(base);
            lastSeenRaw[base] = undefined;
        });

        legacy.forEach(({ key, row }) => absorbLegacy(storeId, key, row, snapshot));

        const applied = [];
        Object.keys(before).forEach(k => {
            const now = getLocal(k);
            if (before[k] !== now) applied.push([k, before[k], now]);
        });
        return { remoteKeys: new Set(remote.map(r => r.key)), applied };
    }

    // نقل قائمة من صفها القديم الكامل إلى الصفوف المقسّمة، ثم وضع علامة حذف مكانه.
    // يحدث مرة عند الترقية، وكلما كتب جهاز ما زالت عليه النسخة القديمة. لا يحذف شيئًا: يضيف فقط
    function absorbLegacy(storeId, key, row, snapshot) {
        const legacyArr = parseArray(row.value) || [];
        snapshot(key);
        const localArr = parseArray(getLocal(key)) || [];
        const have = new Set(localArr.map(x => JSON.stringify(x)));
        const merged = localArr.concat(legacyArr.filter(x => !have.has(JSON.stringify(x))));
        const raw = JSON.stringify(merged);
        setLocal(key, raw);
        lastSeenRaw[key] = undefined;
        // نرفع كل صفوف القائمة دون حذف شيء منها، ثم نعلّم الصف القديم محذوفًا
        if (!push(storeId, key, raw, new Set())) return;
        const res = writeRow(storeId, key, DELETED, row);
        if (res.updatedAt) {
            const versions = loadState('Versions', storeId);
            versions[key] = res.updatedAt;
            saveState('Versions', storeId, versions);
        }
    }

    // يرفع ما فشل رفعه سابقًا (انقطاع الإنترنت مثلًا)
    function pushDirty(storeId) {
        const dirty = loadState('Dirty', storeId);
        Object.keys(dirty).forEach(key => {
            const knownSet = new Set(dirty[key] || []);
            const base = chunkBase(key);
            if (base) {
                pushKey(storeId, key, JSON.stringify(localChunk(base, key.slice(base.length + 1))), knownSet);
                return;
            }
            const value = getLocal(key);
            // قائمة مقسّمة فشل رفعها بالنسخة السابقة: تُرفع الآن مقسّمة
            if (isChunked(key)) clearDirty(storeId, key);
            push(storeId, key, value === null ? DELETED : value, knownSet);
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

        // القائمة المقسّمة موجودة في السحابة إن وُجد أي صف من صفوفها
        const remoteBases = new Set(result.remoteKeys);
        result.remoteKeys.forEach(k => { const b = chunkBase(k); if (b) remoteBases.add(b); });

        const dirty = loadState('Dirty', storeId);
        const dirtyBases = new Set(Object.keys(dirty).map(k => chunkBase(k) || k));
        Object.keys(localStorage)
            .filter(k => isSyncKey(k) && !chunkBase(k) && !remoteBases.has(k) && !dirtyBases.has(k))
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
        const tracked = this === localStorage && isSyncKey(key) && !chunkBase(key);
        const previous = tracked ? originalGet.call(this, key) : null;
        originalSet.call(this, key, value);
        const sid = currentStoreId();
        if (tracked && sid) {
            const raw = String(value);
            push(sid, key, raw, known[key], previous);
            // نتذكر ما كتبته الصفحة فقط، لا ما أضافه الدمج، لأن الصفحة لم تره بعد
            remember(key, raw);
        }
    };

    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        const sid = currentStoreId();
        if (this === localStorage && isSyncKey(key) && !chunkBase(key) && sid) {
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
