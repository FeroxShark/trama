"use strict";
// La lógica del asistente de primer arranque, sin Electron y sin Windows: todo lo de afuera
// (wsl.exe, fetch, el disco, la elevación, la consola) entra por `deps`, así que los tests la
// corren con falsos. Cada paso sabe `comprobar()` (¿ya está hecho?) y `hacer()` (hacerlo); el
// asistente nunca guarda "paso 3 de 6": mira el sistema y sigue desde donde falta algo, por eso
// es idempotente y retoma solo tras un reinicio o un cierre a la mitad.

const DISTRO = "Ubuntu-24.04";
const OLLAMA_URL = "http://localhost:11434";
const MOTOR_URL = "http://localhost:8791";
// Dónde está, dentro del árbol que trae el instalador, el script que arma el motor en WSL.
const INSTALADOR = "motor/scripts/instalar-producto.sh";
const MARCA_PAYLOAD = ".local/share/trama/carcasa-payload";

const PASOS = [
  { id: "wsl", titulo: "Windows Subsystem for Linux" },
  { id: "sistema", titulo: "Ubuntu listo para Trama" },
  { id: "instalar", titulo: "Instalar el motor" },
  { id: "login", titulo: "Conectar tu cuenta" },
  { id: "ollama", titulo: "Modelos locales (Ollama)" },
  { id: "motor", titulo: "Arrancar Trama" },
];

class ErrorPaso extends Error {
  constructor(paso, mensaje, detalle = "") {
    super(mensaje);
    this.name = "ErrorPaso";
    this.paso = paso;
    this.detalle = detalle;
  }
}

// Comillas simples para pegar un texto en un script de bash.
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// C:\Users\Ana\x → /mnt/c/Users/Ana/x (el montaje por defecto de WSL; \\wsl$\… no hace falta).
function aRutaWsl(ruta) {
  const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(ruta);
  if (!m) throw new Error(`No es una ruta de Windows: ${ruta}`);
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`.replace(/\/+$/, "");
}

// Un nombre de usuario de Linux a partir del de Windows: minúsculas, [a-z0-9_-], empieza con letra.
function nombreLinux(usuarioWindows) {
  let n = String(usuarioWindows || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  n = n.replace(/[^a-z0-9_-]/g, "").replace(/^[^a-z]+/, "").slice(0, 32);
  return n && n !== "root" ? n : "trama";
}

function ultimasLineas(texto, n = 15) {
  return String(texto || "").trim().split(/\r?\n/).slice(-n).join("\n");
}

function parsearEstado(texto) {
  const i = String(texto).indexOf("{");
  let o;
  try {
    o = JSON.parse(String(texto).slice(i < 0 ? 0 : i));
  } catch {
    throw new ErrorPaso("instalar", "trama-estado no contestó algo legible.", ultimasLineas(texto));
  }
  if (o.version !== 1) throw new ErrorPaso("instalar", `trama-estado trae una versión que esta carcasa no conoce (${o.version}).`);
  const prov = (x) => ({ instalado: !!x?.instalado, logueado: !!x?.logueado });
  return {
    claude: prov(o.claude),
    agy: prov(o.agy),
    ollama: { url: o.ollama?.url || OLLAMA_URL, responde: !!o.ollama?.responde, modelos: o.ollama?.modelos || [] },
    motor: { vivo: !!o.motor?.vivo, url: o.motor?.url || MOTOR_URL },
  };
}

function crearAsistente(deps) {
  const {
    wsl, // (args, {input, onLinea, timeoutMs}) → {code, stdout, stderr, falta}
    elevarWsl, // (args) → {code, stderr}
    abrirConsola, // (distro, comando)
    fetch,
    estado: store, // {cargar(), guardar(obj)}
    payload, // {dir: "C:\\…\\payload", version: "abc" | null}
    wslconfig, // {leer() → string | null, escribir(texto)}
    inicioSistema = () => 0, // ms desde 1970 en que arrancó Windows
    espera = (ms) => new Promise((r) => setTimeout(r, ms)),
    env = {},
    distro = DISTRO,
    reabrir, // {registrar(), quitar()}: que Windows reabra Trama tras el reinicio (RunOnce)
    version = null, // la versión de esta carcasa (se anota con qué versión se instaló el motor)
  } = deps;

  const guardado = () => ({ ...(store.cargar() || {}) });
  const guardar = (cambios) => store.guardar({ ...guardado(), ...cambios });

  const sh = (script, { root = false, onLinea, timeoutMs } = {}) =>
    wsl(["-d", distro, ...(root ? ["-u", "root"] : []), "-e", "bash", "-s"], { input: `${script}\n`, onLinea, timeoutMs });

  const claves = (texto) => {
    const o = {};
    for (const l of String(texto).split(/\r?\n/)) {
      const m = /^([a-z0-9-]+)=(.*)$/.exec(l.trim());
      if (m) o[m[1]] = m[2];
    }
    return o;
  };

  async function estadoTrama() {
    const r = await sh('"$HOME/.local/bin/trama-estado" --json </dev/null', { timeoutMs: 30000 });
    if (r.code !== 0 && !String(r.stdout).includes("{")) {
      throw new ErrorPaso("instalar", "No pude preguntarle a Trama cómo está.", ultimasLineas(r.stderr || r.stdout));
    }
    const e = parsearEstado(r.stdout);
    // `trama-estado` mira ~/.gemini/oauth_creds.json y agy guarda su sesión en el llavero: con agy instalado y "sin conectar"
    // se le pregunta a agy mismo (`agy models` trae modelos sólo con sesión), con ~/.local/bin en el PATH del servicio.
    if (e.agy.instalado && !e.agy.logueado) {
      const m = await sh('PATH="$HOME/.local/bin:$PATH" agy models </dev/null 2>/dev/null', { timeoutMs: 30000 }).catch(() => null);
      if (m && String(m.stdout).split(/\r?\n/).some((l) => /^[a-z0-9][a-z0-9._:]*(?:-[a-z0-9._:]+)+\s+\S/i.test(l.trim()))) e.agy.logueado = true;
    }
    return e;
  }

  // ---------- wsl ----------
  async function distroInstalada() {
    const r = await wsl(["-l", "-q"], { timeoutMs: 20000 });
    if (r.falta) return { wsl: false, distro: false };
    const nombres = String(r.stdout).split(/\r?\n/).map((l) => l.replace(/\0/g, "").replace(/\(.*\)/, "").trim());
    return { wsl: true, distro: r.code === 0 && nombres.some((n) => n.toLowerCase() === distro.toLowerCase()) };
  }

  const pasoWsl = {
    async comprobar() {
      const { distro: hay } = await distroInstalada();
      if (hay) {
        if (guardado().reinicio) {
          // La instalación la pidió Trama y la distro apareció tras el reinicio: es suya (la limpieza lo mira).
          guardar({ reinicio: null, distroCreada: distro });
          await reabrir?.quitar();
        }
        return { ok: true };
      }
      const pend = guardado().reinicio;
      // Si todavía no se reinició Windows desde que se pidió, no hay nada que reintentar.
      if (pend && inicioSistema() - pend.inicioSistema < 60000) return { ok: false, reinicio: true };
      return { ok: false };
    },
    async hacer(emit) {
      emit({ tipo: "linea", texto: `Instalando ${distro} (Windows va a pedir permiso de administrador)…` });
      const r = await elevarWsl(["--install", "-d", distro, "--no-launch"]);
      if (r.cancelado) throw new ErrorPaso("wsl", "Cancelaste el permiso de administrador. Sin eso Windows no puede instalar WSL.", ultimasLineas(r.stderr));
      // 3010 = "hay que reiniciar"; con el componente recién activado la distro aparece después del reinicio.
      if (r.code !== 0 && r.code !== 3010) {
        throw new ErrorPaso("wsl", "Windows no pudo instalar WSL.", `código ${r.code}\n${ultimasLineas(r.stderr)}`);
      }
      const { distro: hay } = await distroInstalada();
      if (!hay) {
        guardar({ reinicio: { inicioSistema: inicioSistema() } });
        await reabrir?.registrar();
        return { reinicio: true };
      }
      guardar({ reinicio: null, distroCreada: distro });
      return {};
    },
  };

  // ---------- sistema: usuario, systemd ----------
  async function sondaSistema() {
    const r = await sh('echo "uid=$(id -u)"; echo "pid1=$(ps -p 1 -o comm= 2>/dev/null)"; echo "home=$HOME"', { timeoutMs: 60000 });
    if (r.code !== 0) throw new ErrorPaso("sistema", `No pude hablar con ${distro}.`, ultimasLineas(r.stderr || r.stdout));
    return claves(r.stdout);
  }

  const pasoSistema = {
    async comprobar() {
      const k = await sondaSistema();
      return { ok: k.uid !== "0" && k.pid1 === "systemd", home: k.home };
    },
    async hacer(emit) {
      const nombre = nombreLinux(env.USERNAME);
      emit({ tipo: "linea", texto: `Creando el usuario «${nombre}» y activando systemd…` });
      // Un usuario con uid 1000 que ya exista se respeta; sin él, se crea sin preguntar nada.
      const script = `set -e
NOMBRE=${q(nombre)}
if getent passwd 1000 >/dev/null; then NOMBRE=$(getent passwd 1000 | cut -d: -f1); else useradd -m -s /bin/bash -u 1000 "$NOMBRE"; fi
usermod -aG sudo "$NOMBRE" 2>/dev/null || true
echo "$NOMBRE ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-trama
chmod 440 /etc/sudoers.d/90-trama
touch /etc/wsl.conf
awk '/^\\[/{salto=($0=="[boot]"||$0=="[user]")} !salto{print}' /etc/wsl.conf > /tmp/wsl.conf.trama
printf '\\n[boot]\\nsystemd=true\\n\\n[user]\\ndefault=%s\\n' "$NOMBRE" >> /tmp/wsl.conf.trama
cat /tmp/wsl.conf.trama > /etc/wsl.conf
rm -f /tmp/wsl.conf.trama
echo "usuario=$NOMBRE"`;
      const r = await sh(script, { root: true, timeoutMs: 60000 });
      if (r.code !== 0) throw new ErrorPaso("sistema", "No pude preparar el usuario de Ubuntu.", ultimasLineas(r.stderr || r.stdout));
      // wsl.conf se lee al arrancar la distro: se la apaga y la próxima llamada la levanta con systemd.
      await wsl(["--terminate", distro], { timeoutMs: 30000 });
      await espera(2000);
      for (let i = 0; i < 30; i++) {
        const c = await pasoSistema.comprobar();
        if (c.ok) return {};
        await espera(1000);
      }
      throw new ErrorPaso("sistema", "Ubuntu no arrancó con systemd después de configurarlo.", "Probá cerrar todo con `wsl --shutdown` en una consola de Windows y reintentar.");
    },
  };

  // ---------- instalar: copiar el árbol y correr instalar-producto.sh ----------
  const pasoInstalar = {
    async comprobar() {
      const r = await sh(
        `[ -x "$HOME/.local/bin/trama-estado" ] && echo estado=si || echo estado=no\necho "version=$(cat "$HOME/${MARCA_PAYLOAD}" 2>/dev/null)"`,
        { timeoutMs: 30000 },
      );
      const k = claves(r.stdout);
      const hay = k.estado === "si";
      const al_dia = payload.version ? k.version === payload.version : !version || guardado().instalado?.version === version;
      return { ok: hay && al_dia, actualizacion: hay && !al_dia };
    },
    async hacer(emit) {
      const origen = aRutaWsl(payload.dir);
      const alLinea = (texto) => emit({ tipo: "linea", texto });
      emit({ tipo: "linea", texto: "Copiando Trama a Ubuntu…" });
      const c = await sh(
        `set -e
DEST="$HOME/.cache/trama/payload"
rm -rf "$DEST"
mkdir -p "$DEST"
cp -a ${q(origen)}/. "$DEST/"
echo "dest=$DEST"`,
        { timeoutMs: 600000 },
      );
      const dest = claves(c.stdout).dest;
      if (c.code !== 0 || !dest) throw new ErrorPaso("instalar", "No pude copiar los archivos de Trama a Ubuntu.", ultimasLineas(c.stderr || c.stdout));
      const script = `${dest}/${INSTALADOR}`;

      emit({ tipo: "linea", texto: "Instalando paquetes del sistema…" });
      const apt = await sh(`bash ${q(script)} --solo-apt </dev/null 2>&1`, { root: true, onLinea: alLinea, timeoutMs: 1800000 });
      if (apt.code !== 0) throw new ErrorPaso("instalar", "Falló la instalación de paquetes de Ubuntu.", ultimasLineas(apt.stdout + apt.stderr));

      emit({ tipo: "linea", texto: "Instalando el motor de Trama…" });
      const correrMotor = [
        "cd",
        "PID_ANTES=\"$(systemctl --user show -p ExecMainPID --value trama-motor 2>/dev/null || echo 0)\"",
        "[ -e .cache/trama/app-prev ] && rm -r .cache/trama/app-prev",
        "mkdir -p .cache/trama/app-prev",
        "[ -d .local/share/trama/app/dist ] && mv .local/share/trama/app/dist .cache/trama/app-prev/dist",
        "[ -d .local/share/trama/app/dist-electron ] && mv .local/share/trama/app/dist-electron .cache/trama/app-prev/dist-electron",
        "rc=0",
        `TRAMA_PAYLOAD_VERSION=${q(payload.version || "")} bash ${q(script)} --fuente ${q(dest)} </dev/null 2>&1 || rc=$?`,
        "cd",
        "if [ \"$rc\" -ne 0 ]; then",
        "  if [ ! -f .local/share/trama/app/dist-electron/motor.js ] && [ -d .cache/trama/app-prev/dist-electron ]; then",
        "    mkdir -p .local/share/trama/app",
        "    [ -e .local/share/trama/app/dist ] && rm -r .local/share/trama/app/dist",
        "    [ -e .local/share/trama/app/dist-electron ] && rm -r .local/share/trama/app/dist-electron",
        "    [ -d .cache/trama/app-prev/dist ] && mv .cache/trama/app-prev/dist .local/share/trama/app/dist",
        "    mv .cache/trama/app-prev/dist-electron .local/share/trama/app/dist-electron",
        "  fi",
        "  [ -e .cache/trama/app-prev ] && rm -r .cache/trama/app-prev",
        "  exit \"$rc\"",
        "fi",
        "[ -e .cache/trama/app-prev ] && rm -r .cache/trama/app-prev",
        "PID_DESPUES=\"$(systemctl --user show -p ExecMainPID --value trama-motor 2>/dev/null || echo 0)\"",
        "if [ -n \"$PID_ANTES\" ] && [ \"$PID_ANTES\" != \"0\" ] && [ \"$PID_ANTES\" = \"$PID_DESPUES\" ]; then",
        "  echo \"Reiniciando el motor de Trama…\"",
        "  systemctl --user restart trama-motor </dev/null ;",
        "fi",
      ].join("\n");
      const usr = await sh(correrMotor, { onLinea: alLinea, timeoutMs: 1800000 });
      if (usr.code !== 0) throw new ErrorPaso("instalar", "Falló la instalación del motor de Trama.", ultimasLineas(usr.stdout + usr.stderr));

      guardar({ instalado: { version, payload: payload.version || null, fecha: new Date().toISOString() } });
      if (payload.version) {
        await sh(`mkdir -p "$HOME/$(dirname ${MARCA_PAYLOAD})" && printf %s ${q(payload.version)} > "$HOME/${MARCA_PAYLOAD}"`);
      }
      return {};
    },
  };

  // ---------- login ----------
  // Con uno logueado alcanza, pero el paso no se cierra solo apenas se conecta uno: la persona tiene que
  // poder conectar el otro (Claude y Gemini van en tarjetas hermanas). Se sigue cuando cada proveedor
  // está resuelto (conectado o «lo hago después») o cuando toca Continuar (`continuarLogin`) con alguno
  // conectado. Sin ninguno conectado, se entra sólo si dijo «lo hago después» de los dos y se usa Trama
  // sin cuenta (sólo Ollama o ninguno); las cuentas se conectan después desde Ajustes.
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
      return { ok, claude, agy, puedeContinuar: algunaConectada };
    },
  };

  function saltarLogin(proveedor) {
    if (!PROVEEDORES_LOGIN[proveedor]) throw new Error(`Proveedor desconocido: ${proveedor}`);
    guardar({ loginSaltado: { ...(guardado().loginSaltado || {}), [proveedor]: true } });
  }

  // «Continuar» de la pantalla de cuentas, con al menos una conectada.
  async function continuarLogin() {
    const c = await pasoLogin.comprobar();
    if (!c.puedeContinuar) throw new Error("Conectá al menos una cuenta (Claude o Gemini), o elegí «lo hago después» en las dos.");
    guardar({ loginHecho: true });
  }

  // Las cuentas tal como están ahora (para Ajustes de Trama, que deja conectar la que falte).
  async function cuentas() {
    const e = await estadoTrama();
    return { claude: e.claude, agy: e.agy };
  }

  // Abre una consola de verdad con el CLI del proveedor para que la persona inicie sesión ahí.
  async function conectar(proveedor) {
    const cli = { claude: "claude", gemini: "agy" }[proveedor];
    if (!cli) throw new Error(`Proveedor desconocido: ${proveedor}`);
    const comando = `command -v ${cli} >/dev/null 2>&1 || { echo 'No encuentro ${cli} en Ubuntu. Instalalo y volvé a probar.'; read -r -p 'Enter para cerrar'; exit 1; }; ${cli}`;
    await abrirConsola(distro, comando);
  }

  // ---------- ollama (del lado de Windows) ----------
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

  // ¿Lo ve Ubuntu en su localhost? En el modo de red normal de WSL2 no.
  async function ollamaDesdeWsl() {
    const r = await sh(`curl -fsS -m 3 -o /dev/null ${OLLAMA_URL}/api/tags </dev/null && echo visible=si || echo visible=no`, { timeoutMs: 20000 });
    return claves(r.stdout).visible === "si";
  }

  const pasoOllama = {
    async comprobar() {
      if (guardado().ollamaResuelto) return { ok: true, resuelto: true };
      const w = await ollamaWindows();
      if (w.responde) {
        const visible = await ollamaDesdeWsl();
        if (visible) guardar({ ollamaResuelto: true });
        return { ok: visible, detectado: true, modelos: w.modelos, visibleDesdeWsl: visible };
      }
      return { ok: false, detectado: false, modelos: [] };
    },
  };

  const saltarOllama = () => guardar({ ollamaResuelto: true });

  // Modo de red "espejo" (Windows 11 22H2+): el localhost de Ubuntu es el de Windows y viceversa.
  async function habilitarEspejo() {
    const actual = wslconfig.leer() || "";
    if (/^\s*networkingMode\s*=\s*mirrored/im.test(actual)) {
      await wsl(["--shutdown"], { timeoutMs: 60000 });
      return { cambiado: false };
    }
    let nuevo;
    if (/^\s*networkingMode\s*=/im.test(actual)) nuevo = actual.replace(/^\s*networkingMode\s*=.*$/im, "networkingMode=mirrored");
    else if (/^\s*\[wsl2\]\s*$/im.test(actual)) nuevo = actual.replace(/^(\s*\[wsl2\]\s*)$/im, "$1\nnetworkingMode=mirrored");
    else nuevo = `${actual}${actual && !actual.endsWith("\n") ? "\n" : ""}[wsl2]\nnetworkingMode=mirrored\n`;
    wslconfig.escribir(nuevo);
    await wsl(["--shutdown"], { timeoutMs: 60000 });
    return { cambiado: true };
  }

  // ---------- motor ----------
  const pasoMotor = {
    async comprobar() {
      const e = await estadoTrama();
      return { ok: e.motor.vivo, url: e.motor.url };
    },
    async hacer() {
      await sh(`sudo -n loginctl enable-linger "$USER" </dev/null 2>/dev/null || true\nsystemctl --user start trama-motor </dev/null`, { timeoutMs: 60000 });
      for (let i = 0; i < 40; i++) {
        const c = await pasoMotor.comprobar();
        if (c.ok) return {};
        await espera(1000);
      }
      const j = await sh("journalctl --user -u trama-motor -n 20 --no-pager </dev/null 2>&1", { timeoutMs: 20000 });
      throw new ErrorPaso("motor", "El motor de Trama no arrancó.", ultimasLineas(j.stdout));
    },
  };

  const comprobaciones = { wsl: pasoWsl, sistema: pasoSistema, instalar: pasoInstalar, login: pasoLogin, ollama: pasoOllama, motor: pasoMotor };

  // Recorre los pasos en orden: los que ya están hechos pasan en silencio, el primero que falta se
  // hace (si es automático) o se devuelve a la persona (login, Ollama, reinicio). Los eventos:
  // {tipo: "ok"|"inicia"|"linea", paso, texto}.
  async function avanzar(emit = () => {}) {
    for (const { id } of PASOS) {
      const p = comprobaciones[id];
      let c = await p.comprobar();
      if (c.ok) {
        emit({ tipo: "ok", paso: id });
        continue;
      }
      if (c.reinicio) return { espera: "reinicio", paso: id };
      if (!p.hacer) return { espera: id, paso: id, info: c };
      emit({ tipo: "inicia", paso: id, actualizacion: !!c.actualizacion });
      const r = await p.hacer((e) => emit({ ...e, paso: id }));
      if (r?.reinicio) return { espera: "reinicio", paso: id };
      c = await p.comprobar();
      if (!c.ok) throw new ErrorPaso(id, "El paso terminó pero el sistema sigue sin estar listo.");
      emit({ tipo: "ok", paso: id });
    }
    // Pasó por Cuentas: si el motor se cae después (WSL reiniciado), no se la vuelve a pedir.
    if (!guardado().loginHecho) guardar({ loginHecho: true });
    const e = await estadoTrama();
    return { listo: true, url: e.motor.url };
  }

  return { PASOS, avanzar, conectar, comprobar: (id) => comprobaciones[id].comprobar(), saltarOllama, saltarLogin, continuarLogin, cuentas, habilitarEspejo, estadoTrama };
}

module.exports = { crearAsistente, ErrorPaso, aRutaWsl, nombreLinux, parsearEstado, PASOS, DISTRO, MOTOR_URL, OLLAMA_URL };
