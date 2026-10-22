/* theme.js — الوضع الداكن واللغة. الألوان والتنسيق في design.css */
(function () {
    const PREFS_KEY = 'storePrefs';
    const DEFAULTS = { theme: 'dark', lang: 'ar' };

    // ترجمة العناصر المشتركة: النص العربي (مطابق تمامًا) => الإنجليزي
    const EN = {
        'الصفحة الرئيسية': 'Home',
        'المبيعات': 'Sales',
        'المخزن': 'Inventory',
        'المشتريات': 'Purchases',
        'الديون': 'Debts',
        'الصندوق': 'Cash box',
        'التقارير': 'Reports',
        'الإعدادات': 'Settings',
        'سعر الصرف': 'Exchange rate',
        'مرحبا بك': 'Welcome',
        'تسجيل الخروج': 'Sign out',

        'المتجر': 'Store',
        'سجّل الدخول للمتابعة': 'Sign in to continue',
        'اسم المستخدم': 'Username',
        'كلمة المرور': 'Password',
        'تسجيل الدخول': 'Sign in',

        'حفظ': 'Save',
        'إلغاء': 'Cancel',
        'إضافة': 'Add',
        'تعديل': 'Edit',
        'حذف': 'Delete',
        'بحث': 'Search',
        'عرض': 'View',
        'طباعة': 'Print',
        'إغلاق': 'Close',
        'الاسم': 'Name',
        'الإجمالي': 'Total',
        'الحالة': 'Status',
        'التاريخ': 'Date',
        'المبلغ': 'Amount',
        'الفئة': 'Category',
        'الزبون': 'Customer',
        'الموظف': 'Employee',
        'الدفع': 'Payment',
        'ملاحظات': 'Notes',
        'إجراءات': 'Actions',
        'الكمية': 'Quantity',
        'السعر': 'Price',
        'الفاتورة': 'Invoice',

        'آخر المبيعات': 'Latest sales',
        'عرض الكل': 'View all',
        'تنبيهات تحتاج إجراء': 'Alerts',
        'لا توجد تنبيهات حالياً': 'No alerts right now',
        'صافي الربح التقديري': 'Estimated net profit',
        'مبيعات اليوم': "Today's sales",
        'المخزون (بالتكلفة)': 'Inventory (at cost)',
        'ديون الزبائن الكلية': 'Total customer debts',

        'بيانات المتجر': 'Store details',
        'اسم المتجر': 'Store name',
        'الهاتف': 'Phone',
        'العنوان': 'Address',
        'البريد الإلكتروني': 'Email',
        'الموقع الإلكتروني': 'Website',
        'نص الشكر أسفل الفاتورة': 'Thank-you text at the bottom of the invoice',
        'شعار المتجر': 'Store logo',
        'حفظ بيانات المتجر': 'Save store details',
        'الرصيد الافتتاحي للصندوق (د.ع)': 'Opening cash balance (IQD)',
        'حفظ الرصيد الافتتاحي': 'Save opening balance',
        'المستخدمون': 'Users',
        '+ إضافة مستخدم': '+ Add user',
        'اسم الدخول': 'Login name',
        'الدور': 'Role',
        'النسخ الاحتياطي': 'Backup',
        'تصدير نسخة احتياطية': 'Export backup',
        'استعادة النسخة': 'Restore backup',
        'منطقة الخطر': 'Danger zone',
        'حذف بيانات العمل': 'Delete work data',
        'المظهر واللغة': 'Appearance & language',
        'الوضع': 'Theme',
        'الفاتح': 'Light',
        'الداكن': 'Dark',
        'اللغة': 'Language',
        'العربية': 'Arabic'
    };

    function getPrefs() {
        try {
            return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
        } catch {
            return { ...DEFAULTS };
        }
    }

    function applyRoot(p) {
        const root = document.documentElement;
        root.dataset.theme = p.theme;
        root.lang = p.lang;
        root.dir = p.lang === 'en' ? 'ltr' : 'rtl';
    }

    // ===== الترجمة =====
    const originalText = new WeakMap();
    const originalPh = new WeakMap();

    function translate(root, lang) {
        if (!root) return;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach(node => {
            const parent = node.parentNode;
            if (!parent || /^(SCRIPT|STYLE|TEXTAREA)$/.test(parent.nodeName)) return;

            if (!originalText.has(node)) originalText.set(node, node.nodeValue);
            const orig = originalText.get(node);
            const key = orig.trim();
            const next = lang === 'en' && EN[key] ? orig.replace(key, EN[key]) : orig;
            if (node.nodeValue !== next) node.nodeValue = next;
        });

        root.querySelectorAll('[placeholder]').forEach(el => {
            if (!originalPh.has(el)) originalPh.set(el, el.getAttribute('placeholder'));
            const orig = originalPh.get(el);
            const key = orig.trim();
            const next = lang === 'en' && EN[key] ? EN[key] : orig;
            if (el.getAttribute('placeholder') !== next) el.setAttribute('placeholder', next);
        });
    }

    const observer = new MutationObserver(() => {
        translate(document.body, getPrefs().lang);
    });

    function init() {
        const p = getPrefs();
        applyRoot(p);
        translate(document.body, p.lang);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function setPrefs(changes) {
        const next = { ...getPrefs(), ...changes };
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        applyRoot(next);
        translate(document.body, next.lang);
    }

    window.StoreTheme = { get: getPrefs, set: setPrefs };

    applyRoot(getPrefs());
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
