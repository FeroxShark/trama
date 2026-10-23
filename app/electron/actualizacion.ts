// El aviso de Claude Code nuevo (pie de la barra): la versión instalada sale de
// `claude --version` y la última de `npm view @anthropic-ai/claude-code version`,
// los dos por execFile (sin shell) con timeout corto. Se chequea cuando el
// frontend lo pide por primera vez (al abrir) y después cada 6 h; a npm no se le
// vuelve a preguntar si contestó hace menos de 6 h (`claude-version.json` en el
// estado de la app). Si algo falla (sin red, sin npm), silencio: queda lo último
// que se supo. Actualizar es un botón: `claude update` (execFile, sin shell) con el
// mismo `claude` y el mismo PATH con que se lanzan los líderes (lo que se actualiza
// es lo que se lanza). Cada líder resuelve `claude` del PATH al arrancar: los nuevos
// usan la versión nueva al toque; trama no se reinicia; los abiertos siguen con la
// vieja hasta relanzarse (`--resume`, electron/lider.ts `reiniciarOciosos`).
//   HILOS_CLAUDE  el `claude` que se pregunta (el mismo de los líderes; en la prueba, el falso).
//   HILOS_NPM     el `npm` (en la prueba, scripts/npm-falso.sh).
import os from "node:os";
import path from "node:path";
import { ESTADO } from "./pa.js";
import { crearActualizador, versionDe, type Actualizado } from "./actualizador.js";
import { entornoLider } from "./lider-arma.js";

export type { Actualizado };

const HOME = os.homedir();
const CLAUDE = process.env.HILOS_CLAUDE ?? "claude";
const NPM = process.env.HILOS_NPM ?? "npm";
const PAQUETE = "@anthropic-ai/claude-code";
export const CHANGELOG = "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md";

const claude = crearActualizador({
  archivo: path.join(ESTADO, "claude-version.json"),
  bin: CLAUDE,
  nombre: "actualizacion",
  ultima: () => versionDe(NPM, ["view", PAQUETE, "version"], 15_000),
  actualizar: { args: ["update"] },
  // El entorno de los líderes: sin las variables de otra sesión de Claude ni de `pa`.
  entornoActualizar: () => entornoLider(process.env, HOME) as NodeJS.ProcessEnv,
});

export const { leerAviso, descartar, alCambiarAviso, actualizar } = claude;
