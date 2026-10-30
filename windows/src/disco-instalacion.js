"use strict";
// El disco del paso «Instalar Trama» (pasos-nativo.js), sin Electron: lo prueba tests/disco-instalacion.test.js con carpetas
// temporales y un `fs` que simula los bloqueos de Windows.
//
// Windows no deja borrar ni pisar un .exe que está corriendo, pero SÍ renombrarlo. Y el node.exe de %LOCALAPPDATA%\trama\node lo
// pueden estar corriendo programas que no son de Trama (servidores MCP que otra herramienta lanzó con `node` a secas). Por eso:
//   · si el node.exe instalado es el mismo que trae el instalador, no se copia;
//   · si hay que reemplazar algo que está en uso, se lo aparta (`<nombre>.viejo-<marca>`, en la misma carpeta) y se copia el nuevo;
//   · lo apartado se borra en la próxima instalación, cuando nadie lo use ya.
// Nunca se toca ningún proceso ajeno.

const nodefs = require("node:fs");
const path = require("node:path");

const SUFIJO_VIEJO = ".viejo-";
const ES_VIEJO = /\.viejo-[A-Za-z0-9]+$/;
const CHUNK = 1024 * 1024;

/** ¿Son iguales, byte a byte, estos dos archivos? Falso si alguno no existe o no se puede leer. */
function mismoArchivo(a, b, fs = nodefs) {
  let fa = null;
  let fb = null;
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size) return false;
    fa = fs.openSync(a, "r");
    fb = fs.openSync(b, "r");
    const ba = Buffer.alloc(CHUNK);
    const bb = Buffer.alloc(CHUNK);
    for (;;) {
      const na = fs.readSync(fa, ba, 0, CHUNK, null);
      const nb = fs.readSync(fb, bb, 0, CHUNK, null);
      if (na !== nb) return false;
      if (na === 0) return true;
      if (!ba.subarray(0, na).equals(bb.subarray(0, nb))) return false;
    }
  } catch {
    return false;
  } finally {
    for (const f of [fa, fb]) if (f !== null) try { fs.closeSync(f); } catch { /* nada */ }
  }
}

/**
 * Deja libre `destino` para copiar encima: borra lo que se puede y aparta (renombra) lo que está en uso. Devuelve las rutas de lo
 * apartado. Tira si ni siquiera se puede apartar algo.
 */
function apartarOcupados(destino, marca, fs = nodefs) {
  const apartados = [];
  const recorrer = (dir) => {
    let nombres;
    try {
      nombres = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    for (const n of nombres) {
      const r = path.join(dir, n.name);
      if (n.isDirectory()) {
        recorrer(r);
        try { fs.rmdirSync(r); } catch { /* con algo apartado adentro: queda */ }
        continue;
      }
      try {
        fs.unlinkSync(r);
      } catch {
        const aparte = `${r}${SUFIJO_VIEJO}${marca}`;
        fs.renameSync(r, aparte);
        apartados.push(aparte);
      }
    }
  };
  recorrer(destino);
  return apartados;
}

/** Copia la carpeta `de` en `a` encima de lo que haya (cada archivo se pisa). */
function copiarCarpeta(de, a, fs = nodefs) {
  fs.cpSync(de, a, { recursive: true, force: true });
}

/** Borra todo lo que una instalación anterior apartó bajo `dir` (`*.viejo-*`). Lo que sigue en uso se queda para la próxima. Devuelve cuántos borró. */
function limpiarViejos(dir, fs = nodefs) {
  let borrados = 0;
  const recorrer = (d) => {
    let nombres;
    try {
      nombres = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const n of nombres) {
      const r = path.join(d, n.name);
      if (n.isDirectory()) recorrer(r);
      else if (ES_VIEJO.test(n.name))
        try {
          fs.unlinkSync(r);
          borrados++;
        } catch { /* sigue corriendo: se borra otro día */ }
    }
  };
  recorrer(dir);
  return borrados;
}

module.exports = { mismoArchivo, apartarOcupados, copiarCarpeta, limpiarViejos, SUFIJO_VIEJO };
