/* auth.js — تسجيل الدخول عبر Supabase، وحماية الصفحات، والقائمة الجانبية المشتركة، وتسجيل الدخول والخروج في سجل العمليات */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const FUNCTION_URL = SUPABASE_URL + '/functions/v1/create-employee';
    const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
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
    // بيانات العضوية محليًا؛ لا تبدأ بـ store حتى لا تُزامن، ويقرأها storage.js لمعرفة المتجر
    const MEMBERSHIP_KEY = 'appMembership';
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
            s.onerror = () => reject(new Error('تعذر تحميل مكتبة Supabase'));
            document.head.appendChild(s);
        });
    }

    const clientReady = loadLibrary().then(() => {
        sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
            auth: { persistSession: true, autoRefreshToken: true }
        });
    });

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
        await clientReady;
        const { data } = await sb.auth.getSession();
        return data.session;
    }

    async function login(username, password) {
        await clientReady;
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
        saveMembership(m);

        // نؤجل كتابة سجل الدخول إلى الصفحة التالية، بعد اكتمال مزامنة المتجر
        try { sessionStorage.setItem(PENDING_LOGIN_KEY, '1'); } catch (e) {}
        return m;
    }

    async function logout() {
        // تغييرات لم تصل إلى السحابة ستضيع، لأننا نمسح بيانات المتجر من الجهاز عند الخروج
        if (window.StoreSync && StoreSync.flush() > 0 &&
            !confirm('توجد تغييرات لم تُرفع إلى السحابة بعد (تحقق من الإنترنت). الخروج الآن سيحذفها من هذا الجهاز. هل تريد الخروج؟')) {
            return;
        }

        // نسجّل الخروج قبل حذف الجلسة، لأن المزامنة تحتاج رمز الدخول
        writeLog('logout', 'تسجيل خروج', 'خرج المستخدم ' + displayName(membership));
        try { sessionStorage.removeItem(PENDING_LOGIN_KEY); } catch (e) {}

        await clientReady;
        await sb.auth.signOut();
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

    // ===== الحساب والأمان =====
    // نتحقق من كلمة المرور الحالية أولًا، ثم نغيّرها لحساب المستخدم الحالي فقط
    async function changePassword(current, next) {
        await clientReady;
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
        await clientReady;
        const { error } = await sb.auth.signOut({ scope: 'others' });
        if (error) throw new Error('تعذر تسجيل الخروج من الأجهزة الأخرى');
        writeLog('settings', 'الأمان', 'سجّل المستخدم ' + displayName(membership) + ' الخروج من الأجهزة الأخرى');
    }

    // ===== الحماية =====
    async function guard() {
        const session = await getSession();

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
        if (nav.querySelector(`a[href="${href}"]`)) return;
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
                sidebar.querySelectorAll(`a[href="${p}"]`).forEach(a => a.remove());
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
        sidebar.querySelectorAll('nav a[href]').forEach(a => {
            const isCurrent = a.getAttribute('href') === current;
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
    const optimistic = !isLogin && !!(cachedAtStart && cachedAtStart.store_id && hasStoredSession);

    if (optimistic) {
        membership = cachedAtStart;
        if (ADMIN_ONLY_PAGES.includes(page) && cachedAtStart.role !== 'admin') location.replace(HOME_PAGE);
        // القائمة تكتمل قبل أول رسم للصفحة فلا تقفز عناصرها
        whenDomReady().then(buildUI);
    } else if (!isLogin) {
        document.documentElement.style.visibility = 'hidden';
    }

    const ready = clientReady
        .then(guard)
        .then(async ok => {
            await whenDomReady();
            if (ok && !isLogin) {
                buildUI();
                flushPendingLogin();
            }
            return ok;
        })
        .catch(err => {
            console.error('خطأ في تهيئة تسجيل الدخول:', err);
            if (!isLogin) location.replace(LOGIN_PAGE);
            return false;
        })
        .finally(() => {
            document.documentElement.style.visibility = '';
        });

    window.StoreAuth = {
        ready,
        client: null, // يُملأ بعد التهيئة، انظر getClient()
        getClient: async () => {
            await clientReady;
            return sb;
        },
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
        config: {
            url: SUPABASE_URL,
            key: SUPABASE_KEY,
            functionUrl: FUNCTION_URL,
            internalDomain: INTERNAL_EMAIL_DOMAIN
        }
    };
    window.getStoreInfo = getStoreInfo;

    clientReady.then(() => { window.StoreAuth.client = sb; });
})();
