// XMP-trefwoorden in een JPEG schrijven zonder de rest van het bestand aan te
// raken: we voegen één APP1-segment met een XMP-pakket in (of vervangen een
// bestaand XMP-segment). EXIF, IPTC en beelddata blijven byte-voor-byte gelijk.
// Lightroom, Windows Verkenner, macOS Foto's en digiKam lezen dc:subject en
// dc:description als trefwoorden en beschrijving.

const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";

function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

export function xmpPacket({ keywords = [], description = "", rating = null, creatorTool = "AntBench" }) {
  const bag = keywords.map((k) => `          <rdf:li>${esc(k)}</rdf:li>`).join("\n");
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <xmp:CreatorTool>${esc(creatorTool)}</xmp:CreatorTool>
      <xmp:MetadataDate>${new Date().toISOString()}</xmp:MetadataDate>${rating == null ? "" : `
      <xmp:Rating>${rating}</xmp:Rating>`}
      <dc:subject>
        <rdf:Bag>
${bag}
        </rdf:Bag>
      </dc:subject>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${esc(description)}</rdf:li>
        </rdf:Alt>
      </dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

/** Geeft een nieuwe JPEG (Uint8Array) met het XMP-pakket; gooit als het geen JPEG is. */
export function jpegWithXmp(bytes, xmp) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0xff || b[1] !== 0xd8) throw new Error("geen JPEG");
  const payload = new TextEncoder().encode(XMP_NS + xmp);
  if (payload.length + 2 > 0xffff) throw new Error("XMP te groot voor één segment");
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff; seg[1] = 0xe1; seg[2] = (payload.length + 2) >> 8; seg[3] = (payload.length + 2) & 0xff; seg.set(payload, 4);

  // Segmenten doorlopen tot de eerste niet-APPn/COM-marker; bestaand XMP overslaan,
  // en het nieuwe segment ná EXIF (APP1 met "Exif\0") en APP0 invoegen.
  const parts = [b.subarray(0, 2)];
  let i = 2, inserted = false;
  while (i + 4 <= b.length && b[i] === 0xff) {
    const marker = b[i + 1];
    const isApp = marker >= 0xe0 && marker <= 0xef, isCom = marker === 0xfe;
    if (!isApp && !isCom) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    const segment = b.subarray(i, i + 2 + len);
    const isXmp = marker === 0xe1 && startsWith(b, i + 4, "http://ns.adobe.com/xap/1.0/");
    const isExif = marker === 0xe1 && startsWith(b, i + 4, "Exif");
    if (!isXmp) {
      if (!inserted && !(marker === 0xe0 || isExif)) { parts.push(seg); inserted = true; }
      parts.push(segment);
    }
    i += 2 + len;
  }
  if (!inserted) parts.push(seg);
  parts.push(b.subarray(i));
  const total = parts.reduce((n, p) => n + p.length, 0), out = new Uint8Array(total);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function startsWith(b, at, s) { for (let k = 0; k < s.length; k++) if (b[at + k] !== s.charCodeAt(k)) return false; return true; }

/** Los .xmp-sidecarbestand voor niet-JPEG (HEIC, PNG, RAW). */
export function xmpSidecar(xmp) { return new Blob([xmp], { type: "application/rdf+xml" }); }
