/* credit.js — حسابات الزبائن: كشف الحساب، والأقساط
 *
 * الدين = فواتير "دين" (أو دين سُدد بالكامل فصار نقدي) − تسديداتها في storeDebtPayments.
 * خطة التقسيط تُحفظ في storeInstallments، وتسديدات الفاتورة بعد إنشاء الخطة توزَّع على الأقساط بالترتيب.
 */
(function () {
    const INVOICES_KEY = 'storeInvoices';
    const PAYMENTS_KEY = 'storeDebtPayments';
    const PLANS_KEY = 'storeInstallments';
    const CASH_NAME = 'زبون نقدي';
    // الأقساط تُقرَّب لأقرب 250 دينار، والفرق في القسط الأخير
    const ROUND = 250;

    function list(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    }

    function todayLocal() {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 10);
    }

    const nameKey = n => String(n || '').trim().replace(/\s+/g, ' ');
    const isDebt = inv => inv.payment === 'دين' || !!inv.debtSettled;

    function load() {
        return { invoices: list(INVOICES_KEY), payments: list(PAYMENTS_KEY), plans: list(PLANS_KEY) };
    }

    function paidFor(number, payments) {
        return (payments || list(PAYMENTS_KEY))
            .filter(p => p.invoiceNumber === number)
            .reduce((s, p) => s + Number(p.amount || 0), 0);
    }

    // ===== الأقساط =====
    // يضيف أشهرًا مع الحفاظ على اليوم قدر الإمكان (31 يناير + شهر = آخر فبراير)
    function addMonths(iso, n) {
        const [y, m, d] = iso.split('-').map(Number);
        const target = new Date(Date.UTC(y, m - 1 + n, 1));
        const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        target.setUTCDate(Math.min(d, last));
        return target.toISOString().slice(0, 10);
    }

    function splitAmounts(total, count) {
        const each = Math.max(ROUND, Math.ceil(total / count / ROUND) * ROUND);
        const out = [];
        let left = total;
        for (let i = 0; i < count; i++) {
            const a = i === count - 1 ? left : Math.min(each, left);
            out.push(Math.max(0, a));
            left -= a;
        }
        return out.filter((a, i) => a > 0 || i === 0);
    }

    // جدول الأقساط مع حالة كل قسط: paid | partial | overdue | due (اليوم) | upcoming
    function schedule(plan, data) {
        const d = data || load();
        const today = todayLocal();
        const allocated = Math.max(0, paidFor(plan.invoiceNumber, d.payments) - Number(plan.paidAtStart || 0));
        let pool = allocated;
        return plan.amounts.map((amount, i) => {
            const due = addMonths(plan.start, i * (plan.every || 1));
            const paid = Math.min(amount, pool);
            pool -= paid;
            const left = amount - paid;
            let status = 'upcoming';
            if (left <= 0) status = 'paid';
            else if (due < today) status = 'overdue';
            else if (due === today) status = 'due';
            else if (paid > 0) status = 'partial';
            return { n: i + 1, due, amount, paid, left, status };
        });
    }

    function planFor(number, data) {
        return (data || load()).plans.find(p => p.invoiceNumber === number) || null;
    }

    // ملخص الخطة: المتأخر، والقسط القادم
    function planState(plan, data) {
        const rows = schedule(plan, data);
        const overdue = rows.filter(r => r.status === 'overdue');
        const next = rows.find(r => r.left > 0) || null;
        return {
            rows,
            overdueCount: overdue.length,
            overdueAmount: overdue.reduce((s, r) => s + r.left, 0),
            next,
            done: !next
        };
    }

    // ينشئ خطة لما تبقى من الفاتورة (يستبدل أي خطة سابقة لها)
    function createPlan({ invoiceNumber, count, start, every }) {
        const d = load();
        const inv = d.invoices.find(x => x.number === invoiceNumber);
        if (!inv) throw new Error('الفاتورة غير موجودة');
        const paid = paidFor(invoiceNumber, d.payments);
        const remaining = Math.max(0, Number(inv.amount || 0) - paid);
        if (remaining <= 0) throw new Error('الفاتورة مسددة بالكامل');
        count = Math.floor(Number(count));
        if (!(count >= 2 && count <= 60)) throw new Error('عدد الأقساط بين 2 و 60');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '')) throw new Error('اختر تاريخ أول قسط');

        const plan = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            invoiceNumber,
            customer: inv.customer || '',
            total: remaining,
            paidAtStart: paid,
            every: Math.max(1, Math.floor(Number(every) || 1)),
            start,
            amounts: splitAmounts(remaining, count),
            created: todayLocal()
        };
        plan.count = plan.amounts.length;
        const plans = d.plans.filter(p => p.invoiceNumber !== invoiceNumber);
        plans.push(plan);
        localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
        return plan;
    }

    function removePlan(invoiceNumber) {
        const plans = list(PLANS_KEY);
        const next = plans.filter(p => p.invoiceNumber !== invoiceNumber);
        if (next.length !== plans.length) localStorage.setItem(PLANS_KEY, JSON.stringify(next));
    }

    // كل الأقساط المتأخرة في المتجر (للتنبيهات)
    function overdueInstallments() {
        const d = load();
        const out = [];
        d.plans.forEach(plan => {
            const inv = d.invoices.find(x => x.number === plan.invoiceNumber);
            if (!inv) return;
            const st = planState(plan, d);
            if (st.overdueCount) out.push({ plan, inv, ...st });
        });
        return out;
    }

    // ===== الزبائن وكشف الحساب =====
    function customers() {
        const d = load();
        const map = new Map();
        d.invoices.forEach(inv => {
            const name = nameKey(inv.customer);
            if (!name || name === CASH_NAME) return;
            let c = map.get(name);
            if (!c) map.set(name, c = { name, invoices: 0, purchases: 0, debt: 0, paid: 0, remaining: 0, last: '', phone: null, plans: 0, overdue: 0 });
            const amount = Number(inv.amount || 0);
            c.invoices++;
            c.purchases += amount;
            if ((inv.date || '') >= c.last) {
                c.last = inv.date || '';
                if (inv.phone) c.phone = inv.phone;
            }
            if (isDebt(inv)) {
                const paid = paidFor(inv.number, d.payments);
                c.debt += amount;
                c.paid += Math.min(paid, amount);
                c.remaining += Math.max(0, amount - paid);
                const plan = d.plans.find(p => p.invoiceNumber === inv.number);
                if (plan && amount - paid > 0) {
                    c.plans++;
                    c.overdue += planState(plan, d).overdueAmount;
                }
            }
        });
        if (window.StoreWA) map.forEach(c => { if (!c.phone) c.phone = StoreWA.getPhone(c.name); });
        return [...map.values()];
    }

    /* كشف حساب زبون: حركات الدين بالترتيب مع الرصيد بعد كل حركة.
     * includeCash: يضيف الفواتير النقدية (مشتريات مدفوعة) للعلم دون أن تغيّر الرصيد */
    function statement(name, includeCash) {
        const d = load();
        const key = nameKey(name);
        const invs = d.invoices.filter(inv => nameKey(inv.customer) === key);
        const numbers = new Set(invs.filter(isDebt).map(inv => inv.number));
        const rows = [];

        invs.forEach((inv, i) => {
            const amount = Number(inv.amount || 0);
            if (isDebt(inv)) {
                rows.push({ date: inv.date || '', order: 0, i, kind: 'invoice', number: inv.number, text: 'فاتورة دين ' + inv.number, debit: amount, credit: 0 });
            } else if (includeCash) {
                rows.push({ date: inv.date || '', order: 0, i, kind: 'cash', number: inv.number, text: `فاتورة ${inv.payment || 'نقدي'} ${inv.number}`, debit: amount, credit: amount });
            }
        });
        d.payments.forEach((p, i) => {
            if (!numbers.has(p.invoiceNumber)) return;
            rows.push({ date: p.date || '', order: 1, i, kind: 'payment', number: p.invoiceNumber, text: 'تسديد فاتورة ' + p.invoiceNumber + (p.note ? ' — ' + p.note : ''), debit: 0, credit: Number(p.amount || 0) });
        });

        rows.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.i - b.i);
        let balance = 0;
        rows.forEach(r => {
            balance += r.debit - r.credit;
            r.balance = balance;
        });

        const debit = rows.filter(r => r.kind === 'invoice').reduce((s, r) => s + r.debit, 0);
        const credit = rows.filter(r => r.kind === 'payment').reduce((s, r) => s + r.credit, 0);
        const plans = d.plans
            .filter(p => numbers.has(p.invoiceNumber))
            .map(p => ({ plan: p, ...planState(p, d) }))
            .filter(p => !p.done);
        return {
            name: key,
            rows,
            debit,
            credit,
            balance: debit - credit,
            purchases: invs.reduce((s, inv) => s + Number(inv.amount || 0), 0),
            invoiceCount: invs.length,
            plans
        };
    }

    window.StoreCredit = {
        PLANS_KEY,
        isDebt,
        paidFor,
        addMonths,
        splitAmounts,
        schedule,
        planFor,
        planState,
        createPlan,
        removePlan,
        overdueInstallments,
        customers,
        statement
    };
})();
