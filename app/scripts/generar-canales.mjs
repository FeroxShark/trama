// Escribe windows/src/canales.json desde la lista única de canales (electron/canales/contrato.ts). La carcasa de Windows
// no puede importar el contrato (su preload corre con sandbox y es JS plano), así que lleva esta copia versionada.
// Uso, desde app/: `node scripts/generar-canales.mjs` (escribe) o `--comprobar` (falla si el archivo quedó viejo).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AVISOS_VENTANA, CANALES, SOLO_VENTANA, SOLO_VENTANA_LOCAL } from "../electron/canales/contrato.ts";

export const DESTINO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "windows", "src", "canales.json");

/** El contenido que tiene que tener windows/src/canales.json. */
export function generar() {
  const lineas = CANALES.map((e) => `    ${JSON.stringify(e)}`).join(",\n");
  const lista = (xs) => `[${xs.map((c) => JSON.stringify(c)).join(", ")}]`;
  return [
    "{",
    '  "_": "Generado por app/scripts/generar-canales.mjs desde app/electron/canales/contrato.ts. No se edita a mano.",',
    `  "ventana": ${lista(SOLO_VENTANA_LOCAL)},`,
    `  "soloVentana": ${lista(SOLO_VENTANA)},`,
    `  "avisosVentana": ${lista(AVISOS_VENTANA)},`,
    '  "canales": [',
    lineas,
    "  ]",
    "}",
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const nuevo = generar();
  if (process.argv.includes("--comprobar")) {
    if (readFileSync(DESTINO, "utf8") !== nuevo) {
      console.error("windows/src/canales.json está desactualizado: corré `node scripts/generar-canales.mjs` desde app/");
      process.exit(1);
    }
  } else writeFileSync(DESTINO, nuevo);
}
