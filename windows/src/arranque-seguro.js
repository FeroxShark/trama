"use strict";
// Actualizar seguro: la cuenta de si la versión que acaba de instalarse arranca bien, y cuándo hay que volver a la anterior.
// Es la misma regla y el mismo archivo que app/electron/arranque-seguro.ts (la carcasa es JS plano y no puede importarlo): si cambia
// una, cambia la otra. Sin Electron ni red: lo prueba tests/arranque-seguro.test.js.
//
// El estado vive en un JSON chico (`arranque.json`, en la carpeta de datos de la carcasa):
//   actual      la versión de la última corrida
//   arrancando  ms en que arrancó y todavía no llegó a "ventana lista" (null: ya llegó, o salió a propósito)
//   inicio      ms del último arranque, haya terminado o no (para el registro: cuánto vivió el proceso anterior)
//   fallas      arranques seguidos de `actual` que se cerraron solos sin llegar
//   buena       `actual` ya llegó alguna vez a ventana lista (una versión buena no se deshace por un cierre suelto)
//   respaldo    copia de la versión que corre (o corría cuando se instaló la siguiente)
//   anterior    copia de la que había antes de `actual`: la que "Volver a la versión anterior" restaura
//   rechazada   la versión que se desechó: no se vuelve a instalar sola
//   aviso       lo que la ventana cuenta al abrir tras volver ({de, a, motivo}); se gasta al leerlo
// Reglas: una versión nueva no probada (`buena` falso) vuelve sola a `anterior` si no llega a ventana lista en `ARRANQUE_MAX_MS`
// ("lento") o si se cierra sola `FALLAS_MAX` veces seguidas ("cierres"). Sin copia de la anterior no hay a dónde volver.
// Un cierre desde afuera no es «se cerró sola»: una señal (Ctrl+C, la consola que se cierra) sale a propósito.
// A diferencia de Linux, el archivo lo escribe sólo la carcasa (el motor no lo toca), así que no lleva candado.

const fs = require("node:fs");
const path = require("node:path");

const ARRANQUE_MAX_MS = Number(process.env.TRAMA_ARRANQUE_MAX_MS) > 0 ? Number(process.env.TRAMA_ARRANQUE_MAX_MS) : 60_000;
const FALLAS_MAX = 2;
const TIPOS = ["appimage", "carpeta", "instalador"];
const MOTIVOS = ["lento", "cierres", "manual"];

const estadoVacio = () => ({ actual: null, arrancando: null, inicio: null, fallas: 0, buena: false, respaldo: null, anterior: null, rechazada: null, aviso: null });

const texto = (x) => (typeof x === "string" && x ? x : null);
function copiaValida(x) {
  if (!x || typeof x !== "object") return null;
  const version = texto(x.version);
  const ruta = texto(x.ruta);
  if (!version || !ruta || !path.isAbsolute(ruta) || ruta.includes("\0")) return null;
  if (!TIPOS.includes(x.tipo)) return null;
  return { version, tipo: x.tipo, ruta, cuando: typeof x.cuando === "number" ? x.cuando : 0 };
}
function avisoValido(x) {
  if (!x || typeof x !== "object") return null;
  const de = texto(x.de);
  const a = texto(x.a);
  return de && a && MOTIVOS.includes(x.motivo) ? { de, a, motivo: x.motivo } : null;
}

/** Lo que dice un JSON leído del disco, con cada campo validado (un archivo roto o a medias es el estado vacío). */
function estadoDesde(o) {
  if (!o || typeof o !== "object") return estadoVacio();
  return {
    actual: texto(o.actual),
    arrancando: typeof o.arrancando === "number" ? o.arrancando : null,
    inicio: typeof o.inicio === "number" ? o.inicio : null,
    fallas: typeof o.fallas === "number" && o.fallas > 0 ? Math.floor(o.fallas) : 0,
    buena: o.buena === true,
    respaldo: copiaValida(o.respaldo),
    anterior: copiaValida(o.anterior),
    rechazada: texto(o.rechazada),
    aviso: avisoValido(o.aviso),
  };
}

/**
 * Arranca `version`. Una versión distinta de la última es nueva: su `anterior` es el respaldo de la que corría (si lo hay) y empieza
 * a prueba. La misma que dejó un arranque sin terminar suma una falla, salvo que se esté instalando (`o.instalando`: al anterior lo
 * cerró el instalador, no se cerró solo). Si ya no está a prueba (o no hay a dónde volver) sigue.
 */
function alArrancar(e, version, ahora, o = {}) {
  let s;
  if (e.actual !== version) {
    const anterior = e.respaldo && e.respaldo.version !== version && e.respaldo.version === e.actual ? e.respaldo : null;
    s = { ...e, actual: version, arrancando: ahora, inicio: ahora, fallas: 0, buena: false, anterior, respaldo: null };
  } else {
    s = { ...e, fallas: e.arrancando !== null && !o.instalando ? e.fallas + 1 : e.fallas, arrancando: ahora, inicio: ahora };
  }
  const a = s.anterior;
  const desechar = !s.buena && s.fallas >= FALLAS_MAX && a !== null && a.version !== version;
  return { estado: s, decision: desechar ? { accion: "volver", a, motivo: "cierres" } : { accion: "seguir" } };
}

/** La ventana quedó lista: esta versión anda. */
const alVentanaLista = (e) => ({ ...e, arrancando: null, fallas: 0, buena: true });

/**
 * Salió a propósito (Salir de la bandeja, una señal) antes de terminar de arrancar: no cuenta como cierre solo. Con `desde` (el arranque
 * de este proceso) sólo limpia si el arranque pendiente es el suyo.
 */
const alSalirAProposito = (e, desde) => (e.arrancando === null || (desde !== undefined && e.arrancando !== desde) ? e : { ...e, arrancando: null });

/** Una línea para el registro: la versión, la cuenta y cuánto hace que arrancó el último proceso. */
function resumen(e, ahora) {
  const hace = e.inicio === null ? "sin arranque anotado" : `arrancó hace ${Math.max(0, Math.round((ahora - e.inicio) / 1000))} s${e.arrancando !== null ? " sin llegar a ventana lista" : ""}`;
  return `${e.actual ?? "sin versión"}, fallas ${e.fallas}, buena ${e.buena ? "sí" : "no"}, ${hace}`;
}

/** Pasó `ARRANQUE_MAX_MS` sin ventana lista: una versión a prueba con anterior guardada vuelve a ella. */
function alTiempoAgotado(e) {
  const a = e.anterior;
  return e.arrancando !== null && !e.buena && a !== null && a.version !== e.actual ? { accion: "volver", a, motivo: "lento" } : { accion: "seguir" };
}

/** Se volvió a `a`: corre esa, ya probada; la desechada no se reinstala sola y la ventana lo cuenta al abrir. */
function alVolver(e, a, motivo) {
  const de = e.actual ?? "";
  return { ...e, actual: a.version, arrancando: null, fallas: 0, buena: true, respaldo: null, anterior: null, rechazada: de && de !== a.version ? de : e.rechazada, aviso: de ? { de, a: a.version, motivo } : null };
}

/** Se guardó una copia de la versión que corre (antes de instalar la siguiente): queda de respaldo. */
const conRespaldo = (e, r) => ({ ...e, respaldo: r });
const sinAviso = (e) => (e.aviso ? { ...e, aviso: null } : e);

/** El archivo de estado: lectura y escritura síncronas (es chico y se toca pocas veces); nunca tira al leer. */
function crearAlmacen(archivo) {
  const leer = () => {
    try {
      return estadoDesde(JSON.parse(fs.readFileSync(archivo, "utf8")));
    } catch {
      return estadoVacio();
    }
  };
  const escribir = (e) => {
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    const tmp = `${archivo}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...e }));
    fs.renameSync(tmp, archivo);
  };
  /** Lee, aplica el cambio y escribe; devuelve lo que quedó. Si no se puede escribir, devuelve el cambio igual (el estado es de ayuda, no frena nada). */
  const cambiar = (f) => {
    const n = f(leer());
    try {
      escribir(n);
    } catch {}
    return n;
  };
  // Sin candado (un solo escritor): `cambiarYa` es el mismo, con el nombre de Linux (el de salir desde una señal).
  return { leer, cambiar, cambiarYa: cambiar };
}

module.exports = { ARRANQUE_MAX_MS, FALLAS_MAX, estadoVacio, estadoDesde, alArrancar, alVentanaLista, alSalirAProposito, alTiempoAgotado, alVolver, conRespaldo, sinAviso, resumen, crearAlmacen };
