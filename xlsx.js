/* xlsx.js — يكتب ملف Excel حقيقي (.xlsx) بدون مكتبات خارجية
 *
 * StoreXlsx.download(fileName, sheets)
 *   sheets: [{ name, title, subtitle (نص أو قائمة أسطر), columns: [{ header, type, width }], rows: [[...]], total: [...] }]
 *   type: 'text' | 'money' | 'int' | 'percent' | 'date'
 *   rows: قيم خام (أرقام كأرقام حتى تعمل معادلات Excel عليها)
 *   total: سطر مجموع اختياري يُكتب بخط عريض أسفل الجدول
 *   sheet.kpis: بدل الجدول، بطاقات ملخص [{ label, value, type }]
 *
 * كل ورقة من اليمين لليسار، بعنوان وفترة، ورأس جدول ملوّن ومثبّت، وفلترة، وصفوف متناوبة الألوان،
 * وعرض أعمدة مناسب للمحتوى، وتطبع على عرض صفحة واحدة.
 */
(function () {
    // ===== الأنماط (رقم كل نمط هو موضعه في cellXfs أدناه) =====
    const S = {
        title: 1, subtitle: 2, header: 3,
        text: 4, money: 5, int: 6, percent: 7, date: 4,
        textAlt: 8, moneyAlt: 9, intAlt: 10, percentAlt: 11,
        totalText: 12, totalMoney: 13, totalInt: 14, totalPercent: 15,
        kpiLabel: 16, kpiMoney: 17, kpiInt: 18, note: 19
    };

    const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="7">
<font><sz val="11"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="18"/><color rgb="FF1F2A44"/><name val="Arial"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF6B7280"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FF1F2A44"/><name val="Arial"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FF1F2A44"/><name val="Arial"/><family val="2"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Arial"/><family val="2"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F2A44"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF3F5F9"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3E8F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD7DCE5"/></left><right style="thin"><color rgb="FFD7DCE5"/></right><top style="thin"><color rgb="FFD7DCE5"/></top><bottom style="thin"><color rgb="FFD7DCE5"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FFD7DCE5"/></left><right style="thin"><color rgb="FFD7DCE5"/></right><top style="medium"><color rgb="FF1F2A44"/></top><bottom style="medium"><color rgb="FF1F2A44"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="20">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="4" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="4" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="4" fillId="4" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" readingOrder="2"/></xf>
<xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1" readingOrder="2"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    // ===== أدوات =====
    const esc = v => String(v ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
        // محارف تحكم لا يقبلها XML
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    function colName(i) {
        let s = '';
        for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
        return s;
    }

    const ref = (c, r) => colName(c) + r;
    const isNum = v => typeof v === 'number' && isFinite(v);

    function cell(c, r, value, style) {
        const at = ref(c, r);
        if (value === null || value === undefined || value === '') return `<c r="${at}" s="${style}"/>`;
        if (isNum(value)) return `<c r="${at}" s="${style}"><v>${value}</v></c>`;
        return `<c r="${at}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    }

    // اسم ورقة صالح: 31 حرفًا بلا الرموز الممنوعة، ودون تكرار
    function sheetNames(sheets) {
        const used = new Set();
        return sheets.map((s, i) => {
            let n = String(s.name || 'ورقة ' + (i + 1)).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'ورقة ' + (i + 1);
            let k = n, j = 2;
            while (used.has(k)) k = (n.slice(0, 28) + ' ' + j++);
            used.add(k);
            return k;
        });
    }

    // عرض العمود حسب أطول قيمة فيه
    function widthOf(col, rows, i) {
        if (col.width) return col.width;
        const len = v => {
            if (isNum(v)) return col.type === 'percent' ? 7 : Math.round(v).toLocaleString('en-US').length + 1;
            return String(v ?? '').length;
        };
        let w = len(col.header) + 2;
        rows.forEach(r => { w = Math.max(w, len(r[i]) + 2); });
        return Math.max(10, Math.min(48, Math.round(w * 1.15)));
    }

    function styleFor(type, alt) {
        const base = { money: 'money', int: 'int', percent: 'percent', date: 'text' }[type] || 'text';
        return S[alt ? base + 'Alt' : base];
    }

    function totalStyle(type) {
        return S[{ money: 'totalMoney', int: 'totalInt', percent: 'totalPercent' }[type] || 'totalText'];
    }

    function sheetXml(sheet) {
        const rowsXml = [];
        const merges = [];
        let r = 1;
        const cols = sheet.columns || [{ header: 'البيان', type: 'text', width: 34 }, { header: 'القيمة', type: 'money', width: 22 }];
        const last = Math.max(cols.length, 2) - 1;

        // العنوان والفترة
        rowsXml.push(`<row r="${r}" ht="30" customHeight="1">${cell(0, r, sheet.title, S.title)}</row>`);
        merges.push(`${ref(0, r)}:${ref(last, r)}`);
        r++;
        // سطر أو أكثر تحت العنوان (اسم المتجر، الفترة، وقت التصدير)
        [].concat(sheet.subtitle || []).filter(Boolean).forEach(line => {
            rowsXml.push(`<row r="${r}" ht="19" customHeight="1">${cell(0, r, line, S.subtitle)}</row>`);
            merges.push(`${ref(0, r)}:${ref(last, r)}`);
            r++;
        });
        r++; // سطر فارغ

        let headerRow = 0, lastDataRow = 0;
        if (sheet.kpis) {
            sheet.kpis.forEach(k => {
                const valStyle = k.type === 'int' ? S.kpiInt : S.kpiMoney;
                rowsXml.push(`<row r="${r}" ht="26" customHeight="1">${cell(0, r, k.label, S.kpiLabel)}${cell(1, r, k.value, valStyle)}</row>`);
                r++;
            });
        } else {
            headerRow = r;
            rowsXml.push(`<row r="${r}" ht="24" customHeight="1">${cols.map((c, i) => cell(i, r, c.header, S.header)).join('')}</row>`);
            r++;
            const rows = sheet.rows || [];
            if (!rows.length) {
                rowsXml.push(`<row r="${r}">${cell(0, r, 'لا توجد بيانات في هذه الفترة', S.note)}</row>`);
                merges.push(`${ref(0, r)}:${ref(last, r)}`);
                r++;
            }
            rows.forEach((row, n) => {
                rowsXml.push(`<row r="${r}">${cols.map((c, i) => cell(i, r, row[i], styleFor(c.type, n % 2 === 1))).join('')}</row>`);
                lastDataRow = r;
                r++;
            });
            if (sheet.total && rows.length) {
                rowsXml.push(`<row r="${r}" ht="22" customHeight="1">${cols.map((c, i) => cell(i, r, sheet.total[i], totalStyle(c.type))).join('')}</row>`);
                r++;
            }
        }

        if (sheet.note) {
            r++;
            rowsXml.push(`<row r="${r}" ht="32" customHeight="1">${cell(0, r, sheet.note, S.note)}</row>`);
            merges.push(`${ref(0, r)}:${ref(last, r)}`);
        }

        const colsXml = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${widthOf(c, sheet.rows || [], i)}" customWidth="1"/>`).join('');
        // رأس الجدول يبقى ظاهرًا عند التمرير
        const pane = headerRow
            ? `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`
            : '';
        const filter = headerRow && lastDataRow ? `<autoFilter ref="${ref(0, headerRow)}:${ref(cols.length - 1, lastDataRow)}"/>` : '';

        return {
            filterRef: headerRow && lastDataRow ? `$A$${headerRow}:$${colName(cols.length - 1)}$${lastDataRow}` : null,
            // رأس الجدول يتكرر أعلى كل صفحة مطبوعة
            printTitles: headerRow ? `$${headerRow}:$${headerRow}` : null,
            xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${ref(last, Math.max(1, r))}"/>
<sheetViews><sheetView rightToLeft="1" workbookViewId="0" showGridLines="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="18" customHeight="1"/>
<cols>${colsXml}</cols>
<sheetData>${rowsXml.join('')}</sheetData>
${filter}
${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="${cols.length > 6 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter>
</worksheet>`
        };
    }

    // ===== ملف ZIP بدون ضغط (كافٍ لملفات Excel، ويفتح في Excel و LibreOffice و Google Sheets) =====
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            t[n] = c >>> 0;
        }
        return t;
    })();

    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    function zip(files) {
        const enc = new TextEncoder();
        const now = new Date();
        const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
        const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
        const parts = [];
        const central = [];
        let offset = 0;
        files.forEach(f => {
            const name = enc.encode(f.name);
            const data = enc.encode(f.data);
            const crc = crc32(data);
            const local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);
            local.setUint16(6, 0x0800, true); // أسماء UTF-8
            local.setUint16(8, 0, true);
            local.setUint16(10, time, true);
            local.setUint16(12, date, true);
            local.setUint32(14, crc, true);
            local.setUint32(18, data.length, true);
            local.setUint32(22, data.length, true);
            local.setUint16(26, name.length, true);
            local.setUint16(28, 0, true);
            parts.push(new Uint8Array(local.buffer), name, data);

            const cd = new DataView(new ArrayBuffer(46));
            cd.setUint32(0, 0x02014b50, true);
            cd.setUint16(4, 20, true);
            cd.setUint16(6, 20, true);
            cd.setUint16(8, 0x0800, true);
            cd.setUint16(10, 0, true);
            cd.setUint16(12, time, true);
            cd.setUint16(14, date, true);
            cd.setUint32(16, crc, true);
            cd.setUint32(20, data.length, true);
            cd.setUint32(24, data.length, true);
            cd.setUint16(28, name.length, true);
            cd.setUint32(42, offset, true);
            central.push(new Uint8Array(cd.buffer), name);
            offset += 30 + name.length + data.length;
        });
        const cdSize = central.reduce((s, p) => s + p.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, files.length, true);
        end.setUint16(10, files.length, true);
        end.setUint32(12, cdSize, true);
        end.setUint32(16, offset, true);
        return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    // ===== الملف =====
    function build(sheets) {
        const names = sheetNames(sheets);
        const built = sheets.map(sheetXml);
        const quoted = i => `'${names[i].replace(/'/g, "''")}'`;
        const defined = built
            .map((b, i) => (b.filterRef ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${quoted(i)}!${b.filterRef}</definedName>` : '') +
                (b.printTitles ? `<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${quoted(i)}!${b.printTitles}</definedName>` : ''))
            .join('');
        const files = [
            {
                name: '[Content_Types].xml',
                data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
${built.map((b, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`
            },
            {
                name: '_rels/.rels',
                data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
            },
            {
                name: 'docProps/core.xml',
                data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${esc(sheets[0] && sheets[0].title)}</dc:title><dc:creator>إدارة المتجر</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>
</cp:coreProperties>`
            },
            {
                name: 'docProps/app.xml',
                data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>إدارة المتجر</Application></Properties>`
            },
            {
                name: 'xl/workbook.xml',
                data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="16000" windowHeight="9000" activeTab="0"/></bookViews>
<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${defined ? `<definedNames>${defined}</definedNames>` : ''}
</workbook>`
            },
            {
                name: 'xl/_rels/workbook.xml.rels',
                data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${built.map((b, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${built.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
            },
            { name: 'xl/styles.xml', data: STYLES },
            ...built.map((b, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b.xml }))
        ];
        return zip(files);
    }

    function download(fileName, sheets) {
        const blob = build(sheets);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName.replace(/[\\/:*?"<>|]+/g, '-') + '.xlsx';
        // لا نضيفه للصفحة: theme.js يعترض نقرات الروابط داخلها
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    window.StoreXlsx = { build, download };
})();
