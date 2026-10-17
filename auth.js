/* auth.js — الحماية وتسجيل الخروج والإعدادات المشتركة */
(function () {
const USERS_KEY = 'storeUsers';
const SESSION_KEY = 'storeSession';
const SETTINGS_KEY = 'storeSettings';
const LOGIN_PAGE = 'index.html';
const ADMIN_ONLY_PAGES = ['settings.html'];

const page = (location.pathname.split('/').pop() || 'home.html').toLowerCase();
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

async function hash(text) {
const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function newId() {
return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function esc(value) {
return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;' , '>' : '&gt;' , '"' : '&quot;' , "'"
        : '&#39;' }[ch])); } function getUsers() { return read(USERS_KEY, []); } function saveUsers(users) {
        write(USERS_KEY, users); } function currentUser() { const session=read(SESSION_KEY, null); if (!session) return
        null; return getUsers().find(u=> u.id === session.id) || null;
        }

        // أول مرة: يُنشأ حساب المدير الافتراضي admin / 1234 ويمكن تغييره من الإعدادات
        async function ensureDefaultUser() {
        const users = getUsers();
        if (users.length) return;
        users.push({
        id: newId(),
        name: 'المدير',
        username: 'admin',
        role: 'admin',
        password: await hash('1234')
        });
        saveUsers(users);
        }

        async function login(username, password) {
        await ensureDefaultUser();
        const h = await hash(password);
        const user = getUsers().find(u => u.username === username.trim().toLowerCase() && u.password === h);
        if (!user) return null;
        write(SESSION_KEY, { id: user.id });
        return user;
        }

        function logout() {
        localStorage.removeItem(SESSION_KEY);
        location.replace(LOGIN_PAGE);
        }

        function roleLabel(role) {
        return role === 'admin' ? 'مدير' : 'موظف مبيعات';
        }

        function getStoreInfo() {
        return { ...DEFAULT_STORE, ...read(SETTINGS_KEY, {}) };
        }

        function saveStoreInfo(info) {
        write(SETTINGS_KEY, { ...DEFAULT_STORE, ...info });
        }

        // ===== الحماية =====
        const user = currentUser();

        if (isLogin) {
        if (user) {
        location.replace('home.html');
        return;
        }
        } else {
        if (!user) {
        localStorage.removeItem(SESSION_KEY);
        location.replace(LOGIN_PAGE);
        return;
        }
        if (ADMIN_ONLY_PAGES.includes(page) && user.role !== 'admin') {
        location.replace('home.html');
        return;
        }
        }

        // ===== واجهة مشتركة بعد تحميل الصفحة =====
        document.addEventListener('DOMContentLoaded', () => {
        if (isLogin || !user) return;

        const info = getStoreInfo();
        document.querySelectorAll('.brand span').forEach(el => {
        el.textContent = `"${info.name}"`;
        });

        if (user.role !== 'admin') {
        document.querySelectorAll('a[href="settings.html"]').forEach(a => {
        a.style.display = 'none';
        });
        }

        const sidebar = document.querySelector('.sidebar');
        if (sidebar && !document.getElementById('userBox')) {
        const box = document.createElement('div');
        box.id = 'userBox';
        box.style.cssText =
        'margin-top:14px;padding:12px;border-radius:20px;background:#efede5;font-size:15px;font-weight:700;color:#10110d';
        box.innerHTML = `
        <div>${esc(user.name)}</div>
        <div style="font-size:13px;color:#5a5a52;margin-bottom:8px">${roleLabel(user.role)}</div>
        <button type="button" id="logoutBtn"
            style="width:100%;border:0;border-radius:12px;padding:8px;background:#c74845;color:#fff;font:700 15px Tahoma,Arial,sans-serif;cursor:pointer">تسجيل
            الخروج</button>`;
        sidebar.appendChild(box);
        document.getElementById('logoutBtn').addEventListener('click', logout);
        }
        });

        window.StoreAuth = {
        getUsers,
        saveUsers,
        hash,
        newId,
        currentUser,
        login,
        logout,
        ensureDefaultUser,
        getStoreInfo,
        saveStoreInfo,
        roleLabel
        };
        window.getStoreInfo = getStoreInfo;
        })();
