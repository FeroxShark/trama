"use strict";
// El asistente de primer arranque del Trama nativo de Windows (sin WSL ni bash), sin Electron: igual que pasos.js, cada
// paso sabe `comprobar()` y `hacer()`, todo lo de afuera entra por `deps` y el asistente mira el sistema en vez de recordar
// por dónde iba (retoma solo tras un cierre a la mitad o una actualización).
//   instalar  el payload del instalador (node.exe, la app compilada, los hooks .mjs, bin\*.cmd) copiado a %LOCALAPPDATA%\trama,
//             y `instalar-nativo` (los hooks en ~/.claude/settings.json, la skill, las plantillas, el registry)
//   sistema   bin\ en el PATH del usuario y la clave Run (Trama arranca con la sesión, en segundo plano)
//   login     Claude o Gemini con sesión (o «lo hago después»)
//   ollama    opcional; en Windows nativo el localhost es el mismo, no hay red de WSL que arreglar
//   motor     el supervisor (nativo.js) lo lanza y espera a que conteste por /rpc

const { ErrorPaso, parsearEstado, OLLAMA_URL } = require("./pasos");
const { MOTOR_URL_NATIVO, comandoArranque } = require("./nativo");

// `nativo`: la pantalla (ui/asistente.js) usa los textos sin WSL ni Ubuntu.
const PASOS_NATIVO = [
  { id: "instalar", titulo: "Instalar Trama", nativo: true },
  { id: "sistema", titulo: "Comandos y arranque", nativo: true },
  { id: "login", titulo: "Conectar tu cuenta", nativo: true },
  { id: "ollama", titulo: "Modelos locales (Ollama)", nativo: true },
  { id: "motor", titulo: "Arrancar Trama", nativo: true },
];

// Lo que se copia del payload a la carpeta de Trama (cada una se reemplaza entera).
const CARPETAS_PAYLOAD = ["node", "app", "bin"];

function ultimasLineas(texto, n = 15) {
  return String(texto || "").trim().split(/\r?\n/).slice(-n).join("\n");
}

function crearAsistenteNativo(deps) {
  const {
    rutas, // rutasNativas() de nativo.js
    payload, // {dir, version}: el payload-nativo que trae el instalador
    disco, // {existe(r), leer(r) → string|null, escribir(r, t), copiar(de, a), borrar(r), unir(...partes)}
    correrCli, // (nombre, args) → {code, stdout, stderr}: node.exe <app>\dist-electron\cli\<nombre>.js
    pathUsuario, // {tiene(c), agregar(c)}
    arranque, // {leer() → string|null, registrar(cmd)}
    supervisor, // crearSupervisor() de nativo.js
    abrirConsola, // (programa)
    fetch,
    estado: store, // {cargar(), guardar(obj)}
    exe = null, // el Trama.exe instalado (sin él, en desarrollo, no se toca la clave Run)
    version = null,
    log = () => {},
  } = deps;

  const guardado = () => ({ ...(store.cargar() || {}) });
  const guardar = (cambios) => store.guardar({ ...guardado(), ...cambios });

  async function estadoTrama() {
    const r = await correrCli("trama-estado", ["--json"], { timeoutMs: 30000 });
    if (r.code !== 0 && !String(r.stdout).includes("{")) throw new ErrorPaso("login", "No pude preguntarle a Trama cómo está.", ultimasLineas(r.stderr || r.stdout));
    return parsearEstado(r.stdout);
  }

  // ---------- instalar ----------
  /** «Se importaron N cuentas de tu Trama anterior» (una cuenta: «Se importó 1 cuenta…»). */
  const textoImportadas = (n) => `Se ${n === 1 ? "importó 1 cuenta" : `importaron ${n} cuentas`} de tu Trama anterior`;

  // Una sola vez: `cuentas importar-perfiles` copia (nunca mueve) las cuentas de Claude de una Trama vieja (perfiles_claude\) y no hace
  // nada si esa carpeta no existe. Si falla no frena la instalación y se reintenta en la próxima; el resultado queda en el estado
  // (`cuentasImportadas`) para que la pantalla de cuentas lo muestre. Nunca se loguea más que el conteo: las credenciales no se leen acá.
  async function importarCuentasViejas(emit) {
    if (guardado().cuentasImportadas) return;
    let n = null;
    try {
      const r = await correrCli("cuentas", ["importar-perfiles", "--json"], { timeoutMs: 60000 });
      const m = r.code === 0 ? /\{[^{}]*"importadas"\s*:\s*(\d+)[^{}]*\}/.exec(String(r.stdout)) : null;
      if (m) n = Number(m[1]);
      else log(`cuentas importar-perfiles terminó con ${r.code}`);
    } catch (e) {
      log(`cuentas importar-perfiles: ${e.message}`);
    }
    if (n === null) return;
    guardar({ cuentasImportadas: { n, fecha: new Date().toISOString() } });
    if (n > 0) emit({ tipo: "linea", texto: textoImportadas(n) });
  }

  const instalado = () => (disco.leer(rutas.marca) || "").trim();
  const pasoInstalar = {
    async comprobar() {
      const hay = disco.existe(rutas.node) && disco.existe(rutas.motor);
      const al_dia = !payload.version || instalado() === payload.version;
      return { ok: hay && al_dia, actualizacion: hay && !al_dia };
    },
    async hacer(emit) {
      if (!payload.version || !disco.existe(payload.dir)) throw new ErrorPaso("instalar", "Este instalador no trae los archivos de Trama.", `falta ${payload.dir}`);
      // Con el motor andando, node.exe y la app están en uso: se lo para antes de reemplazarlos (el paso motor lo relanza).
      await supervisor.parar();
      for (const c of CARPETAS_PAYLOAD) {
        const de = disco.unir(payload.dir, c);
        if (!disco.existe(de)) throw new ErrorPaso("instalar", "Este instalador vino incompleto.", `falta ${de}`);
        emit({ tipo: "linea", texto: `Copiando ${c}…` });
        const a = disco.unir(rutas.raiz, c);
        try {
          disco.borrar(a);
          disco.copiar(de, a);
        } catch (e) {
          throw new ErrorPaso("instalar", "No pude copiar los archivos de Trama.", `${a}: ${e.message}`);
        }
      }
      emit({ tipo: "linea", texto: "Registrando los hooks de Claude Code…" });
      const r = await correrCli("instalar-nativo", [], { timeoutMs: 120000 });
      for (const l of String(r.stdout).split(/\r?\n/).filter(Boolean)) emit({ tipo: "linea", texto: l });
      if (r.code === -1) throw new ErrorPaso("instalar", "No pude correr el instalador de Trama.", ultimasLineas(r.stderr));
      // Con avisos (un settings.json que no se pudo tocar) se sigue: el motor anda igual; quedan en el registro.
      if (r.code !== 0) log(`instalar-nativo terminó con ${r.code}:\n${ultimasLineas(r.stdout + r.stderr)}`);
      await importarCuentasViejas(emit);
      disco.escribir(rutas.marca, payload.version);
      guardar({ instalado: { version, payload: payload.version, fecha: new Date().toISOString(), modo: "nativo" } });
      return {};
    },
  };

  // ---------- sistema: PATH y arranque ----------
  const pasoSistema = {
    async comprobar() {
      const enPath = await pathUsuario.tiene(rutas.bin);
      const conArranque = !exe || (await arranque.leer()) === comandoArranque(exe);
      return { ok: enPath && conArranque, enPath, conArranque };
    },
    async hacer(emit) {
      emit({ tipo: "linea", texto: "Sumando los comandos de Trama (pa, trama-estado…) a tu PATH…" });
      await pathUsuario.agregar(rutas.bin);
      if (exe) {
        emit({ tipo: "linea", texto: "Trama va a arrancar con Windows, en segundo plano…" });
        await arranque.registrar(comandoArranque(exe));
      }
      return {};
    },
  };

  // ---------- login (mismas reglas que el asistente de WSL) ----------
  const PROVEEDORES_LOGIN = { claude: "claude", gemini: "agy" };
  const pasoLogin = {
    async comprobar() {
      const e = await estadoTrama();
      const g = guardado();
      const saltado = g.loginSaltado || {};
      const claude = { ...e.claude, saltado: !!saltado.claude };
      const agy = { ...e.agy, saltado: !!saltado.gemini };
      const resuelto = (p) => p.logueado || p.saltado;
      const algunaConectada = claude.logueado || agy.logueado;
      const ok = resuelto(claude) && resuelto(agy) ? true : algunaConectada && !!g.loginHecho;
      return { ok, claude, agy, puedeContinuar: algunaConectada, nativo: true, cuentasImportadas: (g.cuentasImportadas && g.cuentasImportadas.n) || 0 };
    },
  };

  function saltarLogin(proveedor) {
    if (!PROVEEDORES_LOGIN[proveedor]) throw new Error(`Proveedor desconocido: ${proveedor}`);
    guardar({ loginSaltado: { ...(guardado().loginSaltado || {}), [proveedor]: true } });
  }

  async function continuarLogin() {
    const c = await pasoLogin.comprobar();
    if (!c.puedeContinuar) throw new Error("Conectá al menos una cuenta (Claude o Gemini), o elegí «lo hago después» en las dos.");
    guardar({ loginHecho: true });
  }

  async function cuentas() {
    const e = await estadoTrama();
    return { claude: e.claude, agy: e.agy };
  }

  async function conectar(proveedor) {
    const cli = PROVEEDORES_LOGIN[proveedor];
    if (!cli) throw new Error(`Proveedor desconocido: ${proveedor}`);
    await abrirConsola(cli);
  }

  // ---------- ollama ----------
  async function ollamaWindows() {
    try {
      const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return { responde: false, modelos: [] };
      const j = await r.json();
      return { responde: true, modelos: (j.models || []).map((m) => m.name || m.model).filter(Boolean) };
    } catch {
      return { responde: false, modelos: [] };
    }
  }

  const pasoOllama = {
    async comprobar() {
      if (guardado().ollamaResuelto) return { ok: true, resuelto: true };
      const w = await ollamaWindows();
      if (w.responde) {
        guardar({ ollamaResuelto: true });
        return { ok: true, detectado: true, modelos: w.modelos, visibleDesdeWsl: true };
      }
      return { ok: false, detectado: false, modelos: [] };
    },
  };
  const saltarOllama = () => guardar({ ollamaResuelto: true });

  // ---------- motor ----------
  const pasoMotor = {
    async comprobar() {
      const f = supervisor.estado().fase;
      return { ok: f === "vivo" || f === "adoptado" };
    },
    async hacer(emit) {
      emit({ tipo: "linea", texto: "Arrancando el motor de Trama…" });
      await supervisor.iniciar();
      if (await supervisor.esperarVivo(60000)) return {};
      const e = supervisor.estado();
      throw new ErrorPaso("motor", "El motor de Trama no arrancó.", [e.ultimo, ultimasLineas(disco.leer(rutas.logMotor) || "", 20)].filter(Boolean).join("\n"));
    },
  };

  const comprobaciones = { instalar: pasoInstalar, sistema: pasoSistema, login: pasoLogin, ollama: pasoOllama, motor: pasoMotor };

  /** La URL del motor con el token de la instalación: el motor lo cambia por una cookie y lo saca de la barra. */
  function urlMotor() {
    const t = (disco.leer(rutas.token) || "").trim();
    return /^[0-9a-f]{16,}$/i.test(t) ? `${MOTOR_URL_NATIVO}/?t=${t}` : MOTOR_URL_NATIVO;
  }

  async function avanzar(emit = () => {}) {
    for (const { id } of PASOS_NATIVO) {
      const p = comprobaciones[id];
      let c = await p.comprobar();
      if (c.ok) {
        emit({ tipo: "ok", paso: id });
        continue;
      }
      if (!p.hacer) return { espera: id, paso: id, info: c };
      emit({ tipo: "inicia", paso: id, actualizacion: !!c.actualizacion });
      await p.hacer((e) => emit({ ...e, paso: id }));
      c = await p.comprobar();
      if (!c.ok) throw new ErrorPaso(id, "El paso terminó pero el sistema sigue sin estar listo.");
      emit({ tipo: "ok", paso: id });
    }
    if (!guardado().loginHecho) guardar({ loginHecho: true });
    return { listo: true, url: urlMotor() };
  }

  // En segundo plano (clave Run): sin ventana ni preguntas. Si nunca se instaló no hace nada (espera a que abran Trama); si
  // el payload cambió (una actualización de la carcasa) lo copia antes, en silencio; después arranca el motor.
  async function arrancarSoloMotor() {
    const c = await pasoInstalar.comprobar();
    if (!c.ok && !c.actualizacion) return false;
    if (c.actualizacion) await pasoInstalar.hacer(() => {});
    await supervisor.iniciar();
    return true;
  }

  return {
    PASOS: PASOS_NATIVO,
    avanzar,
    conectar,
    comprobar: (id) => comprobaciones[id].comprobar(),
    saltarOllama,
    saltarLogin,
    continuarLogin,
    cuentas,
    habilitarEspejo: async () => ({ cambiado: false }),
    estadoTrama,
    urlMotor,
    arrancarSoloMotor,
  };
}

module.exports = { crearAsistenteNativo, PASOS_NATIVO, CARPETAS_PAYLOAD };
