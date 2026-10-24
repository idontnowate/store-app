/* ai.js — الباقة الذكية في البرنامج: قراءة فاتورة مورد، وإضافة منتج من صورته (دالة ai-vision في Supabase) */
(function () {
    const SUPABASE_URL = 'https://pxxgydllfustqkpkfiqn.supabase.co';
    const KEY = 'sb_publishable_I2L_KEOwIXjyuCOue4w_3g_MMhYImIU';
    const SESSION_TOKEN_KEY = 'sb-pxxgydllfustqkpkfiqn-auth-token';
    const FUNCTION_URL = SUPABASE_URL + '/functions/v1/ai-vision';
    // الصورة تُصغَّر قبل الإرسال: أوضح من اللازم يزيد الكلفة ولا يزيد الدقة
    const MAX_SIDE = 1568;

    function token() {
        try {
            const s = JSON.parse(localStorage.getItem(SESSION_TOKEN_KEY));
            return s && s.access_token ? s.access_token : null;
        } catch {
            return null;
        }
    }

    async function call(body) {
        if (navigator.onLine === false) throw new Error('الباقة الذكية تحتاج اتصالًا بالإنترنت');
        const t = token();
        if (!t) throw new Error('سجّل الدخول من جديد');
        let res;
        try {
            res = await fetch(FUNCTION_URL, {
                method: 'POST',
                headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
        } catch {
            throw new Error('تعذر الاتصال بالخادم. تحقق من الإنترنت');
        }
        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(out.error || (res.status === 404 ? 'الباقة الذكية غير منشورة بعد عند المزود' : 'تعذرت العملية، حاول مرة أخرى'));
            err.code = out.code || String(res.status);
            throw err;
        }
        return out;
    }

    // تصغير الصورة وتحويلها إلى JPEG
    function resize(file, maxSide = MAX_SIDE, quality = 0.85) {
        return new Promise((resolve, reject) => {
            if (!file || !/^image\//.test(file.type || 'image/')) return reject(new Error('اختر صورة'));
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.width * scale));
                canvas.height = Math.max(1, Math.round(img.height * scale));
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                resolve({ dataUrl, base64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('تعذر فتح الصورة'));
            };
            img.src = url;
        });
    }

    function readList(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    }

    // حالة الباقة لهذا المتجر (مفعّلة؟ المستخدم والمتبقي هذا الشهر)
    let statusCache = null;
    async function status(force) {
        if (!force && statusCache && Date.now() - statusCache.at < 60000) return statusCache.value;
        const value = await call({ action: 'status' });
        statusCache = { at: Date.now(), value };
        return value;
    }

    async function readInvoice(file) {
        const img = await resize(file);
        const products = readList('storeProducts').map(p => ({ id: p.id, name: p.name, barcode: p.barcode || '' }));
        const out = await call({ action: 'invoice', image: img.base64, mediaType: img.mediaType, products });
        statusCache = null;
        return out;
    }

    // يعيد أيضًا الصورة المصغّرة لتُحفظ صورةً للمنتج
    async function readProduct(file) {
        const img = await resize(file);
        const categories = [...new Set(readList('storeProducts').map(p => String(p.category || '').trim()).filter(Boolean))];
        const out = await call({ action: 'product', image: img.base64, mediaType: img.mediaType, categories });
        statusCache = null;
        return { ...out, dataUrl: img.dataUrl };
    }

    // يختار صورة من الكاميرا أو المعرض (حسب اختيار المستخدم على الموبايل)
    function pickImage() {
        return new Promise(resolve => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.style.display = 'none';
            input.addEventListener('change', () => {
                resolve(input.files && input.files[0] ? input.files[0] : null);
                input.remove();
            }, { once: true });
            document.body.appendChild(input);
            input.click();
        });
    }

    window.StoreAI = { status, readInvoice, readProduct, pickImage, resize };
})();
