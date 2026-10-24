/* barcode-engine.js — قراءة الباركود بالكاميرا، تستخدمه نافذة الكاميرا (barcode-camera.js) وصفحة ماسح الهاتف
 *
 * - على الأجهزة التي فيها قارئ باركود مدمج (أغلب أجهزة أندرويد بمتصفح Chrome) نستخدمه: أسرع وأدق بكثير.
 * - غيرها: مكتبة html5-qrcode مقصورة على أنواع باركود المحلات، بدقة كاميرا أعلى ومساحة قراءة أعرض.
 * - لا نقبل الرقم إلا إذا قُرئ مرتين متتاليتين، وصح رقمه الأخير (رقم التحقق) في باركود المنتجات (EAN/UPC)،
 *   حتى لا تُضاف قراءة خاطئة.
 */
(function () {
    const LIB_URL = 'vendor/html5-qrcode-2.3.8.min.js';
    const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code'];
    const CONFIRM_READS = 2;
    const CONFIRM_MS = 1500;
    // بعد قبول رقم لا نقبله مجددًا ما دامت الكاميرا تراه، وحتى يغيب عنها هذه المدة
    const COOLDOWN_MS = 1500;
    const VIDEO = { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } };

    let libPromise = null;
    function loadLib() {
        if (window.Html5Qrcode) return Promise.resolve();
        if (libPromise) return libPromise;
        libPromise = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = LIB_URL;
            s.onload = resolve;
            s.onerror = () => {
                libPromise = null;
                reject(new Error('تعذر تحميل قارئ الباركود. تحقق من الإنترنت'));
            };
            document.head.appendChild(s);
        });
        return libPromise;
    }

    // رقم التحقق في EAN-8 و UPC-A و EAN-13 و GTIN-14
    function checksumOk(code) {
        const d = code.split('').map(Number);
        const check = d.pop();
        let sum = 0;
        d.reverse().forEach((n, i) => { sum += n * (i % 2 === 0 ? 3 : 1); });
        return (10 - (sum % 10)) % 10 === check;
    }

    function valid(code, format) {
        if (!code) return false;
        const f = String(format || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (f === 'upce') return /^\d{6,8}$/.test(code);
        const productCode = /^(ean13|ean8|upca)$/.test(f) || (!f && /^\d+$/.test(code));
        if (productCode && /^\d+$/.test(code) && [8, 12, 13, 14].includes(code.length)) return checksumOk(code);
        if (/^(ean13|ean8|upca)$/.test(f)) return false;
        return code.length >= 3;
    }

    // صوت قصير واهتزاز عند القبول
    let audio = null;
    function feedback() {
        try {
            if (navigator.vibrate) navigator.vibrate(60);
            audio = audio || new (window.AudioContext || window.webkitAudioContext)();
            const o = audio.createOscillator();
            const g = audio.createGain();
            o.frequency.value = 1800;
            g.gain.value = 0.08;
            o.connect(g).connect(audio.destination);
            o.start();
            o.stop(audio.currentTime + 0.08);
        } catch (e) { }
    }

    function confirmer(onCode) {
        let cand = { code: '', n: 0, at: 0 };
        let last = { code: '', at: 0 };
        return (raw, format) => {
            const code = String(raw || '').trim();
            const now = Date.now();
            if (!valid(code, format)) return;
            // نفس الرقم ما زال أمام الكاميرا: لا نكرره حتى يغيب عنها لحظة (لمسح قطعتين متشابهتين: أبعد الكاميرا ثم أعدها)
            if (code === last.code && now - last.at < COOLDOWN_MS) {
                last.at = now;
                return;
            }
            if (code === cand.code && now - cand.at < CONFIRM_MS) cand.n++;
            else cand = { code, n: 1, at: now };
            cand.at = now;
            if (cand.n < CONFIRM_READS) return;
            cand = { code: '', n: 0, at: 0 };
            last = { code, at: now };
            feedback();
            onCode(code, format);
        };
    }

    // ===== القارئ المدمج في الجهاز =====
    async function nativeFormats() {
        if (!('BarcodeDetector' in window)) return null;
        try {
            const supported = await window.BarcodeDetector.getSupportedFormats();
            const formats = NATIVE_FORMATS.filter(f => supported.includes(f));
            return formats.includes('ean_13') ? formats : null;
        } catch {
            return null;
        }
    }

    async function startNative(box, handle, formats) {
        const detector = new window.BarcodeDetector({ formats });
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: VIDEO });
        const video = document.createElement('video');
        video.className = 'sb-video';
        video.setAttribute('playsinline', '');
        video.muted = true;
        video.srcObject = stream;
        const guide = document.createElement('div');
        guide.className = 'sb-guide';
        guide.innerHTML = '<i></i>';
        box.append(video, guide);
        await video.play();

        const track = stream.getVideoTracks()[0];
        try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { }

        let stopped = false;
        let timer = null;
        const loop = async () => {
            if (stopped) return;
            try {
                if (video.readyState >= 2) {
                    const codes = await detector.detect(video);
                    codes.forEach(c => handle(c.rawValue, c.format));
                }
            } catch (e) { }
            timer = setTimeout(loop, 90);
        };
        loop();

        return {
            engine: 'native',
            track,
            stop: async () => {
                stopped = true;
                clearTimeout(timer);
                stream.getTracks().forEach(t => t.stop());
                video.remove();
                guide.remove();
            }
        };
    }

    // ===== مكتبة html5-qrcode =====
    async function startLib(box, handle) {
        await loadLib();
        const div = document.createElement('div');
        div.id = 'sb-reader-' + Math.random().toString(36).slice(2, 8);
        div.className = 'sb-lib';
        box.appendChild(div);
        const F = window.Html5QrcodeSupportedFormats;
        const formats = F ? [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.QR_CODE] : undefined;
        const sc = new window.Html5Qrcode(div.id, {
            formatsToSupport: formats,
            verbose: false,
            experimentalFeatures: { useBarCodeDetectorIfSupported: true }
        });
        await sc.start(
            { facingMode: 'environment' },
            {
                fps: 15,
                // مساحة قراءة عريضة تناسب باركود المنتجات الطولي
                qrbox: (w, h) => ({ width: Math.max(160, Math.round(w * 0.86)), height: Math.max(100, Math.round(Math.min(h * 0.45, w * 0.5))) }),
                disableFlip: true,
                videoConstraints: VIDEO
            },
            (text, res) => handle(text, res && res.result && res.result.format && res.result.format.formatName),
            () => { }
        );
        try { await sc.applyVideoConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) { }
        let track = null;
        try {
            const v = div.querySelector('video');
            track = v && v.srcObject ? v.srcObject.getVideoTracks()[0] : null;
        } catch (e) { }
        return {
            engine: 'lib',
            track,
            stop: async () => {
                try { await sc.stop(); } catch (e) { }
                try { sc.clear(); } catch (e) { }
                div.remove();
            }
        };
    }

    /* يبدأ القراءة داخل box. onCode(code, format) يُستدعى لكل رقم مؤكد.
     * يعيد { stop(), engine, hasTorch, setTorch(on) } */
    async function start(box, onCode) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('المتصفح لا يدعم الكاميرا. افتح البرنامج من Chrome أو Safari بعنوان يبدأ بـ https');
        }
        const handle = confirmer(onCode);
        const formats = await nativeFormats();
        let ctl = null;
        if (formats) {
            try {
                ctl = await startNative(box, handle, formats);
            } catch (err) {
                if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err;
                console.warn('القارئ المدمج غير متاح، نستخدم المكتبة:', err);
            }
        }
        if (!ctl) ctl = await startLib(box, handle);

        let hasTorch = false;
        try {
            hasTorch = !!(ctl.track && ctl.track.getCapabilities && ctl.track.getCapabilities().torch);
        } catch (e) { }
        return {
            engine: ctl.engine,
            hasTorch,
            stop: ctl.stop,
            async setTorch(on) {
                if (!ctl.track) return false;
                try {
                    await ctl.track.applyConstraints({ advanced: [{ torch: !!on }] });
                    return true;
                } catch (e) {
                    return false;
                }
            }
        };
    }

    // تنسيق المعاينة (مرة واحدة)
    function injectCss() {
        if (document.getElementById('sbCss')) return;
        const st = document.createElement('style');
        st.id = 'sbCss';
        st.textContent = `
            .sb-video { display: block; width: 100%; height: 100%; object-fit: cover; }
            .sb-guide { position: absolute; inset: 0; pointer-events: none; display: grid; place-items: center; }
            .sb-guide::before { content: ""; width: 86%; height: 42%; border-radius: 14px; box-shadow: 0 0 0 9999px rgba(0, 0, 0, .35); border: 2px solid rgba(255, 255, 255, .85); }
            .sb-guide i { position: absolute; width: 80%; height: 2px; background: #3ccf98; box-shadow: 0 0 12px 2px rgba(60, 207, 152, .8); animation: sb-scan 1.6s ease-in-out infinite alternate; }
            @keyframes sb-scan { from { transform: translateY(-60px); } to { transform: translateY(60px); } }
            @media (prefers-reduced-motion: reduce) { .sb-guide i { animation: none; } }
            .sb-lib { width: 100%; }
            .sb-lib video { object-fit: cover; }
        `;
        document.head.appendChild(st);
    }
    if (document.head) injectCss();
    else document.addEventListener('DOMContentLoaded', injectCss);

    window.StoreBarcode = { start, valid, checksumOk };
})();
