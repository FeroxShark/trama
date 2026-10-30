// `npm run check:changed`: el chequeo rápido para workers. Mira lo que cambió contra main (o contra HEAD~1 si la rama es main)
// y corre sólo lo que toca: tsc de la interfaz y de electron; los tests de app/tests que importan un archivo cambiado (directo
// o por cadena de imports), lo nombran o tienen su nombre; la paridad de las herramientas del motor (o de su port en
// electron/cli) que cambiaron; y los tests de windows/ si tocaron algo ahí. Si cambia la casa de las pruebas (INFRA) o no se
// sabe contra qué comparar, corre todo. El chequeo completo (npm test, npm run test:paridad, windows) sigue antes de cada
// commit a main: éste no lo reemplaza.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAIZ = path.dirname(APP);
const CARPETAS = ["electron", "src", "scripts", "tests"]; // dentro de app/: de ahí sale el grafo de imports
const EXT_CODIGO = /\.(?:[cm]?[jt]s|tsx)$/;
const EXTS = [".ts", ".tsx", ".mts", ".cts", ".mjs", ".js", ".cjs"];
const IMPORTA = /\bfrom\s*["']([^"'\n]+)["']|\bimport\s*\(?\s*["']([^"'\n]+)["']|\brequire\(\s*["']([^"'\n]+)["']\s*\)/g;
// Cambiar cualquiera de estos (rutas dentro de app/) corre todo: la casa de las pruebas y la compilación.
const INFRA = ["scripts/test.mjs", "scripts/aislar-pruebas.mjs", "package.json", "tsconfig.json", "tsconfig.electron.json", "vite.config.ts"];
// Qué herramientas de paridad (campo `herramienta` de cada caso; sin campo = "pa") cubre cada archivo del motor o de su port.
// Una ruta que no está en la tabla corre toda la paridad. [] = no afecta a ningún caso (documentación).
const PARIDAD = [
  [/^motor\/.*\.md$/, []],
  [/^motor\/bin\/pa$/, ["pa", "pa-async", "pa-cli", "motores"]],
  [/^motor\/bin\/reparto$/, ["reparto"]],
  [/^motor\/bin\/tablero$/, ["tablero"]],
  [/^motor\/bin\/cuentas$/, ["cuentas"]],
  [/^motor\/bin\/trama-estado$/, ["trama-estado"]],
  [/^motor\/bin\/workers$/, ["workers"]],
  [/^motor\/bin\/proyecto-ruta$/, ["proyecto-ruta"]],
  [/^motor\/hooks\/latido\.(sh|mjs)$/, ["latido"]],
  [/^motor\/hooks\/destructive-guard\.(sh|mjs)$/, ["destructive-guard"]],
  [/^motor\/hooks\/statusline-espejo\.(sh|mjs)$/, ["statusline-espejo"]],
  [/^motor\/hooks\/agy-pa\.(sh|mjs)$/, ["agy-pa"]],
  [/^motor\/opencode\//, ["motores"]],
  [/^app\/electron\/cli\/pa\.ts$/, ["pa", "pa-async", "pa-cli"]],
  [/^app\/electron\/cli\/(reparto|reparto-py)\.ts$/, ["reparto"]],
  [/^app\/electron\/cli\/tablero(-args|-ayuda)?\.ts$/, ["tablero"]],
  [/^app\/electron\/cli\/cuentas(-ayuda)?\.ts$/, ["cuentas"]],
  [/^app\/electron\/cli\/trama-estado\.ts$/, ["trama-estado"]],
  [/^app\/electron\/cli\/workers(-formato)?\.ts$/, ["workers"]],
  [/^app\/electron\/cli\/proyecto-ruta\.ts$/, ["proyecto-ruta"]],
  [/^app\/electron\/cli\/hooks\.ts$/, ["latido", "destructive-guard", "statusline-espejo", "agy-pa"]],
  [/^app\/electron\/cli\/plugin-agy\.ts$/, ["agy-pa"]],
];
const SIN_TABLA = /^(motor\/|app\/electron\/cli\/)/; // dentro de estas carpetas, lo que no está en PARIDAD corre toda la paridad

/** Qué correr. `cambiados`: rutas del repo (posix) que cambiaron, o null si no se sabe contra qué comparar (corre todo).
 *  `archivos`: [{ ruta, texto, importa }] de app/ (ruta posix relativa a app/, importa = rutas de app/ que importa).
 *  Devuelve { completo, pruebas: [nombre.test.ts], paridad: null | "todas" | [herramientas], windows, motivos: [texto] }. */
export function elegir(cambiados, archivos) {
  const cambios = cambiados ?? [];
  const enApp = cambios.filter((r) => r.startsWith("app/")).map((r) => r.slice(4));
  const todo = cambiados === null || enApp.some((r) => INFRA.includes(r));
  const pruebasTop = archivos.filter((f) => /^tests\/[^/]+\.test\.ts$/.test(f.ruta));
  const motivos = [];

  // Grafo inverso (quién importa a quién) y recorrido desde los cambiados hacia quienes los importan.
  const importadoPor = new Map();
  for (const f of archivos) for (const d of f.importa) importadoPor.set(d, [...(importadoPor.get(d) ?? []), f.ruta]);
  const alcanzados = new Set(enApp);
  const cola = [...enApp];
  while (cola.length) {
    const r = cola.shift();
    for (const q of importadoPor.get(r) ?? []) {
      if (alcanzados.has(q)) continue;
      alcanzados.add(q);
      cola.push(q);
      motivos.push(`${q}: importa a ${r}`);
    }
  }

  const seleccion = new Set();
  if (todo) for (const f of pruebasTop) seleccion.add(f.ruta);
  for (const f of pruebasTop) if (alcanzados.has(f.ruta)) seleccion.add(f.ruta);

  // Por nombre: `x.test.ts` cuando el archivo cambiado se llama `x` (o una de sus palabras, si tiene 4+ letras).
  // Por mención: el test escribe la ruta del archivo cambiado (lee un fixture, un .css, un script).
  const claves = cambios.map((r) => (r.startsWith("app/") ? r.slice(4) : r)).filter((k) => k.includes("/"));
  for (const f of pruebasTop) {
    if (seleccion.has(f.ruta)) continue;
    const stem = path.posix.basename(f.ruta).replace(/\.test\.ts$/, "").toLowerCase().split("-");
    for (const r of enApp) {
      const palabras = path.posix.basename(r).replace(/\.[^.]+$/, "").toLowerCase().split("-");
      if (palabras.some((p) => p.length >= 4 && stem.includes(p))) {
        seleccion.add(f.ruta);
        motivos.push(`${f.ruta}: nombre de ${r}`);
        break;
      }
    }
    const k = claves.find((c) => f.texto.includes(c));
    if (!seleccion.has(f.ruta) && k) {
      seleccion.add(f.ruta);
      motivos.push(`${f.ruta}: nombra ${k}`);
    }
  }

  // Paridad: los casos de las herramientas que cambiaron; todo si toca tests/paridad (cambiado o alcanzado), algo sin tabla o
  // la casa de las pruebas. `alcanzados` incluye lo cambiado: un cambio en tests/paridad/ cae ahí solo.
  let paridad = null;
  const herramientas = new Set();
  for (const r of cambios) {
    const regla = PARIDAD.find(([re]) => re.test(r));
    if (regla) regla[1].forEach((h) => herramientas.add(h));
    else if (SIN_TABLA.test(r)) paridad = "todas";
  }
  if ([...alcanzados].some((r) => r.startsWith("tests/paridad/")) || todo || paridad === "todas") paridad = "todas";
  else if (herramientas.size) paridad = [...herramientas].sort();

  const windows = cambios.some((r) => r.startsWith("windows/")) || todo;
  return { completo: todo, pruebas: [...seleccion].map((r) => path.posix.basename(r)), paridad, windows, motivos };
}

// ── Lo que lee del repo y de git (no cubierto por elegir) ──────────────────────────────────────────────────────

const git = (...args) => {
  const r = spawnSync("git", args, { cwd: RAIZ, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** La base contra la que se compara: el punto donde la rama se separó de main; si la rama es main, el commit anterior. */
function baseDeComparacion() {
  const head = git("rev-parse", "HEAD");
  const bifurcacion = git("merge-base", "HEAD", "main");
  if (bifurcacion && head && bifurcacion !== head) return bifurcacion;
  return git("rev-parse", "--verify", "-q", "HEAD~1");
}

/** Lo que cambió desde `base` hasta el árbol de trabajo (commits y sin commitear), más los archivos nuevos sin trackear. */
function cambiadosDesde(base) {
  const sinNodeModules = (r) => r && !r.split("/").includes("node_modules");
  const trackeados = (git("-c", "core.quotepath=off", "diff", "--name-only", base) ?? "").split("\n");
  const nuevos = (git("-c", "core.quotepath=off", "ls-files", "--others", "--exclude-standard") ?? "").split("\n");
  return [...new Set([...trackeados, ...nuevos].filter(sinNodeModules))].sort();
}

/** Todos los archivos de código de app/ (electron, src, scripts, tests), con lo que importan. */
function leerArchivos() {
  const rutas = [];
  const visitar = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules" && !e.name.startsWith("dist")) visitar(p);
      } else if (EXT_CODIGO.test(e.name)) rutas.push(p);
    }
  };
  for (const c of CARPETAS) visitar(path.join(APP, c));
  const esArchivo = (p) => statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
  const aRuta = (p) => path.relative(APP, p).split(path.sep).join("/");
  const resolver = (desde, spec) => {
    if (!spec.startsWith(".")) return null;
    const base = path.resolve(path.dirname(desde), spec);
    const sinExt = path.resolve(path.dirname(desde), spec.replace(/\.[cm]?jsx?$/, ""));
    const candidatos = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(sinExt, "index" + e)), ...EXTS.map((e) => sinExt + e)];
    const hallado = candidatos.find(esArchivo);
    return hallado ? aRuta(hallado) : null;
  };
  return rutas.map((p) => {
    const texto = readFileSync(p, "utf8");
    const importa = [];
    for (const m of texto.matchAll(IMPORTA)) {
      const r = resolver(p, m[1] ?? m[2] ?? m[3]);
      if (r) importa.push(r);
    }
    return { ruta: aRuta(p), texto, importa };
  });
}

// ── Ejecución ──────────────────────────────────────────────────────────────────────────────────────────────────

function correr(titulo, cmd, args, { cwd = APP, env = {} } = {}) {
  process.stdout.write(`\n== ${titulo}\n`);
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
  return r.status === 0;
}

function main() {
  const base = baseDeComparacion();
  if (base) process.stdout.write(`check:changed: contra ${base.slice(0, 9)}\n`);
  else process.stdout.write("check:changed: no hay contra qué comparar (sin main ni HEAD~1): corre todo\n");
  const cambiados = base ? cambiadosDesde(base) : null;
  const eleccion = elegir(cambiados, leerArchivos());
  const { completo, pruebas, paridad, windows, motivos } = eleccion;
  process.stdout.write(`cambiados: ${cambiados ? cambiados.length : "?"} · pruebas: ${completo ? "todas" : pruebas.length} · paridad: ${paridad === "todas" ? "toda" : Array.isArray(paridad) ? paridad.join(",") : "no"} · windows: ${windows ? "sí" : "no"}\n`);
  for (const m of motivos) process.stdout.write(`  ${m}\n`);

  const tsc = (proyecto) => [path.join(APP, "node_modules", "typescript", "bin", "tsc"), "-p", proyecto, "--noEmit"];
  const testMjs = path.join(APP, "scripts", "test.mjs");
  if (!correr("tsc interfaz", process.execPath, tsc("tsconfig.json"))) return 1;
  if (!correr("tsc electron", process.execPath, tsc("tsconfig.electron.json"))) return 1;

  if (completo) {
    if (!correr("npm test (todo)", process.execPath, [testMjs])) return 1;
  } else if (pruebas.length) {
    if (!correr(`pruebas afectadas (${pruebas.length})`, process.execPath, [testMjs], { env: { TRAMA_TEST_SOLO: pruebas.join(",") } })) return 1;
  } else {
    process.stdout.write("\n== pruebas: ninguna afectada\n");
  }

  if (paridad === "todas") {
    if (!correr("paridad (toda)", process.execPath, [testMjs, "--paridad"])) return 1;
  } else if (paridad) {
    const env = { TRAMA_TEST_SOLO: "paridad.test.ts", TRAMA_PARIDAD_HERRAMIENTA: paridad.join(",") };
    if (!correr(`paridad (${paridad.join(", ")})`, process.execPath, [testMjs, "--paridad"], { env })) return 1;
  }

  if (windows) {
    const dirWin = path.join(RAIZ, "windows");
    if (!correr("windows: npm test", process.execPath, [path.join(dirWin, "scripts", "test.mjs")], { cwd: dirWin })) return 1;
  }
  process.stdout.write("\ncheck:changed: verde\n");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
