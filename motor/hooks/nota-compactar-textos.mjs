// Los textos del hook `nota-compactar.mjs` en UN solo lugar (es y en), sin disco, sin reloj y sin efectos al importarlo.
// Viaja junto al hook (en Windows, `app\hooks`). Lo prueba app/tests/nota-compactar-hook.test.ts.

export const TOPE_NOTA = 12_000;

export const idiomaValido = (x) => (x === "en" ? "en" : "es");

const PEDIDOS = {
  es: [
    "[Trama · contexto] Te queda poco espacio antes de compactar. En tu PRÓXIMA respuesta, escribí una nota para vos mismo entre `[[nota-compactar]]` y `[[/nota-compactar]]` con estas secciones (máximo ~600 palabras):",
    "- Objetivo",
    "- Pedidos de la persona (textuales)",
    "- Estado (hecho / a medias)",
    "- Decisiones y por qué",
    "- Qué sigue (pasos exactos)",
    "- Rutas, ids y comandos exactos",
    "- Qué NO hacer",
    "Después de compactar se te va a devolver entera. Después de escribirla, seguí con lo que estabas haciendo.",
  ].join("\n"),
  en: [
    "[Trama · context] You are running low on context before compaction. In your NEXT response, write a note to yourself between `[[nota-compactar]]` and `[[/nota-compactar]]` with these sections (max ~600 words):",
    "- Objective",
    "- User requests (verbatim)",
    "- Status (done / in progress)",
    "- Decisions and why",
    "- What is next (exact steps)",
    "- Exact paths, ids and commands",
    "- What NOT to do",
    "After compacting, it will be returned to you in full. After writing it, continue with what you were doing.",
  ].join("\n"),
};

/** El pedido para que el modelo se escriba su nota antes de compactar. */
export function textoPedidoNota({ idioma } = {}) {
  return PEDIDOS[idiomaValido(idioma)];
}

/**
 * La nota que se devuelve tras compactar (`SessionStart` con `source: "compact"`), con encabezado de tiempo y recorte a `tope`
 * caracteres (12 000 por defecto) con aviso de recorte si se pasa.
 */
export function textoDevolucionNota({ idioma, nota, minutos = null, archivo = "", tope = TOPE_NOTA }) {
  const lang = idiomaValido(idioma);
  const cuerpo = String(nota ?? "").trim();
  const min = typeof minutos === "number" && Number.isFinite(minutos) ? Math.max(0, Math.floor(minutos)) : null;
  const encabezado =
    lang === "en"
      ? min !== null
        ? `Note you wrote to yourself before compacting; written ${min} min ago`
        : "Note you wrote to yourself before compacting"
      : min !== null
        ? `Nota que te escribiste antes de compactar; escrita hace ${min} min`
        : "Nota que te escribiste antes de compactar";
  const completo = `${encabezado}\n\n${cuerpo}`;
  if (completo.length <= tope) return completo;
  const aviso =
    lang === "en"
      ? `\n\n[note truncated to ${tope} characters (original: ${cuerpo.length})${archivo ? `; full note in ${archivo}` : ""}]`
      : `\n\n[nota recortada a ${tope} caracteres (original: ${cuerpo.length})${archivo ? `; completa en ${archivo}` : ""}]`;
  const libre = Math.max(0, tope - encabezado.length - 2 - aviso.length);
  const corte = cuerpo.slice(0, libre).trimEnd();
  return `${encabezado}\n\n${corte}${aviso}`.slice(0, tope);
}
