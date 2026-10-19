/* layout.js — القائمة الجانبية المتحركة والتجاوب مع الهاتف */
(function () {
    const UI_KEY = 'uiNav'; // لا يبدأ بـ store حتى لا يُرفع إلى السحابة
    const MOBILE = window.matchMedia('(max-width: 650px)');

    const css = `
        .nav-toggle {
            position: fixed; top: 12px; left: 12px; z-index: 70;
            width: 46px; height: 46px; border: 0; border-radius: 14px;
            background: #1f2a44; color: #fff; cursor: pointer;
            font: 700 22px Tahoma, Arial, sans-serif;
            box-shadow: 0 2px 8px #0003;
        }
        .sidebar { transition: transform .3s ease; }
        .nav-backdrop {
            display: none; position: fixed; inset: 0; z-index: 40; background: #0008;
        }

        /* الكمبيوتر: إخفاء القائمة بالانزلاق للخارج */
        @media (min-width: 651px) {
            body.nav-collapsed .sidebar { transform: translateX(calc(100% + 30px)) !important; }
            body.nav-collapsed main { margin-left: 3% !important; margin-right: 3% !important; }
            body.nav-collapsed header,
            body.nav-collapsed .topbar { padding-left: 5% !important; padding-right: 5% !important; }
        }

        /* الهاتف: القائمة طبقة تنزلق من اليمين */
        @media (max-width: 650px) {
            .sidebar {
                position: fixed !important; top: 0 !important; bottom: 0 !important;
                right: 0 !important; left: auto !important;
                width: 80% !important; max-width: 320px !important; min-width: 0 !important;
                margin: 0 !important; border-radius: 0 24px 24px 0 !important;
                z-index: 60; transform: translateX(105%); overflow-y: auto;
            }
            body.nav-open .sidebar { transform: none !important; }
            body.nav-open .nav-backdrop { display: block; }
            header, .topbar {
                height: auto !important; padding: 64px 5% 10px !important;
                display: flex !important; flex-direction: column !important; gap: 8px !important;
            }
            h1 { margin-top: 0 !important; }
            main { margin: 0 4% 20px !important; }
            .sidebar nav { grid-template-columns: 1fr !important; }
            .sidebar a { font-size: 19px !important; padding: 12px 14px !important; }
        }
    `;

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
        btn.textContent = '☰';
        document.body.appendChild(btn);

        const backdrop = document.createElement('div');
        backdrop.className = 'nav-backdrop';
        document.body.appendChild(backdrop);

        btn.addEventListener('click', toggle);
        backdrop.addEventListener('click', () => document.body.classList.remove('nav-open'));

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