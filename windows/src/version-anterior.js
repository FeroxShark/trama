"use strict";
// Actualizar seguro en Windows: guardar la carpeta de la Trama instalada antes de que el instalador la pise, y volver a ella (sola, si
// la nueva no arranca bien, o con el botón "Volver a la versión anterior" de Ajustes > General). Las reglas están en arranque-seguro.js;
// esto es el disco y el reinicio. Sin Electron (lo de Electron entra por `d`): lo prueba tests/version-anterior.test.js.
//
// La copia es la carpeta de la instalación (la de Trama.exe: el .exe, resources\ con el motor nativo, etc.) en
// %LOCALAPPDATA%\trama\anterior\Trama-<versión>. Se hace cuando el actualizador termina de bajar la nueva y antes de instalarla (la
// instala electron-updater al salir o con «Reiniciar para actualizar»). Volver no se puede hacer desde adentro: el .exe que corre
// tiene sus archivos abiertos. Un guion de cmd, suelto del proceso, espera a que Trama salga, pone la copia con robocopy /MIR y
// abre Trama otra vez. Tus datos (%APPDATA%\Trama-nativo, el motor en %LOCALAPPDATA%\trama, tus cuentas) no están en esa carpeta y no se tocan.
// Nada de bash ni WSL: cmd.exe, robocopy y powershell vienen con Windows.

const fsp = require("node:fs/promises");
const path = require("node:path");
const { alArrancar, alSalirAProposito, alTiempoAgotado, alVentanaLista, alVolver, ARRANQUE_MAX_MS, conRespaldo, sinAviso } = require("./arranque-seguro");

/** La instalación de este proceso: la carpeta de Trama.exe. Sólo existe empaquetada (en desarrollo no hay qué guardar). */
function instalacionDe({ empaquetada, execPath }) {
  if (!empaquetada || !execPath || !path.isAbsolute(execPath)) return null;
  return { tipo: "carpeta", dir: path.dirname(execPath), exe: path.basename(execPath) };
}

/** ¿La copia sigue entera en el disco? (el .exe y resources\) */
async function copiaExiste(c, exe) {
  try {
    return (await fsp.stat(path.join(c.ruta, exe))).isFile() && (await fsp.stat(path.join(c.ruta, "resources"))).isDirectory();
  } catch {
    return false;
  }
}

/** Copia la instalación a `base`, atómicamente (se arma aparte y se renombra). */
async function guardarCopia(inst, version, base, ahora) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`versión inválida: ${version}`);
  await fsp.mkdir(base, { recursive: true });
  const destino = path.join(base, `Trama-${version}`);
  const tmp = `${destino}.tmp`;
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.cp(inst.dir, tmp, { recursive: true });
  await fsp.rm(destino, { recursive: true, force: true });
  await fsp.rename(tmp, destino);
  return { version, tipo: "carpeta", ruta: destino, cuando: ahora };
}

/** Borra de `base` lo que ninguna copia viva usa (queda a lo sumo la anterior y el respaldo). */
async function podar(base, vivas) {
  const quedan = new Set(vivas.filter(Boolean).map((c) => path.resolve(c.ruta)));
  let nombres = [];
  try {
    nombres = await fsp.readdir(base);
  } catch {
    return;
  }
  for (const n of nombres) if (!quedan.has(path.resolve(base, n))) await fsp.rm(path.join(base, n), { recursive: true, force: true }).catch(() => {});
}

// Las rutas y el nombre del .exe van dentro de un guion de cmd: nada que cmd.exe pueda leer como otra cosa.
const SEGURA = /^[^"%&|<>^!\r\n\0]+$/;
const ARGS_OK = new Set(["--segundo-plano"]);

/**
 * El guion de cmd que vuelve a la copia: espera a que el proceso `pid` salga (hasta 60 s), pone `origen` en lugar de `destino` con
 * robocopy /MIR y abre `exe` de nuevo (con los argumentos permitidos). Tira si algo no es seguro de poner en un guion.
 */
function guionDeRestauracion({ origen, destino, exe, pid, args = [] }) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("pid inválido");
  for (const x of [origen, destino, exe]) if (typeof x !== "string" || !SEGURA.test(x)) throw new Error(`ruta no apta para el guion: ${String(x)}`);
  if (/[\\/]/.test(exe)) throw new Error("el nombre del .exe no puede llevar carpetas");
  const extra = args.filter((a) => ARGS_OK.has(a)).join(" ");
  const abrir = `start "" "${path.win32.join(destino, exe)}"${extra ? ` ${extra}` : ""}`;
  return [
    "@echo off",
    "rem Trama: vuelve a la versión anterior. Lo escribe la propia Trama (windows/src/version-anterior.js); se borra solo al terminar.",
    `powershell -NoProfile -NonInteractive -Command "Wait-Process -Id ${pid} -Timeout 60 -ErrorAction SilentlyContinue" >nul 2>&1`,
    `robocopy "${origen}" "${destino}" /MIR /R:3 /W:1 /NFL /NDL /NJH /NJS /NP >nul`,
    // robocopy sale con 8 o más cuando algo no se pudo copiar: igual se abre lo que haya, y la versión que abra lo cuenta.
    abrir,
    'del "%~f0"',
    "",
  ].join("\r\n");
}

/** Escribe el guion y lo lanza suelto (cmd.exe /c, sin ventana). `escribir` y `lanzar` son de Node; en las pruebas, falsos. */
async function lanzarRestauracion(o, { escribir = fsp.writeFile, lanzar = require("node:child_process").spawn, carpeta = require("node:os").tmpdir() } = {}) {
  const guion = guionDeRestauracion(o);
  const archivo = path.join(carpeta, `trama-volver-${o.pid}.cmd`);
  await escribir(archivo, guion);
  const hijo = lanzar("cmd.exe", ["/d", "/c", archivo], { detached: true, stdio: "ignore", windowsHide: true });
  hijo.unref?.();
  return archivo;
}

/**
 * El servicio de la carcasa. `d`: { almacen, version, inst, base, restaurar(inst, copia), salir(), copiarAlEstarLista?, ahora?, despues?,
 * topeMs?, log? }. `restaurar` deja la restauración en marcha (en Windows, el guion suelto) y `salir` cierra esta Trama.
 */
function crearVersionAnterior(d) {
  const ahora = d.ahora ?? Date.now;
  const log = d.log ?? (() => {});
  const despues =
    d.despues ??
    ((f, ms) => {
      const r = setTimeout(f, ms);
      r.unref?.();
      return { cancelar: () => clearTimeout(r) };
    });
  let reloj = null;
  let volviendo = null;
  let guardando = null;

  /** Anota que se vuelve, deja la restauración en marcha y sale. Nunca rechaza; una sola vez a la vez. */
  function volver(c, motivo) {
    if (!d.inst) return Promise.resolve({ ok: false, error: "esta instalación no guarda versiones anteriores" });
    const inst = d.inst;
    volviendo ??= (async () => {
      reloj?.cancelar();
      try {
        if (!(await copiaExiste(c, inst.exe))) throw new Error("la copia de la versión anterior ya no está");
        await d.restaurar(inst, c);
        d.almacen.cambiar((e) => alVolver(e, c, motivo));
        log(`vuelvo a la ${c.version} (${motivo})`);
        await d.salir();
        return { ok: true };
      } catch (e) {
        log(`no pude volver a la ${c.version}: ${e instanceof Error ? e.message : String(e)}`);
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    })().finally(() => (volviendo = null));
    return volviendo;
  }

  /** Guarda la versión que corre como respaldo, si todavía no está (antes de instalar la siguiente). Una copia a la vez. Nunca rechaza. */
  function guardarAntes() {
    if (!d.inst) return Promise.resolve();
    guardando ??= (async () => {
      try {
        const e = d.almacen.leer();
        if (e.respaldo?.version === d.version && (await copiaExiste(e.respaldo, d.inst.exe))) return;
        const c = await guardarCopia(d.inst, d.version, d.base, ahora());
        const s = d.almacen.cambiar((x) => conRespaldo(x, c));
        await podar(d.base, [s.respaldo, s.anterior]);
        log(`guardé la ${d.version} para poder volver`);
      } catch (e) {
        log(`no pude guardar la versión que corre: ${e instanceof Error ? e.message : String(e)}`);
      }
    })().finally(() => (guardando = null));
    return guardando;
  }

  return {
    /** Al arrancar el proceso: anota el arranque y, si esta versión a prueba ya falló, vuelve (true: este proceso se va). */
    async alArrancar() {
      if (!d.inst) return false;
      const r = alArrancar(d.almacen.leer(), d.version, ahora());
      d.almacen.cambiar(() => r.estado);
      if (r.decision.accion === "volver") return (await volver(r.decision.a, r.decision.motivo)).ok;
      reloj = despues(() => {
        const t = alTiempoAgotado(d.almacen.leer());
        if (t.accion === "volver") void volver(t.a, t.motivo);
      }, d.topeMs ?? ARRANQUE_MAX_MS);
      return false;
    },
    /** La ventana cargó: la versión anda. */
    async alVentanaLista() {
      if (!d.inst) return;
      reloj?.cancelar();
      d.almacen.cambiar(alVentanaLista);
      if (d.copiarAlEstarLista) await guardarAntes();
    },
    /** Salió a propósito (Salir de la bandeja): un arranque sin terminar no cuenta como cierre solo. */
    alSalir: () => void (d.inst && d.almacen.cambiar(alSalirAProposito)),
    guardarAntes,
    /** La versión anterior que hay para volver (con su copia entera en disco), o null. */
    async disponible() {
      const a = d.inst ? d.almacen.leer().anterior : null;
      return a && a.version !== d.version && (await copiaExiste(a, d.inst.exe)) ? a.version : null;
    },
    /** El botón: vuelve a la anterior guardada. */
    async volverManual() {
      const a = d.inst ? d.almacen.leer().anterior : null;
      if (!a) return { ok: false, error: "no hay una versión anterior guardada" };
      return volver(a, "manual");
    },
    /** Lo que la ventana cuenta al abrir tras volver; se gasta al leerlo. */
    leerAviso() {
      const e = d.almacen.leer();
      if (!e.aviso) return null;
      d.almacen.cambiar(sinAviso);
      return e.aviso;
    },
    /** La versión desechada, para que el actualizador no la baje otra vez. */
    rechazada: () => d.almacen.leer().rechazada,
  };
}

module.exports = { instalacionDe, copiaExiste, guardarCopia, podar, guionDeRestauracion, lanzarRestauracion, crearVersionAnterior };
