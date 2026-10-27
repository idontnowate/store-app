/* preload.js — يربط صفحات البرنامج بتطبيق ويندوز
 *
 * - window.print في كل صفحة وإطار يذهب إلى main.js فيطبع مباشرة على الطابعة المختارة
 * - window.StoreDesktop: تعرف به الصفحات أنها تعمل داخل تطبيق الكمبيوتر
 */
const { contextBridge, ipcRenderer, webFrame } = require('electron');

let info = { desktop: true, version: '', silentPrint: true, printer: '' };
try { info = ipcRenderer.sendSync('store-desktop-info'); } catch (e) { }

contextBridge.exposeInMainWorld('StoreDesktop', {
    desktop: true,
    version: info.version,
    silentPrint: info.silentPrint,
    print: () => ipcRenderer.send('store-print')
});

webFrame.executeJavaScript('window.print = function () { window.StoreDesktop.print(); };');

// print.js يطبع النسخ واحدة بعد الأخرى عندما تكون الطباعة المباشرة مفعّلة
try {
    const key = 'storePrefs';
    const p = JSON.parse(localStorage.getItem(key) || '{}') || {};
    if (p.silentPrint !== info.silentPrint) {
        p.silentPrint = info.silentPrint;
        localStorage.setItem(key, JSON.stringify(p));
    }
} catch (e) { }
