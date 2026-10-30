/* auth.js — تسجيل الدخول عبر Supabase، وحماية الصفحات، والقائمة الجانبية المشتركة، وتسجيل الدخول والخروج في سجل العمليات */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const FUNCTION_URL = SUPABASE_URL + '/functions/v1/create-employee';
    const SUPABASE_LIB = 'vendor/supabase-js-2.45.4.js';
    const INTERNAL_EMAIL_DOMAIN = 'users.storeapp.io';
    const LOGIN_PAGE = 'index.html';
    const HOME_PAGE = 'home.html';
    // الإعدادات متاحة للجميع: الموظف يرى فيها حسابه وإعدادات جهازه فقط
    const ADMIN_ONLY_PAGES = ['log.html', 'users.html'];
    // صفحات فرعية تُميَّز في القائمة بصفحتها الأم
    const PARENT_PAGE = { 'add-invoice.html': 'sales-new_1.html' };
    const SETTINGS_KEY = 'storeSettings';
    // خيارات البيع والمخزون على مستوى المتجر (تُزامن، يعدّلها المدير)
    const OPTIONS_KEY = 'storeOptions';
    const SESSION_TOKEN_KEY = 'sb-pxxgydllfustqkpkfiqn-auth-token';
    // حالة اشتراك المتجر (تُحدَّث من السحابة عند كل صفحة، وتُستخدم فورًا عند الفتح التالي)
    const SUBSCRIPTION_KEY = 'appSubscription';
    const EXPIRED_PAGE = 'expired.html';
    // بيانات تواصل المزود تظهر في صفحة انتهاء الاشتراك؛ اكتب رقمك هنا
    const SUPPORT_CONTACT = '07762525551';
    // مهلة بعد انتهاء الاشتراك (أيام) قبل الإيقاف، والتنبيه قبل الانتهاء (أيام)؛ مطابقة لـ provider.sql
    const GRACE_DAYS = 3;
    const WARN_DAYS = 7;
    // بيانات العضوية محليًا؛ لا تبدأ بـ store حتى لا تُزامن، ويقرأها storage.js لمعرفة المتجر
    const MEMBERSHIP_KEY = 'appMembership';
    // المتجر التجريبي (demo.js): بيانات وهمية على الجهاز، بلا حساب ولا سحابة
    const DEMO_KEY = 'appDemo';
    const DEMO = (() => { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch { return false; } })();
    // يحفظ معرف المتجر الذي اكتملت مزامنته محليًا (يكتبه storage.js)
    const SYNCED_STORE_KEY = 'appSyncedStore';
    // علامة مؤقتة: تسجيل دخول جديد ينتظر كتابته في السجل بعد اكتمال المزامنة
    const PENDING_LOGIN_KEY = 'pendingLoginLog';

    const page = (location.pathname.split('/').pop() || HOME_PAGE).toLowerCase();
    const isLogin = page === LOGIN_PAGE;

    const DEFAULT_STORE = {
        name: 'اسم المتجر',
        address: 'المدينة - الشارع',
        phone: '',
        email: '',
        website: '',
        logo: '',
        policies: [
            'إستبدال واسترجاع المنتج خلال 30 يوم',
            'استرجاع المنتجات بأصل الفاتورة',
            'لا يمكن استبدال المنتجات التي لم تعد في حالتها الأصلية'
        ],
        footer: 'شكرًا لتسوقكم وثقتكم بنا!'
    };

    const DEFAULT_OPTIONS = {
        allowNegativeStock: false,
        defaultPayment: 'نقدي',
        defaultMinQty: 0
    };

    function read(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key));
            return value ?? fallback;
        } catch {
            return fallback;
        }
    }

    function write(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function saveMembership(m) {
        localStorage.setItem(MEMBERSHIP_KEY, JSON.stringify(m));
    }

    function esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function roleLabel(role) {
        return role === 'admin' ? 'مدير' : 'موظف مبيعات';
    }

    function displayName(m) {
        return (m && (m.display_name || m.username)) || '';
    }

    // كتابة في سجل العمليات، ولا توقف الدخول أو الخروج عند أي خطأ
    function writeLog(action, entity, details) {
        try {
            if (window.StoreLog) StoreLog.add(action, entity, details);
        } catch (err) {
            console.error('تعذر تسجيل العملية:', err);
        }
    }

    function getStoreInfo() {
        return { ...DEFAULT_STORE, ...read(SETTINGS_KEY, {}) };
    }

    function saveStoreInfo(info) {
        write(SETTINGS_KEY, { ...DEFAULT_STORE, ...info });
    }

    function getStoreOptions() {
        return { ...DEFAULT_OPTIONS, ...read(OPTIONS_KEY, {}) };
    }

    function saveStoreOptions(options) {
        write(OPTIONS_KEY, { ...getStoreOptions(), ...options });
    }

    // ===== تحميل مكتبة Supabase ثم إنشاء العميل =====
    let sb = null;
    let membership = null; // { store_id, role, display_name, username }

    function loadLibrary() {
        return new Promise((resolve, reject) => {
            if (window.supabase) return resolve();
            const s = document.createElement('script');
            s.src = SUPABASE_LIB;
            s.onload = resolve;
            s.onerror = () => {
                s.remove();
                reject(new Error('تعذر تحميل مكتبة Supabase'));
            };
            document.head.appendChild(s);
        });
    }

    function makeClient() {
        return loadLibrary().then(() => {
            sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
                auth: { persistSession: true, autoRefreshToken: true }
            });
        });
    }

    let clientReady = DEMO ? Promise.resolve() : makeClient();

    // إذا فشل تحميل المكتبة (بدون إنترنت) نعيد المحاولة عند الحاجة
    function ensureClient() {
        return clientReady.catch(() => (clientReady = makeClient()));
    }

    // اسم المستخدم يتحول إلى البريد الداخلي، والبريد الكامل يُستخدم كما هو
    function usernameToEmail(input) {
        const v = String(input).trim().toLowerCase();
        return v.includes('@') ? v : `${v}@${INTERNAL_EMAIL_DOMAIN}`;
    }

    async function loadMembership(userId) {
        const { data, error } = await sb
            .from('store_members')
            .select('store_id, role, display_name, username')
            .eq('user_id', userId)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    async function getSession() {
        if (DEMO) return null;
        await ensureClient();
        const { data } = await sb.auth.getSession();
        return data.session;
    }

    async function login(username, password) {
        if (navigator.onLine === false) throw new Error('لا يوجد اتصال بالإنترنت. أول تسجيل دخول على الجهاز يحتاج إنترنت');
        await ensureClient();
        const { data, error } = await sb.auth.signInWithPassword({
            email: usernameToEmail(username),
            password
        });
        if (error || !data.user) throw new Error('اسم المستخدم أو كلمة المرور غير صحيحة');

        const m = await loadMembership(data.user.id);
        if (!m) {
            await sb.auth.signOut();
            throw new Error('هذا الحساب غير مرتبط بأي متجر');
        }
        membership = m;

        // الجهاز موقوف من المدير، أو وصل المتجر للحد الأعلى من الأجهزة
        const dev = await deviceCheckin(true);
        if (dev && (dev.status === 'revoked' || dev.status === 'limit')) {
            membership = null;
            await sb.auth.signOut({ scope: 'local' });
            throw new Error(deviceBlockedMessage(dev));
        }
        saveMembership(m);

        // نؤجل كتابة سجل الدخول إلى الصفحة التالية، بعد اكتمال مزامنة المتجر
        try { sessionStorage.setItem(PENDING_LOGIN_KEY, '1'); } catch (e) {}
        return m;
    }

    // الخروج من التجربة: تُمسح كل بياناتها الوهمية
    function exitDemo() {
        if (window.StoreSync) StoreSync.clearLocal();
        [DEMO_KEY, MEMBERSHIP_KEY, SUBSCRIPTION_KEY].forEach(k => localStorage.removeItem(k));
        location.replace(LOGIN_PAGE);
    }

    async function logout() {
        if (DEMO) return exitDemo();
        // تغييرات لم تصل إلى السحابة ستضيع، لأننا نمسح بيانات المتجر من الجهاز عند الخروج
        if (window.StoreSync && (await StoreSync.flush(10000)) > 0 &&
            !confirm('توجد تغييرات لم تُرفع إلى السحابة بعد (تحقق من الإنترنت). الخروج الآن سيحذفها من هذا الجهاز. هل تريد الخروج؟')) {
            return;
        }

        // نسجّل الخروج قبل حذف الجلسة، لأن المزامنة تحتاج رمز الدخول
        writeLog('logout', 'تسجيل خروج', 'خرج المستخدم ' + displayName(membership));
        try { sessionStorage.removeItem(PENDING_LOGIN_KEY); } catch (e) {}

        // بدون إنترنت لا يرد الخادم، ومكتبة الدخول عندها تُبقي الجلسة؛ فننتظر 5 ثوانٍ على الأكثر
        // ثم نحذف الجلسة من الجهاز بأنفسنا، حتى يتم الخروج في كل الأحوال
        try {
            await Promise.race([
                ensureClient().then(() => sb.auth.signOut(navigator.onLine === false ? { scope: 'local' } : undefined)),
                new Promise(resolve => setTimeout(resolve, 5000))
            ]);
        } catch (e) { }
        localStorage.removeItem(SESSION_TOKEN_KEY);
        membership = null;
        localStorage.removeItem(MEMBERSHIP_KEY);
        // حتى لا يرى المستخدم التالي على هذا الجهاز بيانات متجر آخر
        if (window.StoreSync) StoreSync.clearLocal();
        location.replace(LOGIN_PAGE);
    }

    // يكتب سجل الدخول مرة واحدة بعد أن تكون بيانات المتجر محمّلة محليًا
    function flushPendingLogin() {
        try {
            if (sessionStorage.getItem(PENDING_LOGIN_KEY) !== '1') return;
            if (!window.StoreLog || !membership) return;
            if (localStorage.getItem(SYNCED_STORE_KEY) !== membership.store_id) return;

            writeLog('login', 'تسجيل دخول', 'دخل المستخدم ' + displayName(membership));
            sessionStorage.removeItem(PENDING_LOGIN_KEY);
        } catch (err) {
            console.error(err);
        }
    }

    function currentUser() {
        return membership;
    }

    // ===== الاشتراك =====
    function todayLocal() {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 10);
    }

    // نفس قاعدة الخادم: تنبيه قبل الانتهاء، ومهلة بعده، ثم إيقاف
    function subscriptionStatus(sub) {
        if (!sub) return { status: 'none', daysLeft: null };
        const daysLeft = sub.expires_at
            ? Math.round((Date.parse(sub.expires_at) - Date.parse(todayLocal())) / 86400000)
            : null;
        if (sub.suspended) return { status: 'suspended', daysLeft };
        if (daysLeft === null || daysLeft > WARN_DAYS) return { status: 'active', daysLeft };
        if (daysLeft >= 0) return { status: 'expiring', daysLeft };
        if (daysLeft >= -GRACE_DAYS) return { status: 'grace', daysLeft };
        return { status: 'expired', daysLeft };
    }

    const isBlocked = st => st.status === 'expired' || st.status === 'suspended';

    // الحالة المحفوظة على الجهاز، محسوبة بتاريخ اليوم (فتنتهي في موعدها حتى دون اتصال)
    function cachedSubscription(storeId) {
        const c = read(SUBSCRIPTION_KEY, null);
        if (!c || c.store_id !== storeId) return null;
        return { ...c, ...subscriptionStatus(c.row) };
    }

    // يجلب اشتراك المتجر من السحابة؛ يعيد null إذا تعذر (أو لم يُنشأ جدول الاشتراكات بعد)
    async function fetchSubscription() {
        if (DEMO || !membership) return null;
        try {
            const { data, error } = await sb
                .from('store_subscriptions')
                .select('expires_at, suspended')
                .eq('store_id', membership.store_id)
                .maybeSingle();
            if (error) return null;
            write(SUBSCRIPTION_KEY, { store_id: membership.store_id, row: data, checkedAt: new Date().toISOString() });
            return { row: data, ...subscriptionStatus(data) };
        } catch {
            return null;
        }
    }

    // تنبيه أعلى الصفحة: للمدير قبل الانتهاء، وللجميع خلال المهلة
    function showSubscriptionBanner(st) {
        document.querySelectorAll('.sub-banner').forEach(el => el.remove());
        if (!st || !st.row) return;
        const expires = st.row.expires_at;
        let text = '';
        if (st.status === 'grace') {
            const left = GRACE_DAYS + st.daysLeft;
            text = left > 0
                ? `انتهى اشتراك المتجر في ${expires}. سيتوقف البرنامج بعد ${left} يوم ما لم يُجدَّد.`
                : `انتهى اشتراك المتجر في ${expires}. سيتوقف البرنامج غدًا ما لم يُجدَّد.`;
        } else if (st.status === 'expiring' && membership && membership.role === 'admin') {
            text = st.daysLeft === 0
                ? `ينتهي اشتراك المتجر اليوم (${expires}). تواصل مع المزود للتجديد.`
                : `ينتهي اشتراك المتجر بعد ${st.daysLeft} يوم (${expires}). تواصل مع المزود للتجديد.`;
        }
        const main = document.querySelector('body > main');
        if (!text || !main) return;
        const banner = document.createElement('div');
        banner.className = 'sub-banner' + (st.status === 'grace' ? ' urgent' : '');
        banner.setAttribute('role', 'status');
        banner.textContent = text;
        main.prepend(banner);
    }

    function applySubscription(st) {
        if (!st) return;
        if (isBlocked(st)) {
            if (page !== EXPIRED_PAGE) location.replace(EXPIRED_PAGE);
            return;
        }
        if (page === EXPIRED_PAGE) {
            location.replace(HOME_PAGE);
            return;
        }
        showSubscriptionBanner(st);
    }

    // ===== الحساب والأمان =====
    // نتحقق من كلمة المرور الحالية أولًا، ثم نغيّرها لحساب المستخدم الحالي فقط
    async function changePassword(current, next) {
        if (DEMO) throw new Error('غير متاح في النسخة التجريبية');
        await ensureClient();
        const { data } = await sb.auth.getSession();
        const email = data.session && data.session.user && data.session.user.email;
        if (!email) throw new Error('انتهت الجلسة، سجّل الدخول من جديد');

        const check = await sb.auth.signInWithPassword({ email, password: current });
        if (check.error) throw new Error('كلمة المرور الحالية غير صحيحة');

        const { error } = await sb.auth.updateUser({ password: next });
        if (error) {
            throw new Error(/different/i.test(error.message)
                ? 'كلمة المرور الجديدة يجب أن تختلف عن الحالية'
                : 'تعذر تغيير كلمة المرور');
        }
        writeLog('settings', 'كلمة المرور', 'غيّر المستخدم ' + displayName(membership) + ' كلمة مروره');
    }

    // يلغي جلسات هذا الحساب على كل الأجهزة الأخرى، ويبقى هذا الجهاز مسجّلًا
    async function signOutOthers() {
        if (DEMO) throw new Error('غير متاح في النسخة التجريبية');
        await ensureClient();
        const { error } = await sb.auth.signOut({ scope: 'others' });
        if (error) throw new Error('تعذر تسجيل الخروج من الأجهزة الأخرى');
        writeLog('settings', 'الأمان', 'سجّل المستخدم ' + displayName(membership) + ' الخروج من الأجهزة الأخرى');
    }

    // ===== الأجهزة: كل جهاز يسجّل نفسه، والمدير يرى القائمة ويوقف أي جهاز (devices.sql) =====
    const DEVICE_ID_KEY = 'appDeviceId';
    const DEVICE_CHECK_KEY = 'appDeviceCheck';
    const FORCED_OUT_KEY = 'appForcedOut';
    const DEVICE_CHECK_MS = 60000;

    // معرّف ثابت لهذا المتصفح، لا يُمسح عند تسجيل الخروج
    function deviceId() {
        let id = localStorage.getItem(DEVICE_ID_KEY);
        if (!id || id.length < 8) {
            id = window.crypto && crypto.randomUUID
                ? crypto.randomUUID()
                : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
            localStorage.setItem(DEVICE_ID_KEY, id);
        }
        return id;
    }

    async function deviceInfo() {
        const ua = navigator.userAgent || '';
        const platform =
            /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'آيباد'
                : /iPhone|iPod/.test(ua) ? 'آيفون'
                    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'أندرويد' : 'تابلت أندرويد')
                        : /Windows/.test(ua) ? 'ويندوز'
                            : /Mac OS X|Macintosh/.test(ua) ? 'ماك'
                                : /CrOS/.test(ua) ? 'كروم بوك'
                                    : /Linux/.test(ua) ? 'لينكس' : 'جهاز آخر';
        const browser =
            /Edg\//.test(ua) ? 'Edge'
                : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
                    : /OPR\/|Opera/.test(ua) ? 'Opera'
                        : /Firefox|FxiOS/.test(ua) ? 'Firefox'
                            : /CriOS|Chrome/.test(ua) ? 'Chrome'
                                : /Safari/.test(ua) ? 'Safari' : '';
        let model = '';
        try {
            if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
                const v = await navigator.userAgentData.getHighEntropyValues(['model']);
                model = v.model || '';
            }
        } catch (e) { }
        if (!model) {
            const m = ua.match(/Android [\d.]+; ([^;)]+)\)/);
            if (m && m[1] !== 'K') model = m[1].replace(/ Build\/.*$/, '').trim();
        }
        let installed = false;
        try {
            installed = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
        } catch (e) { }
        return { platform, browser, model: model.slice(0, 60), installed };
    }

    // يسجّل الجهاز ويحدّث آخر نشاط. null = تعذر التحقق (لا إنترنت، أو لم يُشغَّل devices.sql بعد): لا نمنع شيئًا
    async function deviceCheckin(force) {
        if (DEMO || !membership || navigator.onLine === false) return null;
        const last = read(DEVICE_CHECK_KEY, null);
        if (!force && last && last.store === membership.store_id && last.status === 'ok' && Date.now() - last.at < DEVICE_CHECK_MS) return last;
        try {
            const info = await deviceInfo();
            const { data, error } = await sb.rpc('device_checkin', {
                p_store: membership.store_id,
                p_device: deviceId(),
                p_platform: info.platform,
                p_browser: info.browser,
                p_model: info.model,
                p_installed: info.installed
            });
            if (error || !data || !data.status) return null;
            const out = { ...data, store: membership.store_id, at: Date.now() };
            write(DEVICE_CHECK_KEY, out);
            return out;
        } catch {
            return null;
        }
    }

    function deviceBlockedMessage(dev) {
        return dev.status === 'revoked'
            ? 'هذا الجهاز موقوف من مدير المتجر. اطلب منه إعادة السماح له من صفحة المستخدمين'
            : `وصل المتجر للحد الأعلى من الأجهزة (${dev.limit}). اطلب من المدير إيقاف جهاز لا يُستخدم من صفحة المستخدمين، أو تواصل مع المزود لزيادة الحد`;
    }

    // جهاز أُوقف وهو داخل: نرفع ما لم يُرفع ثم نخرجه
    async function applyDevice(dev) {
        if (!dev || (dev.status !== 'revoked' && dev.status !== 'limit')) return;
        let pending = 0;
        try { if (window.StoreSync) pending = await StoreSync.flush(10000); } catch (e) { }
        try { sessionStorage.setItem(FORCED_OUT_KEY, deviceBlockedMessage(dev)); } catch (e) { }
        try { await Promise.race([sb.auth.signOut({ scope: 'local' }), new Promise(r => setTimeout(r, 5000))]); } catch (e) { }
        localStorage.removeItem(SESSION_TOKEN_KEY);
        membership = null;
        localStorage.removeItem(MEMBERSHIP_KEY);
        // تغييرات لم تُرفع تبقى على الجهاز حتى لا تضيع مبيعات مسجلة
        if (window.StoreSync && !pending) StoreSync.clearLocal();
        location.replace(LOGIN_PAGE);
    }

    // سبب الخروج الإجباري لصفحة الدخول (مرة واحدة)
    function takeForcedOutMessage() {
        try {
            const v = sessionStorage.getItem(FORCED_OUT_KEY);
            sessionStorage.removeItem(FORCED_OUT_KEY);
            return v || '';
        } catch {
            return '';
        }
    }

    // ===== الحماية =====
    // لا إنترنت (أو تعذر تجديد الجلسة بسبب الشبكة) ومعنا دخول محفوظ: نكمل بالبيانات المحفوظة
    function offlineFallback() {
        const cached = read(MEMBERSHIP_KEY, null);
        if (!optimistic || !cached || !cached.store_id) return false;
        membership = cached;
        return !(ADMIN_ONLY_PAGES.includes(page) && membership.role !== 'admin');
    }

    async function guard() {
        await ensureClient();
        // بدأت التجربة من صفحة الدخول أثناء التحقق: لا نمسح دخولها الوهمي
        if (localStorage.getItem(DEMO_KEY) === '1') return false;
        const { data, error } = await sb.auth.getSession();
        const session = data && data.session;

        // فقط عند خطأ شبكة؛ جلسة ملغاة أو منتهية فعلًا تعيد إلى صفحة الدخول
        const networkError = navigator.onLine === false || (error && /retryable|fetch|network/i.test((error.name || '') + ' ' + (error.message || '')));
        if (!session && networkError && offlineFallback()) return true;

        if (!session) {
            localStorage.removeItem(MEMBERSHIP_KEY);
            if (!isLogin) location.replace(LOGIN_PAGE);
            return false;
        }

        const cached = read(MEMBERSHIP_KEY, null);

        if (cached && cached.store_id) {
            // نعرض الصفحة فورًا بالبيانات المحفوظة، ونتحقق من الخادم في الخلفية
            membership = cached;
            revalidateMembership(session.user.id);
        } else {
            try {
                membership = await loadMembership(session.user.id);
                if (membership) saveMembership(membership);
            } catch {
                // خطأ شبكة: لا نسجّل الخروج، نعيد المستخدم لصفحة الدخول فقط
                if (offlineFallback()) return true;
                membership = null;
                if (!isLogin) location.replace(LOGIN_PAGE);
                return false;
            }
        }

        if (!membership) {
            // حساب بلا متجر: نسجّل خروجه
            await sb.auth.signOut();
            localStorage.removeItem(MEMBERSHIP_KEY);
            if (!isLogin) location.replace(LOGIN_PAGE);
            return false;
        }

        if (isLogin) {
            location.replace(HOME_PAGE);
            return false;
        }

        if (ADMIN_ONLY_PAGES.includes(page) && membership.role !== 'admin') {
            location.replace(HOME_PAGE);
            return false;
        }

        return true;
    }

    // يتحقق من العضوية في الخلفية؛ إذا أُزيل الحساب من المتجر يسجّل خروجه
    async function revalidateMembership(userId) {
        try {
            const m = await loadMembership(userId);
            if (!m) {
                await sb.auth.signOut();
                localStorage.removeItem(MEMBERSHIP_KEY);
                location.replace(LOGIN_PAGE);
                return;
            }
            membership = m;
            saveMembership(m);
        } catch {
            // خطأ شبكة: نبقى على البيانات المحفوظة
        }
    }

    // ===== الواجهة المشتركة =====
    function addLink(nav, href, text) {
        if (nav.querySelector(`a[href="${href}"], a[data-href="${href}"]`)) return;
        const a = document.createElement('a');
        a.href = href;
        a.textContent = text;
        nav.appendChild(a);
    }

    function buildUI() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar || !membership) return;

        if (membership.role !== 'admin') {
            ADMIN_ONLY_PAGES.forEach(p => {
                sidebar.querySelectorAll(`a[href="${p}"], a[data-href="${p}"]`).forEach(a => a.remove());
            });
        } else {
            const nav = sidebar.querySelector('nav:not(.bottom)');
            if (nav) {
                addLink(nav, 'users.html', 'المستخدمين');
                addLink(nav, 'log.html', 'سجل العمليات');
            }
        }

        // ماسح الباركود بالهاتف متاح لكل المستخدمين
        const bottomNav = sidebar.querySelector('nav.bottom');
        if (bottomNav) addLink(bottomNav, 'scanner.html', 'ماسح الهاتف');

        const current = PARENT_PAGE[page] || page;
        sidebar.querySelectorAll('nav a[href], nav a[data-href]').forEach(a => {
            const isCurrent = (a.getAttribute('href') || a.dataset.href) === current;
            a.classList.toggle('active', isCurrent);
            if (isCurrent) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });

        // الصفحات القديمة التي لا تحتوي القائمة الكاملة في HTML
        if (!sidebar.querySelector('.side-brand')) {
            const brand = document.createElement('div');
            brand.className = 'side-brand';
            brand.innerHTML = `
                <span class="logo" data-store-logo></span>
                <span class="name"><span data-store-name></span><span class="sub" data-user-role></span></span>`;
            sidebar.prepend(brand);
        }

        if (!document.getElementById('userBox')) {
            const box = document.createElement('div');
            box.id = 'userBox';
            box.innerHTML = `
                <a class="who-link" href="settings.html#account" title="حسابي">
                    <span class="avatar" data-account-logo aria-hidden="true"></span>
                    <span class="who"><b data-user-name></b><small data-user-role></small></span>
                </a>
                <button type="button" id="logoutBtn" title="تسجيل الخروج" aria-label="تسجيل الخروج">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 16l-4-4 4-4M6 12h10"/></svg>
                </button>`;
            sidebar.appendChild(box);
        }

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn && !logoutBtn.dataset.bound) {
            logoutBtn.dataset.bound = '1';
            logoutBtn.addEventListener('click', logout);
        }

        refreshBrand();
    }

    // شعار المتجر يظهر في أعلى القائمة وفي صندوق الحساب؛ وبدونه أول حرف من الاسم
    function refreshBrand() {
        if (!membership) return;
        const info = getStoreInfo();
        const logo = info.logo ? `<img src="${esc(info.logo)}" alt="">` : '';

        document.querySelectorAll('[data-store-logo]').forEach(el => {
            el.innerHTML = logo || esc((info.name || '').trim().charAt(0) || 'م');
        });
        document.querySelectorAll('[data-store-name]').forEach(el => {
            el.textContent = info.name;
        });
        document.querySelectorAll('[data-account-logo]').forEach(el => {
            el.innerHTML = logo || esc(displayName(membership).trim().charAt(0).toUpperCase());
            el.classList.toggle('has-logo', !!logo);
        });
        document.querySelectorAll('[data-user-name]').forEach(el => {
            el.textContent = displayName(membership);
        });
        document.querySelectorAll('[data-user-role]').forEach(el => {
            el.textContent = roleLabel(membership.role);
        });
        document.querySelectorAll('.brand span').forEach(el => {
            el.textContent = `"${info.name}"`;
        });
    }

    // عند تغيير الشعار من جهاز أو صفحة أخرى
    window.addEventListener('storage', e => {
        if (e.key === SETTINGS_KEY) refreshBrand();
    });

    function whenDomReady() {
        return document.readyState === 'loading'
            ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
            : Promise.resolve();
    }

    // إذا كان على الجهاز دخول سابق محفوظ نعرض الصفحة فورًا بالبيانات المحفوظة
    // (التحقق من الخادم يكمل في الخلفية ويعيد إلى صفحة الدخول إن فشل)،
    // وإلا نخفي الصفحة حتى نعرف هل المستخدم مسموح له بها
    const cachedAtStart = read(MEMBERSHIP_KEY, null);
    let hasStoredSession = false;
    try { hasStoredSession = !!localStorage.getItem(SESSION_TOKEN_KEY); } catch (e) { }
    const optimistic = !isLogin && !!(cachedAtStart && cachedAtStart.store_id && (hasStoredSession || DEMO));

    if (optimistic) {
        membership = cachedAtStart;
        if (ADMIN_ONLY_PAGES.includes(page) && cachedAtStart.role !== 'admin') location.replace(HOME_PAGE);
        // اشتراك منتهٍ أو متجر موقوف: نتحول فورًا دون انتظار السحابة
        const sub = cachedSubscription(cachedAtStart.store_id);
        if (sub && isBlocked(sub) && page !== EXPIRED_PAGE) location.replace(EXPIRED_PAGE);
        else if (sub) whenDomReady().then(() => showSubscriptionBanner(sub));
        // القائمة تكتمل قبل أول رسم للصفحة فلا تقفز عناصرها
        whenDomReady().then(buildUI);
    } else if (!isLogin) {
        document.documentElement.style.visibility = 'hidden';
    }

    // ===== شريط النسخة التجريبية =====
    function showDemoBanner() {
        const main = document.querySelector('body > main');
        if (!main || document.querySelector('.demo-banner')) return;
        const wa = 'https://wa.me/964' + SUPPORT_CONTACT.replace(/^0/, '') + '?text=' +
            encodeURIComponent('مرحبًا، جربت برنامج إدارة المتجر وأريد نسخة لمحلي');
        const bar = document.createElement('div');
        bar.className = 'demo-banner';
        bar.setAttribute('role', 'status');
        bar.innerHTML = `<span><b>نسخة تجريبية</b> — بيانات وهمية للتجربة، ولا يُحفظ شيء.</span>
            <span class="demo-actions">
                <a class="demo-cta" href="${wa}" target="_blank" rel="noopener">أريد البرنامج لمحلي</a>
                <button type="button" class="demo-exit">خروج من التجربة</button>
            </span>`;
        bar.querySelector('.demo-exit').addEventListener('click', exitDemo);
        main.prepend(bar);
    }

    // عميل وهمي للتجربة: أي طلب للسحابة يرجع فارغًا مع رسالة واضحة بدل أن ينكسر
    function demoClient() {
        const res = { data: null, error: { message: 'غير متاح في النسخة التجريبية' }, count: 0 };
        const q = {};
        ['select', 'eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'order', 'limit', 'range', 'insert', 'update', 'upsert', 'delete', 'match', 'is', 'like', 'ilike'].forEach(m => { q[m] = () => q; });
        q.maybeSingle = async () => res;
        q.single = async () => res;
        q.then = (ok, bad) => Promise.resolve(res).then(ok, bad);
        return { from: () => q, rpc: async () => res, auth: { getSession: async () => ({ data: { session: null } }), signOut: async () => ({}) } };
    }

    const ready = DEMO
        ? whenDomReady().then(() => {
            if (isLogin) {
                location.replace(HOME_PAGE);
                return false;
            }
            membership = read(MEMBERSHIP_KEY, null);
            if (!membership) {
                exitDemo();
                return false;
            }
            buildUI();
            showDemoBanner();
            document.documentElement.style.visibility = '';
            return true;
        })
        : clientReady
        .then(guard)
        .then(async ok => {
            await whenDomReady();
            if (ok && !isLogin) {
                // الجلسة جُدّدت الآن إن كانت منتهية: نعيد مزامنة البداية إن فشلت
                if (window.StoreSync && StoreSync.retryIfFailed) StoreSync.retryIfFailed();
                buildUI();
                flushPendingLogin();
                // حالة الاشتراك من السحابة (لا تؤخر ظهور الصفحة)
                fetchSubscription().then(applySubscription);
                deviceCheckin().then(applyDevice);
            }
            return ok;
        })
        .catch(err => {
            console.error('خطأ في تهيئة تسجيل الدخول:', err);
            // بدون إنترنت قد لا تُحمَّل مكتبة الدخول؛ نبقى في الصفحة بالدخول المحفوظ
            if (offlineFallback()) {
                whenDomReady().then(buildUI);
                return true;
            }
            if (!isLogin) location.replace(LOGIN_PAGE);
            return false;
        })
        .finally(() => {
            document.documentElement.style.visibility = '';
        });

    // ===== عودة الاتصال: نجدد الجلسة ثم نرفع ما حُفظ على الجهاز ونجلب الجديد =====
    let syncing = false;
    async function syncNow() {
        if (DEMO || syncing || isLogin || !window.StoreSync || navigator.onLine === false) return;
        syncing = true;
        try {
            try {
                await ensureClient();
                await sb.auth.getSession(); // يجدد رمز الدخول إن كان منتهيًا
            } catch (err) {
                // نرفع بالرمز المحفوظ؛ إن كان منتهيًا تبقى التغييرات وتُعاد المحاولة لاحقًا
            }
            await StoreSync.refresh();
            window.dispatchEvent(new CustomEvent('storesync', { detail: { synced: true } }));
        } catch (err) {
            console.warn('تعذرت المزامنة بعد عودة الاتصال:', err);
        } finally {
            syncing = false;
        }
    }
    window.addEventListener('online', () => setTimeout(syncNow, 800));
    // إذا بقيت تغييرات لم تُرفع (اتصال ضعيف) نعيد المحاولة كل 30 ثانية
    setInterval(() => {
        if (window.StoreSync && StoreSync.status().failed > 0) syncNow();
    }, 30000);

    // آخر نشاط للجهاز (يظهر للمدير «متصل الآن»)، ويخرج الجهاز إذا أوقفه المدير
    setInterval(() => {
        if (!isLogin && membership && !document.hidden) deviceCheckin().then(applyDevice);
    }, 2 * DEVICE_CHECK_MS);
    document.addEventListener('visibilitychange', () => {
        if (!isLogin && membership && !document.hidden) deviceCheckin().then(applyDevice);
    });

    window.StoreAuth = {
        ready,
        client: null, // يُملأ بعد التهيئة، انظر getClient()
        getClient: async () => {
            if (DEMO) return demoClient();
            await ensureClient();
            return sb;
        },
        isDemo: () => DEMO,
        currentUser,
        login,
        logout,
        getSession,
        getStoreInfo,
        saveStoreInfo,
        roleLabel,
        refreshBrand,
        getStoreOptions,
        saveStoreOptions,
        changePassword,
        signOutOthers,
        syncNow,
        deviceId,
        deviceInfo,
        checkDevice: () => deviceCheckin(true).then(dev => { applyDevice(dev); return dev; }),
        takeForcedOutMessage,
        // لصفحة انتهاء الاشتراك
        checkSubscription: () => fetchSubscription().then(st => { applySubscription(st); return st; }),
        subscriptionStatus: () => membership && cachedSubscription(membership.store_id),
        supportContact: SUPPORT_CONTACT,
        config: {
            url: SUPABASE_URL,
            key: SUPABASE_KEY,
            functionUrl: FUNCTION_URL,
            internalDomain: INTERNAL_EMAIL_DOMAIN
        }
    };
    window.getStoreInfo = getStoreInfo;

    clientReady.then(() => { window.StoreAuth.client = sb; }).catch(() => { });
})();
