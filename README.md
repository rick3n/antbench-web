# AntBench (web)

Referentie-webapp met alle browser-modellen van [Desert Ant Labs](https://desertant.com)
(SDK 4.3.0, npm `@desert-ant-labs/*`). De modellen draaien **in de browser**
(WebAssembly + LiteRT.js; Voz op ONNX Runtime Web), dus ook op iPhone en iPad;
de server levert alleen statische bestanden en ziet geen invoer. Demo:
https://dev.3n.nl/antbench/

Gemaakt door [3n.nl](https://3n.nl) als proef bij de kennismaking met Desert Ant
Labs; de volledige ontwikkeling gebeurde met Claude.

## Snel starten

    npm ci
    npm run dev          # http://localhost:5173/antbench/
    npm run build        # → dist/ (statisch, ~140 MB door de wasm-runtimes)

`npm run assets` (onderdeel van `dev` en `build`) kopieert de LiteRT- en
ONNX-runtimes en het Tongue-model uit `node_modules` naar `public/`. De overige
modellen haalt de SDK bij eerste gebruik SHA-256-geverifieerd van Hugging Face;
de service worker (`public/sw.js`) zet ze in Cache Storage, zodat herladen en
vliegtuigmodus daarna zonder netwerk werken.

Hosting: elke statische webserver. `vite.config.js` heeft `base: "/antbench/"`;
pas dat aan als de app op een andere plek komt. Geef `index.html` en `sw.js`
`Cache-Control: no-cache` en `assets/`, `litert/`, `ort/`, `models/` een lange
cache (bestandsnamen zijn gehasht of versiegebonden).

## Wat erin zit

| Tabblad | Modellen | Invoer |
|---|---|---|
| Tekst | Redact (PII), Tongue (taal), Emo (emoji), Gist (onderwerpen) | typen, plakken, bestand (txt/md/html/docx), Delen-menu |
| Audio | Voz (transcriptie), Who (sprekers), Ear (gesproken taal), Clear (opschonen) | microfoon, audio-/videobestand |
| Beeld | Eye (analyse), Moderator (NSFW) | camera, foto |
| Tekenen | Shapes (vormherkenning) | één haal op het canvas |
| Vergadering | Voz → Who → Ear/Tongue/Gist/Redact als keten (Clear optioneel vooraf) | één opname → notulen (.md/.srt), geredigeerde versie, optioneel schone .wav |
| Project | alle bovenstaande, batch | veel bestanden tegelijk (of een map op desktop) |

## Project: batchverwerking met terugschrijven

Noem bestanden `<project>__<naam>.<ext>`; alles met hetzelfde voorvoegsel vóór
de dubbele underscore vormt één project (zonder voorvoegsel: "los"). Per
modaliteit kies je de modellen (standaard foto → Eye, audio → Voz, tekst →
Redact + Gist + Tongue). Het resultaat komt als `<project>__antbench.zip`:

- foto's: kopie `<naam>__tagged.jpg` met de Eye-tags als XMP-trefwoorden
  (dc:subject), beschrijving en een 1–5-ster rating op keeper-score — de
  originele bytes blijven intact, er komt alleen een XMP-segment bij (src/xmp.js);
  niet-JPEG krijgt een `.xmp`-sidecar
- audio: `__transcript.txt` en `__transcript.srt` (met sprekers als Who meedraait),
  `__clear.wav`
- tekst: `__redacted.txt`
- `rapport.md` en `resultaten.json`


## Vliegtuigtest en netwerkbewijs

Onderaan de pagina staat een indicator `● online` / `✈ offline` en na elke
actie meldt de status hoeveel netwerkverzoeken er tijdens het verwerken zijn
gedaan, naar welke hosts, en hoeveel bestanden uit de modelcache kwamen. De
service worker ziet elk verzoek, ook vanuit workers. Model online gebruiken →
vliegtuigmodus aan → zelfde model opnieuw geeft `0 netwerkverzoeken` en een
"Bewezen"-stempel.

## Goed om te weten over de SDK

- Bij elke modellading doet de SDK één verzoek naar `https://events.desertant.com/api/v1`
  (het adres staat in de wasm-kern; de code noemt het telemetrie/licentie).
  Offline mislukt dat verzoek en werkt het model gewoon door. De netwerkteller
  laat het zien.
- De browser-SDK bewaart modellen zelf alleen in het paginageheugen; de
  modelcache in `sw.js` is een toevoeging van deze app.
- Clear mastert naar −16 LUFS maar met `maxGainDB` standaard 9 dB; deze app
  geeft 40 mee. `measuredLUFS` is de loudness van de ínvoer; `src/loudness.js`
  meet de uitvoer (BS.1770).
- Clear vóór Voz maakt een transcript slechter, niet beter; in de
  Vergadering-keten staat Clear daarom standaard uit.
- Moderator geeft als `score` de hoogste regio-score en vlagt bij ≥ `threshold`
  (0,5); een huidrijke close-up van een gezicht komt daar al snel overheen.
- Voz is traag zonder WebGPU; Chrome op Android en Safari 26+ hebben het.
  Op een Galaxy S25 Ultra: 15× realtime.

## Licentie

De code van AntBench is beschikbaar onder de MIT-licentie (`LICENSE`). De
Desert Ant SDK en de modellen vallen onder de voorwaarden van Desert Ant Labs;
die accepteer je zelf bij `npm ci`.

## Versie

De versie staat in `package.json` en komt via `__APP_VERSION__` in de
voettekst, in `rapport.md`, `resultaten.json` en de notulen.

| Versie | Wat |
|---|---|
| 0.1 | Redact + Tongue |
| 0.2 | 11 modellen in vier tabbladen |
| 0.3 | Project: batch + ZIP met XMP-trefwoorden |
| 0.4 | Vergadering: keten naar notulen |
| 0.5 | Clear-loudness correct gemeten en opgetild (maxGainDB 40); versienummer zichtbaar |
| 0.5.1 | Notulen liepen vast op lange opnames: LUFS-meting geheugenarm, origineel vrijgegeven, fouten zichtbaar |
| 0.5.2 | Sprekers per zin op meerderheid, micro-beurten samengevoegd; Clear uitschakelbaar ter vergelijking |
| 0.5.3 | Herstel: Clear-schakelaar werkte niet (useClear ongedefinieerd) |
| 0.5.4 | Moderator: drempel en policy instelbaar; score uitgelegd als hoogste regio-score |
| 0.5.5 | Vergadering: geheugenpiek bij samenstellen weg (16 kHz, buffers vrij, WAV buiten de ZIP) — tab crashte op telefoon |
| 0.6.0 | Vliegtuigtest: online/offline-indicator, netwerkteller per run, bewijs van lokaal verwerken |
| 0.6.1 | Modelcache in de service worker: modellen overleven herladen en vliegtuigmodus; netwerkteller via de service worker; knoppen voor opslag beschermen en cache wissen |
| 0.6.2 | Vergadering: Clear standaard uit — Voz transcribeert het origineel aantoonbaar beter |
| 0.6.3 | Link naar het GitHub-repo en melding dat de demo-site tijdelijk is (tot 1 december 2026) |
