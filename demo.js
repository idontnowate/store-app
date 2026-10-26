/* demo.js — المتجر التجريبي: بيانات وهمية واقعية لتجربة البرنامج بدون حساب
 *
 * يعمل كله على الجهاز: مع appDemo لا يتصل storage.js بالسحابة ولا يرفع شيئًا، وauth.js لا يطلب تسجيل دخول.
 * التواريخ محسوبة من اليوم، فتبقى المبيعات والأقساط والتنبيهات حديثة متى فُتحت التجربة.
 * الخروج من التجربة (زر الخروج) يمسح كل بياناتها.
 */
(function () {
    const DEMO_KEY = 'appDemo';
    const MEMBERSHIP_KEY = 'appMembership';

    function day(offset) {
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // مولّد أرقام ثابت: نفس البيانات في كل مرة
    let seed = 7;
    function rand() {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    }
    const pick = arr => arr[Math.floor(rand() * arr.length)];

    // ===== المنتجات: [المعرف، الاسم، الفئة، سعر البيع، التكلفة، الكمية الافتتاحية، الحد الأدنى، العملة] =====
    const PRODUCTS = [
        ['d1', 'شاحن سامسونج 25 واط', 'شواحن', 15000, 9500, 40, 8],
        ['d2', 'شاحن آيفون 20 واط', 'شواحن', 22000, 14000, 30, 6],
        ['d3', 'شاحن سريع 65 واط', 'شواحن', 30000, 19000, 6, 5],
        ['d4', 'كيبل USB-C متر', 'كيبلات', 5000, 2000, 80, 15],
        ['d5', 'كيبل لايتننغ', 'كيبلات', 7000, 3000, 50, 10],
        ['d6', 'كيبل USB-C إلى C', 'كيبلات', 8000, 3500, 4, 10],
        ['d7', 'سماعة بلوتوث لاسلكية', 'سماعات', 35000, 22000, 18, 4],
        ['d8', 'سماعة سلكية', 'سماعات', 6000, 2500, 45, 10],
        ['d9', 'إيربودز برو (نسخة)', 'سماعات', 25000, 16000, 12, 4],
        ['d10', 'باور بانك 10000', 'باور بانك', 25000, 16000, 20, 5],
        ['d11', 'باور بانك 20000', 'باور بانك', 38000, 26000, 9, 3],
        ['d12', 'ساعة ذكية', 'ساعات', 55000, 38000, 7, 2],
        ['d13', 'حافظة آيفون 15', 'حافظات', 10000, 4000, 25, 6],
        ['d14', 'حافظة سامسونج A55', 'حافظات', 8000, 3000, 0, 5],
        ['d15', 'شاشة حماية زجاج', 'حماية', 5000, 1500, 100, 20],
        ['d16', 'حامل هاتف للسيارة', 'إكسسوارات', 12000, 6500, 15, 3],
        ['d17', 'ذاكرة 64 جيجا', 'ذواكر', 12000, 7500, 22, 5],
        ['d18', 'فلاش 32 جيجا', 'ذواكر', 8000, 4500, 3, 5],
        ['d19', 'سماعة جي بي إل', 'سماعات', 95, 72, 5, 2, 'USD'],
        ['d20', 'آيباد كفر', 'حافظات', 18000, 9000, 10, 3]
    ].map(([id, name, category, price, cost, openingQty, minQty, currency], i) => ({
        // الكمية تكفي مبيعات الشهر، إلا المنتجات المقصودة للتنبيه (نافد أو قارب)
        id, name, category, price, cost, minQty,
        openingQty: ['d14'].includes(id) ? 0 : ['d3', 'd6', 'd18'].includes(id) ? openingQty + 2 : openingQty * 4 + 20,
        barcode: '62' + String(1000000000 + i * 7919).slice(0, 10) + (i % 10),
        ...(currency ? { currency } : {})
    }));

    const CUSTOMERS = [
        ['أحمد كريم', '07701234501'], ['زينب جاسم', '07801234502'], ['علي حسين', '07701234503'],
        ['نور الهدى', '07501234504'], ['مصطفى عادل', '07801234505'], ['سارة فاضل', '07701234506'],
        ['حسن علي', '07901234507'], ['مريم سعد', '07501234508']
    ];
    const EMPLOYEES = ['مدير تجريبي', 'علي (كاشير)'];

    function buildInvoices() {
        const byId = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
        const iqdItems = PRODUCTS.filter(p => !p.currency && p.openingQty > 0);
        const invoices = [];
        let n = 0;
        // 30 يومًا، 2 إلى 6 فواتير يوميًا
        for (let d = -29; d <= 0; d++) {
            const count = 2 + Math.floor(rand() * 5);
            for (let k = 0; k < count; k++) {
                n++;
                const lines = 1 + Math.floor(rand() * 3);
                const items = [];
                for (let l = 0; l < lines; l++) {
                    const p = pick(iqdItems);
                    if (items.some(it => it.productId === p.id)) continue;
                    const qty = p.price < 10000 ? 1 + Math.floor(rand() * 3) : 1;
                    items.push({ category: p.category, description: p.name, productId: p.id, qty, price: p.price, total: qty * p.price, cost: p.cost });
                }
                const r = rand();
                const named = r < .45;
                const cust = named ? pick(CUSTOMERS)[0] : 'زبون نقدي';
                const payment = r < .12 && named ? 'دين' : r < .3 ? 'بطاقة' : 'نقدي';
                const subtotal = items.reduce((s, it) => s + it.total, 0);
                const discount = subtotal > 40000 && rand() < .3 ? 1000 : 0;
                invoices.push({
                    number: 'C' + String(n).padStart(5, '0'),
                    date: day(d),
                    customer: cust,
                    employee: pick(EMPLOYEES),
                    payment,
                    discount,
                    notes: 'بيع من الكاشير',
                    items,
                    category: [...new Set(items.map(it => it.category))].join('، '),
                    amount: subtotal - discount
                });
            }
        }

        // فواتير دين أكبر للأقساط
        const big = (num, d, cust, lines) => {
            const items = lines.map(([id, qty]) => {
                const p = byId[id];
                return { category: p.category, description: p.name, productId: id, qty, price: p.price, total: qty * p.price, cost: p.cost };
            });
            const amount = items.reduce((s, it) => s + it.total, 0);
            return { number: num, date: day(d), customer: cust, employee: EMPLOYEES[0], payment: 'دين', discount: 0, notes: 'تقسيط', items, category: [...new Set(items.map(it => it.category))].join('، '), amount };
        };
        invoices.push(big('C09001', -40, 'حسن علي', [['d12', 1], ['d11', 1], ['d7', 1]]));   // متأخر
        invoices.push(big('C09002', -25, 'زينب جاسم', [['d12', 1], ['d10', 1]]));            // قسط غدًا
        invoices.push(big('C09003', -20, 'أحمد كريم', [['d11', 2]]));                          // قسط اليوم
        invoices.push(big('C09004', -45, 'مريم سعد', [['d7', 2], ['d9', 1]]));                // دين قديم بلا تقسيط
        return invoices;
    }

    function buildData() {
        seed = 7;
        const invoices = buildInvoices();
        const debt = invoices.filter(inv => inv.payment === 'دين' && !/^C09/.test(inv.number));
        // تسديدات جزئية لبعض الديون العادية
        const payments = debt.slice(0, Math.ceil(debt.length / 2)).map((inv, i) => ({
            id: 'dp' + i, invoiceNumber: inv.number, amount: Math.round(inv.amount / 2 / 250) * 250, date: inv.date, note: 'دفعة'
        }));
        payments.push({ id: 'dpx', invoiceNumber: 'C09001', amount: 20000, date: day(-40), note: 'مقدمة' });

        const plan = (id, invoiceNumber, customer, total, paidAtStart, amounts, start) => ({ id, invoiceNumber, customer, total, paidAtStart, amounts, start, every: 1, created: Date.now() });
        const inv = num => invoices.find(x => x.number === num);
        const plans = [
            plan('pl1', 'C09001', 'حسن علي', inv('C09001').amount - 20000, 20000, [33500, 33500, 33000], day(-10)),
            plan('pl2', 'C09002', 'زينب جاسم', inv('C09002').amount, 0, [20000, 20000, 20000, 20000], day(1)),
            plan('pl3', 'C09003', 'أحمد كريم', inv('C09003').amount, 0, [19000, 19000, 19000, 19000], day(0))
        ];

        const purchases = [
            { id: 'pu1', number: 'P-1001', date: day(-28), supplier: 'شركة الرافدين للإلكترونيات', payment: 'نقدي', payments: [], settled: true, discount: 0, notes: '',
                items: [{ productId: 'd1', name: 'شاحن سامسونج 25 واط', barcode: '', qty: 30, cost: 9500, total: 285000 }, { productId: 'd4', name: 'كيبل USB-C متر', barcode: '', qty: 60, cost: 2000, total: 120000 }], subtotal: 405000 },
            { id: 'pu2', number: 'P-1002', date: day(-12), supplier: 'مخازن بغداد', payment: 'دين', payments: [{ id: 'pp1', date: day(-5), amount: 150000, note: 'دفعة أولى' }], settled: false, discount: 0, notes: '',
                items: [{ productId: 'd10', name: 'باور بانك 10000', barcode: '', qty: 15, cost: 16000, total: 240000 }, { productId: 'd12', name: 'ساعة ذكية', barcode: '', qty: 4, cost: 38000, total: 152000 }], subtotal: 392000 },
            { id: 'pu3', number: 'P-1003', date: day(-3), supplier: 'شركة الرافدين للإلكترونيات', payment: 'دين', payments: [], settled: false, discount: 0, notes: '',
                items: [{ productId: 'd13', name: 'حافظة آيفون 15', barcode: '', qty: 20, cost: 4000, total: 80000 }], subtotal: 80000 }
        ];

        return {
            storeSettings: { name: 'متجر تجريبي — إكسسوارات الموبايل', phone: '07700000000', address: 'بغداد — الكرادة', footer: 'شكرًا لتسوقكم', policies: ['البضاعة المباعة تُستبدل خلال 3 أيام مع الفاتورة'] },
            storeOptions: { usdSource: 'manual', usdMarket: 'baghdad', defaultPayment: 'نقدي', reminderDays: 1 },
            storeProducts: PRODUCTS,
            storeInvoices: invoices,
            storeDebtPayments: payments,
            storeInstallments: plans,
            storePurchases: purchases,
            storeCustomerPhones: CUSTOMERS.map(([name, phone]) => ({ name, phone: '964' + phone.slice(1) })),
            storeExchangeRates: [{ id: 'r1', created: Date.now(), date: day(0), rates: { baghdad: { buy: 1480, sell: 1490 } } }],
            storeCashOpening: 750000,
            storeCashManual: [
                { id: 'm1', kind: 'out', amount: 250000, note: 'إيجار المحل', date: day(-15) },
                { id: 'm2', kind: 'out', amount: 35000, note: 'كهرباء المولدة', date: day(-6) }
            ],
            storeStockAdjustments: []
        };
    }

    // هل على الجهاز بيانات متجر حقيقي لم تُرفع بعد؟ عندها لا نشغّل التجربة حتى لا تُمسح
    function hasPendingRealData() {
        return Object.keys(localStorage).some(k => {
            if (!k.startsWith('appSyncDirty')) return false;
            try { return Object.keys(JSON.parse(localStorage.getItem(k) || '{}')).length > 0; } catch { return false; }
        });
    }

    // بيانات المتجر على الجهاز (نفس ما يمسحه تسجيل الخروج)، ما عدا إعدادات الجهاز
    function wipeStoreData() {
        Object.keys(localStorage)
            .filter(k => (k.startsWith('store') && k !== 'storePrefs' && k !== 'storeSession') ||
                k.startsWith('appSync') || k === 'appDataOwner' || k === 'appSubscription' || k === 'appDeviceCheck')
            .forEach(k => localStorage.removeItem(k));
    }

    function start() {
        if (localStorage.getItem('sb-pxxgydllfustqkpkfiqn-auth-token')) {
            throw new Error('أنت مسجّل الدخول بمتجرك على هذا الجهاز. سجّل الخروج أولًا لتجربة النسخة التجريبية.');
        }
        if (hasPendingRealData()) {
            throw new Error('على هذا الجهاز تغييرات لمتجرك لم تُرفع بعد. سجّل الدخول واتركها تُرفع قبل تشغيل التجربة.');
        }
        // أولًا: وضع التجربة، فلا يُرفع أي شيء مما يلي
        localStorage.setItem(DEMO_KEY, '1');
        wipeStoreData();
        localStorage.setItem(MEMBERSHIP_KEY, JSON.stringify({ store_id: 'demo', role: 'admin', display_name: 'مدير تجريبي', username: 'demo' }));
        const data = buildData();
        Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)));
        location.replace('home.html');
    }

    window.StoreDemo = { start, buildData, isOn: () => localStorage.getItem(DEMO_KEY) === '1' };
})();
