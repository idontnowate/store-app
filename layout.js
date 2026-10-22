/* layout.js — القائمة الجانبية المتحركة والتجاوب مع الهاتف */
(function () {
    const UI_KEY = 'uiNav'; // لا يبدأ بـ store حتى لا يُرفع إلى السحابة
    const MOBILE = window.matchMedia('(max-width: 650px)');

    // التنسيق البصري في design.css؛ هنا سلوك الإخفاء والإظهار فقط
    const css = `
        .sidebar { transition: transform .28s cubic-bezier(.2, .8, .2, 1); }
        body > header, .topbar, body > main { transition: margin .28s cubic-bezier(.2, .8, .2, 1); }
        .nav-toggle {
            position: fixed; z-index: 70; display: grid; place-items: center;
            cursor: pointer; padding: 0;
        }
        .nav-toggle svg { width: 18px; height: 18px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; }
        .nav-backdrop {
            display: none; position: fixed; inset: 0; z-index: 40;
            background: rgba(10, 12, 16, .45); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px);
        }

        /* الكمبيوتر: إخفاء القائمة بالانزلاق للخارج */
        @media (min-width: 651px) {
            html[dir="rtl"] body.nav-collapsed .sidebar { transform: translateX(101%); }
            html[dir="ltr"] body.nav-collapsed .sidebar { transform: translateX(-101%); }
            body.nav-collapsed > header,
            body.nav-collapsed .topbar { margin-inline-start: 0 !important; }
            body.nav-collapsed > main { margin-inline-start: var(--gutter) !important; }
        }

        /* الهاتف: القائمة طبقة تنزلق فوق الصفحة */
        @media (max-width: 650px) {
            body.nav-open .nav-backdrop { display: block; }
        }
    `;

    // أيقونات القائمة (خطوط بسيطة بنفس السماكة)
    const ICONS = {
        'home.html': '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
        'cashier.html': '<circle cx="9" cy="19.5" r="1.4"/><circle cx="17.5" cy="19.5" r="1.4"/><path d="M2.5 3.5h2.4l2.4 11a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L20.5 7H5.6"/>',
        'sales-new_1.html': '<path d="M5.5 3h13v18l-2.6-1.7L13.3 21l-2.6-1.7L8.1 21l-2.6-1.7z"/><path d="M9 8h6M9 12h6"/>',
        'inventory.html': '<path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/>',
        'purchases.html': '<path d="M2.5 6h11.5v10H2.5z"/><path d="M14 9.5h4l3.5 3.5v3H14"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
        'debts.html': '<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h14a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 19.5 7H5.5"/><circle cx="16.5" cy="13.5" r="1.1"/>',
        'cashbox.html': '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
        'reports.html': '<path d="M3.5 20.5h17"/><path d="M6.5 16.5v-5M11 16.5V6.5M15.5 16.5v-7M20 16.5V4"/>',
        'users.html': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.6A6.5 6.5 0 0 1 21.5 20"/>',
        'log.html': '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
        'settings.html': '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
        'exchange-rate.html': '<path d="m7 3.5-3.5 3.5L7 10.5"/><path d="M3.5 7H17"/><path d="m17 13.5 3.5 3.5-3.5 3.5"/><path d="M20.5 17H7"/>'
    };

    function svg(paths) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
    }

    function addIcons() {
        document.querySelectorAll('.sidebar a[href]').forEach(a => {
            if (a.querySelector('svg')) return;
            const icon = ICONS[a.getAttribute('href')];
            if (icon) a.insertAdjacentHTML('afterbegin', svg(icon));
        });
    }

    function applyDesktopState() {
        const collapsed = localStorage.getItem(UI_KEY) === 'collapsed';
        document.body.classList.toggle('nav-collapsed', !MOBILE.matches && collapsed);
    }

    function toggle() {
        if (MOBILE.matches) {
            document.body.classList.toggle('nav-open');
            return;
        }
        const collapsed = !document.body.classList.contains('nav-collapsed');
        document.body.classList.toggle('nav-collapsed', collapsed);
        localStorage.setItem(UI_KEY, collapsed ? 'collapsed' : 'open');
    }

    function init() {
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);

        const btn = document.createElement('button');
        btn.className = 'nav-toggle';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'فتح أو إغلاق القائمة');
        btn.innerHTML = svg('<path d="M4 7h16M4 12h16M4 17h16"/>');
        document.body.appendChild(btn);

        const backdrop = document.createElement('div');
        backdrop.className = 'nav-backdrop';
        document.body.appendChild(backdrop);

        btn.addEventListener('click', toggle);
        backdrop.addEventListener('click', () => document.body.classList.remove('nav-open'));

        // auth.js يضيف روابط المدير لاحقًا، فنضيف أيقوناتها عند ظهورها
        addIcons();
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) new MutationObserver(addIcons).observe(sidebar, { childList: true, subtree: true });

        // على الهاتف تُغلق القائمة عند اختيار صفحة
        document.querySelectorAll('.sidebar a').forEach(a => {
            a.addEventListener('click', () => {
                if (MOBILE.matches) document.body.classList.remove('nav-open');
            });
        });

        MOBILE.addEventListener('change', () => {
            document.body.classList.remove('nav-open');
            applyDesktopState();
        });

        applyDesktopState();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
