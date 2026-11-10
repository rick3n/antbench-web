# antbench-web

Webversie van AntBench: de on-device modellen van Desert Ant Labs draaien in
de browser (WebAssembly + LiteRT.js; Voz op ONNX Runtime Web), dus ook op
iPhone en iPad. Niets verlaat het toestel; de server levert alleen statische
bestanden. Te gebruiken op https://dev.3n.nl/antbench/.

| Tabblad | Modellen | Invoer |
|---|---|---|
| Tekst | Redact (PII), Tongue (taal), Emo (emoji), Gist (onderwerpen) | typen, plakken, bestand (txt/md/html/docx), Delen-menu |
| Audio | Voz (transcriptie), Who (sprekers), Ear (gesproken taal), Clear (opschonen) | microfoon, audio-/videobestand |
| Beeld | Eye (analyse), Moderator (NSFW) | camera, foto |
| Tekenen | Shapes (vormherkenning) | één haal op het canvas |
| Vergadering | Clear → Voz → Who → Ear/Tongue/Gist/Redact als keten | één opname → notulen (.md/.srt), schone .wav, geredigeerde versie |
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


Elk model laadt pas bij de eerste klik (de wasm-cores zijn ~50 MB per model,
de gewichten komen SHA-256-geverifieerd van Hugging Face) en zit daarna in de
browsercache. Voz is traag zonder WebGPU; Chrome op Android en Safari 26+ hebben het.

Bouwen gebeurt door Nix (`default.nix`, buildNpmPackage); lokaal ontwikkelen:

    npm ci
    npm run dev          # of: npm run build  → dist/

## Versie

De versie staat in `package.json` (en gelijk in `default.nix`) en komt via
`__APP_VERSION__` in de voettekst, in `rapport.md`, `resultaten.json` en de
notulen. Bump hem in elke PR die de app verandert; zo is bij een melding van
een gebruiker direct te zien welke versie die draaide.

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
| 0.7.0 | Menukaart `werkbank/`: twaalf klussen van de ambtenaar met per klus een knop naar de demo |
| 0.7.1 | Menukaart: alleen eigen demo's; wat er nog niet is staat op komt |
| 0.8.0 | Ketting `ketting/`: kralen slepen tot een klus, doorgeefpakket, twaalf verhalen; nieuwe kralen OCR (Tesseract), vertalen (Opus-MT), schrijven (Qwen3 via WebLLM), voorlezen (Piper) |
| 0.8.1 | Tekstresultaten opslaan als Word (.docx), PDF of .md — in de ketting per kraal en als verslag, in Vergadering voor de notulen |

Verandert `package-lock.json`, zet dan `npmDepsHash` in `default.nix` opnieuw
(`nix run nixpkgs#prefetch-npm-deps -- package-lock.json`).
