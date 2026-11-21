// Draaien met: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { metTijden, leesNamenlijst, maskeerNamenlijst } from "../src/ketting/transcript.js";

const woorden = (zinnen) => { let t = 0; return zinnen.flatMap((z) => z.split(" ").map((text) => { const w = { text, start: t, end: t + 0.4 }; t += 0.5; return w; })); };

test("tijden komen vóór zinnen, met een minimale afstand", () => {
  const w = woorden(["Goedemorgen allemaal.", "We beginnen met de actielijst.", "Het budget is 35.000 euro over van de 320.000.", "Is dat genoeg voor de licenties?", "Ja."]);
  const uit = metTijden("Goedemorgen allemaal. We beginnen met de actielijst. Het budget is 35.000 euro over van de 320.000. Is dat genoeg voor de licenties? Ja.", w, { minAfstand: 2 });
  assert.equal(uit, "[0:00] Goedemorgen allemaal. We beginnen met de actielijst. [0:03] Het budget is 35.000 euro over van de 320.000. [0:08] Is dat genoeg voor de licenties? [0:11] Ja.");
});

test("een bedrag met punt breekt de zin niet", () => {
  const w = woorden(["Er is 35.000 euro over.", "Dat is genoeg."]);
  assert.equal(metTijden("Er is 35.000 euro over. Dat is genoeg.", w, { minAfstand: 0 }), "[0:00] Er is 35.000 euro over. [0:02] Dat is genoeg.");
});

test("gemaskeerde tekst: de echte naam komt niet terug en de tijd klopt bij benadering", () => {
  const w = woorden(["Welkom allemaal vandaag.", "Bakker past de planning aan.", "Mevrouw de Vries beslist donderdag."]);
  const uit = metTijden("Welkom allemaal vandaag. [SURNAME_1] past de planning aan. Mevrouw [PERSOON_1] beslist donderdag.", w, { minAfstand: 0 });
  assert.ok(!/Bakker|Vries/.test(uit));
  assert.equal(uit, "[0:00] Welkom allemaal vandaag. [0:01] [SURNAME_1] past de planning aan. [0:04] Mevrouw [PERSOON_1] beslist donderdag.");
});

test("sprekerkoppen blijven zoals ze zijn; alleen latere zinnen in de beurt krijgen een tijd", () => {
  const w = woorden(["Dat is te vroeg.", "De kasten komen later.", "Dan schuiven we op."]);
  const uit = metTijden("**Spreker 1** · 0:00\nDat is te vroeg. De kasten komen later.\n\n**Spreker 2** · 0:04\nDan schuiven we op.", w, { minAfstand: 2 });
  assert.equal(uit, "**Spreker 1** · 0:00\nDat is te vroeg. [0:02] De kasten komen later.\n\n**Spreker 2** · 0:04\nDan schuiven we op.");
});

test("een zin vindt zijn begin niet middenin de vorige zin terug", () => {
  const w = woorden(["Is dat genoeg voor de licenties en de backup?", "Voor de licenties wel."]);
  assert.equal(metTijden("Is dat genoeg voor de licenties en de backup? Voor de licenties wel.", w, { minAfstand: 0 }), "[0:00] Is dat genoeg voor de licenties en de backup? [0:04] Voor de licenties wel.");
});

test("zonder woorden, of bij een tekst die niet het transcript is, verandert er niets", () => {
  assert.equal(metTijden("Een samenvatting.", null), "Een samenvatting.");
  assert.equal(metTijden("Heel andere tekst hier.", woorden(["Dit staat er niet in."])), "Heel andere tekst hier.");
});

test("namenlijst lezen: varianten en rol", () => {
  assert.deepEqual(leesNamenlijst("De Vries | De Ves = voorzitter\n\nBakker\n x "), [
    { naam: "De Vries", varianten: ["De Vries", "De Ves"], rol: "voorzitter" },
    { naam: "Bakker", varianten: ["Bakker"], rol: "" },
  ]);
});

test("namenlijst maskeert wat het model miste, ook verhaspeld, en zet de juiste naam terug", () => {
  const lijst = leesNamenlijst("De Vries | De Ves = voorzitter\nBakker = budgethouder");
  const r = maskeerNamenlijst("Mevrouw de Ves en de Heren Bakker beslissen. De bakkerij is dicht.", [], lijst);
  assert.equal(r.tekst, "Mevrouw [PERSOON_1] en de Heren [PERSOON_2] beslissen. De bakkerij is dicht.");
  assert.deepEqual(r.pgg, [{ label: "PERSOON", placeholder: "[PERSOON_1]", original: "De Vries" }, { label: "PERSOON", placeholder: "[PERSOON_2]", original: "Bakker" }]);
  assert.deepEqual(r.rollen, [{ placeholder: "[PERSOON_1]", rol: "voorzitter" }, { placeholder: "[PERSOON_2]", rol: "budgethouder" }]);
  assert.equal(r.extra, 2);
});

test("wat het model al maskeerde blijft zo; de rol gaat naar die plaatshouder", () => {
  const lijst = leesNamenlijst("De Vries = voorzitter\nBakker = budgethouder");
  const r = maskeerNamenlijst("Mevrouw de Vries en de heer [SURNAME_1] beslissen.", [{ label: "SURNAME", placeholder: "[SURNAME_1]", original: "Bakker" }], lijst);
  assert.equal(r.tekst, "Mevrouw [PERSOON_1] en de heer [SURNAME_1] beslissen.");
  assert.deepEqual(r.rollen, [{ placeholder: "[PERSOON_1]", rol: "voorzitter" }, { placeholder: "[SURNAME_1]", rol: "budgethouder" }]);
});

test("lege namenlijst verandert niets", () => {
  const r = maskeerNamenlijst("Tekst met Bakker.", [], leesNamenlijst(""));
  assert.equal(r.tekst, "Tekst met Bakker."); assert.equal(r.extra, 0); assert.deepEqual(r.rollen, []);
});
