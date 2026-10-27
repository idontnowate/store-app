/* rates.js — أسعار الصرف المركزية من المزود (انظر supabase/rates.sql)
 *
 * يجلب آخر أسعار سجّلها المزود ويحفظها على الجهاز (appMarketRates)، فتبقى متاحة بدون إنترنت.
 * products.js يستخدمها لسعر الدولار في البيع إذا كان مصدر السعر "تلقائي من المزود" (الافتراضي).
 */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const SESSION_TOKEN_KEY = 'sb-pxxgydllfustqkpkfiqn-auth-token';
    const CACHE_KEY = 'appMarketRates';
    const MARKETS = ['official', 'baghdad', 'erbil', 'basra'];
    const EVERY = 15 * 60 * 1000;

    function token() {
        try {
            const s = JSON.parse(localStorage.getItem(SESSION_TOKEN_KEY));
            return s && s.access_token ? s.access_token : null;
        } catch {
            return null;
        }
    }

    function cached() {
        try {
            return JSON.parse(localStorage.getItem(CACHE_KEY)) || null;
        } catch {
            return null;
        }
    }

    // نقبل فقط أرقامًا معقولة لكل دولار، حتى لا يصل سعر خاطئ للكاشير
    const sane = v => (typeof v === 'number' && v >= 500 && v <= 10000 ? v : null);

    function clean(rates) {
        const out = {};
        MARKETS.forEach(m => {
            const r = rates && rates[m];
            if (!r) return;
            const buy = sane(Number(r.buy)), sell = sane(Number(r.sell));
            if (buy !== null || sell !== null) out[m] = { buy, sell };
        });
        return out;
    }

    let loading = false;

    async function refresh() {
        if (loading || !token() || navigator.onLine === false) return cached();
        loading = true;
        try {
            const res = await fetch(SUPABASE_URL + '/rest/v1/market_rates?select=rates,note,created_at&order=created_at.desc&limit=1', {
                headers: { apikey: KEY, Authorization: 'Bearer ' + token() },
                // طلب معلق لا يمنع التحديثات القادمة
                signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined
            });
            if (!res.ok) return cached(); // الجدول غير موجود بعد أو الجلسة منتهية
            const rows = await res.json();
            if (!rows.length) return cached();
            const row = { rates: clean(rows[0].rates), note: rows[0].note || '', at: rows[0].created_at, fetchedAt: new Date().toISOString() };
            const prev = cached();
            localStorage.setItem(CACHE_KEY, JSON.stringify(row));
            if (!prev || prev.at !== row.at) window.dispatchEvent(new CustomEvent('marketrates', { detail: row }));
            return row;
        } catch {
            return cached();
        } finally {
            loading = false;
        }
    }

    // كم مضى على السعر: "اليوم 10:30" أو "أمس" أو "قبل 3 أيام"
    function age(iso) {
        const d = new Date(iso);
        if (isNaN(d)) return '';
        const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
        const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
        if (days <= 0) return 'اليوم ' + time;
        if (days === 1) return 'أمس ' + time;
        return `قبل ${days} أيام`;
    }

    window.StoreRates = { latest: cached, refresh, age, MARKETS };

    if (token()) {
        refresh();
        setInterval(() => { if (!document.hidden) refresh(); }, EVERY);
        window.addEventListener('online', refresh);
        document.addEventListener('visibilitychange', () => {
            const c = cached();
            if (!document.hidden && (!c || Date.now() - Date.parse(c.fetchedAt) > 5 * 60 * 1000)) refresh();
        });
    }
})();
