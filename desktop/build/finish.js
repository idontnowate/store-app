/* finish.js — يضع أيقونة البرنامج ومعلومات الإصدار على IPStore.exe بعد التجميع
 * (electron-builder يحتاج wine لهذا على لينكس، و resedit يفعلها بدونه) */
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');
const pkg = require('../package.json');

const exe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'IPStore.exe');
const data = fs.readFileSync(exe);
const file = ResEdit.NtExecutable.from(data, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(file);

const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icon.icons.map(i => i.data));

const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
const [a, b, c] = pkg.version.split('.').map(Number);
vi.setFileVersion(a, b, c, 0, 1033);
vi.setProductVersion(a, b, c, 0, 1033);
vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: pkg.build.productName,
    FileDescription: pkg.build.productName,
    CompanyName: pkg.author,
    LegalCopyright: '© ' + new Date().getFullYear() + ' ' + pkg.author,
    OriginalFilename: 'IPStore.exe',
    InternalName: 'IPStore'
});
vi.outputToResourceEntries(res.entries);
res.outputResource(file);
fs.writeFileSync(exe, Buffer.from(file.generate()));
fs.writeFileSync(path.join(__dirname, 'version.nsh'), `!define VERSION "${pkg.version}"\n`);
console.log('icon and version set on', path.basename(exe));
