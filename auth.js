/* auth.js — تسجيل الدخول عبر Supabase، وحماية الصفحات، والقائمة الجانبية المشتركة، وتسجيل الدخول والخروج في سجل العمليات */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const FUNCTION_URL = SUPABASE_URL + '/functions/v1/create-employee';
    const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
    const INTERNAL_EMAIL_DOMAIN = 'users.storeapp.io';
    const LOGIN_PAGE = 'index.html';
    const HOME_PAGE = 'home.html';
    const ADMIN_ONLY_PAGES = ['settings.html', 'log.html', 'users.html'];
    const SETTINGS_KEY = 'storeSettings';
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
        const info = getStoreInfo();
        document.querySelectorAll('.brand span').forEach(el => {
            el.textContent = `"${info.name}"`;
        });

        const sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

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

        sidebar.querySelectorAll('a[href]').forEach(a => {
            const isCurrent = a.getAttribute('href') === page;
            a.classList.toggle('active', isCurrent);
            if (isCurrent) a.setAttribute('aria-current', 'page');
            else a.removeAttribute('aria-current');
        });

        if (!document.getElementById('userBox')) {
            const box = document.createElement('div');
            box.id = 'userBox';
            box.style.cssText =
                'margin-top:14px;padding:12px;border-radius:20px;background:#efede5;font-size:15px;font-weight:700;color:#10110d';
            box.innerHTML = `
                <div>${esc(displayName(membership))}</div>
                <div style="font-size:13px;color:#5a5a52;margin-bottom:8px">${roleLabel(membership.role)}</div>
                <button type="button" id="logoutBtn"
                    style="width:100%;border:0;border-radius:12px;padding:8px;background:#c74845;color:#fff;font:700 15px Tahoma,Arial,sans-serif;cursor:pointer">تسجيل الخروج</button>`;
            sidebar.appendChild(box);
            document.getElementById('logoutBtn').addEventListener('click', logout);
        }
    }

    function whenDomReady() {
        return document.readyState === 'loading'
            ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
            : Promise.resolve();
    }

    // نخفي الصفحة حتى نعرف هل المستخدم مسموح له بها
    if (!isLogin) document.documentElement.style.visibility = 'hidden';

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
