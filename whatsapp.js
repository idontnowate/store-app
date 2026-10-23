/* whatsapp.js — إرسال الفواتير وتذكير الديون والتقرير اليومي برسالة واتساب جاهزة
 *
 * يفتح واتساب (التطبيق أو الويب) على محادثة الرقم مع نص الرسالة، والمستخدم يضغط إرسال.
 * أرقام الزبائن تُحفظ في storeCustomerPhones وتتزامن بين أجهزة المتجر.
 */
(function () {
    const PHONES_KEY = 'storeCustomerPhones';
    const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-3.3-.8-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.3 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.2 1.6 1.9 1 .9 1.9 1.2 2.2 1.3.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.1.1.6-.1 1.2z"/></svg>';

    function money(n) {
        return Number(n || 0).toLocaleString('en-US') + ' د.ع';
    }

    // ===== الأرقام =====
    // يقبل 07xxxxxxxxx أو 7xxxxxxxxx أو +964 أو 00964، وبالأرقام العربية أيضًا. يعيد 9647xxxxxxxxx أو null
    function normalizePhone(input) {
        let d = String(input || '')
            .replace(/[٠-٩]/g, c => '٠١٢٣٤٥٦٧٨٩'.indexOf(c))
            .replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c))
            .replace(/\D/g, '');
        if (d.startsWith('00')) d = d.slice(2);
        if (d.startsWith('0')) d = '964' + d.slice(1);
        else if (d.length === 10 && d.startsWith('7')) d = '964' + d;
        return d.length >= 10 && d.length <= 15 ? d : null;
    }

    // للعرض: 0776 252 5551
    function displayPhone(phone) {
        const p = normalizePhone(phone);
        if (!p) return '';
        if (p.startsWith('964') && p.length === 13) {
            const l = '0' + p.slice(3);
            return l.slice(0, 4) + ' ' + l.slice(4, 7) + ' ' + l.slice(7);
        }
        return '+' + p;
    }

    const nameKey = name => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

    function readPhones() {
        try {
            const v = JSON.parse(localStorage.getItem(PHONES_KEY) || '[]');
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    }

    function getPhone(name) {
        const k = nameKey(name);
        if (!k) return null;
        const hit = readPhones().find(x => nameKey(x.name) === k);
        return hit ? hit.phone : null;
    }

    // قائمة سجلات (لا كائن واحد) حتى تندمج إضافات الأجهزة المختلفة دون أن تمحو بعضها
    function savePhone(name, phone) {
        const k = nameKey(name);
        const p = normalizePhone(phone);
        if (!k || !p || k === nameKey('زبون نقدي')) return;
        const list = readPhones();
        if (list.some(x => nameKey(x.name) === k && x.phone === p)) return;
        const next = list.filter(x => nameKey(x.name) !== k);
        next.push({ name: String(name).trim(), phone: p });
        localStorage.setItem(PHONES_KEY, JSON.stringify(next));
    }

    // ===== فتح واتساب =====
    function open(phone, text) {
        const p = normalizePhone(phone);
        const url = 'https://wa.me/' + (p || '') + '?text=' + encodeURIComponent(text);
        const w = window.open(url, '_blank');
        if (w) w.opener = null;
        else location.href = url;
    }

    // ===== نافذة الرقم =====
    let dlg = null;

    function injectCss() {
        if (document.getElementById('waCss')) return;
        const st = document.createElement('style');
        st.id = 'waCss';
        st.textContent = `
            dialog.wa-dlg { width: min(440px, calc(100vw - 32px)); }
            .wa-dlg form { display: grid; gap: 14px; }
            .wa-dlg p { margin: 0; color: var(--text-2); font-size: 14px; line-height: 1.7; }
            .wa-dlg label { display: grid; gap: 7px; font-size: 13.5px; font-weight: 500; color: var(--text-2); }
            .wa-dlg input { font: inherit; direction: ltr; text-align: right; padding: 11px 13px; border-radius: var(--radius-sm); border: 1px solid var(--border-strong); background: var(--surface); color: var(--text); }
            .wa-dlg input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
            .wa-dlg .wa-err { min-height: 18px; color: var(--danger); font-size: 13px; }
            .wa-dlg .wa-preview { max-height: 180px; overflow: auto; white-space: pre-wrap; padding: 12px 14px; border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-2); font-size: 13px; line-height: 1.7; }
            .wa-dlg .wa-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start; }
            .wa-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 0 16px; border-radius: var(--radius-sm); border: 1px solid transparent; background: #128c5e; color: #fff; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; text-decoration: none; transition: background var(--dur-1) var(--ease); }
            .wa-btn:hover { background: #0e7550; }
            .wa-btn svg { width: 18px; height: 18px; fill: currentColor; flex: none; }
            .wa-btn.ghost { background: var(--surface); color: var(--text); border-color: var(--border-strong); }
            .wa-btn.ghost:hover { background: var(--surface-2); }
            .wa-btn.small { min-height: 32px; padding: 0 11px; font-size: 13px; }
            .wa-btn.small svg { width: 15px; height: 15px; }
            .wa-btn.icon { width: 34px; min-height: 34px; padding: 0; }
        `;
        document.head.appendChild(st);
    }

    function ensureDialog() {
        if (dlg) return dlg;
        injectCss();
        dlg = document.createElement('dialog');
        dlg.className = 'wa-dlg';
        dlg.setAttribute('aria-labelledby', 'waTitle');
        dlg.innerHTML = `
            <form method="dialog" novalidate>
                <h2 id="waTitle">إرسال بالواتساب</h2>
                <p id="waText"></p>
                <label>رقم الواتساب
                    <input id="waPhone" type="tel" inputmode="tel" autocomplete="off" placeholder="07xx xxx xxxx">
                </label>
                <div class="wa-err" id="waErr" role="alert"></div>
                <div class="wa-preview" id="waPreview"></div>
                <div class="wa-actions">
                    <button class="wa-btn" type="submit" value="send">${ICON}<span>فتح واتساب</span></button>
                    <button class="wa-btn ghost" type="submit" value="pick" id="waPick">اختيار من جهات الاتصال</button>
                    <button class="wa-btn ghost" type="submit" value="cancel" formnovalidate>إلغاء</button>
                </div>
            </form>`;
        document.body.appendChild(dlg);
        return dlg;
    }

    /* يعرض الرسالة ويطلب الرقم (معبأ مسبقًا إن كان معروفًا)، ثم يفتح واتساب.
     * opts: { title, intro, phone, name (لحفظ الرقم باسم الزبون), text, allowPick } */
    function compose(opts) {
        const d = ensureDialog();
        const input = d.querySelector('#waPhone');
        const err = d.querySelector('#waErr');
        d.querySelector('#waTitle').textContent = opts.title || 'إرسال بالواتساب';
        d.querySelector('#waText').textContent = opts.intro || '';
        d.querySelector('#waText').hidden = !opts.intro;
        d.querySelector('#waPreview').textContent = opts.text;
        d.querySelector('#waPick').hidden = opts.allowPick === false;
        input.value = displayPhone(opts.phone || (opts.name && getPhone(opts.name)) || '');
        err.textContent = '';

        return new Promise(resolve => {
            const form = d.querySelector('form');
            const onSubmit = e => {
                const action = e.submitter ? e.submitter.value : 'send';
                if (action === 'send') {
                    const p = normalizePhone(input.value);
                    if (!p) {
                        e.preventDefault();
                        err.textContent = 'اكتب رقمًا صحيحًا، مثل 07701234567';
                        input.focus();
                        return;
                    }
                    if (opts.name) savePhone(opts.name, p);
                    finish();
                    open(p, opts.text);
                    resolve(p);
                } else if (action === 'pick') {
                    finish();
                    open(null, opts.text);
                    resolve('');
                } else {
                    finish();
                    resolve(null);
                }
            };
            const onCancel = () => { finish(); resolve(null); };
            function finish() {
                form.removeEventListener('submit', onSubmit);
                d.removeEventListener('cancel', onCancel);
                if (d.open) d.close();
            }
            form.addEventListener('submit', onSubmit);
            d.addEventListener('cancel', onCancel);
            d.showModal();
            setTimeout(() => (input.value ? d.querySelector('.wa-btn') : input).focus(), 30);
        });
    }

    // ===== نصوص الرسائل =====
    function storeInfo() {
        return window.StoreAuth && StoreAuth.getStoreInfo ? StoreAuth.getStoreInfo() : { name: '' };
    }

    function footerLines(info) {
        const out = [];
        if (info.phone) out.push('للتواصل: ' + info.phone);
        if (info.address && info.address !== 'المدينة - الشارع') out.push(info.address);
        return out;
    }

    // null = سطر غير موجود، '' = سطر فارغ مقصود (لا يتكرر)
    function compact(lines) {
        return lines
            .filter(l => l !== null && l !== undefined)
            .filter((l, i, a) => l !== '' || (i > 0 && a[i - 1] !== ''))
            .join('\n')
            .trim();
    }

    function invoiceText(inv) {
        const info = storeInfo();
        const items = Array.isArray(inv.items) ? inv.items : [];
        const sub = items.reduce((s, it) => s + Number(it.total ?? Number(it.qty || 0) * Number(it.price || 0)), 0);
        const lines = [
            `*${info.name || 'فاتورة'}*`,
            `فاتورة رقم ${inv.number} — ${inv.date || ''}`,
            inv.customer && inv.customer !== 'زبون نقدي' ? `الزبون: ${inv.customer}` : null,
            '',
            ...items.map(it => `• ${it.description || it.name || ''} × ${Number(it.qty || 0)} = ${money(it.total ?? Number(it.qty || 0) * Number(it.price || 0))}`),
            '',
            Number(inv.discount || 0) > 0 ? `المجموع: ${money(sub)}\nالخصم: ${money(inv.discount)}` : null,
            `*الإجمالي: ${money(inv.amount)}*`,
            `الدفع: ${inv.payment || ''}`,
            inv.payment === 'دين' && inv.remaining !== undefined ? `المتبقي: ${money(inv.remaining)}` : null,
            '',
            info.footer || 'شكرًا لتسوقكم',
            ...footerLines(info)
        ];
        return compact(lines);
    }

    // debts: [{ number, date, amount, remaining }]، notes: أسطر إضافية (مثل الأقساط)
    function debtText(customer, debts, notes) {
        const info = storeInfo();
        const total = debts.reduce((s, d) => s + Number(d.remaining || 0), 0);
        const lines = [
            `مرحبًا ${customer}،`,
            `نذكّرك بأن المبلغ المتبقي عليك لدى ${info.name || 'المتجر'} هو *${money(total)}*.`,
            ''
        ];
        if (debts.length > 1 || debts[0].remaining !== debts[0].amount) {
            debts.forEach(d => lines.push(`• فاتورة ${d.number} (${d.date || ''}): المتبقي ${money(d.remaining)}`));
            lines.push('');
        } else {
            lines.push(`فاتورة ${debts[0].number} بتاريخ ${debts[0].date || ''}`, '');
        }
        if (notes && notes.length) lines.push(...notes, '');
        lines.push('شكرًا لتعاملك معنا.', ...footerLines(info));
        return lines.join('\n').trim();
    }

    // s: { date, salesTotal, invoiceCount, cash, card, debt, collected, profit, expenses, cashBalance, debtTotal, lowStock: [names] }
    function dailyText(s) {
        const info = storeInfo();
        const lines = [
            `*ملخص ${info.name || 'المتجر'} — ${s.date}*`,
            '',
            `المبيعات: ${money(s.salesTotal)} (${s.invoiceCount} فاتورة)`,
            `• نقدي: ${money(s.cash)}`,
            s.card ? `• بطاقة: ${money(s.card)}` : null,
            `• دين: ${money(s.debt)}`,
            s.collected ? `تسديد ديون اليوم: ${money(s.collected)}` : null,
            `الربح التقديري اليوم: ${money(s.profit)}`,
            s.expenses ? `مصروفات اليوم: ${money(s.expenses)}` : null,
            '',
            `رصيد الصندوق الآن: ${money(s.cashBalance)}`,
            `مجموع ديون الزبائن: ${money(s.debtTotal)}`
        ];
        if (s.lowStock && s.lowStock.length) {
            lines.push('', `منتجات قاربت على النفاد (${s.lowStock.length}):`);
            s.lowStock.slice(0, 8).forEach(n => lines.push('• ' + n));
            if (s.lowStock.length > 8) lines.push(`• و${s.lowStock.length - 8} غيرها`);
        }
        return compact(lines);
    }

    injectCss();

    window.StoreWA = {
        ICON,
        normalizePhone,
        displayPhone,
        getPhone,
        savePhone,
        open,
        compose,
        invoiceText,
        debtText,
        dailyText,
        // يرسل فاتورة: يقترح رقم الفاتورة أو الرقم المحفوظ للزبون. فاتورة الدين تذكر المتبقي
        sendInvoice(inv, extra) {
            const named = inv.customer && inv.customer !== 'زبون نقدي' ? inv.customer : '';
            if (inv.payment === 'دين' && !(extra && 'remaining' in extra)) {
                let paid = 0;
                try {
                    paid = (JSON.parse(localStorage.getItem('storeDebtPayments') || '[]') || [])
                        .filter(p => p.invoiceNumber === inv.number)
                        .reduce((t, p) => t + Number(p.amount || 0), 0);
                } catch (e) { }
                extra = { ...(extra || {}), remaining: Math.max(0, Number(inv.amount || 0) - paid) };
            }
            return compose({
                title: 'إرسال الفاتورة ' + inv.number,
                phone: inv.phone || (named && getPhone(named)) || '',
                name: named,
                text: invoiceText({ ...inv, ...(extra || {}) })
            });
        }
    };
})();
