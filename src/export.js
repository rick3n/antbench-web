// Tekstresultaten opslaan als .md, Word (.docx) of PDF — lokaal in de browser.
// Invoer is onze eigen lichte markdown: "# titel", "## kop", "| k | v |"-tabellen,
// "**vet**" (o.a. sprekerregels) en [PLACEHOLDER_1]-markeringen van Redact.
import { VERSION } from "./ui.js";

/** Lichte markdown → blokken: {type:"h1"|"h2"|"p"|"table"|"empty", text|rows}. */
export function parse(md) {
  const blokken = []; let tabel = null;
  for (const raw of md.split("\n")) {
    const r = raw.trimEnd();
    if (/^\|.*\|$/.test(r)) {
      if (/^\|\s*-{2,}/.test(r)) continue;                      // |---|---|
      const cellen = r.slice(1, -1).split("|").map((c) => c.trim());
      if (!tabel) { tabel = { type: "table", rows: [] }; blokken.push(tabel); }
      tabel.rows.push(cellen); continue;
    }
    tabel = null;
    if (!r.trim()) { blokken.push({ type: "empty" }); continue; }
    if (r.startsWith("# ")) blokken.push({ type: "h1", text: r.slice(2) });
    else if (r.startsWith("## ")) blokken.push({ type: "h2", text: r.slice(3) });
    else if (r.startsWith("### ")) blokken.push({ type: "h3", text: r.slice(4) });
    else if (/^[-*] /.test(r)) blokken.push({ type: "li", text: r.slice(2) });
    else if (/^\d+\. /.test(r)) blokken.push({ type: "li", text: r.replace(/^\d+\. /, "") });
    else blokken.push({ type: "p", text: r });
  }
  // lege tabelcellen in de kop (onze "| | |") → geen koprij
  return blokken;
}

/** "a **b** c [X_1]" → runs met vet/markering. */
function runs(text) {
  const uit = []; const re = /(\*\*(.+?)\*\*|\*(.+?)\*|\[[A-Z_]+_\d+\])/g; let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) uit.push({ t: text.slice(last, m.index) });
    if (m[2] != null) uit.push({ t: m[2], b: true }); else if (m[3] != null) uit.push({ t: m[3], i: true }); else uit.push({ t: m[0], mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) uit.push({ t: text.slice(last) });
  return uit;
}
const plat = (text) => runs(text).map((r) => r.t).join("");
// jsPDF's standaardlettertypen kennen alleen WinAnsi: pijlen, vinkjes en emoji vervangen.
const winansi = (t) => t.replace(/→/g, "->").replace(/←/g, "<-").replace(/✔|✓/g, "v").replace(/✗|✕/g, "x").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\uFE0F]/gu, "").replace(/[^\x00-\x7F\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026\u20AC]/g, "?");

function download(blob, naam) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = naam; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

export function alsMd(md, basis) { download(new Blob([md], { type: "text/markdown" }), `${basis}.md`); }

export async function alsDocx(md, basis) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = await import("docx");
  const par = (b) => {
    const tr = (r) => new TextRun({ text: r.t, bold: !!r.b, italics: !!r.i, highlight: r.mark ? "yellow" : undefined });
    if (b.type === "h1") return new Paragraph({ heading: HeadingLevel.TITLE, children: runs(b.text).map(tr) });
    if (b.type === "h2") return new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(b.text).map(tr) });
    if (b.type === "h3") return new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(b.text).map(tr) });
    if (b.type === "li") return new Paragraph({ bullet: { level: 0 }, children: runs(b.text).map(tr) });
    if (b.type === "empty") return new Paragraph({});
    return new Paragraph({ children: runs(b.text).map(tr), spacing: { after: 120 } });
  };
  const kinderen = [];
  for (const b of parse(md)) {
    if (b.type !== "table") { kinderen.push(par(b)); continue; }
    const rijen = b.rows.filter((r) => r.some((c) => c));
    const geen = { style: BorderStyle.SINGLE, size: 2, color: "DDDDDD" };
    kinderen.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE },
      rows: rijen.map((r) => new TableRow({ children: r.map((c, i) => new TableCell({ borders: { top: geen, bottom: geen, left: geen, right: geen },
        width: { size: i === 0 ? 30 : 70, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: runs(c).map((x) => new TextRun({ text: x.t, bold: !!x.b || i === 0, color: i === 0 ? "666666" : undefined, highlight: x.mark ? "yellow" : undefined })) })] })) })) }));
    kinderen.push(new Paragraph({}));
  }
  kinderen.push(new Paragraph({ children: [new TextRun({ text: `${VERSION} · gemaakt op dit toestel, niets is naar een server gestuurd`, size: 16, color: "888888" })] }));
  const doc = new Document({ creator: "AntBench", title: basis, styles: { default: { document: { run: { font: "Calibri", size: 22 } } } }, sections: [{ children: kinderen }] });
  download(await Packer.toBlob(doc), `${basis}.docx`);
}

export async function alsPdf(md, basis) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const W = 595.28, H = 841.89, M = 56, breed = W - 2 * M; let y = M;
  const regel = (tekst, { size = 11, bold = false, color = 0, x = M, w = breed, after = 4 } = {}) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size); pdf.setTextColor(color);
    const lijnen = pdf.splitTextToSize(winansi(tekst), w); const hoog = size * 1.35;
    for (const l of lijnen) { if (y + hoog > H - M) { voet(); pdf.addPage(); y = M; } pdf.text(l, x, y + size); y += hoog; }
    y += after;
  };
  const voet = () => { pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(140); pdf.text(`${VERSION} · gemaakt op dit toestel, niets is naar een server gestuurd · ${pdf.getNumberOfPages()}`, M, H - 28); };
  for (const b of parse(md)) {
    if (b.type === "h1") { y += 4; regel(plat(b.text), { size: 18, bold: true, after: 10 }); }
    else if (b.type === "h2") { y += 8; regel(plat(b.text), { size: 13, bold: true, after: 6 }); }
    else if (b.type === "h3") { y += 4; regel(plat(b.text), { size: 11.5, bold: true, after: 4 }); }
    else if (b.type === "li") regel("•  " + plat(b.text));
    else if (b.type === "empty") y += 4;
    else if (b.type === "table") {
      for (const r of b.rows.filter((x) => x.some((c) => c))) {
        const y0 = y; regel(plat(r[0] ?? ""), { size: 9.5, color: 110, w: breed * 0.3, after: 0 }); const y1 = y; y = y0;
        regel(plat(r.slice(1).join(" · ")), { size: 10, x: M + breed * 0.32, w: breed * 0.68, after: 0 }); y = Math.max(y, y1) + 3;
      }
      y += 6;
    } else { const vet = /^\*\*/.test(b.text); regel(plat(b.text), { bold: vet, size: vet ? 10.5 : 11, after: vet ? 2 : 6 }); }
  }
  voet();
  download(pdf.output("blob"), `${basis}.pdf`);
}

/** Eén aanroep: kies op formaat. */
export async function bewaar(fmt, md, basis) {
  if (fmt === "docx") return alsDocx(md, basis);
  if (fmt === "pdf") return alsPdf(md, basis);
  return alsMd(md, basis);
}
