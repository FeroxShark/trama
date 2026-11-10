// Corrector ortográfico: Chromium usa un solo diccionario (el del idioma del sistema) y marca todo el español. Trama pide
// siempre español e inglés (se escribe en español aunque la interfaz esté en inglés). Puro: lo prueba tests/corrector.test.ts.
// La carcasa de Windows tiene el mismo en windows/src/corrector.js (mismas reglas).

/**
 * Los códigos a pedir, de la lista que Chromium dice tener: el primer español (prefiere es-ES, luego es-419 y es-MX por si
 * falta) y el inglés (en-US, o el primero que haya). Un idioma sin diccionario se omite; sin ninguno, lista vacía.
 */
export function idiomasCorrector(disponibles: readonly string[]): string[] {
  const norm = (c: string) => c.toLowerCase().replace(/_/g, "-");
  const con = (pref: readonly string[], base: string): string | undefined => {
    for (const p of pref) {
      const h = disponibles.find((c) => norm(c) === p);
      if (h) return h;
    }
    return disponibles.find((c) => norm(c) === base || norm(c).startsWith(`${base}-`));
  };
  const es = con(["es-es", "es-419", "es-mx"], "es");
  const en = con(["en-us"], "en");
  return [es, en].filter((c): c is string => !!c);
}

/** Lo que usa la sesión de Electron (`session.defaultSession`). Si la lista no tiene nada, no toca lo que Chromium eligió. */
export function armarCorrector(ses: { availableSpellCheckerLanguages: string[]; setSpellCheckerLanguages: (l: string[]) => void }): string[] {
  const l = idiomasCorrector(ses.availableSpellCheckerLanguages);
  if (l.length) ses.setSpellCheckerLanguages(l);
  return l;
}
