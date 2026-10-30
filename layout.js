/* layout.js — القائمة الجانبية المتحركة والتجاوب مع الهاتف */
(function () {
    const UI_KEY = 'uiNav'; // لا يبدأ بـ store حتى لا يُرفع إلى السحابة
    const MOBILE = window.matchMedia('(max-width: 650px)');

    // حالة القائمة المطوية تُطبَّق قبل أول رسم للصفحة، حتى لا تنزلق القائمة عند كل انتقال
    // (التنسيق في design.css)
    try {
        if (localStorage.getItem(UI_KEY) === 'collapsed' && !MOBILE.matches) {
            document.documentElement.classList.add('nav-collapsed');
        }
    } catch (e) { }

    // ظهور المحتوى بالتتابع عند فتح الصفحة
    const ENTER_SELECTOR = [
        'body:not(.standalone) > main > :not(.summary):not(.stats):not(.cols):not(.pos):not(.set-layout):not(.flash):not(dialog)',
        'main .summary > *',
        'main .stats > *',
        'main .cols > *',
        'main .pos > *',
        '.set-layout > .set-nav',
        '.set-body > *'
    ].join(',');

    function playEntrance() {
        if (window.StoreTheme && StoreTheme.motionOff()) return;
        const root = document.documentElement;
        const els = [...document.querySelectorAll(ENTER_SELECTOR)].filter(el => el.getClientRects().length);
        els.forEach((el, i) => {
            el.classList.add('enter');
            el.style.setProperty('--enter-delay', Math.min(i, 8) * 45 + 'ms');
        });
        root.classList.add('is-entering');
        setTimeout(() => {
            root.classList.remove('is-entering');
            els.forEach(el => {
                el.classList.remove('enter');
                el.style.removeProperty('--enter-delay');
            });
        }, 1100);
    }

    // أيقونات القائمة (خطوط بسيطة بنفس السماكة)
    const ICONS = {
        'home.html': '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>',
        'cashier.html': '<circle cx="9" cy="19.5" r="1.4"/><circle cx="17.5" cy="19.5" r="1.4"/><path d="M2.5 3.5h2.4l2.4 11a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L20.5 7H5.6"/>',
        'sales-new_1.html': '<path d="M5.5 3h13v18l-2.6-1.7L13.3 21l-2.6-1.7L8.1 21l-2.6-1.7z"/><path d="M9 8h6M9 12h6"/>',
        'orders.html': '<path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 10.5V6.5a3 3 0 0 1 6 0v4"/>',
        'inventory.html': '<path d="M20.5 7.5 12 3 3.5 7.5v9L12 21l8.5-4.5z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/>',
        'purchases.html': '<path d="M2.5 6h11.5v10H2.5z"/><path d="M14 9.5h4l3.5 3.5v3H14"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
        'debts.html': '<path d="M19 7V5.5A1.5 1.5 0 0 0 17.5 4h-12A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20h14a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 19.5 7H5.5"/><circle cx="16.5" cy="13.5" r="1.1"/>',
        'customers.html': '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
        'cashbox.html': '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
        'reports.html': '<path d="M3.5 20.5h17"/><path d="M6.5 16.5v-5M11 16.5V6.5M15.5 16.5v-7M20 16.5V4"/>',
        'users.html': '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.6A6.5 6.5 0 0 1 21.5 20"/>',
        'log.html': '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
        'settings.html': '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
        'scanner.html': '<path d="M3.5 7.5V5.5a2 2 0 0 1 2-2h2M16.5 3.5h2a2 2 0 0 1 2 2v2M20.5 16.5v2a2 2 0 0 1-2 2h-2M7.5 20.5h-2a2 2 0 0 1-2-2v-2"/><path d="M7.5 8v8M10.5 8v8M13.5 8v8M16.5 8v8"/>',
        'exchange-rate.html': '<path d="m7 3.5-3.5 3.5L7 10.5"/><path d="M3.5 7H17"/><path d="m17 13.5 3.5 3.5-3.5 3.5"/><path d="M20.5 17H7"/>'
    };

    function svg(paths) {
        return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
    }

    function addIcons() {
        document.querySelectorAll('.sidebar a[href], .sidebar a[data-href]').forEach(a => {
            if (a.querySelector('svg')) return;
            const icon = ICONS[a.getAttribute('href') || a.dataset.href];
            if (icon) a.insertAdjacentHTML('afterbegin', svg(icon));
        });
    }

    function applyDesktopState() {
        const collapsed = localStorage.getItem(UI_KEY) === 'collapsed';
        document.documentElement.classList.toggle('nav-collapsed', !MOBILE.matches && collapsed);
    }

    function toggle() {
        if (MOBILE.matches) {
            document.body.classList.toggle('nav-open');
            return;
        }
        const collapsed = !document.documentElement.classList.contains('nav-collapsed');
        document.documentElement.classList.toggle('nav-collapsed', collapsed);
        localStorage.setItem(UI_KEY, collapsed ? 'collapsed' : 'open');
    }

    // ===== شريط التبويب للهاتف: فقاعة ملوّنة ترتفع فوق التبويب الحالي، والشريط ينحني تحتها =====
    const TABS = [
        ['home.html', 'الرئيسية', '#a3e635'],
        ['cashier.html', 'الكاشير', '#facc15'],
        ['sales-new_1.html', 'المبيعات', '#fb923c'],
        ['inventory.html', 'المخزن', '#f472b6']
    ];
    const TAB_KEY = 'uiTabFrom'; // التبويب السابق، لتنتقل الفقاعة منه عند فتح الصفحة الجديدة

    // شكل الشريط: مستطيل بزوايا دائرية وتجويف ناعم حول الفقاعة عند x (0 = بلا تجويف)
    function tabbarPath(w, h, x, depth) {
        const r = Math.min(18, h / 2);
        let top = `M${r},0`;
        if (depth > 0) {
            const half = 32, d = depth;
            // التجويف لا يتجاوز الزوايا الدائرية للتبويب الأول والأخير (الفرق بضع بكسلات لا تُرى)
            x = Math.min(Math.max(x, r + half + 8), w - r - half - 8);
            top += ` L${x - half - 8},0 C${x - half + 4},0 ${x - half + 4},${d} ${x},${d} C${x + half - 4},${d} ${x + half - 4},0 ${x + half + 8},0`;
        }
        return top + ` L${w - r},0 A${r},${r} 0 0 1 ${w},${r} L${w},${h - r} A${r},${r} 0 0 1 ${w - r},${h} L${r},${h} A${r},${r} 0 0 1 0,${h - r} L0,${r} A${r},${r} 0 0 1 ${r},0 Z`;
    }

    function buildTabbar() {
        const page = (location.pathname.split('/').pop() || 'home.html').toLowerCase();
        const current = TABS.findIndex(t => t[0] === page);
        const bar = document.createElement('nav');
        bar.className = 'tabbar';
        bar.setAttribute('aria-label', 'التبويبات');
        bar.innerHTML = '<div class="tab-glow" aria-hidden="true"></div>' +
            '<div class="tab-bg" aria-hidden="true"></div>' +
            '<svg class="tab-edge" aria-hidden="true"><path/></svg>' +
            '<span class="tab-bubble" aria-hidden="true"></span>' +
            TABS.map(([href, label, color], i) =>
                `<a href="${href}" style="--tab:${color}"${i === current ? ' aria-current="page"' : ''}>${svg(ICONS[href])}<span>${label}</span></a>`
            ).join('') +
            `<button type="button" data-more>${svg('<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>')}<span>المزيد</span></button>`;
        bar.querySelector('[data-more]').addEventListener('click', () => document.body.classList.add('nav-open'));
        bar.addEventListener('click', e => {
            const a = e.target.closest('a');
            if (a && current >= 0) try { sessionStorage.setItem(TAB_KEY, String(current)); } catch (err) { }
        }, true);
        document.body.appendChild(bar);
        document.body.classList.add('has-tabbar');

        const bg = bar.querySelector('.tab-bg');
        const edge = bar.querySelector('.tab-edge');
        const bubble = bar.querySelector('.tab-bubble');
        const items = [...bar.querySelectorAll('a, button')];
        let pos = null; // مركز الفقاعة الحالي

        function centerOf(i) {
            const b = bar.getBoundingClientRect(), r = items[i].getBoundingClientRect();
            return r.left - b.left + r.width / 2;
        }

        function draw(x) {
            const w = bar.clientWidth, h = bar.clientHeight;
            if (!w) return;
            const d = tabbarPath(w, h, x, x === null ? 0 : 20);
            bg.style.clipPath = `path('${d}')`;
            edge.setAttribute('viewBox', `0 0 ${w} ${h}`);
            edge.firstChild.setAttribute('d', d);
            if (x !== null) bubble.style.transform = `translateX(${x}px)`;
        }

        // at: موضع الفقاعة إن لم تكن فوق التبويب (بداية الانتقال)
        function show(i, at) {
            if (i < 0) return draw(null);
            const tab = items[i];
            bar.style.setProperty('--active', TABS[i][2]);
            bubble.innerHTML = tab.querySelector('svg').outerHTML;
            pos = at === undefined ? centerOf(i) : at;
            draw(pos);
        }

        // من التبويب السابق إلى الحالي بحركة ناعمة
        function slide(from, to) {
            const a = centerOf(from), b = centerOf(to);
            const start = performance.now(), dur = 420;
            bar.classList.add('moving');
            const step = now => {
                const t = Math.min(1, (now - start) / dur);
                const e = 1 - Math.pow(1 - t, 3);
                pos = a + (b - a) * e;
                draw(pos);
                if (t < 1) requestAnimationFrame(step);
                else bar.classList.remove('moving');
            };
            requestAnimationFrame(step);
        }

        function start() {
            if (!MOBILE.matches) return;
            let from = -1;
            try { from = Number(sessionStorage.getItem(TAB_KEY) ?? -1); sessionStorage.removeItem(TAB_KEY); } catch (err) { }
            const still = window.StoreTheme && StoreTheme.motionOff();
            if (current >= 0 && from >= 0 && from < items.length && from !== current && !still) {
                show(current, centerOf(from));
                slide(from, current);
            } else {
                show(current);
            }
        }

        requestAnimationFrame(start);
        window.addEventListener('resize', () => { if (MOBILE.matches) show(current); });
        MOBILE.addEventListener('change', start);
    }

    // ===== زر الفاتح/الداكن بجانب زر الخروج: المظهر الجديد ينتشر بدائرة من الزر =====
    const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>';
    const MOON = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';

    function addThemeButton() {
        const box = document.getElementById('userBox');
        if (!box || !window.StoreTheme || document.getElementById('themeBtn')) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.id = 'themeBtn';
        const paint = () => {
            const dark = StoreTheme.get().theme !== 'light';
            b.innerHTML = svg(dark ? SUN : MOON);
            b.title = dark ? 'المظهر الفاتح' : 'المظهر الداكن';
            b.setAttribute('aria-label', b.title);
        };
        paint();
        b.addEventListener('click', () => {
            const r = b.getBoundingClientRect();
            StoreTheme.toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
            paint();
        });
        const logout = document.getElementById('logoutBtn');
        box.insertBefore(b, logout || null);
    }

    // ===== إضاءة تتبع المؤشر فوق البطاقات (الكمبيوتر فقط) =====
    const SPOT = '.stat, .summary-card, .card, .panel, .sum-card';
    function initSpotlight() {
        if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        let frame = 0, last = null;
        document.addEventListener('pointermove', e => {
            last = e;
            if (frame) return;
            frame = requestAnimationFrame(() => {
                frame = 0;
                const card = last.target.closest && last.target.closest(SPOT);
                if (!card || (window.StoreTheme && StoreTheme.motionOff())) return;
                if (!card.querySelector(':scope > .spot')) {
                    const s = document.createElement('span');
                    s.className = 'spot';
                    s.setAttribute('aria-hidden', 'true');
                    card.appendChild(s);
                }
                const r = card.getBoundingClientRect();
                card.style.setProperty('--mx', (last.clientX - r.left) + 'px');
                card.style.setProperty('--my', (last.clientY - r.top) + 'px');
            });
        }, { passive: true });
    }

    // ===== الأرقام تعدّ حتى قيمتها عند الظهور، ومن القيمة السابقة عند تغيّرها =====
    const COUNT = '.stat .value, .summary-card .value';
    const NUM = /-?[\d٠-٩][\d٠-٩,٬]*(?:[.٫][\d٠-٩]+)?/;
    const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
    const counted = new Map(); // عنوان البطاقة -> آخر قيمة
    const loadedAt = performance.now();

    function readNumber(token) {
        const latin = token.replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d)).replace(/[,٬]/g, '').replace('٫', '.');
        return Number(latin);
    }

    function writeNumber(n, token) {
        const dec = (token.split(/[.٫]/)[1] || '').length;
        let out = /[,٬]/.test(token)
            ? n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
            : n.toFixed(dec);
        if (/[٠-٩]/.test(token)) out = out.replace(/\d/g, d => AR_DIGITS[d]).replace(/,/g, '٬').replace('.', '٫');
        return out;
    }

    function countUp(el) {
        if (el.dataset.counting) return;
        const node = [...el.childNodes].find(n => n.nodeType === 3 && NUM.test(n.nodeValue));
        if (!node) return;
        const token = node.nodeValue.match(NUM)[0];
        const target = readNumber(token);
        if (!isFinite(target)) return;
        const card = el.closest('.stat, .summary-card');
        const label = card && card.querySelector('.label, .title, h3, small');
        const key = (label ? label.textContent : '') + '|' + [...document.querySelectorAll(COUNT)].indexOf(el);
        const had = counted.has(key);
        const from = had ? counted.get(key) : 0;
        counted.set(key, target);
        // أول ظهور بعد فتح الصفحة فقط، أو تغيّر القيمة لاحقًا
        if (from === target || (!had && performance.now() - loadedAt > 4000)) return;
        if (window.StoreTheme && StoreTheme.motionOff()) return;
        const text = node.nodeValue, at = text.indexOf(token);
        const start = performance.now(), dur = had ? 600 : 900;
        el.dataset.counting = '1';
        const step = now => {
            if (!node.isConnected) return delete el.dataset.counting;
            const t = Math.min(1, (now - start) / dur);
            const e = 1 - Math.pow(1 - t, 4);
            const v = t < 1 ? from + (target - from) * e : target;
            const rounded = (token.split(/[.٫]/)[1] || '').length ? v : Math.round(v);
            node.nodeValue = text.slice(0, at) + (t < 1 ? writeNumber(rounded, token) : token) + text.slice(at + token.length);
            if (t < 1) requestAnimationFrame(step);
            else delete el.dataset.counting;
        };
        requestAnimationFrame(step);
    }

    function initCounters() {
        const scan = () => document.querySelectorAll(COUNT).forEach(countUp);
        let queued = false;
        new MutationObserver(() => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => { queued = false; scan(); });
        }).observe(document.body, { childList: true, subtree: true });
        scan();
    }

    function init() {
        const btn = document.createElement('button');
        btn.className = 'nav-toggle';
        btn.type = 'button';
        btn.setAttribute('aria-label', 'فتح أو إغلاق القائمة');
        btn.innerHTML = svg('<path d="M4 7h16M4 12h16M4 17h16"/>');
        document.body.appendChild(btn);

        const backdrop = document.createElement('div');
        backdrop.className = 'nav-backdrop';
        document.body.appendChild(backdrop);

        buildTabbar();
        addThemeButton();

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
        initSpotlight();
        initCounters();

        // الحركات تبدأ بعد أول رسم فقط، فلا يتحرك شيء أثناء تحميل الصفحة
        requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('nav-ready')));

        // المحتوى ظاهر الآن، أو بعد أن يتحقق auth.js من الدخول
        if (document.documentElement.style.visibility !== 'hidden') playEntrance();
        else if (window.StoreAuth) StoreAuth.ready.then(ok => { if (ok) playEntrance(); });
    }

    // ===== الجداول على الهاتف: كل سطر بطاقة، وكل خانة بعنوان عمودها (التنسيق في design.css) =====
    const SKIP_TABLE = '#printSheet, #receipt, #printArea, .no-stack, .ps-table';

    function labelTable(table) {
        if (table.closest(SKIP_TABLE) || !table.tHead) return;
        const body = table.tBodies[0];
        if (!body) return;
        // جدول إدخال (أصناف الفاتورة والمشتريات): بطاقات بخانات بعرض كامل
        table.classList.toggle('stack-form', !!body.querySelector('input:not([type=checkbox]), select, textarea'));
        const heads = [...table.tHead.rows[0].cells].map(th => th.textContent.trim());
        if (heads.length < 3) return;
        table.classList.add('stacked');
        [...table.tBodies].forEach(tb => [...tb.rows].forEach(tr => {
            let col = 0;
            [...tr.cells].forEach(td => {
                const label = td.colSpan > 1 ? '' : (heads[col] || '');
                if (td.dataset.label !== label) td.dataset.label = label;
                td.classList.toggle('wide', td.colSpan > 1);
                // خانة فارغة («لا يوجد»، «—») تُخفى في البطاقة فتقصر
                const text = td.textContent.trim();
                td.classList.toggle('blank', td.colSpan === 1 && !td.querySelector('img, svg, button, a, input') && ['', '—', '-', 'لا يوجد'].includes(text));
                col += td.colSpan || 1;
            });
        }));
    }

    let labelQueued = false;
    function labelTables() {
        labelQueued = false;
        document.querySelectorAll('main table, dialog table').forEach(labelTable);
    }
    function queueLabels() {
        if (labelQueued) return;
        labelQueued = true;
        requestAnimationFrame(labelTables);
    }

    function initTables() {
        labelTables();
        // الصفحات ترسم صفوفها بعد التحميل وعند كل تصفية
        new MutationObserver(queueLabels).observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTables);
    } else {
        initTables();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
