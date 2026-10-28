// instalar-nativo — lo que en Linux hace motor/scripts/instalar-producto.sh después de dejar el motor en su lugar, para el Trama
// nativo de Windows (sin bash ni jq): los hooks `.mjs` en ~/.claude/settings.json con el node.exe propio, la skill del líder, las
// plantillas del home (si faltan) y el registry vacío. Lo corre la carcasa (windows/src/pasos-nativo.js) con el node.exe del
// instalador, después de copiar el payload a %LOCALAPPDATA%\trama:
//
//   node.exe <app>\dist-electron\cli\instalar-nativo.js [--json]   (en otro sistema sale con 2 salvo --forzar)
//
// Las líneas son las del instalador de Linux (`ok`, `hecho`, `AVISO`). Sale con 1 si algo quedó con aviso (como `mal=1` allá).
// En Windows la skill se COPIA (un symlink pide privilegios); la copia lleva una marca (`.de-trama`) y una carpeta sin la marca
// no se toca. Lo prueba tests/cli-instalar-nativo.test.ts con las carpetas inyectadas.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { carpetaApp, homeDe, nodeWindows, plataformaActual, registroProyectos } from "../rutas.ts";
import { esPrincipal } from "./base/principal.ts";
import { registrarEnArchivo } from "./hooks.ts";

type Env = Record<string, string | undefined>;
export type Linea = { tipo: "ok" | "hecho" | "aviso"; texto: string };
export type OpcionesInstalar = {
  /** La carpeta de la app instalada (con `hooks\`, `skills\`, `plantillas\`). */
  app: string;
  home: string;
  /** El node.exe con que se corren los hooks. */
  node: string;
  /** `registry.json` de los proyectos. */
  registro: string;
  /** Para armar los comandos de los hooks (en win32 van con `/`). */
  plataforma?: NodeJS.Platform;
};

export const MARCA_SKILL = ".de-trama";
const PLANTILLAS = ["CLAUDE.md", "GEMINI.md"];

/** Las opciones de verdad: las rutas de rutas.ts para esta plataforma (en Windows, las de %LOCALAPPDATA%\trama). */
export function opcionesDe(env: Env = process.env): OpcionesInstalar {
  const plat = plataformaActual();
  const home = homeDe(env, plat);
  return {
    app: carpetaApp(env, home, plat),
    home,
    node: plat === "win32" ? nodeWindows(env, home) : process.execPath,
    registro: registroProyectos(env, home, plat),
    plataforma: plat,
  };
}

/** Copia una carpeta nuestra encima de la anterior (sólo si la anterior también es nuestra). */
function copiarNuestra(de: string, a: string, que: string, out: Linea[]): boolean {
  if (!existsSync(de)) {
    out.push({ tipo: "aviso", texto: `falta ${de}` });
    return false;
  }
  if (existsSync(a) && !existsSync(path.join(a, MARCA_SKILL))) {
    out.push({ tipo: "aviso", texto: `no toco ${a} (no la puso Trama; movela a mano)` });
    return false;
  }
  const habia = existsSync(a);
  rmSync(a, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  mkdirSync(path.dirname(a), { recursive: true });
  cpSync(de, a, { recursive: true });
  writeFileSync(path.join(a, MARCA_SKILL), "copiada por instalar-nativo de Trama: se reemplaza en cada instalación\n");
  out.push({ tipo: "hecho", texto: `${habia ? "actualizada" : "copiada"} ${que}: ${a}` });
  return true;
}

export function instalar(o: OpcionesInstalar): { lineas: Linea[]; mal: boolean } {
  const out: Linea[] = [];
  const claude = path.join(o.home, ".claude");
  mkdirSync(claude, { recursive: true });

  // --- hooks en ~/.claude/settings.json: se agregan, nunca se pisa nada ---
  const hooks = path.join(o.app, "hooks");
  const settings = path.join(claude, "settings.json");
  if (!existsSync(path.join(hooks, "destructive-guard.mjs"))) out.push({ tipo: "aviso", texto: `faltan los hooks en ${hooks}: no registré nada en ${settings}` });
  else {
    const r = registrarEnArchivo(settings, { carpeta: hooks, variante: "mjs", node: o.node, plataforma: o.plataforma });
    if (r.estado === "invalido") out.push({ tipo: "aviso", texto: `${r.motivo}: no lo toqué (registrá a mano destructive-guard.mjs y statusline-espejo.mjs)` });
    else if (r.estado === "ya") out.push({ tipo: "ok", texto: `${settings} ya engancha los hooks` });
    else out.push({ tipo: "hecho", texto: `${settings}: destructive-guard y statusline-espejo registrados${r.copia ? ` (copia: ${r.copia})` : ""}` });
  }

  // --- skills del líder ---
  const skills = path.join(o.app, "skills");
  for (const s of existsSync(skills) ? readdirSync(skills) : []) copiarNuestra(path.join(skills, s), path.join(claude, "skills", s), `la skill ${s}`, out);
  if (!existsSync(skills)) out.push({ tipo: "aviso", texto: `falta ${skills}` });

  // --- home: líder genérico (sólo si no existen) ---
  for (const p of PLANTILLAS) {
    const destino = path.join(o.home, p);
    const origen = path.join(o.app, "plantillas", "home", p);
    if (existsSync(destino)) out.push({ tipo: "ok", texto: `${destino} ya existe (no lo toco)` });
    else if (existsSync(origen)) {
      cpSync(origen, destino);
      out.push({ tipo: "hecho", texto: `${destino} (plantilla)` });
    } else out.push({ tipo: "aviso", texto: `falta la plantilla ${origen}` });
  }

  // --- estado mínimo ---
  if (!existsSync(o.registro)) {
    mkdirSync(path.dirname(o.registro), { recursive: true });
    writeFileSync(o.registro, '{"projects":[]}\n');
    out.push({ tipo: "hecho", texto: `${o.registro} (vacío: agregá tus proyectos)` });
  } else out.push({ tipo: "ok", texto: o.registro });

  return { lineas: out, mal: out.some((l) => l.tipo === "aviso") };
}

const ETIQUETA = { ok: "ok    ", hecho: "hecho ", aviso: "AVISO " } as const;

export function main(argv: string[], env: Env = process.env, out: (s: string) => void = (s) => process.stdout.write(s), o: OpcionesInstalar = opcionesDe(env)): number {
  // Es el instalador de Windows: en otro sistema registraría hooks .mjs encima de los de Linux. `--forzar` es para probarlo.
  if (o.plataforma !== "win32" && !argv.includes("--forzar")) {
    out("instalar-nativo: es sólo para Trama nativo de Windows (en Linux está motor/scripts/instalar-producto.sh)\n");
    return 2;
  }
  let r: ReturnType<typeof instalar>;
  try {
    r = instalar(o);
  } catch (e) {
    out(argv.includes("--json") ? `${JSON.stringify({ lineas: [{ tipo: "aviso", texto: String((e as Error).message) }], mal: true })}\n` : `AVISO  ${(e as Error).message}\n`);
    return 1;
  }
  out(argv.includes("--json") ? `${JSON.stringify(r)}\n` : r.lineas.map((l) => `${ETIQUETA[l.tipo]} ${l.texto}\n`).join(""));
  return r.mal ? 1 : 0;
}

if (esPrincipal(import.meta.url)) process.exitCode = main(process.argv.slice(2));
