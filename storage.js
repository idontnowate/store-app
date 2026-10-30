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
 *
 * الشبكة لا توقف الصفحة أبدًا:
 * - الحفظ يُكتب على الجهاز فورًا، والرفع يتم في الخلفية بطلبات غير متزامنة لكل منها مهلة.
 * - كل عمليات المزامنة تمر بطابور واحد بالترتيب، فلا تتداخل عمليتا دمج على نفس البيانات.
 * - قبل الرفع يُسجَّل المفتاح "بانتظار الرفع" (Pending)؛ إن أُغلقت الصفحة قبل اكتمال الرفع
 *   تكمله الصفحة التالية، ولا يكتب السحب فوق تغيير لم يُرفع بعد.
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
    // مهلة كل طلب للسحابة: اتصال ضعيف لا يُبقي المزامنة معلقة
    const REQUEST_TIMEOUT = 15000;
    // مزامنة دورية أثناء فتح الصفحة، حتى يظهر ما يسجله الجهاز الآخر (الهاتف والكمبيوتر معًا)
    const SYNC_EVERY = 60000;

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

    // معرّف السجل إن وُجد (المنتجات، الزبائن، الفواتير...)
    function idOf(item) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const id = item.id;
        return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
    }

    // كل سجلات القائمة لها معرّف، ولا يتكرر معرّف
    function uniqueIds(arr) {
        const ids = new Set();
        for (const item of arr) {
            const id = idOf(item);
            if (id === null || ids.has(id)) return false;
            ids.add(id);
        }
        return true;
    }

    const isPlainObject = v => !!v && typeof v === 'object' && !Array.isArray(v);

    // دمج ثلاثي لسجل غيّره جهازان معًا: لكل خانة، ما غيّرته الصفحة يُؤخذ منها، وما لم تغيّره يُؤخذ من السحابة.
    // مثال: جهاز غيّر السعر وجهاز غيّر الاسم ← السجل يحمل الاثنين، بدل نسختين من نفس المنتج
    function mergeRecord(base, local, remote) {
        const out = {};
        const keys = new Set([...Object.keys(remote), ...Object.keys(local)]);
        keys.forEach(k => {
            const changedHere = JSON.stringify(local[k]) !== JSON.stringify(base[k]);
            const v = changedHere ? local[k] : remote[k];
            if (v !== undefined) out[k] = v;
        });
        return out;
    }

    // دمج ثلاثي: نسخة السحابة − ما حذفته الصفحة + ما أضافته الصفحة
    function mergeArrays(remoteArr, localArr, knownSet) {
        if (uniqueIds(localArr) && uniqueIds(remoteArr)) return mergeById(remoteArr, localArr, knownSet);

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

    /* نفس الدمج لكن حسب معرّف السجل، فتعديل السجل نفسه على جهازين لا يُنتج نسختين منه:
     * - غيّرته الصفحة فقط ← نسخة الصفحة. غيّرته السحابة فقط ← نسخة السحابة.
     * - غيّراه معًا ← دمج الخانات (mergeRecord) على آخر نسخة عرفتها الصفحة.
     * - حذفته الصفحة (كانت تعرفه وليس عندها) ← يبقى محذوفًا. أضافه جهاز آخر ← يُضاف.
     * - حذفه جهاز آخر وعدّلته الصفحة ← يبقى بتعديلها، حتى لا يضيع عمل */
    function mergeById(remoteArr, localArr, knownSet) {
        const seen = knownSet || new Set();
        const baseOf = new Map(); // المعرّف -> آخر نسخة عرفتها الصفحة
        seen.forEach(s => {
            try {
                const item = JSON.parse(s);
                const id = idOf(item);
                if (id !== null) baseOf.set(id, item);
            } catch { }
        });
        const remoteById = new Map(remoteArr.map(item => [idOf(item), item]));
        const localIds = new Set();

        const out = [];
        localArr.forEach(item => {
            const id = idOf(item);
            localIds.add(id);
            const s = JSON.stringify(item);
            const remote = remoteById.get(id);
            const changedHere = !seen.has(s);
            if (!changedHere) {
                // لم تغيّره الصفحة: نسخة السحابة، أو يُحذف إن حذفه جهاز آخر
                if (remote !== undefined) out.push(remote);
                else if (!baseOf.has(id)) out.push(item);
                return;
            }
            if (remote === undefined) return out.push(item);
            const rs = JSON.stringify(remote);
            if (rs === s || seen.has(rs)) return out.push(item);
            const base = baseOf.get(id);
            out.push(isPlainObject(base) && isPlainObject(remote) ? mergeRecord(base, item, remote) : item);
        });
        remoteArr.forEach(item => {
            const id = idOf(item);
            if (localIds.has(id) || baseOf.has(id)) return;
            out.push(item);
        });
        return out;
    }

    // نفس الفكرة لمفتاح قيمته كائن (مثل إعدادات المتجر): base هي آخر نسخة سحابة عرفها الجهاز
    function mergeObjectValue(baseRaw, localRaw, remoteRaw) {
        try {
            const base = JSON.parse(baseRaw), local = JSON.parse(localRaw), remote = JSON.parse(remoteRaw);
            if (!isPlainObject(base) || !isPlainObject(local) || !isPlainObject(remote)) return localRaw;
            return JSON.stringify(mergeRecord(base, local, remote));
        } catch {
            return localRaw;
        }
    }

    // ===== الاتصال بالسحابة =====
    // يعيد { status, responseText }، أو null عند انقطاع الاتصال أو انتهاء المهلة
    async function request(method, url, body, extraHeaders) {
        // بدون إنترنت: لا ننتظر الشبكة، والتغيير يبقى على الجهاز ويُرفع عند عودة الاتصال
        if (navigator.onLine === false) return null;
        const headers = { apikey: KEY, Authorization: 'Bearer ' + accessToken() };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        if (extraHeaders) Object.assign(headers, extraHeaders);
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT) : null;
        try {
            const res = await fetch(url, { method, headers, body, cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
            const text = await res.text();
            if (res.status >= 300) console.warn('خطأ من السحابة:', method, res.status, text);
            return { status: res.status, responseText: text };
        } catch (err) {
            console.warn('تعذر الاتصال بالسحابة:', err && err.name === 'AbortError' ? 'انتهت المهلة' : err);
            return null;
        } finally {
            if (timer) clearTimeout(timer);
        }
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
    async function fetchRow(storeId, key) {
        const xhr = await request('GET', API + '?select=value,updated_at&' + rowFilter(storeId, key));
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
    async function writeRow(storeId, key, value, row) {
        const updated_at = nextTimestamp(row && row.updated_at);
        const xhr = row
            ? await request(
                'PATCH',
                API + '?' + rowFilter(storeId, key) + '&updated_at=eq.' + encodeURIComponent(row.updated_at),
                JSON.stringify({ value, updated_at }),
                { Prefer: 'return=representation' }
            )
            : await request(
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

    // ===== بانتظار الرفع =====
    // يُسجَّل المفتاح هنا لحظة الحفظ، ويُمسح بعد اكتمال رفعه. ما يبقى هنا عند فتح صفحة جديدة
    // (أُغلقت الصفحة السابقة أثناء الرفع) يُنقل إلى Dirty فيُرفع بالطريقة نفسها
    const inFlight = {}; // المفتاح -> عدد عمليات الرفع المنتظرة له في هذه الصفحة

    function markPending(storeId, key, knownSet) {
        const pend = loadState('Pending', storeId);
        if (key in pend) return;
        pend[key] = [...(knownSet || new Set())];
        saveState('Pending', storeId, pend);
    }

    function clearPending(storeId, key) {
        const pend = loadState('Pending', storeId);
        if (!(key in pend)) return;
        delete pend[key];
        saveState('Pending', storeId, pend);
    }

    // Base: لمفتاح قيمته كائن (الإعدادات)، نسخته قبل أول تغيير لم يُرفع. بها يُدمج تغييران من جهازين خانة بخانة
    function markBase(storeId, key, previous) {
        if (previous === null || previous === undefined) return;
        try {
            const v = JSON.parse(previous);
            if (!v || typeof v !== 'object' || Array.isArray(v)) return;
        } catch {
            return;
        }
        const bases = loadState('Base', storeId);
        if (key in bases) return;
        bases[key] = previous;
        saveState('Base', storeId, bases);
    }

    function clearBase(storeId, key) {
        const bases = loadState('Base', storeId);
        if (!(key in bases)) return;
        delete bases[key];
        saveState('Base', storeId, bases);
    }

    function recoverPending(storeId) {
        const pend = loadState('Pending', storeId);
        const keys = Object.keys(pend);
        if (!keys.length) return;
        keys.forEach(k => markDirty(storeId, k, new Set(pend[k] || [])));
        saveState('Pending', storeId, {});
    }

    // لا يكتب السحب فوق مفتاح تغيّر على الجهاز ولم يُرفع بعد (ولا فوق صفوف قائمته المقسّمة).
    // تقرأ الحالة مرة واحدة؛ تُستدعى من جديد بعد كل انتظار لأن الصفحة قد تحفظ أثناءه
    function heldBack(storeId) {
        const dirty = loadState('Dirty', storeId);
        const pend = loadState('Pending', storeId);
        return key => {
            const base = chunkBase(key);
            return key in dirty || key in pend || (!!base && (base in dirty || base in pend)) || !!inFlight[base || key];
        };
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
    async function pushKey(storeId, key, localValue, knownSet, synced) {
        const localArr = parseArray(localValue);
        // كائن تغيّر قبل أن يُرفع (بدون إنترنت مثلًا): ندمج على نسخة السحابة التي عرفها الجهاز قبل أول تغيير
        const bases = localArr ? null : loadState('Base', storeId);
        if (bases && key in bases) synced = bases[key];
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
                row = await fetchRow(storeId, key);
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
                } else if (row && typeof synced === 'string' && localValue !== DELETED && typeof row.value === 'string' && row.value !== DELETED) {
                    // كائن (إعدادات): نحفظ ما غيّرته الصفحة فوق ما غيّره جهاز آخر في نفس الوقت
                    value = mergeObjectValue(synced, localValue, row.value);
                }
            }

            const res = await writeRow(storeId, key, value, row);
            if (res.denied) {
                reject(storeId, key, await fetchRow(storeId, key), versions);
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
            if (bases && key in bases) {
                // حفظ آخر ينتظر بعد هذا: أساس دمجه هو ما صار في السحابة الآن
                if ((inFlight[key] || 0) > 1) { const now = loadState('Base', storeId); now[key] = value; saveState('Base', storeId, now); }
                else clearBase(storeId, key);
            }

            // الدمج أضاف ما غيّرته الأجهزة الأخرى: نحدّث الجهاز ونبلغ الصفحة لتعيد التحميل.
            // إذا حفظت الصفحة المفتاح نفسه مرة أخرى بعد هذا الرفع نتركه، فرفعها القادم يدمج من جديد
            const target = chunkBase(key) || key;
            if (value !== localValue && value !== DELETED && (inFlight[target] || 0) <= 1) applyRemote(key, value, true);
            return true;
        }

        console.warn('تعذر رفع التغيير إلى السحابة، سيُعاد عند الاتصال:', key);
        markDirty(storeId, key, knownSet);
        return false;
    }

    /* يرفع مفتاحًا كما تراه الصفحة. القوائم المقسّمة: نرفع فقط الصفوف التي تغيّر فيها شيء.
     * previous: قيمة المفتاح على الجهاز قبل هذا الحفظ (إن عُرفت)
     * live: مجموعة ما تعرفه الصفحة الآن، نحذف منها ما رُفع حذفه */
    async function push(storeId, key, localValue, knownSet, previous, live) {
        if (!isChunked(key)) return pushKey(storeId, key, localValue, knownSet, previous === undefined ? undefined : (previous === null ? '[]' : previous));

        if (localValue === DELETED) {
            // تصفير القائمة: علامة حذف لكل صفوفها، وللصف القديم غير المقسّم إن وُجد
            const versions = loadState('Versions', storeId);
            let all = true;
            for (const k of Object.keys(versions).filter(k => chunkBase(k) === key)) {
                all = (await pushKey(storeId, k, DELETED, null)) && all;
            }
            if (key in versions) all = (await pushKey(storeId, key, DELETED, null)) && all;
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
        for (const b of changed) {
            const items = local.get(b) || [];
            const synced = prevBy ? JSON.stringify(prevBy.get(b) || []) : undefined;
            const done = await pushKey(storeId, chunkKey(key, b), JSON.stringify(items), knownBy.get(b) || new Set(), synced);
            // بعد رفع الحذف لا داعي لتذكّر السجلات المحذوفة، وإلا يُعاد رفع صفها مع كل حفظ
            if (done && knownBy.has(b)) {
                knownBy.get(b).forEach(s => {
                    if (localStrings.has(s)) return;
                    if (knownSet) knownSet.delete(s);
                    if (live) live.delete(s);
                });
            }
            all = done && all;
        }
        return all;
    }

    // ===== السحب =====
    // يجلب updated_at لكل المفاتيح، ثم قيم المفاتيح التي تغيّرت فقط. يعيد قائمة المفاتيح التي تغيّرت محليًا
    async function pull(storeId) {
        const xhr = await request('GET', API + '?select=key,updated_at&store_id=eq.' + encodeURIComponent(storeId) + '&key=like.store*');
        if (!ok(xhr)) return null;
        const remote = JSON.parse(xhr.responseText).filter(r => isSyncKey(r.key));

        const versions = loadState('Versions', storeId);
        const held = heldBack(storeId);
        const changed = remote.filter(r => versions[r.key] !== r.updated_at && !held(r.key)).map(r => r.key);

        // نجلب كل القيم أولًا، ثم نطبقها على الجهاز دفعة واحدة دون انتظار بينها
        const rows = [];
        for (let i = 0; i < changed.length; i += 50) {
            const part = changed.slice(i, i + 50);
            const res = await request('GET', API + '?select=key,value,updated_at&store_id=eq.' + encodeURIComponent(storeId) + '&key=in.' + inList(part));
            if (!ok(res)) return null;
            JSON.parse(res.responseText).forEach(r => rows.push(r));
        }

        const before = {};
        const chunks = new Map(); // القائمة -> (الصف -> سجلاته)
        const legacy = []; // صفوف كاملة قديمة لقوائم صارت مقسّمة
        const snapshot = key => { if (!(key in before)) before[key] = getLocal(key); };
        const latest = loadState('Versions', storeId);
        const heldNow = heldBack(storeId);

        rows.forEach(r => {
            // حفظت الصفحة هذا المفتاح أثناء السحب: نتركه لرفعها
            if (heldNow(r.key)) return;
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
            latest[r.key] = r.updated_at;
        });
        saveState('Versions', storeId, latest);

        chunks.forEach((map, base) => {
            const arr = parseArray(getLocal(base)) || [];
            const out = replaceChunks(base, arr, map);
            if (out.length) setLocal(base, JSON.stringify(out));
            else removeLocal(base);
            lastSeenRaw[base] = undefined;
        });

        for (const { key, row } of legacy) await absorbLegacy(storeId, key, row, snapshot);

        const applied = [];
        Object.keys(before).forEach(k => {
            const now = getLocal(k);
            if (before[k] !== now) applied.push([k, before[k], now]);
        });
        return { remoteKeys: new Set(remote.map(r => r.key)), applied };
    }

    // نقل قائمة من صفها القديم الكامل إلى الصفوف المقسّمة، ثم وضع علامة حذف مكانه.
    // يحدث مرة عند الترقية، وكلما كتب جهاز ما زالت عليه النسخة القديمة. لا يحذف شيئًا: يضيف فقط
    async function absorbLegacy(storeId, key, row, snapshot) {
        const legacyArr = parseArray(row.value) || [];
        snapshot(key);
        const localArr = parseArray(getLocal(key)) || [];
        const have = new Set(localArr.map(x => JSON.stringify(x)));
        const merged = localArr.concat(legacyArr.filter(x => !have.has(JSON.stringify(x))));
        const raw = JSON.stringify(merged);
        setLocal(key, raw);
        lastSeenRaw[key] = undefined;
        // نرفع كل صفوف القائمة دون حذف شيء منها، ثم نعلّم الصف القديم محذوفًا
        if (!(await push(storeId, key, raw, new Set()))) return;
        const res = await writeRow(storeId, key, DELETED, row);
        if (res.updatedAt) {
            const versions = loadState('Versions', storeId);
            versions[key] = res.updatedAt;
            saveState('Versions', storeId, versions);
        }
    }

    // يرفع ما فشل رفعه سابقًا (انقطاع الإنترنت مثلًا)
    async function pushDirty(storeId) {
        const dirty = loadState('Dirty', storeId);
        for (const key of Object.keys(dirty)) {
            // حفظته الصفحة الآن وسيُرفع من الطابور
            if (inFlight[chunkBase(key) || key]) continue;
            const knownSet = new Set(dirty[key] || []);
            const base = chunkBase(key);
            if (base) {
                await pushKey(storeId, key, JSON.stringify(localChunk(base, key.slice(base.length + 1))), knownSet);
                continue;
            }
            const value = getLocal(key);
            // قائمة مقسّمة سُجلت كاملة: تُرفع الآن مقسّمة (الصفوف التي تفشل تُسجَّل وحدها)
            if (isChunked(key)) clearDirty(storeId, key);
            await push(storeId, key, value === null ? DELETED : value, knownSet);
        }
    }

    async function sync(storeId, notify) {
        await pushDirty(storeId);
        const result = await pull(storeId);
        if (!result) return false;
        setLocal(stateKey('Last', storeId), new Date().toISOString());
        if (notify) result.applied.forEach(([k, o, n]) => notifyPage(k, o, n));
        return result;
    }

    // ===== الطابور: عملية مزامنة واحدة في كل لحظة وبالترتيب =====
    let queue = Promise.resolve();
    let busy = 0;

    function setBusy(delta) {
        busy += delta;
        try { window.dispatchEvent(new CustomEvent('storesync', { detail: { busy: busy > 0 } })); } catch (e) { }
    }

    function enqueue(task) {
        setBusy(1);
        const run = queue.then(task).catch(err => {
            console.warn('تعذرت المزامنة:', err);
            return false;
        }).finally(() => setBusy(-1));
        queue = run;
        return run;
    }

    // ===== 1) عند فتح الصفحة: عزل المتجر فورًا، ثم المزامنة في الخلفية =====
    // البيانات المحلية لا تُستخدم إلا إذا كان مؤكدًا أنها لهذا المتجر.
    // إن كانت لمتجر آخر أو مجهولة المصدر نمسحها قبل أن تقرأها الصفحة، ثم نحمّل المتجر من السحابة
    function isolate(storeId) {
        const owner = getLocal(OWNER_KEY) || getLocal(SYNCED_STORE_KEY);
        const ownedHere = owner === storeId;
        if (!ownedHere) {
            wipeLocal();
            setLocal(OWNER_KEY, storeId);
        }
        return ownedHere;
    }

    // تعيد true عند النجاح. ما يتغير يُبلَّغ للصفحة لتعيد العرض
    async function startupSync(storeId, ownedHere) {
        // أجهزة النسخة القديمة: نرفع مرة واحدة بيانات هذا المتجر المحلية التي ليست في السحابة
        const firstSync = ownedHere && getLocal(stateKey('Versions', storeId)) === null;

        const result = await sync(storeId, true);
        if (!result) return false;

        // القائمة المقسّمة موجودة في السحابة إن وُجد أي صف من صفوفها
        const remoteBases = new Set(result.remoteKeys);
        result.remoteKeys.forEach(k => { const b = chunkBase(k); if (b) remoteBases.add(b); });

        const held = heldBack(storeId);
        const localOnly = Object.keys(localStorage)
            .filter(k => isSyncKey(k) && !chunkBase(k) && !remoteBases.has(k) && !held(k));
        for (const k of localOnly) {
            if (firstSync) {
                await push(storeId, k, getLocal(k), new Set());
            } else {
                // حُذف من السحابة بالطريقة القديمة
                const old = getLocal(k);
                removeLocal(k);
                notifyPage(k, old, null);
            }
        }
        setLocal(SYNCED_STORE_KEY, storeId);
        return true;
    }

    // إذا فشلت مزامنة البداية (جلسة منتهية بعد غياب طويل أو انقطاع) يعيدها auth.js بعد تجديد الجلسة
    let startupFailed = false;
    let startupOwned = false;
    let ready = Promise.resolve(true);

    // مزامنة في الخلفية، دون تكديس طلبات متكررة في الطابور
    let syncQueued = null;
    function scheduleSync() {
        const sid = currentStoreId();
        if (!sid) return Promise.resolve(false);
        if (syncQueued) return syncQueued;
        syncQueued = enqueue(async () => {
            syncQueued = null;
            if (startupFailed) {
                startupFailed = !(await startupSync(sid, startupOwned));
                return !startupFailed;
            }
            return !!(await sync(sid, true));
        });
        return syncQueued;
    }

    // ===== «تذكرني» غير مفعّل: ينتهي الدخول عند إغلاق البرنامج أو المتصفح =====
    // index.html يكتب appSessionTemp عند الدخول، و appSessionAlive يبقى ما دامت النافذة مفتوحة
    (function endTempSession() {
        try {
            if (getLocal('appSessionTemp') !== '1' || sessionStorage.getItem('appSessionAlive') === '1') return;
            const m = readJSON(MEMBERSHIP_KEY);
            const sid = m && m.store_id;
            // تغييرات لم تُرفع بعد: نُبقي الدخول حتى لا تضيع
            if (sid && (Object.keys(loadState('Dirty', sid)).length || Object.keys(loadState('Pending', sid)).length)) {
                sessionStorage.setItem('appSessionAlive', '1');
                return;
            }
            removeLocal(SESSION_TOKEN_KEY);
            removeLocal(MEMBERSHIP_KEY);
            removeLocal('appSessionTemp');
            wipeLocal();
        } catch (e) { }
    })();

    const storeId = currentStoreId();
    if (storeId) {
        startupOwned = isolate(storeId);
        recoverPending(storeId);
        startupFailed = true;
        ready = scheduleSync();

        // عند الرجوع إلى الصفحة، وكل دقيقة أثناء فتحها، نجلب ما تغيّر من الأجهزة الأخرى
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) scheduleSync();
        });
        setInterval(() => {
            if (!document.hidden && navigator.onLine !== false) scheduleSync();
        }, SYNC_EVERY);
    }

    // ===== 2) تتبّع القراءة، ورفع كل تغيير في الخلفية فور حدوثه =====
    Storage.prototype.getItem = function (key) {
        const value = originalGet.call(this, key);
        if (this === localStorage && isSyncKey(key)) remember(key, value);
        return value;
    };

    // يسجل المفتاح "بانتظار الرفع" على الجهاز فورًا، ثم يرفعه من الطابور
    function queuePush(sid, key, raw, previous) {
        const live = known[key];
        const knownCopy = new Set(live || []);
        markPending(sid, key, knownCopy);
        if (raw !== DELETED) markBase(sid, key, previous);
        inFlight[key] = (inFlight[key] || 0) + 1;
        enqueue(async () => {
            let done = false;
            try {
                done = await push(sid, key, raw, raw === DELETED ? null : knownCopy, previous, live);
            } finally {
                inFlight[key]--;
                // الرفع الأخير لهذا المفتاح انتهى: إن فشل فهو مسجل في Dirty ويُعاد لاحقًا
                if (!inFlight[key]) {
                    delete inFlight[key];
                    clearPending(sid, key);
                }
            }
            return done;
        });
    }

    Storage.prototype.setItem = function (key, value) {
        const tracked = this === localStorage && isSyncKey(key) && !chunkBase(key);
        const previous = tracked ? originalGet.call(this, key) : null;
        originalSet.call(this, key, value);
        const sid = currentStoreId();
        if (tracked && sid) {
            const raw = String(value);
            queuePush(sid, key, raw, previous);
            // نتذكر ما كتبته الصفحة فقط، لا ما أضافه الدمج، لأن الصفحة لم تره بعد
            remember(key, raw);
        }
    };

    Storage.prototype.removeItem = function (key) {
        originalRemove.call(this, key);
        const sid = currentStoreId();
        if (this === localStorage && isSyncKey(key) && !chunkBase(key) && sid) {
            queuePush(sid, key, DELETED, undefined);
            delete known[key];
            delete lastSeenRaw[key];
        }
    };

    function pendingCount(sid) {
        const keys = new Set([...Object.keys(loadState('Dirty', sid)), ...Object.keys(loadState('Pending', sid))]);
        return keys.size;
    }

    window.StoreSync = {
        // تنتهي بعد أول مزامنة للصفحة (أو فشلها)
        ready,
        // يرفع كل ما لم يُرفع وينتظر انتهاءه؛ يعيد عدد المفاتيح التي بقيت دون رفع
        async flush(timeoutMs) {
            const sid = currentStoreId();
            if (!sid) return 0;
            const work = enqueue(() => pushDirty(sid));
            if (timeoutMs) await Promise.race([work, new Promise(r => setTimeout(r, timeoutMs))]);
            else await work;
            return pendingCount(sid);
        },
        // عند تسجيل الخروج: لا تبقى بيانات المتجر على الجهاز للمستخدم التالي
        clearLocal: wipeLocal,
        // يعيد مزامنة البداية إن كانت قد فشلت؛ يستدعيه auth.js بعد التحقق من الجلسة وتجديدها
        async retryIfFailed() {
            if (!startupFailed || !currentStoreId()) return false;
            return scheduleSync();
        },
        // حالة المزامنة: pending = تغييرات فشل رفعها أو ما زالت ترفع، busy = مزامنة جارية الآن
        status() {
            const sid = currentStoreId();
            const offline = navigator.onLine === false;
            if (!sid) return { pending: 0, failed: 0, lastSync: null, offline, busy: false };
            return {
                pending: pendingCount(sid),
                failed: Object.keys(loadState('Dirty', sid)).length,
                lastSync: getLocal(stateKey('Last', sid)),
                offline,
                busy: busy > 0
            };
        },
        // يجلب أحدث البيانات؛ timeoutMs: لا ننتظر أكثر منها (تكمل المزامنة في الخلفية)
        async refresh(timeoutMs) {
            const work = scheduleSync();
            if (!timeoutMs) return work;
            return Promise.race([work, new Promise(r => setTimeout(() => r(false), timeoutMs))]);
        }
    };
})();
