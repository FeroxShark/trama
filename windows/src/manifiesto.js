"use strict";
// Todo lo que Trama deja FUERA de su propia carpeta de instalación, con la versión que lo empezó a dejar
// (`desde`) y la primera versión que ya no lo usa (`hasta`; null = sigue en uso). La limpieza
// (limpieza.js) lee esto y nada más: quitar algo que no está acá es imposible, y una entrada sólo se
// puede quitar si el sistema confirma que es de Trama (ver `dueno`).
//
// Al sacar una pieza de una versión, NO se borra la entrada: se le pone `hasta`. Así una instalación
// vieja sabe qué limpiar aunque salte varias versiones.
//
// Campos:
//   id        estable; nunca se reusa
//   ambito    "windows" (el lado de Windows) | "wsl" (dentro de la distro de Trama)
//   grupo     "carcasa" (la app de Windows) | "motor-wsl" (el motor y sus enlaces dentro de WSL) |
//             "sistema" (cosas compartidas con el resto de la máquina)
//   tipo      windows: carpeta | registro | path (una carpeta en el PATH del usuario) | gestionado (lo maneja el instalador NSIS)
//             wsl: enlace | archivo | carpeta | unit | bloque | hooks | sudoers | distro | compartido
//   ruta      windows: con %VARIABLES% · wsl: con ~/ (el HOME de la distro) o absoluta
//   que       qué es, en una frase (se muestra tal cual)
//   quitar    "seguro"   se puede quitar sin pedir más cuando está muerta (y en el desinstalador)
//             "datos"    datos propios de Trama en Windows: sólo el desinstalador, y preguntando
//             "distro"   desregistrar la distro: sólo con confirmación explícita y si es de Trama
//             "nunca"    es del usuario o está compartido: jamás se borra, a lo sumo se avisa
//   auto      true = la limpieza de después de actualizar lo quita sola; false = sólo con el botón
//   dueno     cómo se comprueba que es nuestro (wsl): { enlaceA } el destino del enlace contiene eso ·
//             { contiene } el archivo contiene eso · { soloEnlaces } la carpeta sólo tiene enlaces ·
//             ausente = por la ruta basta (es una ruta que sólo usa Trama)
//   pierde    (distro) qué se pierde al quitarla

const VERSION_MANIFIESTO = 1;

const enlacesBin = ["pa", "tablero", "trama-estado", "trama-motor", "proyecto-ruta", "workers"].map((b) => ({
  id: `wsl-bin-${b}`,
  ambito: "wsl",
  grupo: "motor-wsl",
  tipo: "enlace",
  ruta: `~/.local/bin/${b}`,
  que: `Comando «${b}» (enlace en ~/.local/bin de Ubuntu)`,
  desde: "0.1.0",
  hasta: null,
  quitar: "seguro",
  auto: false,
  dueno: { enlaceA: "/trama/" },
}));

const enlacesHooks = ["latido.sh", "destructive-guard.sh", "statusline-espejo.sh"].map((h) => ({
  id: `wsl-hook-${h.replace(/\.sh$/, "")}`,
  ambito: "wsl",
  grupo: "motor-wsl",
  tipo: "enlace",
  ruta: `~/.claude/hooks/${h}`,
  que: `Gancho de Claude Code «${h}» (enlace)`,
  desde: "0.1.0",
  hasta: null,
  quitar: "seguro",
  auto: false,
  dueno: { enlaceA: "/trama/" },
}));

const ENTRADAS = [
  // ---------- Windows ----------
  {
    id: "win-instalacion",
    ambito: "windows",
    grupo: "carcasa",
    tipo: "gestionado",
    ruta: "%LOCALAPPDATA%\\Programs\\Trama",
    que: "La app, el acceso directo del menú Inicio y la entrada de «Aplicaciones» (los maneja el instalador de Windows)",
    desde: "0.1.0",
    hasta: null,
    quitar: "nunca",
    auto: false,
  },
  {
    id: "win-runonce",
    ambito: "windows",
    grupo: "carcasa",
    tipo: "registro",
    ruta: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce|Trama",
    que: "Entrada del registro que reabre Trama una vez, tras reiniciar Windows al instalar WSL",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: true,
  },
  {
    id: "win-cache-actualizador",
    ambito: "windows",
    grupo: "carcasa",
    tipo: "carpeta",
    ruta: "%LOCALAPPDATA%\\trama-windows-updater",
    que: "Descargas viejas del actualizador (instaladores ya usados)",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: true,
  },
  {
    id: "win-datos-carcasa",
    ambito: "windows",
    grupo: "carcasa",
    tipo: "carpeta",
    ruta: "%APPDATA%\\Trama",
    que: "Los ajustes de la app de Windows, su registro (carcasa.log) y el estado del asistente",
    desde: "0.1.0",
    hasta: null,
    quitar: "datos",
    auto: false,
  },
  {
    id: "win-wslconfig",
    ambito: "windows",
    grupo: "sistema",
    tipo: "compartido",
    ruta: "%USERPROFILE%\\.wslconfig",
    que: "networkingMode=mirrored, sólo si lo pediste en el asistente (es configuración de WSL, no de Trama)",
    desde: "0.1.0",
    hasta: null,
    quitar: "nunca",
    auto: false,
  },
  {
    id: "win-wsl",
    ambito: "windows",
    grupo: "sistema",
    tipo: "compartido",
    ruta: "Windows Subsystem for Linux",
    que: "El componente WSL de Windows (otros programas pueden usarlo)",
    desde: "0.1.0",
    hasta: null,
    quitar: "nunca",
    auto: false,
  },

  // ---------- WSL: el motor ----------
  ...enlacesBin,
  ...enlacesHooks,
  {
    id: "wsl-skill-orquestar",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "enlace",
    ruta: "~/.claude/skills/trama-orquestar",
    que: "Skill «trama-orquestar» de Claude Code (enlace)",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
    dueno: { enlaceA: "/trama/" },
  },
  {
    id: "wsl-plugin-gemini",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "carpeta",
    ruta: "~/.gemini/config/plugins/pa-worker",
    que: "Plugin «pa-worker» de Antigravity (sólo enlaces)",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
    dueno: { soloEnlaces: true },
  },
  {
    id: "wsl-hooks-claude",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "hooks",
    ruta: "~/.claude/settings.json",
    que: "Las dos líneas que Trama agregó a ~/.claude/settings.json (destructive-guard y statusline-espejo); el resto del archivo no se toca",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
  },
  {
    id: "wsl-unit-motor",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "unit",
    ruta: "~/.config/systemd/user/trama-motor.service",
    que: "El servicio trama-motor (el motor que sirve la interfaz en localhost:8791)",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
    dueno: { contiene: "instalar-producto.sh" },
  },
  {
    id: "wsl-app-compilada",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "carpeta",
    ruta: "~/.local/share/trama/app",
    que: "La app de Trama compilada para el motor",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
  },
  {
    id: "wsl-payload",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "carpeta",
    ruta: "~/.cache/trama/payload",
    que: "Copia del motor (pa, tablero, ganchos) que traía el instalador",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
  },
  {
    id: "wsl-marca-payload",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "archivo",
    ruta: "~/.local/share/trama/carcasa-payload",
    que: "Marca de qué versión del motor se instaló",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
  },
  {
    id: "wsl-ruta-app",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "archivo",
    ruta: "~/.config/trama/app",
    que: "Archivo que dice dónde está la app compilada",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
  },
  {
    id: "wsl-bashrc-path",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "bloque",
    ruta: "~/.bashrc",
    que: "Las dos líneas «# trama:path» que Trama sumó a ~/.bashrc (el resto no se toca)",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
  },
  {
    id: "wsl-sudoers",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "sudoers",
    ruta: "/etc/sudoers.d/90-trama",
    que: "Permiso de sudo sin contraseña para tu usuario de Ubuntu (lo dejó el asistente)",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: false,
    root: true,
    dueno: { contiene: "NOPASSWD" },
  },

  // ---------- WSL: la distro ----------
  {
    id: "wsl-distro",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "distro",
    ruta: "Ubuntu-24.04",
    que: "La distro Ubuntu-24.04 que instaló el asistente",
    desde: "0.1.0",
    hasta: null,
    quitar: "distro",
    auto: false,
    pierde: "Todo lo que hay adentro: tu cuenta de Ubuntu y sus archivos, el motor, las sesiones y tareas de Trama, el tablero, los proyectos registrados y la sesión iniciada de Claude y de Gemini.",
  },

  // ---------- WSL: lo que es tuyo o está compartido (nunca se borra) ----------
  {
    id: "wsl-datos-trama",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "compartido",
    ruta: "~/.config/trama, ~/.local/state/hilos, ~/.local/state/pa",
    que: "Tu configuración de Trama, sus sesiones, nombres y borradores, y el estado de los workers",
    desde: "0.1.0",
    hasta: null,
    quitar: "nunca",
    auto: false,
  },
  {
    id: "wsl-datos-proyectos",
    ambito: "wsl",
    grupo: "motor-wsl",
    tipo: "compartido",
    ruta: "~/.config/proyectos, el tablero, ~/CLAUDE.md, ~/GEMINI.md",
    que: "Tus proyectos registrados, el tablero y las instrucciones de tu líder",
    desde: "0.1.0",
    hasta: null,
    quitar: "nunca",
    auto: false,
  },
  {
    id: "wsl-logins",
    ambito: "wsl",
    grupo: "sistema",
    tipo: "compartido",
    ruta: "~/.claude, ~/.gemini, ~/.local/bin/claude, ~/.local/bin/agy",
    que: "Claude Code y Antigravity con tu sesión iniciada (los instaló el asistente, pero ahora son tuyos)",
    desde: "0.1.0",
    hasta: null,
    quitar: "nunca",
    auto: false,
  },
  {
    id: "wsl-sistema",
    ambito: "wsl",
    grupo: "sistema",
    tipo: "compartido",
    ruta: "/etc/wsl.conf, paquetes apt (git, jq, curl, python3…), node en ~/.local",
    que: "Systemd activado en WSL, paquetes del sistema y Node: otros programas de Ubuntu los usan",
    desde: "0.1.0",
    hasta: null,
    quitar: "nunca",
    auto: false,
  },
];

// Compara "0.2.0" con "0.10.1" por números. Sin versión (o con letras raras) cuenta como 0.
function comparar(a, b) {
  const n = (v) => String(v || "0").split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

// ¿La versión `version` todavía usa esta entrada?
const vigente = (entrada, version) => !entrada.hasta || comparar(version, entrada.hasta) < 0;
const muerta = (entrada, version) => !vigente(entrada, version);

// Valida que el manifiesto esté bien armado (los tests lo corren): ids únicos, versiones y campos obligatorios.
function validar(entradas = ENTRADAS) {
  const vistos = new Set();
  const errores = [];
  for (const e of entradas) {
    if (vistos.has(e.id)) errores.push(`id repetido: ${e.id}`);
    vistos.add(e.id);
    if (!["windows", "wsl"].includes(e.ambito)) errores.push(`${e.id}: ámbito inválido`);
    if (!["seguro", "datos", "distro", "nunca"].includes(e.quitar)) errores.push(`${e.id}: quitar inválido`);
    if (!/^\d+\.\d+\.\d+$/.test(e.desde || "")) errores.push(`${e.id}: desde inválido`);
    if (e.hasta != null && (!/^\d+\.\d+\.\d+$/.test(e.hasta) || comparar(e.hasta, e.desde) <= 0)) errores.push(`${e.id}: hasta inválido`);
    if (!e.ruta || !e.que || !e.grupo || !e.tipo) errores.push(`${e.id}: faltan campos`);
    if (e.auto && e.quitar !== "seguro") errores.push(`${e.id}: sólo lo seguro se quita solo`);
    if (e.quitar === "seguro" && e.ambito === "wsl" && !e.ruta.startsWith("~/") && !e.ruta.startsWith("/etc/")) errores.push(`${e.id}: ruta de WSL fuera de ~ o /etc`);
  }
  return errores;
}

module.exports = { ENTRADAS, VERSION_MANIFIESTO, comparar, vigente, muerta, validar };
