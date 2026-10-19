/* log.js — سجل مركزي لكل عمليات البرنامج. كل عملية تُحفظ كصف مستقل حتى لا تتعارض الأجهزة */
(function () {
    const PREFIX = 'storeLog_';

    function currentUserName() {
        try {
            const u = window.StoreAuth && StoreAuth.currentUser ? StoreAuth.currentUser() : null;
            return u ? (u.name || u.username || '') : 'غير معروف';
        } catch {
            return 'غير معروف';
        }
    }

    // add('create', 'فاتورة بيع', 'C00012 — الزبون أحمد — 25,000 د.ع')
    function add(action, entity, details) {
        const at = new Date();
        const id = at.getTime().toString(36) + Math.random().toString(36).slice(2, 8);
        const entry = {
            id,
            at: at.toISOString(),
            user: currentUserName(),
            action,
            entity: entity || '',
            details: details || '',
            page: (location.pathname.split('/').pop() || 'index.html')
        };
        try {
            localStorage.setItem(PREFIX + id, JSON.stringify(entry));
        } catch (err) {
            console.warn('تعذر تسجيل العملية:', err);
        }
        return entry;
    }

    // كل السجلات مرتبة من الأحدث إلى الأقدم
    function list() {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(PREFIX)) continue;
            try {
                const e = JSON.parse(localStorage.getItem(key));
                if (e && e.at) out.push(e);
            } catch { }
        }
        return out.sort((a, b) => b.at.localeCompare(a.at));
    }

    window.StoreLog = { add, list, PREFIX };
})();