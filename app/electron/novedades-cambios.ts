// Novedades de cada versión (CHANGELOG.md de la raíz): el parser y la regla de qué versiones mostrar. Puro (sin fs ni React; vive en
// electron/ porque preferencias.ts lo usa y electron/ no importa de src/, pero la interfaz sí importa de acá): lo
// usan el aviso de la barra (`AvisoNovedades.tsx`), Ajustes > Actualizaciones (`AjustesNovedades.tsx`) y tests/novedades.test.ts.
// Formato del archivo: `## 0.2.57` y debajo viñetas `- …` (una viñeta puede seguir en renglones con sangría). El contenido queda en
// español tal cual; tolera markdown simple: `código` y **negrita**.

/** Una versión del CHANGELOG, con sus viñetas en markdown simple (sin el `- `). */
export type Entrada = { version: string; items: string[] };

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** `0.2.57` o `v0.2.57` → `0.2.57`; lo que no es una versión X.Y.Z, null. */
export function versionNormal(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = VERSION.exec(v.trim());
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : null;
}

/** Orden de versiones: negativo si a < b. Una que no es versión va antes que cualquiera. */
export function compararVersiones(a: string, b: string): number {
  const pa = VERSION.exec(a.trim());
  const pb = VERSION.exec(b.trim());
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Las versiones del CHANGELOG, en el orden del archivo (la más nueva arriba). El título `## 0.2.57` puede traer algo detrás
 * (` — 2026-11-06`); un título que no es una versión corta la lectura de esa sección. Sin viñetas, la versión no figura.
 */
export function parsearCambios(texto: string): Entrada[] {
  const salida: Entrada[] = [];
  let actual: Entrada | null = null;
  let abierta = false;
  for (const crudo of texto.replace(/\r\n?/g, "\n").split("\n")) {
    const titulo = /^##\s+(\S+)/.exec(crudo);
    if (titulo) {
      const v = versionNormal(titulo[1]);
      actual = v && !salida.some((e) => e.version === v) ? { version: v, items: [] } : null;
      if (actual) salida.push(actual);
      abierta = false;
      continue;
    }
    if (!actual) continue;
    const vineta = /^\s{0,3}[-*]\s+(.*\S)\s*$/.exec(crudo);
    if (vineta) {
      actual.items.push(vineta[1]);
      abierta = true;
    } else if (abierta && crudo.trim() && /^\s+\S/.test(crudo)) {
      // Sigue la viñeta anterior (renglón con sangría).
      actual.items[actual.items.length - 1] += ` ${crudo.trim()}`;
    } else if (!crudo.trim() || /^#/.test(crudo)) {
      abierta = false;
    }
  }
  return salida.filter((e) => e.items.length > 0);
}

/**
 * Qué versiones se muestran tras arrancar con `actual`: las posteriores a la última vista y hasta la actual, la más nueva arriba
 * (si saltó varias, las intermedias también). Sin versión vista guardada (`null`: ya usaba Trama antes de que existieran las
 * novedades) sólo la de ahora. Igual o más nueva que la actual (se volvió a una versión anterior): nada.
 */
export function versionesAMostrar(entradas: readonly Entrada[], vista: string | null, actual: string): Entrada[] {
  const act = versionNormal(actual);
  if (!act) return [];
  const v = vista === null ? null : versionNormal(vista);
  if (vista !== null && !v) return [];
  return entradas
    .filter((e) => (v === null ? e.version === act : compararVersiones(e.version, v) > 0 && compararVersiones(e.version, act) <= 0))
    .sort((a, b) => compararVersiones(b.version, a.version));
}

/** Un pedazo de una viñeta ya leída: texto común, `código` o **negrita**. */
export type Trozo = { tipo: "texto" | "codigo" | "negrita"; texto: string };

/** Parte una viñeta en pedazos para dibujarla (sin HTML: el que dibuja arma los elementos). Lo que no cierra queda como texto. */
export function trozos(md: string): Trozo[] {
  const salida: Trozo[] = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
  let desde = 0;
  for (let m = re.exec(md); m; m = re.exec(md)) {
    if (m.index > desde) salida.push({ tipo: "texto", texto: md.slice(desde, m.index) });
    salida.push(m[1] !== undefined ? { tipo: "codigo", texto: m[1] } : { tipo: "negrita", texto: m[2] });
    desde = m.index + m[0].length;
  }
  if (desde < md.length) salida.push({ tipo: "texto", texto: md.slice(desde) });
  return salida;
}

export function combinarCambios(textoEn: string, textoEs: string): string {
  if (!textoEn.trim()) return textoEs;
  if (!textoEs.trim()) return textoEn;
  const es = parsearCambios(textoEs);
  const en = parsearCambios(textoEn);
  const mapaEn = new Map(en.map((e) => [e.version, e]));
  const mapaEs = new Map(es.map((e) => [e.version, e]));
  const faltan = es.some((e) => !mapaEn.has(e.version));
  const sobran = en.some((e) => !mapaEs.has(e.version));
  if (!faltan && !sobran) return textoEn;
  const combinadas: Entrada[] = [];
  const vistas = new Set<string>();
  for (const e of es) {
    vistas.add(e.version);
    combinadas.push(mapaEn.get(e.version) ?? e);
  }
  for (const e of en) {
    if (!vistas.has(e.version)) combinadas.push(e);
  }
  return combinadas
    .map((e) => "## " + e.version + "\n\n" + e.items.map((it) => "- " + it).join("\n") + "\n")
    .join("\n");
}
