// Ketting — hulp voor het verslag: tijden in het transcript en een eigen namenlijst.
// Zuivere functies zonder browser of model, zodat ze los te testen zijn (zie test/transcript.test.mjs).

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const kaal = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Zet vóór zinnen het tijdstip uit de opname ("[0:12] Dat is te vroeg."), zodat een verslag bij twijfel kan zeggen
 * waar je moet terugluisteren. Werkt op de tekst zoals hij nu is, dus ook ná het maskeren: de woorden met tijd dienen
 * alleen om de plek te vinden en komen zelf niet in de tekst. Een zin waarvan het begin niet terug te vinden is
 * (plaatshouder, verhaspeld woord) krijgt geen tijd; dat is beter dan een verkeerde.
 */
export function metTijden(tekst, woorden, { minAfstand = 5, venster = 60 } = {}) {
  if (!tekst || !woorden?.length) return tekst;
  const w = woorden.map((x) => ({ k: kaal(x.text), start: x.start })).filter((x) => x.k);
  let wijzer = 0, laatste = -Infinity;
  const zoek = (zin) => {
    // de eerste gewone woorden van de zin (plaatshouders en opmaak tellen niet mee)
    const anker = [];
    for (const m of zin.matchAll(/\[[A-Z_]+_\d+\]|[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu)) {   // "35.000" is één woord, net als in de woordenlijst van Voz
      if (m[0].startsWith("[")) { if (!anker.length) continue; break; }
      anker.push(kaal(m[0])); if (anker.length === 3) break;
    }
    if (!anker.length) return null;
    const lengte = (zin.match(/[\p{L}\p{N}]+(?:['’.,-][\p{L}\p{N}]+)*/gu) ?? []).length;
    const eerst = !/^\s*\[[A-Z_]+_\d+\]/.test(zin);   // begint de zin zelf met het ankerwoord?
    // een anker van één woord ("Ja.") komt te vaak voor om ver vooruit te zoeken
    const ver = anker.length > 1 ? venster : 8;
    for (let i = wijzer; i < Math.min(w.length, wijzer + ver); i++) {
      if (anker.every((a, j) => w[i + j]?.k === a)) {
        // door naar (bijna) het eind van deze zin, anders vindt de volgende zin zijn begin middenin deze terug
        wijzer = i + Math.max(anker.length, lengte - 2); return { t: w[eerst ? i : Math.max(0, i - 1)].start };
      }
    }
    return null;
  };
  return tekst.split("\n").map((regel) => {
    if (!regel.trim()) return regel;
    // een sprekerkop heeft zelf al een tijd; de zin er direct onder krijgt er dan geen tweede
    const kop = /^\*\*Spreker \d+\*\* · (\d+):(\d\d)/.exec(regel);
    if (kop) { laatste = +kop[1] * 60 + +kop[2]; return regel; }
    // zinnen splitsen op leesteken + witruimte; "35.000" en "nl.wikipedia" blijven zo heel
    return regel.split(/(?<=[.!?])(\s+)/).map((zin) => {
      if (!zin.trim()) return zin;
      const v = zoek(zin);
      if (!v || v.t - laatste < minAfstand) return zin;
      laatste = v.t; return `[${fmt(v.t)}] ${zin}`;
    }).join("");
  }).join("\n");
}

/**
 * Namenlijst lezen: één persoon per regel, varianten met "|" ertussen, optioneel "= rol".
 *   De Vries | De Ves = voorzitter
 * De eerste variant is de naam die na afloop wordt teruggezet.
 */
export function leesNamenlijst(invoer) {
  const uit = [];
  for (const regel of (invoer ?? "").split("\n")) {
    const [links, ...rest] = regel.split("=");
    const varianten = links.split("|").map((v) => v.trim().replace(/\s+/g, " ")).filter((v) => v.length >= 2);
    if (varianten.length) uit.push({ naam: varianten[0], varianten, rol: rest.join("=").trim() });
  }
  return uit;
}

/**
 * Namen uit de eigen lijst altijd maskeren, wat het model er ook van vond. Draait ná Redact: wat het model al wegnam
 * blijft zo, wat het miste (of wat de spraakherkenning verhaspelde en als variant in de lijst staat) wordt alsnog een
 * plaatshouder. Geeft ook de rollen per plaatshouder, zodat een verslag "voorzitter" kan schrijven zonder de naam te kennen.
 */
export function maskeerNamenlijst(tekst, pgg, lijst) {
  const items = [...(pgg ?? [])], rollen = [];
  let extra = 0, nr = 0;
  const bestaand = (v) => items.find((i) => i.original != null && /NAME|PERSOON/.test(i.label ?? "") && i.original.trim().toLowerCase() === v.toLowerCase());
  for (const p of lijst ?? []) {
    // heeft het model deze naam al gevonden, dan hoort de rol bij die plaatshouder
    const al = p.varianten.map(bestaand).find(Boolean);
    let ph = null;
    for (const v of [...p.varianten].sort((a, b) => b.length - a.length)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}\\[_])${v.split(" ").map(esc).join("\\s+")}(?![\\p{L}\\p{N}\\]_])`, "giu");
      tekst = tekst.replace(re, () => { extra++; ph ??= `[PERSOON_${++nr}]`; return ph; });
    }
    if (ph) items.push({ label: "PERSOON", placeholder: ph, original: p.naam });
    if (p.rol) for (const h of new Set([al?.placeholder, ph].filter(Boolean))) rollen.push({ placeholder: h, rol: p.rol });
  }
  return { tekst, pgg: items, rollen, extra };
}
