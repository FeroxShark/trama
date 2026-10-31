#!/usr/bin/env node
// Chequeo de esperas literales en tests (#1793).
// Recorre app/tests/**/*.ts y windows/tests/**/*.js y lista cada setTimeout/sleep
// con número literal >= 50 ms (archivo:línea), salvo los que tengan en la misma
// línea o la anterior el comentario "// espera-justificada: <motivo>".
// Sale con código 1 si hay alguno.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const S = String.fromCharCode(47);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.dirname(APP);

function listarArchivos(dir, ext) {
  const res = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        res.push(...listarArchivos(full, ext));
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        res.push(full);
      }
    }
  } catch {}
  return res;
}

function buscarEsperas(contenido) {
  const lineas = contenido.split("\n");
  const hallazgos = [];

  const regex = new RegExp("\\b(setTimeout|sleep)\\s*\\(", "g");
  let m;
  while ((m = regex.exec(contenido)) !== null) {
    const fn = m[1];
    const inicio = m.index;
    const parenIdx = inicio + m[0].lastIndexOf("(");

    const posUltimoSalto = contenido.lastIndexOf("\n", inicio);
    const textoAntesEnLinea = contenido.slice(posUltimoSalto + 1, inicio);
    if (new RegExp("^\\s*\\" + S + "\\" + S).test(textoAntesEnLinea)) {
      continue;
    }

    let depthParen = 1;
    let depthBrace = 0;
    let depthBracket = 0;
    let inString = null;
    let inComment = null;
    let currentArg = "";
    const args = [];
    let endIdx = -1;

    for (let i = parenIdx + 1; i < contenido.length; i++) {
      const ch = contenido[i];
      const next = contenido[i + 1];

      if (inString) {
        if (ch === "\\" && inString !== "`") {
          currentArg += ch + (next || "");
          i++;
          continue;
        }
        if (ch === inString) {
          inString = null;
        }
        currentArg += ch;
        continue;
      }

      if (inComment === S + S) {
        if (ch === "\n") inComment = null;
        continue;
      }
      if (inComment === S + "*") {
        if (ch === "*" && next === S) {
          inComment = null;
          i++;
        }
        continue;
      }

      if (ch === S && next === S) {
        inComment = S + S;
        i++;
        continue;
      }
      if (ch === S && next === "*") {
        inComment = S + "*";
        i++;
        continue;
      }

      if (ch === "\"" || ch === "\x27" || ch === "`") {
        inString = ch;
        currentArg += ch;
        continue;
      }

      if (ch === "(") {
        depthParen++;
        currentArg += ch;
      } else if (ch === ")") {
        depthParen--;
        if (depthParen === 0) {
          args.push(currentArg.trim());
          endIdx = i;
          break;
        } else {
          currentArg += ch;
        }
      } else if (ch === "{") {
        depthBrace++;
        currentArg += ch;
      } else if (ch === "}") {
        depthBrace--;
        currentArg += ch;
      } else if (ch === "[") {
        depthBracket++;
        currentArg += ch;
      } else if (ch === "]") {
        depthBracket--;
        currentArg += ch;
      } else if (ch === "," && depthParen === 1 && depthBrace === 0 && depthBracket === 0) {
        args.push(currentArg.trim());
        currentArg = "";
      } else {
        currentArg += ch;
      }
    }

    if (endIdx === -1) continue;

    let delayArg = null;
    if (fn === "sleep") {
      delayArg = args[0];
    } else if (fn === "setTimeout") {
      if (args.length === 1) {
        delayArg = args[0];
      } else if (args.length >= 2) {
        delayArg = args[1];
      }
    }

    if (!delayArg) continue;

    const matchNum = delayArg.match(/^(\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)$/i);
    if (!matchNum) continue;

    const ms = Number(matchNum[1].replace(/_/g, ""));
    if (isNaN(ms) || ms < 50) continue;

    const numLinea = contenido.slice(0, inicio).split("\n").length;
    const numLineaFin = contenido.slice(0, endIdx).split("\n").length;

    const regexJust = new RegExp(S + S + "\\s*espera-justificada:");
    const lineasRevisar = [
      lineas[numLinea - 1] || "",
      numLinea > 1 ? lineas[numLinea - 2] : "",
      lineas[numLineaFin - 1] || "",
      numLineaFin > 1 ? lineas[numLineaFin - 2] : "",
    ];
    const justificada = lineasRevisar.some((l) => regexJust.test(l));
    if (!justificada) {
      hallazgos.push(numLinea);
    }
  }

  return [...new Set(hallazgos)].sort((a, b) => a - b);
}

const archivos = [
  ...listarArchivos(path.join(RAIZ, "app", "tests"), ".ts"),
  ...listarArchivos(path.join(RAIZ, "windows", "tests"), ".js"),
].sort();

const salidas = [];
for (const arch of archivos) {
  const contenido = readFileSync(arch, "utf8");
  const lineas = buscarEsperas(contenido);
  const rel = path.relative(RAIZ, arch).replace(new RegExp("\\\\", "g"), S);
  for (const l of lineas) {
    salidas.push(rel + ":" + l);
  }
}

for (const item of salidas) {
  console.log(item);
}

if (salidas.length > 0) {
  process.exit(1);
}
