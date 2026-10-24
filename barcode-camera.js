/* barcode-camera.js — يضيف زر "كاميرا" بجانب كل خانة باركود، ويقرأ بمحرك barcode-engine.js */
(function () {
    const SELECTOR = '#barcodeInput, #barcodeField, input[name="barcode"]';
    const CAM_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/></svg>';

    let dlg = null;
    let ctl = null;
    let target = null;
    let torchOn = false;

    function injectCss() {
        const css = `
            dialog#baOverlay { padding: 0; border: 0; background: transparent; max-width: none; max-height: none; width: 100%; height: 100%; }
            dialog#baOverlay::backdrop { background: rgba(8, 9, 11, .82); backdrop-filter: blur(4px); }
            .ba-wrap { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
            .ba-box { background: var(--surface, #fff); color: var(--text, #0e1116); border: 1px solid var(--border, #e7e8eb); border-radius: 20px; padding: 14px; width: min(520px, 100%); display: grid; gap: 10px; font-family: inherit; box-shadow: 0 30px 80px -20px rgba(0,0,0,.6); }
            #ba-reader { position: relative; width: 100%; aspect-ratio: 4 / 3; border-radius: 14px; overflow: hidden; background: #000; }
            .ba-msg { font-weight: 600; text-align: center; color: var(--text-2, #4a505a); min-height: 22px; font-size: 14px; }
            .ba-msg.err { color: var(--danger, #c4372f); }
            .ba-actions { display: flex; gap: 8px; flex-wrap: wrap; }
            .ba-actions button, .ba-manual button { flex: 1 1 auto; border: 1px solid var(--border-strong, #d5d8dd); border-radius: var(--radius-sm, 10px); padding: 11px 14px; background: var(--surface, #fff); color: var(--text, #0e1116); font: inherit; font-weight: 600; cursor: pointer; }
            .ba-actions .ba-close { background: var(--primary, #111318); color: var(--primary-text, #fff); border-color: transparent; }
            .ba-actions button[aria-pressed="true"] { background: #f5c542; color: #111; border-color: transparent; }
            .ba-manual { display: flex; gap: 8px; }
            .ba-manual[hidden] { display: none; }
            .ba-manual input { flex: 1; min-width: 0; padding: 11px 12px; border-radius: var(--radius-sm, 10px); border: 1px solid var(--border-strong, #d5d8dd); background: var(--surface, #fff); color: var(--text, #0e1116); font: inherit; direction: ltr; text-align: left; }
            .ba-cam-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none; border: 1px solid var(--border, #e7e8eb); border-radius: var(--radius-sm, 10px); padding: 0 14px; min-height: 40px; background: var(--surface, #fff); color: var(--text, #0e1116); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background var(--dur-1, .15s), border-color var(--dur-1, .15s); }
            .ba-cam-btn:hover { background: var(--surface-2, #f3f4f6); border-color: var(--border-strong, #d5d8dd); }
            .ba-cam-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
            .ba-inline { display: flex; align-items: center; gap: 6px; min-width: 0; }
            .ba-inline > input { flex: 1 1 auto; min-width: 0; width: auto !important; }
            table .ba-cam-btn { min-height: 36px; padding: 0 9px; }
            table .ba-cam-btn span { display: none; }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function ensureDialog() {
        if (dlg) return dlg;
        dlg = document.createElement('dialog');
        dlg.id = 'baOverlay';
        dlg.innerHTML = `
            <div class="ba-wrap">
                <div class="ba-box">
                    <div id="ba-reader"></div>
                    <div class="ba-msg" id="ba-msg" role="status"></div>
                    <form class="ba-manual" id="ba-manual" hidden>
                        <input id="ba-code" inputmode="numeric" autocomplete="off" placeholder="اكتب رقم الباركود">
                        <button type="submit">إضافة</button>
                    </form>
                    <div class="ba-actions">
                        <button type="button" id="ba-torch" aria-pressed="false" hidden>🔦 الإضاءة</button>
                        <button type="button" id="ba-type">⌨ كتابة الرقم</button>
                        <button type="button" class="ba-close" id="ba-close">إغلاق</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(dlg);
        dlg.querySelector('#ba-close').addEventListener('click', closeCamera);
        dlg.addEventListener('close', closeCamera);
        dlg.querySelector('#ba-torch').addEventListener('click', async e => {
            if (!ctl) return;
            torchOn = !torchOn;
            if (await ctl.setTorch(torchOn)) e.currentTarget.setAttribute('aria-pressed', String(torchOn));
            else torchOn = !torchOn;
        });
        dlg.querySelector('#ba-type').addEventListener('click', () => {
            const form = dlg.querySelector('#ba-manual');
            form.hidden = !form.hidden;
            if (!form.hidden) dlg.querySelector('#ba-code').focus();
        });
        dlg.querySelector('#ba-manual').addEventListener('submit', e => {
            e.preventDefault();
            const code = dlg.querySelector('#ba-code').value.trim();
            if (code) done(code);
        });
        return dlg;
    }

    function setMsg(text, isErr = false) {
        const m = document.getElementById('ba-msg');
        if (!m) return;
        m.textContent = text;
        m.classList.toggle('err', isErr);
    }

    async function closeCamera() {
        const c = ctl;
        ctl = null;
        torchOn = false;
        if (c) {
            try { await c.stop(); } catch (e) { }
        }
        if (dlg && dlg.open) dlg.close();
    }

    // نحاكي القارئ: نكتب الرقم في الخانة ثم نرسل Enter
    function fillAndEnter(input, code) {
        input.focus();
        input.value = code;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }

    async function done(code) {
        const input = target;
        await closeCamera();
        if (input) fillAndEnter(input, code);
    }

    async function openCamera(input) {
        target = input;
        const d = ensureDialog();
        d.querySelector('#ba-manual').hidden = true;
        d.querySelector('#ba-code').value = '';
        d.querySelector('#ba-torch').hidden = true;
        d.querySelector('#ba-torch').setAttribute('aria-pressed', 'false');
        if (!d.open) d.showModal();
        setMsg('جارِ تشغيل الكاميرا…');
        try {
            const c = await StoreBarcode.start(d.querySelector('#ba-reader'), code => done(code));
            if (!d.open) {
                c.stop();
                return;
            }
            ctl = c;
            d.querySelector('#ba-torch').hidden = !c.hasTorch;
            setMsg('ضع الباركود داخل الإطار وثبّت الهاتف لحظة');
        } catch (err) {
            console.warn('فشل تشغيل الكاميرا:', err);
            const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
            setMsg(denied
                ? 'لم يُسمح بالكاميرا. اسمح بها من إعدادات المتصفح، أو اكتب الرقم'
                : (err && err.message && /[؀-ۿ]/.test(err.message) ? err.message : 'تعذر فتح الكاميرا. تأكد أن الرابط يبدأ بـ https، أو اكتب الرقم'), true);
            d.querySelector('#ba-manual').hidden = false;
        }
    }

    function addButtons(root) {
        (root || document).querySelectorAll(SELECTOR).forEach(input => {
            if (input.dataset.camAdded) return;
            input.dataset.camAdded = '1';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ba-cam-btn';
            btn.innerHTML = CAM_ICON + '<span>كاميرا</span>';
            btn.title = 'مسح الباركود بالكاميرا';
            btn.setAttribute('aria-label', 'مسح الباركود بالكاميرا');
            btn.addEventListener('click', () => {
                if (input.disabled) {
                    alert('افتح فاتورة أو صفحة الإدخال أولا ثم امسح');
                    return;
                }
                openCamera(input);
            });
            // داخل الجداول (أسطر المشتريات) نضع الخانة والزر في صف واحد حتى لا يغطي الزر الخانة المجاورة
            if (input.closest('td')) {
                const wrap = document.createElement('span');
                wrap.className = 'ba-inline';
                input.insertAdjacentElement('beforebegin', wrap);
                wrap.append(input, btn);
            } else {
                input.insertAdjacentElement('afterend', btn);
            }
        });
    }

    function init() {
        injectCss();
        addButtons(document);
        // لإضافة الزر تلقائيا للصفوف الجديدة (مثل أسطر المشتريات)
        new MutationObserver(() => addButtons(document))
            .observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
