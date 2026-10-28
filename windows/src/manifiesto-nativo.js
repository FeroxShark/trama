"use strict";
// Lo que el Trama nativo de Windows (sin WSL) deja fuera de la carpeta de la app, con las mismas reglas y campos que
// manifiesto.js (ver ahí): es la lista que usa el desinstalador (`--desinstalar`) en modo nativo. Todo es del lado de
// Windows; de manifiesto.js se toman las entradas de la carcasa que valen igual (la instalación, el caché del actualizador,
// los datos de la carcasa) y se dejan las de WSL (RunOnce, .wslconfig, el componente WSL, la distro).
//
// Las rutas son las de app/electron/rutas.ts en win32 (%LOCALAPPDATA%\trama\…) y windows/src/nativo.js (rutasNativas).

const { ENTRADAS } = require("./manifiesto");

// OJO con %APPDATA%\\Trama: es la carpeta de la Trama nativa vieja (su cuentas.json y cuentas\\, que `cuentas importar-perfiles` sólo lee y
// copia). La carcasa nativa guarda lo suyo en %APPDATA%\\Trama-nativo (main.js) y esa es la única que este manifiesto ofrece quitar: el
// desinstalador nativo nunca toca %APPDATA%\\Trama.
const DE_LA_CARCASA = ["win-instalacion", "win-cache-actualizador"];

const nativa = (id, campos) => ({ id, ambito: "windows", grupo: "motor-nativo", desde: "0.2.0", hasta: null, auto: false, ...campos });

const ENTRADAS_NATIVO = [
  ...ENTRADAS.filter((e) => DE_LA_CARCASA.includes(e.id)),
  nativa("win-nativo-carcasa", {
    tipo: "carpeta",
    ruta: "%APPDATA%\\Trama-nativo",
    que: "Los ajustes de la app de Windows, su registro (carcasa.log) y el estado del asistente",
    quitar: "datos",
  }),
  nativa("win-nativo-arranque", {
    tipo: "registro",
    ruta: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run|Trama",
    que: "Entrada del registro que abre Trama en segundo plano al iniciar sesión (para que el motor esté andando)",
    quitar: "seguro",
  }),
  nativa("win-nativo-path", {
    tipo: "path",
    ruta: "%LOCALAPPDATA%\\trama\\bin",
    que: "La carpeta de los comandos de Trama (pa, trama-estado…) en el PATH de tu usuario",
    quitar: "seguro",
  }),
  nativa("win-nativo-app", { tipo: "carpeta", ruta: "%LOCALAPPDATA%\\trama\\app", que: "El motor de Trama y sus hooks", quitar: "seguro" }),
  nativa("win-nativo-node", { tipo: "carpeta", ruta: "%LOCALAPPDATA%\\trama\\node", que: "El Node.js propio de Trama (node.exe)", quitar: "seguro" }),
  nativa("win-nativo-bin", { tipo: "carpeta", ruta: "%LOCALAPPDATA%\\trama\\bin", que: "Los comandos de Trama (pa.cmd, trama-estado.cmd…)", quitar: "seguro" }),
  nativa("win-nativo-run", { tipo: "carpeta", ruta: "%LOCALAPPDATA%\\trama\\run", que: "Archivos de cuando el motor está andando", quitar: "seguro" }),
  nativa("win-nativo-skill", {
    tipo: "carpeta",
    ruta: "%USERPROFILE%\\.claude\\skills\\trama-orquestar",
    que: "La skill «trama-orquestar» de Claude Code (copiada por Trama)",
    quitar: "seguro",
  }),
  nativa("win-nativo-estado", {
    tipo: "carpeta",
    ruta: "%LOCALAPPDATA%\\trama\\estado",
    que: "El estado de Trama: los hilos, el tablero, el historial de los workers",
    quitar: "datos",
  }),
  nativa("win-nativo-config", {
    tipo: "carpeta",
    ruta: "%LOCALAPPDATA%\\trama\\config",
    que: "La configuración de Trama: tus proyectos, modelos y el token de esta instalación",
    quitar: "datos",
  }),
  nativa("win-nativo-wt", {
    grupo: "sistema",
    tipo: "compartido",
    ruta: "%LOCALAPPDATA%\\trama\\wt",
    que: "Los worktrees de los workers en %LOCALAPPDATA%\\trama\\wt (puede haber trabajo sin integrar: revisalo antes de borrarlo)",
    quitar: "nunca",
  }),
  nativa("win-nativo-hooks", {
    grupo: "sistema",
    tipo: "compartido",
    ruta: "%USERPROFILE%\\.claude\\settings.json",
    que: "Los hooks de Trama en ~/.claude/settings.json (destructive-guard y statusline-espejo; sacalos a mano si ya no usás Trama)",
    quitar: "nunca",
  }),
];

module.exports = { ENTRADAS_NATIVO };
