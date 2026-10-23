/* barcode-camera.js — يضيف زر "مسح بالكاميرا" بجانب كل خانة باركود */
(function () {
    const LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
    const SELECTOR = '#barcodeInput, #barcodeField, input[name="barcode"]';

    let libPromise = null;
    let scanner = null;
    let dlg = null;

    // تحميل المكتبة عند أول ضغطة فقط
    function loadLib() {
        if (window.Html5Qrcode) return Promise.resolve();
        if (libPromise) return libPromise;
        libPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = LIB_URL;
            s.onload = resolve;
            s.onerror = () => reject(new Error('تعذر تحميل مكتبة القراءة. تحقق من الإنترنت'));
            document.head.appendChild(s);
        });
        return libPromise;
    }

    function injectCss() {
        const css = `
            dialog#baOverlay { padding: 0; border: 0; background: transparent; max-width: none; max-height: none; width: 100%; height: 100%; }
            dialog#baOverlay::backdrop { background: rgba(8, 9, 11, .78); backdrop-filter: blur(4px); }
            .ba-wrap { min-height: 100%; display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }
            .ba-box { background: var(--surface, #fff); color: var(--text, #0e1116); border: 1px solid var(--border, #e7e8eb); border-radius: 20px; padding: 14px; width: min(480px, 100%); display: grid; gap: 12px; font-family: inherit; box-shadow: 0 30px 80px -20px rgba(0,0,0,.6); }
            #ba-reader { width: 100%; border-radius: 14px; overflow: hidden; background: #000; min-height: 240px; }
            .ba-msg { font-weight: 600; text-align: center; color: var(--text-2, #4a505a); min-height: 22px; }
            .ba-msg.err { color: var(--danger, #c4372f); }
            .ba-close { border: 0; border-radius: var(--radius-sm, 10px); padding: 13px; background: var(--primary, #111318); color: var(--primary-text, #fff); font: inherit; font-weight: 600; cursor: pointer; }
            .ba-cam-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; flex: none; border: 1px solid var(--border, #e7e8eb); border-radius: var(--radius-sm, 10px); padding: 0 16px; min-height: 44px; background: var(--surface, #fff); color: var(--text, #0e1116); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; transition: background var(--dur-1, .15s), border-color var(--dur-1, .15s); }
            .ba-cam-btn:hover { background: var(--surface-2, #f3f4f6); border-color: var(--border-strong, #d5d8dd); }
            .ba-cam-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
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
                    <button type="button" class="ba-close" id="ba-close">إغلاق الكاميرا</button>
                </div>
            </div>`;
        document.body.appendChild(dlg);
        dlg.querySelector('#ba-close').addEventListener('click', closeCamera);
        // زر Esc أو أي إغلاق آخر يوقف الكاميرا أيضا
        dlg.addEventListener('close', closeCamera);
        return dlg;
    }

    function setMsg(text, isErr = false) {
        const m = document.getElementById('ba-msg');
        if (!m) return;
        m.textContent = text;
        m.classList.toggle('err', isErr);
    }

    async function closeCamera() {
        if (scanner) {
            const s = scanner;
            scanner = null;
            try { await s.stop(); } catch { }
            try { s.clear(); } catch { }
        }
        if (dlg && dlg.open) dlg.close();
    }

    // نحاكي الماسح: نكتب الرقم في الخانة ثم نرسل Enter
    function fillAndEnter(input, code) {
        input.focus();
        input.value = code;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }

    async function openCamera(input) {
        const d = ensureDialog();
        if (!d.open) d.showModal();
        setMsg('جارِ تشغيل الكاميرا…');
        try {
            await loadLib();
            scanner = new Html5Qrcode('ba-reader');
            await scanner.start(
                { facingMode: 'environment' },
                { fps: 10, qrbox: { width: 260, height: 140 } },
                async text => {
                    await closeCamera();
                    fillAndEnter(input, String(text).trim());
                },
                () => { }
            );
            setMsg('وجّه الكاميرا نحو الباركود');
        } catch (err) {
            console.warn('فشل تشغيل الكاميرا:', err);
            setMsg('تعذر فتح الكاميرا. اسمح بالوصول إليها، وتأكد أن الرابط يبدأ بـ https', true);
        }
    }

    function addButtons(root) {
        (root || document).querySelectorAll(SELECTOR).forEach(input => {
            if (input.dataset.camAdded) return;
            input.dataset.camAdded = '1';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ba-cam-btn';
            btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.5" r="3.5"/></svg><span>كاميرا</span>';
            btn.title = 'مسح الباركود بالكاميرا';
            btn.setAttribute('aria-label', 'مسح الباركود بالكاميرا');
            btn.addEventListener('click', () => {
                if (input.disabled) {
                    alert('افتح فاتورة أو صفحة الإدخال أولا ثم امسح');
                    return;
                }
                openCamera(input);
            });
            input.insertAdjacentElement('afterend', btn);
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
