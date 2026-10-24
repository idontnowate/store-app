/* print.js — الطباعة: إعدادات كل قسم، والطباعة المباشرة بدون نافذة الطابعة
 *
 * المتصفح لا يسمح لأي موقع بالطباعة دون نافذة الطابعة. الحل المعتمد في برامج الكاشير على الويب:
 * فتح البرنامج من اختصار يشغّل Chrome أو Edge بخيار --kiosk-printing، فتذهب كل طباعة مباشرة
 * إلى الطابعة الافتراضية في الجهاز. الاختصار يفتح البرنامج بـ ?kiosk=1 فنعرف أن الجهاز يطبع مباشرة.
 *
 * الإعدادات خاصة بهذا الجهاز (storePrefs) لأن لكل جهاز طابعته.
 */
(function () {
    const PREFS_KEY = 'storePrefs';
    const DEFAULTS = {
        silentPrint: false,
        // الكاشير
        autoPrint: true,
        receiptWidth: '80',
        receiptCopies: 1,
        // فاتورة المبيعات
        invoicePaper: 'A4',
        invoiceCopies: 1,
        invoiceAutoPrint: false,
        // كشف الحساب
        statementPaper: 'A4'
    };

    function prefs() {
        let p = {};
        try { p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { }
        return { ...DEFAULTS, ...p };
    }

    function save(patch) {
        if (window.StoreTheme && StoreTheme.set) return StoreTheme.set(patch);
        try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), ...patch })); } catch (e) { }
    }

    const copiesOf = n => Math.min(5, Math.max(1, Math.floor(Number(n) || 1)));

    // فُتح البرنامج من اختصار الطباعة المباشرة
    (function detectKiosk() {
        try {
            const url = new URL(location.href);
            if (url.searchParams.get('kiosk') !== '1') return;
            save({ silentPrint: true });
            url.searchParams.delete('kiosk');
            history.replaceState(history.state, '', url.pathname + url.search + url.hash);
        } catch (e) { }
    })();

    // يطبع الصفحة الحالية (عناصر @media print فيها). مع الطباعة المباشرة تُطبع النسخ واحدة بعد الأخرى؛
    // بدونها تظهر نافذة الطابعة مرة واحدة ويختار المستخدم عدد النسخ منها
    function print(options) {
        const copies = copiesOf(options && options.copies);
        const silent = prefs().silentPrint;
        const n = silent ? copies : 1;
        for (let i = 0; i < n; i++) window.print();
    }

    // يطبع صفحة أخرى دون مغادرة الصفحة الحالية (مثلًا فاتورة من قائمة المبيعات)
    function printUrl(url) {
        return new Promise(resolve => {
            const frame = document.createElement('iframe');
            frame.setAttribute('aria-hidden', 'true');
            frame.tabIndex = -1;
            frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;inset-inline-start:-9999px';
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                window.removeEventListener('message', onMsg);
                setTimeout(() => frame.remove(), 1000);
                resolve();
            };
            const onMsg = e => {
                if (e.source === frame.contentWindow && e.data === 'store-printed') finish();
            };
            window.addEventListener('message', onMsg);
            setTimeout(finish, 60000);
            frame.src = url + (url.includes('?') ? '&' : '?') + 'embed=1';
            document.body.appendChild(frame);
        });
    }

    // تستدعيها الصفحة المفتوحة داخل printUrl بعد الطباعة
    function notifyPrinted() {
        try { if (window.parent !== window) window.parent.postMessage('store-printed', location.origin); } catch (e) { }
    }

    const isEmbedded = () => new URLSearchParams(location.search).get('embed') === '1' && window.parent !== window;

    // ===== اختصار الطباعة المباشرة =====
    function appUrl(page) {
        const base = location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '');
        return base + (page || 'cashier.html') + '?kiosk=1';
    }

    // يُنشئ أيقونة سطح المكتب. يُرسل لـ PowerShell مرمّزًا (UTF-16 ثم base64) فلا تتعارض علامات التنصيص مع cmd
    const SHORTCUT_PS = [
        "$d = [Environment]::GetFolderPath('Desktop')",
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'المتجر - طباعة مباشرة.lnk'))",
        '$s.TargetPath = $env:BROWSER',
        `$s.Arguments = '--kiosk-printing --user-data-dir="' + $env:PROFILE + '" --app="' + $env:URL + '"'`,
        "$s.IconLocation = $env:BROWSER + ',0'",
        '$s.Save()'
    ].join('\n');

    function encodePs(script) {
        let bin = '';
        for (let i = 0; i < script.length; i++) {
            const c = script.charCodeAt(i);
            bin += String.fromCharCode(c & 255, c >> 8);
        }
        return btoa(bin);
    }

    // ملف يُفتح مرة واحدة على ويندوز فيضع على سطح المكتب أيقونة تفتح البرنامج بالطباعة المباشرة.
    // نستخدم ملفًا شخصيًا مستقلًا للمتصفح حتى يعمل الخيار حتى لو كان Chrome مفتوحًا
    function windowsShortcut(page) {
        const url = appUrl(page);
        const lines = [
            '@echo off',
            'rem Store app - direct printing shortcut (Chrome or Edge with --kiosk-printing)',
            `set "URL=${url}"`,
            'set "BROWSER=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
            'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
            'if not exist "%BROWSER%" set "BROWSER=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
            'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
            'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
            'if not exist "%BROWSER%" (',
            '  echo Chrome or Edge was not found. Install Google Chrome and run this file again.',
            '  pause',
            '  exit /b 1',
            ')',
            'set "PROFILE=%LocalAppData%\\StoreAppDirectPrint"',
            `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodePs(SHORTCUT_PS)}`,
            'start "" "%BROWSER%" --kiosk-printing --user-data-dir="%PROFILE%" --app="%URL%"',
            'echo.',
            'echo Done. From now on open the store from the new desktop icon (direct printing).',
            'timeout /t 5 >nul'
        ];
        return lines.join('\r\n') + '\r\n';
    }

    function download(name, text, type) {
        const blob = new Blob([text], { type: type || 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }

    function macCommand(page) {
        return `open -na "Google Chrome" --args --kiosk-printing --user-data-dir="$HOME/.store-app-print" --app="${appUrl(page)}"`;
    }

    window.StorePrint = {
        prefs,
        save,
        print,
        printUrl,
        notifyPrinted,
        isEmbedded,
        copiesOf,
        appUrl,
        windowsShortcut,
        macCommand,
        downloadWindowsShortcut: page => download('store-direct-print.bat', windowsShortcut(page))
    };
})();
