"use strict";
// El disco del paso «Instalar Trama» (pasos-nativo.js), sin Electron: lo prueba tests/disco-instalacion.test.js con carpetas
// temporales y un `fs` que simula los bloqueos de Windows.
//
// La carpeta de Trama (%LOCALAPPDATA%\trama\app, node, bin) NO es sólo de Trama: otros programas escriben ahí (un servidor MCP que
// lanzó alguien con `node` a secas y cwd en app\ crea app\logs\*.log y los tiene abiertos). Por eso el instalador sólo toca lo que
// trae su payload:
//   · cada archivo del payload se copia encima del que haya; nada más se copia, renombra ni borra;
//   · un archivo propio bloqueado (un .exe corriendo, un archivo abierto) se reintenta, y si sigue bloqueado se aparta
//     (`<nombre>.viejo-<marca>`, en la misma carpeta; Windows deja renombrar un .exe en uso) y se copia el nuevo; si es igual al del
//     instalador, se lo deja;
//   · lo que una instalación anterior instaló y esta ya no trae se borra (para eso queda `.trama-instalado.json` en cada carpeta,
//     con la lista de lo instalado); sin esa lista (primera vez) no se borra nada;
//   · lo apartado antes se borra cuando ya nadie lo usa.
// Nunca se toca ningún proceso ajeno. Lo que no se pudo reemplazar vuelve en `sinReemplazar`, para avisarlo con claridad.

const nodefs = require("node:fs");
const path = require("node:path");

const SUFIJO_VIEJO = ".viejo-";
const VIEJO = /^(.+)\.viejo-[A-Za-z0-9]+$/;
const MANIFIESTO = ".trama-instalado.json";
const CHUNK = 1024 * 1024;
const BLOQUEOS = new Set(["EPERM", "EBUSY", "EACCES", "ETXTBSY", "EMFILE"]);

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

/** Una pausa corta y síncrona (el paso de instalar corre en el proceso principal, sin otra cosa que atender). */
function pausa(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Los archivos (no carpetas) bajo `dir`, con su ruta relativa y «/» de separador. */
function archivosDe(dir, fs = nodefs, rel = "") {
  const sale = [];
  for (const n of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${n.name}` : n.name;
    if (n.isDirectory()) sale.push(...archivosDe(dir, fs, r));
    else sale.push(r);
  }
  return sale;
}

function leerManifiesto(a, fs) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(a, MANIFIESTO), "utf8"));
    return Array.isArray(j?.archivos) ? j.archivos.filter((x) => typeof x === "string" && x && !x.includes("..")) : null;
  } catch {
    return null;
  }
}

/**
 * Copia el archivo `origen` a `destino`. Devuelve null si quedó, "apartado" si hubo que apartar el viejo, "igual" si el que estaba ya
 * era igual y estaba en uso, o el error si no se pudo.
 */
function copiarArchivo(origen, destino, marca, o) {
  const { fs, reintentos, esperar } = o;
  let e = null;
  for (let i = 0; i <= reintentos; i++) {
    try {
      fs.copyFileSync(origen, destino);
      return null;
    } catch (err) {
      e = err;
      if (!BLOQUEOS.has(err.code)) break;
      if (i < reintentos) esperar(150 * (i + 1));
    }
  }
  if (!BLOQUEOS.has(e.code)) return e;
  if (mismoArchivo(origen, destino, fs)) return "igual";
  const aparte = `${destino}${SUFIJO_VIEJO}${marca}`;
  try {
    fs.renameSync(destino, aparte);
  } catch {
    return e; // ni siquiera se deja apartar: lo tiene abierto alguien sin permitir renombrar
  }
  try {
    fs.copyFileSync(origen, destino);
    o.apartados.push(aparte);
    return "apartado";
  } catch (err) {
    try { fs.renameSync(aparte, destino); } catch { /* queda apartado: el próximo intento lo ve */ }
    return err;
  }
}

/**
 * Instala la carpeta del payload `de` en `a`: copia cada archivo suyo encima y nada más (ver arriba).
 * Devuelve {copiados, apartados: [ruta], sinReemplazar: [{ruta, motivo}], quitados}.
 */
function instalarCarpeta(de, a, { marca, fs = nodefs, reintentos = 2, esperar = pausa } = {}) {
  const nuevos = archivosDe(de, fs);
  const previos = leerManifiesto(a, fs);
  const o = { fs, reintentos, esperar, apartados: [] };
  const sinReemplazar = [];
  let copiados = 0;
  fs.mkdirSync(a, { recursive: true });
  for (const rel of nuevos) {
    const destino = path.join(a, ...rel.split("/"));
    let r;
    try {
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      r = copiarArchivo(path.join(de, ...rel.split("/")), destino, marca, o);
    } catch (e) {
      r = e;
    }
    if (r instanceof Error) sinReemplazar.push({ ruta: destino, motivo: r.code || r.message });
    else copiados++;
  }
  // Lo que instaló una versión anterior y ésta ya no trae.
  const conjunto = new Set(nuevos);
  let quitados = 0;
  const sobrantes = (previos || []).filter((r) => !conjunto.has(r));
  for (const rel of sobrantes) {
    const destino = path.join(a, ...rel.split("/"));
    try {
      fs.unlinkSync(destino);
      quitados++;
    } catch (e) {
      if (e.code === "ENOENT") continue;
      try { fs.renameSync(destino, `${destino}${SUFIJO_VIEJO}${marca}`); quitados++; } catch { /* en uso: queda, no estorba */ }
    }
    for (let d = path.dirname(destino); d !== path.resolve(a) && d.startsWith(path.resolve(a)); d = path.dirname(d))
      try { fs.rmdirSync(d); } catch { break; }
  }
  limpiarViejos(a, new Set([...nuevos, ...sobrantes]), fs);
  try {
    fs.writeFileSync(path.join(a, MANIFIESTO), JSON.stringify({ archivos: nuevos }));
  } catch { /* sin la lista, la próxima vez no se borra nada: nunca de más */ }
  return { copiados, apartados: o.apartados, sinReemplazar, quitados };
}

/** Borra lo que una instalación anterior apartó (`<archivo propio>.viejo-*`) y ya nadie usa. Un `.viejo-` ajeno no se toca. */
function limpiarViejos(a, propios, fs = nodefs) {
  const dirs = new Set([""]);
  for (const r of propios) {
    const i = r.lastIndexOf("/");
    if (i > 0) dirs.add(r.slice(0, i));
  }
  for (const d of dirs) {
    let nombres;
    try {
      nombres = fs.readdirSync(path.join(a, ...d.split("/").filter(Boolean)));
    } catch {
      continue;
    }
    for (const n of nombres) {
      const m = VIEJO.exec(n);
      if (!m || !propios.has(d ? `${d}/${m[1]}` : m[1])) continue;
      try { fs.unlinkSync(path.join(a, ...d.split("/").filter(Boolean), n)); } catch { /* sigue corriendo: se borra otro día */ }
    }
  }
}

module.exports = { mismoArchivo, instalarCarpeta, MANIFIESTO, SUFIJO_VIEJO };
