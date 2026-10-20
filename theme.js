/* theme.js — الوضع الداكن واللغة والهوية اللونية الرسمية */
(function () {
    const PREFS_KEY = 'storePrefs';
    const DEFAULTS = { theme: 'dark', lang: 'ar' };

    // ===== ألوان الوضع الفاتح: عدّل الخلفية من هنا فقط =====
    const LIGHT = {
        page: '#eef1f6',
        panel: '#ffffff',
        line: '#d5dce6',
        ink: '#1a1f2b',
        muted: '#5b6474',
        primary: '#1f2a44',
        accent: '#2e7d5b',
        danger: '#8b1e2d'
    };

    // ===== ألوان الوضع الداكن =====
    const DARK = {
        page: '#121826',
        panel: '#1d2638',
        line: '#34405a',
        ink: '#e6ebf2',
        muted: '#9aa5b8',
        hover: '#34405a',
        primaryBox: '#2d3b5c',
        danger: '#c0505f',
        dangerSoft: '#5a2a33',
        dangerText: '#f7c9cf',
        okSoft: '#2d4a3a',
        okText: '#c7ead8',
        infoSoft: '#2a3d5c',
        infoText: '#cfdcef'
    };

    // ===== خريطة الألوان: القديم => الجديد (تُطبَّق على كل صفحات الموقع في الوضع الفاتح) =====
    const COLOR_MAP = {
        '#40570d': LIGHT.primary,
        '#344807': LIGHT.primary,
        '#d1cec5': LIGHT.panel,
        '#efede5': LIGHT.page,
        '#c74845': LIGHT.danger,
        '#91d94c': LIGHT.accent,
        '#1fa64a': LIGHT.accent,
        '#8d956e': '#c9d1dd',
        '#bdb9ae': LIGHT.line,
        '#777': LIGHT.muted,
        '#777777': LIGHT.muted,
        '#4b4a48': LIGHT.muted,
        '#a93a38': '#6b1822',
        '#664cae': LIGHT.primary
    };

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

    // ===== الوضع الداكن =====
    const DARK_CSS = `
        html[data-theme="dark"] {
            color-scheme: dark;
            --page: ${DARK.page};
            --olive: ${DARK.primaryBox};
            --olive-dark: #c9d6ee;
            --panel: ${DARK.panel};
            --ink: ${DARK.ink};
            --muted: ${DARK.muted};
            --line: ${DARK.line};
            --red: ${DARK.danger};
            --green: #4fa57c;
        }
        html[data-theme="dark"] body { background: var(--page); color: var(--ink); }
        html[data-theme="dark"] input,
        html[data-theme="dark"] select,
        html[data-theme="dark"] textarea {
            background: #1a2232 !important;
            color: ${DARK.ink} !important;
            border-color: #4a5672 !important;
        }
        html[data-theme="dark"] dialog { background: var(--page); color: var(--ink); }
        html[data-theme="dark"] table { background: var(--page); }
        html[data-theme="dark"] tbody tr:hover { background: #242d42; }
        html[data-theme="dark"] thead th { background: ${DARK.primaryBox}; color: ${DARK.ink}; }
        html[data-theme="dark"] td { color: var(--ink); border-color: ${DARK.line}; }

        html[data-theme="dark"] .card,
        html[data-theme="dark"] .report,
        html[data-theme="dark"] .logo-box,
        html[data-theme="dark"] .summary-card,
        html[data-theme="dark"] .stat-card,
        html[data-theme="dark"] .table-card,
        html[data-theme="dark"] .form-card,
        html[data-theme="dark"] .login-card,
        html[data-theme="dark"] .sidebar,
        html[data-theme="dark"] .alert { background: var(--panel) !important; color: var(--ink) !important; }
        html[data-theme="dark"] .summary-card.main,
        html[data-theme="dark"] .sales,
        html[data-theme="dark"] .alerts { background: ${DARK.primaryBox} !important; color: ${DARK.ink} !important; }
        html[data-theme="dark"] .sidebar a { color: var(--ink) !important; }
        html[data-theme="dark"] .sidebar a:hover,
        html[data-theme="dark"] .sidebar a.active,
        html[data-theme="dark"] nav a:hover,
        html[data-theme="dark"] nav a.active { background: ${DARK.hover} !important; }
        html[data-theme="dark"] .card-title,
        html[data-theme="dark"] .topbar h1,
        html[data-theme="dark"] h1,
        html[data-theme="dark"] h2 { color: var(--ink); }
        html[data-theme="dark"] .card-title { background: ${DARK.page} !important; }
        html[data-theme="dark"] .brand { color: #4fa57c !important; }
        html[data-theme="dark"] .brand span { color: #c9d6ee !important; }

        /* الأزرار والعناصر البارزة */
        html[data-theme="dark"] .add-row,
        html[data-theme="dark"] .add-button,
        html[data-theme="dark"] .button.print,
        html[data-theme="dark"] .btn.olive,
        html[data-theme="dark"] .export-btn,
        html[data-theme="dark"] .chip[aria-pressed="true"],
        html[data-theme="dark"] .link-sales { background: ${DARK.primaryBox} !important; color: ${DARK.ink} !important; }
        html[data-theme="dark"] .button.cancel,
        html[data-theme="dark"] .button.more,
        html[data-theme="dark"] .chip { background: ${DARK.hover} !important; color: ${DARK.ink} !important; }
        html[data-theme="dark"] .view-link { color: #c9d6ee !important; border-color: #c9d6ee !important; }
        html[data-theme="dark"] .button.delete,
        html[data-theme="dark"] .danger-link,
        html[data-theme="dark"] .remove-row,
        html[data-theme="dark"] .btn.danger { background: ${DARK.dangerSoft} !important; color: ${DARK.dangerText} !important; border-color: ${DARK.dangerSoft} !important; }

        /* نوع الدفع في المبيعات */
        html[data-theme="dark"] .pay { color: ${DARK.ink} !important; }
        html[data-theme="dark"] .pay.debt { background: ${DARK.dangerSoft} !important; color: ${DARK.dangerText} !important; }
        html[data-theme="dark"] .pay.cash { background: ${DARK.okSoft} !important; color: ${DARK.okText} !important; }
        html[data-theme="dark"] .pay.card { background: ${DARK.infoSoft} !important; color: ${DARK.infoText} !important; }

        /* نوع الحركة في الصندوق */
        html[data-theme="dark"] .type { background: ${DARK.okSoft} !important; color: ${DARK.okText} !important; }
        html[data-theme="dark"] .type.out { background: ${DARK.dangerSoft} !important; color: ${DARK.dangerText} !important; }
        html[data-theme="dark"] .type.manual { background: ${DARK.infoSoft} !important; color: ${DARK.infoText} !important; }

        /* الحالة في الديون والمشتريات */
        html[data-theme="dark"] .status { background: ${DARK.hover} !important; color: ${DARK.ink} !important; }
        html[data-theme="dark"] .status.closed { background: ${DARK.okSoft} !important; color: ${DARK.okText} !important; }
        html[data-theme="dark"] .status.unpaid,
        html[data-theme="dark"] .status.out { background: ${DARK.dangerSoft} !important; color: ${DARK.dangerText} !important; }
        html[data-theme="dark"] .status.low { background: #5a4a1e !important; color: #f5e3b0 !important; }

        /* المربع أسفل القائمة (اسم المستخدم وتسجيل الخروج) */
        html[data-theme="dark"] #userBox {
            background: ${DARK.panel} !important;
            color: ${DARK.ink} !important;
            border: 1px solid ${DARK.line} !important;
            box-shadow: none !important;
        }
        html[data-theme="dark"] #userBox > div:first-child { color: ${DARK.ink} !important; }
        html[data-theme="dark"] #userBox > div:nth-child(2) { color: ${DARK.muted} !important; }
        html[data-theme="dark"] #logoutBtn {
            background: ${DARK.dangerSoft} !important;
            color: ${DARK.dangerText} !important;
            border: 1px solid ${DARK.danger} !important;
        }

        /* اتجاه الإنجليزية: القائمة على اليسار */
        html[dir="ltr"] .sidebar { right: auto; left: 1.4%; }
        html[dir="ltr"] main { margin-left: 21.7%; margin-right: 3%; }
        html[dir="ltr"] .topbar { padding: 22px 4% 10px 22%; }
    `;

    // ===== الوضع الفاتح: هوية رسمية بخلفية متوازنة =====
    const LIGHT_CSS = `
        :root {
            --page: ${LIGHT.page};
            --olive: ${LIGHT.primary};
            --olive-dark: ${LIGHT.primary};
            --panel: ${LIGHT.panel};
            --ink: ${LIGHT.ink};
            --muted: ${LIGHT.muted};
            --line: ${LIGHT.line};
            --red: ${LIGHT.danger};
            --green: ${LIGHT.accent};
        }
        body { background: ${LIGHT.page}; color: ${LIGHT.ink}; }
        .brand { color: ${LIGHT.accent} !important; }
        .brand span { color: ${LIGHT.primary} !important; }
        .card,
        .report,
        .logo-box,
        .summary-card,
        .stat-card,
        .table-card,
        .form-card,
        .login-card,
        .sidebar,
        .alert {
            background: ${LIGHT.panel};
            box-shadow: 0 1px 3px rgba(31, 42, 68, .08), 0 4px 12px rgba(31, 42, 68, .06);
        }
        .card-title { background: ${LIGHT.page} !important; color: ${LIGHT.primary}; }
        .summary-card { color: ${LIGHT.primary}; }
        .summary-card.main,
        .sales,
        .alerts,
        .add-row,
        .link-sales,
        .export-btn,
        .btn.olive,
        .button.print { background: ${LIGHT.primary} !important; color: #f3f4f6 !important; }
        .totals .grand,
        .ps-table tr.grand td { background: ${LIGHT.accent} !important; color: #fff !important; }
        .ps-table th,
        .ps-table tr.sum td,
        .ps-notes h3,
        .ps-footer { background-color: ${LIGHT.primary} !important; color: #fff !important; }
        .ps-title { background: none !important; color: ${LIGHT.primary} !important; }
        .button.cancel { background: #e6ebf2 !important; color: ${LIGHT.primary} !important; }
        .button.more { background: ${LIGHT.muted} !important; color: #fff !important; }
        .button.delete,
        .danger-link,
        .remove-row,
        .btn.danger { background: ${LIGHT.danger} !important; color: #fff !important; border-color: ${LIGHT.danger} !important; }
        .chip { background: ${LIGHT.panel}; color: ${LIGHT.primary}; }
        .chip[aria-pressed="true"] { background: ${LIGHT.primary} !important; color: #f3f4f6 !important; }
        .view-link { color: ${LIGHT.primary} !important; border-color: ${LIGHT.primary} !important; }
        .view-link:hover { background: ${LIGHT.primary} !important; color: #fff !important; }
        .sidebar a:hover,
        .sidebar a.active,
        nav a:hover,
        nav a.active { background: #dde4ee !important; }
        .stock-hint { color: ${LIGHT.muted}; }

        /* المربع أسفل القائمة */
        #userBox {
            background: ${LIGHT.panel} !important;
            color: ${LIGHT.ink} !important;
            border: 1px solid ${LIGHT.line} !important;
            box-shadow: 0 1px 3px rgba(31, 42, 68, .08) !important;
        }
        #userBox > div:first-child { color: ${LIGHT.ink} !important; }
        #userBox > div:nth-child(2) { color: ${LIGHT.muted} !important; }
        #logoutBtn { background: ${LIGHT.danger} !important; color: #fff !important; }

        /* الجداول العادية بيضاء */
        .table-card table,
        .table-wrap table,
        .items-wrap table { background: ${LIGHT.panel}; }
        tbody tr:hover { background: #f1f4f9; }
        thead th { color: #f3f4f6; }
        td { border-color: ${LIGHT.line}; }

        /* الجدول داخل البطاقة الداكنة "آخر المبيعات" يبقى شفافًا بنص فاتح */
        .sales table,
        .alerts table { background: transparent !important; }
        .sales thead th { background: transparent !important; color: #f3f4f6 !important; border-bottom: 1px solid rgba(255,255,255,.25); }
        .sales td { color: #f3f4f6 !important; border-top: 1px solid rgba(255,255,255,.15) !important; border-bottom: 0 !important; }
        .sales tbody tr:hover { background: rgba(255,255,255,.06) !important; }
        .sales-heading,
        .sales-heading a { color: #f3f4f6 !important; }
    `;

    const style = document.createElement('style');
    style.id = 'theme-style';
    style.textContent = DARK_CSS + LIGHT_CSS;
    document.head.appendChild(style);

    // ===== تغيير الألوان الثابتة داخل <style> صفحات الموقع =====
    const originalCss = new Map();

    function getPrefs() {
        try {
            return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
        } catch {
            return { ...DEFAULTS };
        }
    }

    function applyPageColors() {
        const dark = getPrefs().theme === 'dark';
        document.querySelectorAll('style:not(#theme-style)').forEach(el => {
            if (!originalCss.has(el)) originalCss.set(el, el.textContent);
            const base = originalCss.get(el);
            if (dark) {
                el.textContent = base;
                return;
            }
            el.textContent = base.replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g, match => {
                return COLOR_MAP[match.toLowerCase()] || match;
            });
        });
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
        applyPageColors();
        translate(document.body, p.lang);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function setPrefs(changes) {
        const next = { ...getPrefs(), ...changes };
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
        applyRoot(next);
        applyPageColors();
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
