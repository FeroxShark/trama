// Corrector ortográfico: gemelo de app/electron/corrector.ts (mismas reglas; lo controla app/tests/corrector.test.ts).
"use strict";

function idiomasCorrector(disponibles) {
  const norm = (c) => c.toLowerCase().replace(/_/g, "-");
  const con = (pref, base) => {
    for (const p of pref) {
      const h = disponibles.find((c) => norm(c) === p);
      if (h) return h;
    }
    return disponibles.find((c) => norm(c) === base || norm(c).startsWith(`${base}-`));
  };
  const es = con(["es-es", "es-419", "es-mx"], "es");
  const en = con(["en-us"], "en");
  return [es, en].filter((c) => !!c);
}

function armarCorrector(ses) {
  const l = idiomasCorrector(ses.availableSpellCheckerLanguages);
  if (l.length) ses.setSpellCheckerLanguages(l);
  return l;
}

module.exports = { idiomasCorrector, armarCorrector };
