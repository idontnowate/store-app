/* reminders.js — تذكيرات الأقساط بالواتساب: قائمة يومية جاهزة، ورسالة مكتوبة، وضغطة واحدة لكل زبون
 *
 * الإرسال التلقائي الكامل يحتاج واتساب API مدفوعًا من ميتا، لذلك البرنامج يجهّز كل شيء
 * والمستخدم يضغط "إرسال" فيفتح واتساب على الزبون والرسالة مكتوبة.
 * ما أُرسل يُسجَّل في storeReminderLog (يتزامن بين أجهزة المتجر) حتى لا يتكرر.
 * الإعدادات في storeOptions: reminderDays، reminderLate، reminderTextSoon، reminderTextLate.
 */
(function () {
    const LOG_KEY = 'storeReminderLog';
    const KEEP_DAYS = 120;

    const DEFAULT_SOON = [
        'مرحبًا {الزبون}،',
        'نذكّرك بأن موعد القسط {القسط} من فاتورة {الفاتورة} هو {اليوم} ({التاريخ}) بمبلغ *{المبلغ}*.',
        'شكرًا لتعاملك مع {المتجر}.'
    ].join('\n');

    const DEFAULT_LATE = [
        'مرحبًا {الزبون}،',
        'نذكّرك بأن القسط {القسط} من فاتورة {الفاتورة} كان مستحقًا بتاريخ {التاريخ} بمبلغ *{المبلغ}* ولم يُسدَّد بعد.',
        'نرجو التسديد بأقرب وقت. شكرًا لتعاملك مع {المتجر}.'
    ].join('\n');

    const PLACEHOLDERS = ['{الزبون}', '{المبلغ}', '{التاريخ}', '{اليوم}', '{القسط}', '{الفاتورة}', '{المتجر}'];

    function readList(key) {
        try {
            const v = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    }

    function options() {
        let o = {};
        try { o = JSON.parse(localStorage.getItem('storeOptions') || '{}') || {}; } catch (e) { }
        const days = Number(o.reminderDays);
        return {
            days: [0, 1, 2, 3].includes(days) ? days : 1,
            late: o.reminderLate !== false,
            soonText: String(o.reminderTextSoon || '').trim() || DEFAULT_SOON,
            lateText: String(o.reminderTextLate || '').trim() || DEFAULT_LATE
        };
    }

    function todayLocal() {
        const d = new Date();
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        return d.toISOString().slice(0, 10);
    }

    function daysBetween(a, b) {
        return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
    }

    function money(n) {
        return Number(n || 0).toLocaleString('en-US') + ' د.ع';
    }

    function whenText(inDays) {
        if (inDays === 0) return 'اليوم';
        if (inDays === 1) return 'غدًا';
        if (inDays === 2) return 'بعد يومين';
        if (inDays > 2) return `بعد ${inDays} أيام`;
        const late = -inDays;
        return late === 1 ? 'متأخر يومًا' : late === 2 ? 'متأخر يومين' : `متأخر ${late} أيام`;
    }

    // ===== سجل ما أُرسل =====
    function sentMap() {
        const map = new Map();
        readList(LOG_KEY).forEach(x => {
            const prev = map.get(x.key);
            if (!prev || (x.at || '') > (prev.at || '')) map.set(x.key, x);
        });
        return map;
    }

    function markSent(item) {
        const me = window.StoreAuth && StoreAuth.currentUser ? StoreAuth.currentUser() : null;
        const cutoff = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString();
        const list = readList(LOG_KEY).filter(x => (x.at || '') >= cutoff);
        list.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            key: item.key,
            at: new Date().toISOString(),
            by: me ? (me.display_name || me.username || '') : ''
        });
        localStorage.setItem(LOG_KEY, JSON.stringify(list));
        if (window.StoreLog) {
            try { StoreLog.add('reminder', 'تذكير قسط', `${item.customer} — القسط ${item.n} من فاتورة ${item.invoice} — ${money(item.left)}`); } catch (e) { }
        }
    }

    // ===== القائمة =====
    // كل قسط غير مسدد يستحق خلال الأيام المحددة، والمتأخرة (إن فُعّلت)
    function queue() {
        if (!window.StoreCredit) return [];
        const o = options();
        const today = todayLocal();
        const sent = sentMap();
        const items = [];
        const add = (x, kind) => {
            const customer = String(x.inv.customer || x.plan.customer || '').trim();
            const key = `${x.plan.id}#${x.n}#${kind}`;
            const log = sent.get(key) || null;
            const phone = window.StoreWA ? StoreWA.getPhone(customer) : null;
            items.push({
                key,
                kind,
                customer,
                phone,
                invoice: x.inv.number,
                n: x.n,
                count: x.plan.amounts.length,
                due: x.due,
                left: x.left,
                inDays: daysBetween(today, x.due),
                sent: log
            });
        };

        StoreCredit.upcomingInstallments(o.days).forEach(x => add(x, 'soon'));
        if (o.late) {
            StoreCredit.overdueInstallments().forEach(st => {
                st.rows.filter(r => r.status === 'overdue').forEach(r => add({ ...r, plan: st.plan, inv: st.inv }, 'late'));
            });
        }
        // غير المُرسل أولًا، ثم المتأخر الأقدم، ثم الأقرب موعدًا
        return items.sort((a, b) =>
            (!!a.sent - !!b.sent) ||
            (a.kind === 'late' ? 0 : 1) - (b.kind === 'late' ? 0 : 1) ||
            a.due.localeCompare(b.due));
    }

    function fill(template, item) {
        const info = window.StoreAuth && StoreAuth.getStoreInfo ? StoreAuth.getStoreInfo() : { name: '' };
        const values = {
            '{الزبون}': item.customer || 'زبوننا العزيز',
            '{المبلغ}': money(item.left),
            '{التاريخ}': item.due,
            '{اليوم}': whenText(item.inDays),
            '{القسط}': `${item.n} من ${item.count}`,
            '{الفاتورة}': item.invoice,
            '{المتجر}': info.name || 'المتجر'
        };
        let text = PLACEHOLDERS.reduce((t, k) => t.split(k).join(values[k]), template);
        if (info.phone) text += '\nللتواصل: ' + info.phone;
        return text;
    }

    function text(item) {
        const o = options();
        return fill(item.kind === 'late' ? o.lateText : o.soonText, item);
    }

    // يفتح واتساب على الزبون والرسالة مكتوبة؛ بلا رقم محفوظ يطلب الرقم أولًا ويحفظه
    async function send(item) {
        const msg = text(item);
        if (item.phone) {
            StoreWA.open(item.phone, msg);
            markSent(item);
            return true;
        }
        const p = await StoreWA.compose({
            title: 'تذكير قسط — ' + item.customer,
            intro: 'لا يوجد رقم محفوظ لهذا الزبون. اكتب رقمه مرة واحدة ويُحفظ للتذكيرات القادمة.',
            name: item.customer,
            text: msg,
            allowPick: true
        });
        if (p === null) return false;
        markSent(item);
        return true;
    }

    // ===== الواجهة: قائمة التذكيرات داخل عنصر =====
    function esc(v) {
        return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }

    function sentText(log) {
        const d = Math.floor((Date.now() - Date.parse(log.at)) / 86400000);
        const when = d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : `قبل ${d} أيام`;
        return `أُرسل ${when}${log.by ? ' — ' + log.by : ''}`;
    }

    function mount(root) {
        if (!root) return;
        const icon = window.StoreWA ? StoreWA.ICON : '';

        function render() {
            const items = queue();
            const pending = items.filter(x => !x.sent);
            const o = options();
            root.querySelector('[data-rem-summary]').textContent = items.length
                ? `${pending.length} بانتظار الإرسال من ${items.length}`
                : (o.days ? 'لا توجد أقساط قريبة أو متأخرة' : 'لا توجد أقساط تستحق اليوم أو متأخرة');
            const next = root.querySelector('[data-rem-next]');
            next.hidden = !pending.length;
            next.innerHTML = `${icon}<span>إرسال التالي (${pending.length})</span>`;
            root.querySelector('[data-rem-list]').innerHTML = items.map(x => `
                <li class="rem-item ${x.sent ? 'done' : ''} ${x.kind === 'late' ? 'late' : ''}">
                    <div class="rem-main">
                        <b>${esc(x.customer || 'بدون اسم')}</b>
                        <span class="rem-when">${esc(whenText(x.inDays))}</span>
                        <small>${esc(money(x.left))} — القسط ${x.n} من ${x.count} — فاتورة ${esc(x.invoice)}</small>
                        <small class="rem-phone"><span>${x.phone ? esc(StoreWA.displayPhone(x.phone)) : 'لا يوجد رقم واتساب'}</span>${x.sent ? ' · <span>' + esc(sentText(x.sent)) + '</span>' : ''}</small>
                    </div>
                    <button type="button" class="rem-send ${x.sent ? 'again' : ''}" data-rem-send="${esc(x.key)}">${x.sent ? 'إرسال مرة ثانية' : x.phone ? icon + '<span>إرسال</span>' : 'إضافة الرقم والإرسال'}</button>
                </li>`).join('');
            // لا شيء للإرسال ولا شيء أُرسل: نخفي القسم
            root.hidden = !items.length;
        }

        root.addEventListener('click', async e => {
            const b = e.target.closest('[data-rem-send], [data-rem-next]');
            if (!b) return;
            const items = queue();
            const item = b.hasAttribute('data-rem-next')
                ? items.find(x => !x.sent && x.phone) || items.find(x => !x.sent)
                : items.find(x => x.key === b.dataset.remSend);
            if (!item) return;
            await send(item);
            render();
        });

        // عند الرجوع من واتساب أو وصول تغييرات من جهاز آخر
        document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
        window.addEventListener('storage', render);
        render();
        return { render };
    }

    window.StoreReminders = { queue, text, send, markSent, mount, options, DEFAULT_SOON, DEFAULT_LATE, PLACEHOLDERS, whenText };
})();
