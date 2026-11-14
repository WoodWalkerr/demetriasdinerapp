// Small, dependency-free makers for downloadable reports:
//   xlsx(sheets) → a real Excel .xlsx file (opens in Excel, Google Sheets, Numbers)
//   pdf(doc)     → a simple A4 landscape PDF table (Helvetica)
import zlib from 'node:zlib';

// ---------------------------------------------------------------- ZIP (for .xlsx)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const parts = [], central = []; let offset = 0;
  for (const { name, data } of files) {
    const raw = Buffer.from(data, 'utf8'), comp = zlib.deflateRawSync(raw), nameB = Buffer.from(name, 'utf8'), crc = crc32(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameB.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, nameB, comp);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(0, 12); cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(raw.length, 24); cen.writeUInt16LE(nameB.length, 28);
    cen.writeUInt32LE(offset, 42); central.push(cen, nameB);
    offset += 30 + nameB.length + comp.length;
  }
  const cenBuf = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cenBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cenBuf, end]);
}

// ---------------------------------------------------------------- XLSX
const xe = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
/**
 * sheets: [{ name, widths?: [chars…], rows: [[cell…]…], bold?: [rowIndex…] }]
 * cell: string | number | null. Numbers stay numbers (so Excel can add them up).
 */
export function xlsx(sheets) {
  const safe = (n, i) => (String(n || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`);
  const names = []; sheets.forEach((s, i) => { let n = safe(s.name, i); while (names.includes(n)) n = (n.slice(0, 28) + ' ' + (i + 1)); names.push(n); });
  const sheetXml = (s) => {
    const bold = new Set(s.bold || [0]);
    const rows = s.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = colName(ci) + (ri + 1), st = bold.has(ri) ? ' s="1"' : '';
      return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${st}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const cols = s.widths ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${(s.freeze ?? 1)}" topLeftCell="A${(s.freeze ?? 1) + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xe(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zip(files);
}

// ---------------------------------------------------------------- PDF
// Text is written with the built-in Helvetica fonts (Latin-1), so other characters are swapped for plain ones.
const latin = (s) => String(s ?? '').replace(/₱/g, 'PHP ').replace(/[–—]/g, '-').replace(/[·•]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/→/g, '->').replace(/[^\x20-\x7e\xa0-\xff]/g, '');
const pe = (s) => latin(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
// Helvetica widths (per 1000) for a reasonable fit; unknown characters count as 556.
const W = { ' ': 278, i: 222, l: 222, j: 222, t: 278, f: 278, r: 333, I: 278, '.': 278, ',': 278, ':': 278, '-': 333, '(': 333, ')': 333, '/': 278, m: 833, w: 722, M: 833, W: 944 };
const textW = (s, size) => [...latin(s)].reduce((a, c) => a + (W[c] || (c >= 'A' && c <= 'Z' ? 667 : 556)), 0) * size / 1000;
const fit = (s, size, w) => { let t = latin(s); if (textW(t, size) <= w) return t; while (t && textW(t + '...', size) > w) t = t.slice(0, -1); return t + '...'; };
/**
 * doc: { title, subtitle, sections: [{ heading, columns: [{ label, w (points), align? }], rows: [[…]], totals?: [[…]] }] }
 * A4 landscape, header repeated on each page, page numbers at the bottom.
 */
export function pdf(doc) {
  const PW = 842, PH = 595, M = 32, pages = []; let ops = [], y = 0;
  const text = (x, yy, s, size = 9, bold = false) => ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(1)} ${yy.toFixed(1)} Td (${pe(s)}) Tj ET`);
  const line = (x1, y1, x2, y2, gray = 0.8) => ops.push(`${gray} G 0.5 w ${x1} ${y1} m ${x2} ${y2} l S 0 G`);
  const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = PH - M; text(M, y - 4, doc.title, 14, true); if (doc.subtitle) text(M, y - 20, doc.subtitle, 9); y -= 38; };
  const row = (cols, cells, bold = false, size = 8.5) => {
    let x = M;
    cols.forEach((c, i) => { const v = fit(cells[i] ?? '', size, c.w - 6); const tx = c.align === 'right' ? x + c.w - 4 - textW(v, size) : x + 2; text(tx, y, v, size, bold); x += c.w; });
    y -= 13;
  };
  newPage();
  for (const sec of doc.sections) {
    const need = 34 + Math.min(3, sec.rows.length) * 13;
    if (y - need < M + 14) newPage();
    if (sec.heading) { text(M, y, sec.heading, 11, true); y -= 15; }
    const head = () => { row(sec.columns, sec.columns.map((c) => c.label), true); line(M, y + 9, PW - M, y + 9, 0.6); };
    head();
    for (const r of sec.rows) { if (y < M + 18) { newPage(); if (sec.heading) { text(M, y, sec.heading + ' (continued)', 10, true); y -= 14; } head(); } row(sec.columns, r); }
    for (const t of sec.totals || []) { line(M, y + 9, PW - M, y + 9, 0.6); row(sec.columns, t, true); }
    y -= 12;
  }
  pages.push(ops);
  // assemble the file
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(''), pagesId = add(''), f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = pages.map((p, i) => {
    const content = [...p, `BT /F1 8 Tf ${PW - M - 60} 18 Td (Page ${i + 1} of ${pages.length}) Tj ET`].join('\n');
    const c = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${c} 0 R >>`);
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}