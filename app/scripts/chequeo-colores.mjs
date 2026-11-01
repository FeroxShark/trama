#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");
const REPO_ROOT = path.resolve(APP_DIR, "..");
const SRC_DIR = path.join(APP_DIR, "src");

const S = String.fromCharCode(47);
const STAR = String.fromCharCode(42);
const BS = String.fromCharCode(92);
const Q1 = String.fromCharCode(39);
const Q2 = String.fromCharCode(34);
const BT = String.fromCharCode(96);

const RE_COLOR = new RegExp("(?<![a-zA-Z0-9_$])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\\b|\\b(?:rgba?|hsla?)\\(\\s*[\\d.][^)]*\\)", "gi");

function listarArchivos(dir) {
  const archivos = [];
  try {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        archivos.push(...listarArchivos(ruta));
      } else if (ent.isFile()) {
        if (ent.name.endsWith(".css") || ent.name.endsWith(".tsx")) {
          archivos.push(ruta);
        }
      }
    }
  } catch {}
  return archivos;
}

function esLineaJustificada(numLinea, lineas) {
  const actual = lineas[numLinea - 1] || "";
  if (actual.includes("color-justificado:")) return true;
  if (numLinea > 1) {
    const anterior = lineas[numLinea - 2] || "";
    if (anterior.includes("color-justificado:")) return true;
  }
  return false;
}
function analizarCss(contenido, rutaRel) {
  const lineas = contenido.split("\n");
  const hallazgos = [];
  const reBloque = new RegExp("\\" + S + "\\" + STAR + "[\\s\\S]*?\\" + STAR + "\\" + S, "g");
  const reNoSalto = new RegExp("[^\\n]", "g");
  const limpio = contenido.replace(reBloque, (m) => m.replace(reNoSalto, " "));
  const lineasLimpias = limpio.split("\n");

  for (let i = 0; i < lineasLimpias.length; i++) {
    const numLinea = i + 1;
    if (esLineaJustificada(numLinea, lineas)) continue;

    const texto = lineasLimpias[i];
    const regex = new RegExp(RE_COLOR.source, RE_COLOR.flags);
    let match;
    while ((match = regex.exec(texto)) !== null) {
      hallazgos.push({
        archivo: rutaRel,
        linea: numLinea,
        color: match[0],
      });
    }
  }
  return hallazgos;
}
function analizarTsx(contenido, rutaRel) {
  const lineas = contenido.split("\n");
  const hallazgos = [];
  const reInicio = new RegExp("\\bstyle\\s*=\\s*\\{\\s*\\{", "g");
  let match;
  while ((match = reInicio.exec(contenido)) !== null) {
    const segundoBrace = match.index + match[0].lastIndexOf("{");
    let depth = 2;
    let i = segundoBrace + 1;
    let inString = null;
    let inBlockComment = false;
    let inLineComment = false;
    let sliceStart = i;
    const regiones = [];

    while (i < contenido.length && depth > 0) {
      const ch = contenido[i];
      const next = contenido[i + 1];

      if (inBlockComment) {
        if (ch === STAR && next === S) {
          inBlockComment = false;
          i += 2;
          sliceStart = i;
          continue;
        }
        i++;
        continue;
      }

      if (inLineComment) {
        if (ch === "\n") {
          inLineComment = false;
          sliceStart = i;
        }
        i++;
        continue;
      }

      if (inString) {
        if (ch === BS) {
          i += 2;
          continue;
        }
        if (ch === inString) {
          inString = null;
          regiones.push({ texto: contenido.slice(sliceStart, i + 1), offset: sliceStart });
          i++;
          sliceStart = i;
          continue;
        }
        i++;
        continue;
      }

      if (ch === S && next === STAR) {
        if (i > sliceStart) {
          regiones.push({ texto: contenido.slice(sliceStart, i), offset: sliceStart });
        }
        inBlockComment = true;
        i += 2;
        continue;
      }

      if (ch === S && next === S) {
        if (i > sliceStart) {
          regiones.push({ texto: contenido.slice(sliceStart, i), offset: sliceStart });
        }
        inLineComment = true;
        i += 2;
        continue;
      }

      if (ch === Q2 || ch === Q1 || ch === BT) {
        if (i > sliceStart) {
          regiones.push({ texto: contenido.slice(sliceStart, i), offset: sliceStart });
        }
        inString = ch;
        sliceStart = i;
        i++;
        continue;
      }

      if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          if (i > sliceStart) {
            regiones.push({ texto: contenido.slice(sliceStart, i), offset: sliceStart });
          }
          break;
        }
      }
      i++;
    }

    for (const reg of regiones) {
      const regex = new RegExp(RE_COLOR.source, RE_COLOR.flags);
      let cm;
      while ((cm = regex.exec(reg.texto)) !== null) {
        const offsetEnArchivo = reg.offset + cm.index;
        const numLinea = contenido.slice(0, offsetEnArchivo).split("\n").length;
        if (!esLineaJustificada(numLinea, lineas)) {
          hallazgos.push({
            archivo: rutaRel,
            linea: numLinea,
            color: cm[0],
          });
        }
      }
    }
  }
  return hallazgos;
}
function main() {
  const archivos = listarArchivos(SRC_DIR).sort();
  const todosHallazgos = [];
  const conteoPorArchivo = new Map();
  const rutaTokens = ["app", "src", "tokens.css"].join(S);
  const rutaTemas = ["app", "src", "temas-colores.css"].join(S);

  for (const arch of archivos) {
    const rel = path.relative(REPO_ROOT, arch).split(path.sep).join(S);
    if (rel === rutaTokens || rel === rutaTemas) {
      continue;
    }

    const contenido = readFileSync(arch, "utf8");
    let hallazgosArchivo = [];
    if (rel.endsWith(".css")) {
      hallazgosArchivo = analizarCss(contenido, rel);
    } else if (rel.endsWith(".tsx")) {
      hallazgosArchivo = analizarTsx(contenido, rel);
    }

    if (hallazgosArchivo.length > 0) {
      todosHallazgos.push(...hallazgosArchivo);
      conteoPorArchivo.set(rel, hallazgosArchivo.length);
    }
  }

  for (const h of todosHallazgos) {
    console.log(h.archivo + ":" + h.linea + ":" + h.color);
  }

  const ordenados = [...conteoPorArchivo.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  if (ordenados.length > 0) {
    console.log("\nResumen por archivo:");
    for (const [arch, cant] of ordenados) {
      console.log(arch + ": " + cant);
    }
    console.log("\nTotal: " + todosHallazgos.length + " colores literales en " + ordenados.length + " archivos");
    process.exit(1);
  } else {
    console.log("\nNo se encontraron colores literales.");
    process.exit(0);
  }
}

main();
