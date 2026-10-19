/* barcode-camera.js — يضيف زر "مسح بالكاميرا" بجانب كل خانة باركود */
(function () {
    const LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
    const SELECTOR = '#barcodeInput, #barcodeField, input[name="barcode"]';

    let libPromise = null;
    let scanner = null;
    let overlay = null;

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
            #baOverlay { position: fixed; inset: 0; background: #000d; z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 16px; }
            #baOverlay[hidden] { display: none; }
            .ba-box { background: #efede5; border-radius: 20px; padding: 14px; width: min(480px, 100%); display: grid; gap: 10px; font-family: Tahoma, Arial, sans-serif; }
            #ba-reader { width: 100%; border-radius: 14px; overflow: hidden; background: #000; min-height: 240px; }
            .ba-msg { font-weight: 700; text-align: center; color: #40570d; min-height: 22px; }
            .ba-msg.err { color: #c74845; }
            .ba-close { border: 0; border-radius: 14px; padding: 13px; background: #40570d; color: #fff; font: 700 17px Tahoma, Arial, sans-serif; cursor: pointer; }
            .ba-cam-btn { border: 0; border-radius: 12px; padding: 0 14px; min-height: 44px; background: #40570d; color: #fff; font: 700 15px Tahoma, Arial, sans-serif; cursor: pointer; white-space: nowrap; margin-inline-start: 6px; }
        `;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function ensureOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'baOverlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="ba-box">
                <div id="ba-reader"></div>
                <div class="ba-msg" id="ba-msg" role="status"></div>
                <button type="button" class="ba-close" id="ba-close">إغلاق الكاميرا</button>
            </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#ba-close').addEventListener('click', closeCamera);
        return overlay;
    }

    function setMsg(text, isErr = false) {
        const m = document.getElementById('ba-msg');
        if (!m) return;
        m.textContent = text;
        m.classList.toggle('err', isErr);
    }

    async function closeCamera() {
        if (scanner) {
            try { await scanner.stop(); } catch { }
            try { scanner.clear(); } catch { }
            scanner = null;
        }
        if (overlay) overlay.hidden = true;
    }

    // نحاكي الماسح: نكتب الرقم في الخانة ثم نرسل Enter
    function fillAndEnter(input, code) {
        input.focus();
        input.value = code;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    }

    async function openCamera(input) {
        ensureOverlay().hidden = false;
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
            btn.textContent = '📷 مسح';
            btn.title = 'مسح الباركود بالكاميرا';
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