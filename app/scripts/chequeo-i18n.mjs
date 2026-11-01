#!/usr/bin/env node
// Chequeo de consistencia entre diccionarios i18n (es.ts y en.ts).
// Compara:
// 1. Claves que estan en uno y no en el otro (error critico, sale con 1).
// 2. Claves con distintas {variables} (error critico, sale con 1).
// 3. Valores de en.ts identicos a es.ts con palabras en castellano (probable sin traducir, advertencia).
// 4. Valores de es.ts con ingles obvio (advertencia).
// Sin dependencias externas.

import { es } from "../src/i18n/es.ts";
import { en } from "../src/i18n/en.ts";

const PALABRAS_INGLES = new Set(["the", "and", "week", "back", "failed", "running"]);

const PALABRAS_CASTELLANO = new Set([
  "de", "del", "la", "las", "el", "los", "para", "por", "con", "sin", "una", "unos", "unas",
  "que", "como", "este", "esta", "estos", "estas", "pero", "hace", "ayer",
  "guardar", "cerrar", "abrir", "editar", "borrar", "cambiar", "cancelar", "copiar", "pegar",
  "fallo", "falló", "espera", "esperan", "parar", "trabajando", "termino", "terminó", "frenado",
  "trabado", "necesita", "volver", "atras", "atrás", "siguiente", "anterior", "nuevo", "nueva",
  "todos", "todas", "cada", "archivo", "carpeta", "ajustes", "cuenta", "hilo", "tarea", "rama",
  "ayuda", "mensaje", "mensajes"
]);

const TIENE_ACENTO_ES = new RegExp("[áéíóúüñ¿¡]", "i");
const RE_VARS = new RegExp("\\{(\\w+)\\}", "g");
const RE_VARS_BORRAR = new RegExp("\\{[^}]*\\}", "g");
const RE_PALABRAS = new RegExp("[a-záéíóúüñ]+", "gi");
const RE_ALFANUM = new RegExp("[a-z0-9]+", "gi");

function extraerVariables(texto) {
  if (typeof texto !== "string") return [];
  const vars = [];
  let m;
  const regex = new RegExp(RE_VARS.source, "g");
  while ((m = regex.exec(texto)) !== null) {
    vars.push(m[1]);
  }
  return vars.sort();
}

const keysEn = Object.keys(en);
const keysEs = Object.keys(es);
const setEn = new Set(keysEn);
const setEs = new Set(keysEs);

const clavesFaltanEnEs = [];
const clavesFaltanEnEn = [];
const clavesVarsDistintas = [];
const enConCastellano = [];
const esConIngles = [];

for (const k of keysEn) {
  if (!setEs.has(k)) {
    clavesFaltanEnEs.push(k);
  }
}

for (const k of keysEs) {
  if (!setEn.has(k)) {
    clavesFaltanEnEn.push(k);
  }
}

for (const k of keysEn) {
  if (setEs.has(k)) {
    const varsEs = extraerVariables(es[k]);
    const varsEn = extraerVariables(en[k]);
    if (varsEs.join(",") !== varsEn.join(",")) {
      clavesVarsDistintas.push({
        clave: k,
        es: varsEs,
        en: varsEn,
        textoEs: es[k],
        textoEn: en[k]
      });
    }

    if (en[k] === es[k]) {
      const limpio = en[k].replace(RE_VARS_BORRAR, "");
      const tieneAcento = TIENE_ACENTO_ES.test(limpio);
      const palabras = limpio.toLowerCase().match(RE_PALABRAS) || [];
      const matchPalabra = palabras.find((p) => PALABRAS_CASTELLANO.has(p));
      if (tieneAcento || matchPalabra) {
        enConCastellano.push({
          clave: k,
          texto: en[k],
          motivo: tieneAcento ? "contiene caracteres en español" : ("palabra \"" + matchPalabra + "\"")
        });
      }
    }
  }
}

for (const k of keysEs) {
  const limpio = es[k].replace(RE_VARS_BORRAR, "");
  const palabras = limpio.toLowerCase().match(RE_ALFANUM) || [];
  const matchIngles = palabras.find((p) => PALABRAS_INGLES.has(p));
  if (matchIngles) {
    esConIngles.push({
      clave: k,
      texto: es[k],
      palabra: matchIngles
    });
  }
}

let hayCriticos = false;

if (clavesFaltanEnEs.length > 0) {
  hayCriticos = true;
  console.log("\n❌ Claves en en.ts que faltan en es.ts (" + clavesFaltanEnEs.length + "):");
  for (const k of clavesFaltanEnEs) {
    console.log("  - " + k);
  }
}

if (clavesFaltanEnEn.length > 0) {
  hayCriticos = true;
  console.log("\n❌ Claves en es.ts que faltan en en.ts (" + clavesFaltanEnEn.length + "):");
  for (const k of clavesFaltanEnEn) {
    console.log("  - " + k);
  }
}

if (clavesVarsDistintas.length > 0) {
  hayCriticos = true;
  console.log("\n❌ Claves con distintas {variables} (" + clavesVarsDistintas.length + "):");
  for (const item of clavesVarsDistintas) {
    console.log("  - " + item.clave + ":");
    console.log("      es: {" + item.es.join(", ") + "} -> \"" + item.textoEs + "\"");
    console.log("      en: {" + item.en.join(", ") + "} -> \"" + item.textoEn + "\"");
  }
}

if (enConCastellano.length > 0) {
  console.log("\n⚠️  Valores de en.ts idénticos a es.ts con probable castellano (" + enConCastellano.length + "):");
  for (const item of enConCastellano) {
    console.log("  - " + item.clave + ": \"" + item.texto + "\" (" + item.motivo + ")");
  }
}

if (esConIngles.length > 0) {
  console.log("\n⚠️  Valores de es.ts con inglés obvio (" + esConIngles.length + "):");
  for (const item of esConIngles) {
    console.log("  - " + item.clave + ": \"" + item.texto + "\" (palabra: \"" + item.palabra + "\")");
  }
}

const totalRevisadas = keysEn.length;
const totalCriticos = clavesFaltanEnEs.length + clavesFaltanEnEn.length + clavesVarsDistintas.length;
const totalAdvertencias = enConCastellano.length + esConIngles.length;

if (totalCriticos === 0 && totalAdvertencias === 0) {
  console.log("\n✓ i18n: " + totalRevisadas + " claves revisadas. Todo en orden (0 errores críticos, 0 advertencias).");
} else if (totalCriticos === 0) {
  console.log("\n✓ i18n: " + totalRevisadas + " claves revisadas (0 errores críticos, " + totalAdvertencias + " advertencia(s)).");
} else {
  console.log("\n❌ i18n: " + totalCriticos + " error(es) crítico(s) encontrado(s) en " + totalRevisadas + " claves.");
}

if (hayCriticos) {
  process.exit(1);
}
