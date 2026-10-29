"use strict";
// La limpieza de lo que Trama dejó fuera de su carpeta, según manifiesto.js. Sin Electron: el disco de Windows y el registro
// entran por `deps`, así que los tests la corren con falsos.
//
// REGLA DURA (la repiten los tests):
//  · Nunca se borran datos de la persona (proyectos, tablero, sesiones, sesiones iniciadas de Claude/Gemini,
//    configuración). Las entradas «nunca» ni se miran; las «datos» (lo propio de la app de Windows) sólo las
//    quita el desinstalador y después de preguntar.
//  · Cada cosa se comprueba otra vez al quitarla: si ya no es de Trama (un archivo en vez de una carpeta nuestra),
//    queda «ajeno» y no se toca.

const { ENTRADAS, muerta } = require("./manifiesto");

class ErrorLimpieza extends Error {
  constructor(mensaje, detalle = "") {
    super(mensaje);
    this.name = "ErrorLimpieza";
    this.detalle = detalle;
  }
}

function crearLimpieza(deps) {
  const {
    win, // {expandir(ruta), tipo(ruta) → "carpeta"|"archivo"|null, borrar(ruta), registro: {hay(clave, valor), quitar(clave, valor)}}
    estado: store, // {cargar(), guardar(obj)}
    version, // la versión de la app que corre
    entradas = ENTRADAS,
    ahora = () => new Date().toISOString(),
  } = deps;

  const guardado = () => ({ ...(store.cargar() || {}) });
  const guardar = (c) => store.guardar({ ...guardado(), ...c });

  // ---------- el estado de cada entrada ----------
  const rutaWin = (e) => (e.tipo === "registro" ? e.ruta : win.expandir(e.ruta));
  function sanaWin(e, ruta) {
    // Una variable sin expandir o una ruta corta: no se borra nada.
    return !/%/.test(ruta) && ruta.length > 12 && /[\\/]/.test(ruta) && !/^[A-Za-z]:[\\/]?$/.test(ruta);
  }
  async function estadoWin(e) {
    if (e.tipo === "registro") {
      const [clave, valor] = e.ruta.split("|");
      return (await win.registro.hay(clave, valor)) ? "presente" : "ausente";
    }
    if (e.tipo === "path") {
      // Una carpeta en el PATH del usuario (Trama nativo): `ruta` es la carpeta que se sumó.
      if (!win.path) return "ausente";
      return (await win.path.tiene(rutaWin(e))) ? "presente" : "ausente";
    }
    if (e.tipo === "carpeta") {
      const ruta = rutaWin(e);
      if (!sanaWin(e, ruta)) return "ajeno";
      const t = await win.tipo(ruta);
      return t === "carpeta" ? "presente" : t ? "ajeno" : "ausente";
    }
    return "ajeno";
  }
  async function quitarWin(e) {
    const antes = await estadoWin(e);
    if (antes !== "presente") return antes;
    try {
      if (e.tipo === "registro") {
        const [clave, valor] = e.ruta.split("|");
        await win.registro.quitar(clave, valor);
      } else if (e.tipo === "path") await win.path.quitar(rutaWin(e));
      else await win.borrar(rutaWin(e));
      return "quitado";
    } catch {
      return "error";
    }
  }

  // ---------- el plan ----------
  // modo "restos": sólo lo que la versión actual ya no usa. modo "desinstalar": todo lo de Trama.
  async function planificar({ modo = "restos" } = {}) {
    if (modo !== "restos" && modo !== "desinstalar") throw new ErrorLimpieza(`Modo desconocido: ${modo}`);
    const candidatas = entradas.filter((e) => e.tipo !== "gestionado" && (modo === "desinstalar" || muerta(e, version)));
    const estados = {};
    for (const e of candidatas.filter((c) => ["seguro", "datos"].includes(c.quitar))) estados[e.id] = await estadoWin(e);

    const items = [];
    for (const e of candidatas) {
      if (e.quitar === "nunca") {
        if (modo === "desinstalar" && e.tipo === "compartido") items.push({ id: e.id, ambito: e.ambito, tipo: e.tipo, ruta: e.ruta, que: e.que, accion: "queda" });
        continue;
      }
      const est = estados[e.id];
      if (est === "ausente") continue;
      const accion = est === "ajeno" ? "ajeno" : e.quitar === "datos" ? "datos" : "quitar";
      items.push({ id: e.id, ambito: e.ambito, tipo: e.tipo, ruta: e.ruta, que: e.que, grupo: e.grupo, accion, auto: !!e.auto && e.quitar === "seguro" });
    }
    return { modo, version, items };
  }

  // Quita lo pedido (`ids`) y sólo si el plan de ahora lo permite. `datos`: ids de datos propios que la persona
  // aceptó borrar (sólo en el modo desinstalar).
  async function ejecutar({ modo = "restos", ids = [], datos = [] } = {}) {
    const plan = await planificar({ modo });
    const resultados = [];
    const pedido = new Set(ids);
    const aQuitar = plan.items.filter((i) => i.accion === "quitar" && pedido.has(i.id));
    const aDatos = modo === "desinstalar" ? plan.items.filter((i) => i.accion === "datos" && datos.includes(i.id)) : [];
    const hechos = [...aQuitar, ...aDatos];
    for (const id of [...pedido, ...datos]) {
      if (hechos.some((i) => i.id === id)) continue;
      const it = plan.items.find((i) => i.id === id);
      resultados.push({ id, estado: it?.accion === "ajeno" ? "ajeno" : "omitido" });
    }
    for (const i of hechos) resultados.push({ id: i.id, estado: await quitarWin(entradas.find((e) => e.id === i.id)) });
    const quitados = resultados.filter((x) => x.estado === "quitado").map((x) => x.id);
    if (quitados.length) guardar({ limpieza: { version, modo, fecha: ahora(), quitados } });
    return { resultados };
  }

  // Después de actualizar: quita sola sólo lo que la versión nueva dejó de usar Y está marcado `auto`.
  // Corre una vez por versión. Nunca toca datos ni lo que pide confirmar.
  async function despuesDeActualizar() {
    if (guardado().limpiezaAuto === version) return { hecho: false, resultados: [] };
    const plan = await planificar({ modo: "restos" });
    const ids = plan.items.filter((i) => i.accion === "quitar" && i.auto).map((i) => i.id);
    const { resultados } = ids.length ? await ejecutar({ modo: "restos", ids }) : { resultados: [] };
    guardar({ limpiezaAuto: version });
    return { hecho: true, resultados, pendientes: plan.items.filter((i) => i.accion === "quitar" && !i.auto).length };
  }

  return { planificar, ejecutar, despuesDeActualizar };
}

module.exports = { crearLimpieza, ErrorLimpieza };
