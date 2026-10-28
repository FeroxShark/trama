// Casos de paridad de los globales de medición y modelos: `pa --bien`, `--bien-auto`, `--rinde` (con `--por` y `--rubrica`),
// `--modelos`, `--cupo-gemini` y `--gemini-proyectos` (app/electron/cli/pa/medicion.ts, rinde.ts y tabla-modelos.ts) contra el bash.
// Los datos se arman con la fecha de hoy (las ventanas de días y de horas cuentan desde ahora) y se comparan la salida, el código
// y medicion.tsv / lecciones.md que queda en el estado.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";

const HEADER =
  "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta\tfase\ttarea\trubrica\trub_fila\trub_modelo\trub_effort";
const COLS = HEADER.split("\t");
const HEADER_VIEJO = COLS.slice(0, 13).join("\t");

const hace = (horas: number) => new Date(Date.now() - horas * 3600_000);
const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "+00:00");
const epoch = (d: Date) => Math.floor(d.getTime() / 1000);
/** Una fila de medicion.tsv por nombre de columna (lo que falta queda vacío). */
const fila = (o: Record<string, string | number>) => COLS.map((c) => String(o[c] ?? "")).join("\t");
const M = "claude-sonnet-5-5";
const H = "claude-haiku-5-5";

/** Escribe un archivo del estado del sandbox. */
const estado = (c: Contexto, rel: string, texto: string) => {
  const f = path.join(c.estado, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, texto);
};
const medicion = (...filas: string[]) => (c: Contexto) => estado(c, "medicion.tsv", `${[HEADER, ...filas].join("\n")}\n`);
const archivo = (rel: string, texto: string) => (c: Contexto) => {
  const f = path.join(c.aux, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, texto);
};
const ejecutable = (c: Contexto, rel: string, texto: string) => {
  archivo(rel, texto)(c);
  chmodSync(path.join(c.aux, rel), 0o755);
};
const todo = (...fs: ((c: Contexto) => void)[]) => (c: Contexto) => fs.forEach((f) => f(c));

const pcli = (nombre: string, args: Caso["args"], rc: number, extra: Partial<Caso> = {}): Caso => ({ herramienta: "pa-cli", nombre: `medicion: ${nombre}`, args, rc, ...extra });

// ------------------------------------------------------------------------------------------- datos de --rinde

/** Corridas de los últimos días para --rinde: tipos, modelos, efforts, cuentas, fases, tareas y la rúbrica. */
const datosRinde = (c: Contexto) =>
  medicion(
    fila({ fecha: iso(hace(2)), id: "r1", proyecto: "proy", modelo: M, effort: "high", num_turns: 10, costo_usd: "0.50", compactaciones: 0, tipo: "codigo-acotado", integrada: 1, retrabajo: 0, fase: "F5", tarea: "t1", rubrica: "A=chico B=ejecutar C=completo D=bajo E=si", rub_fila: 10, rub_modelo: H, rub_effort: "xhigh" }),
    fila({ fecha: iso(hace(3)), id: "r2", proyecto: "proy", modelo: M, effort: "high", num_turns: 20, costo_usd: "0.75", compactaciones: 2, tipo: "codigo-acotado", integrada: 1, retrabajo: 1, fase: "F5", tarea: "t1" }),
    fila({ fecha: iso(hace(4)), id: "r3", proyecto: "proy", modelo: M, effort: "high", num_turns: 31, costo_usd: "0.125", compactaciones: 0, tipo: "codigo-acotado", integrada: 0, fase: "F6", tarea: "t2" }),
    fila({ fecha: iso(hace(5)), id: "r4", proyecto: "proy", modelo: M, effort: "high", num_turns: 7, costo_usd: "1", compactaciones: 0, tipo: "codigo-acotado", integrada: 1, retrabajo: 0, fase: "F6", tarea: "t2" }),
    fila({ fecha: iso(hace(6)), id: "r5", proyecto: "proy", modelo: M, effort: "high", num_turns: 12, tipo: "codigo-acotado", integrada: 1, retrabajo: 0 }),
    fila({ fecha: iso(hace(7)), id: "r6", proyecto: "proy", modelo: M, effort: "high", num_turns: 15, tipo: "codigo-acotado", integrada: 1, retrabajo: 0 }),
    fila({ fecha: iso(hace(8)), id: "r7", proyecto: "proy", modelo: M, effort: "high", num_turns: 9, tipo: "codigo-acotado", integrada: 1, retrabajo: 0 }),
    fila({ fecha: iso(hace(9)), id: "r8", proyecto: "proy", modelo: M, effort: "high", num_turns: 11, tipo: "codigo-acotado", integrada: 1, retrabajo: 1 }),
    fila({ fecha: iso(hace(10)), id: "r9", proyecto: "proy", modelo: H, effort: "xhigh", num_turns: 4, costo_usd: "0.05", tipo: "mecanico", integrada: 1, retrabajo: 0, rubrica: "A=chico B=ejecutar C=completo D=bajo E=si", rub_fila: 10, rub_modelo: H, rub_effort: "xhigh" }),
    fila({ fecha: iso(hace(11)), id: "r10", proyecto: "proy", modelo: "opencode:opencode/big-pickle", effort: "-", num_turns: 3, tipo: "mecanico", cuenta: "opencode", integrada: 1, retrabajo: 0, rubrica: "A=chico B=ejecutar C=completo D=bajo E=si M=si", rub_fila: 9, rub_modelo: "opencode:opencode/glm-5.3-flash-free", rub_effort: "" }),
    fila({ fecha: iso(hace(12)), id: "r11", proyecto: "proy", modelo: M, effort: "high", num_turns: 25, tipo: "", cuenta: "claude", rubrica: "A=mediano B=decidir C=completo D=bajo E=si", rub_fila: "5", rub_modelo: M, rub_effort: "high" }),
    fila({ fecha: iso(hace(13)), id: "r12", proyecto: "proy", modelo: M, effort: "", num_turns: 8, tipo: "debug", rubrica: "A=chico B=ejecutar C=parcial D=bajo E=si", rub_fila: "7", rub_modelo: H, rub_effort: "xhigh" }),
    fila({ fecha: iso(hace(14)), id: "r13", proyecto: "proy", modelo: M, effort: "high", num_turns: 6, tipo: "debug", integrada: 1, retrabajo: 0, rubrica: "A=grande I=si", rub_fila: "1b", rub_modelo: M, rub_effort: "high" }),
    // fuera de la ventana de 30 días y una fila corta (sólo las 13 viejas)
    fila({ fecha: iso(hace(24 * 40)), id: "viejo", proyecto: "proy", modelo: M, effort: "high", num_turns: 99, tipo: "debug", integrada: 1, retrabajo: 0, rub_fila: 2 }),
    `${iso(hace(1))}\tcorta\tproy\t${M}\thigh\t0\t0\t0\t5`,
  )(c);

// ------------------------------------------------------------------------------------------- datos de --bien-auto

const integradas = (c: Contexto, ...filas: string[][]) =>
  estado(c, "integradas.tsv", `${["fecha\tid\tproyecto\trama\trama_ppal\thead_antes\thead_despues\tcommits\tauto\taccion", ...filas.map((f) => f.join("\t"))].join("\n")}\n`);
const hilo = (c: Contexto, id: string, campos: Record<string, string | number>) =>
  estado(c, `proy/${id}.hilo`, `${Object.entries(campos).map(([k, v]) => `${k}=${v}`).join("\n")}\n`);
const SHA = "a".repeat(40);

/** Un abanico de corridas: integradas hace tiempo, a las que se volvió, descartadas, revertidas, sin integrar, recientes… */
const datosBienAuto = todo(
  (c) =>
    medicion(
      fila({ fecha: iso(hace(24 * 11)), id: "b1", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0, tipo: "codigo-acotado" }),
      fila({ fecha: iso(hace(24 * 4)), id: "b2", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0, tipo: "debug" }),
      fila({ fecha: iso(hace(24 * 3)), id: "b3", proyecto: "proy", modelo: H, effort: "xhigh", leer: 0, seguir: 0, tipo: "mecanico" }),
      fila({ fecha: iso(hace(24 * 3)), id: "b4", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0 }),
      fila({ fecha: iso(hace(24 * 5)), id: "b5", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0 }),
      fila({ fecha: iso(hace(24 * 12)), id: "b6", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0 }),
      fila({ fecha: iso(hace(24 * 12)), id: "b7", proyecto: "proy", modelo: M, effort: "high", leer: 1, seguir: 0 }),
      fila({ fecha: iso(hace(24 * 12)), id: "b8", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0, bien: "parcial" }),
      fila({ fecha: iso(hace(2)), id: "b9", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0 }),
      `${iso(hace(24 * 12))}\tb10\tproy\t${M}\thigh\t0\t0\t0\t5`,
      // una corrida que arrancó después de la integración de la rama de su origen no la cubre esa fila
      fila({ fecha: iso(hace(24 * 9)), id: "b11", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 1 }),
    )(c),
  (c) =>
    integradas(
      c,
      [iso(hace(24 * 10)), "b1", "proy", "pa/proy/b1", "main", SHA, SHA, "2", "0", "integrada"],
      [iso(hace(24 * 4)), "b2", "proy", "pa/proy/b2", "main", SHA, SHA, "1", "0", "integrada"],
      [iso(hace(24 * 3)), "b3", "proy", "pa/proy/b3", "main", SHA, SHA, "1", "0", "descartada"],
      [iso(hace(24 * 3)), "b4", "proy", "pa/proy/b4", "main", SHA, SHA, "1", "0", "integrada"],
      [iso(hace(24 * 2)), "b4", "proy", "pa/proy/b4", "main", SHA, SHA, "1", "0", "revertida"],
      [iso(hace(24 * 10)), "b6", "proy", "pa/proy/b6", "main", SHA, SHA, "1", "0", "integrada"],
      [iso(hace(24 * 12)), "b8", "proy", "pa/proy/b8", "main", SHA, SHA, "1", "0", "integrada"],
      [iso(hace(1)), "b9", "proy", "pa/proy/b9", "main", SHA, SHA, "1", "0", "integrada"],
      [iso(hace(24 * 10)), "b10", "proy", "pa/proy/b10", "main", SHA, SHA, "1", "0", "integrada"],
    ),
  (c) => hilo(c, "b1", { inicio: epoch(hace(24 * 11)), rama: "pa/proy/b1" }),
  (c) => hilo(c, "b2", { inicio: epoch(hace(24 * 4)), rama: "pa/proy/b2" }),
  (c) => hilo(c, "b3", { inicio: epoch(hace(24 * 3)), rama: "pa/proy/b3", tarea: "tarea que se descartó" }),
  (c) => hilo(c, "b5", { inicio: epoch(hace(24 * 5)), rama: "pa/proy/b5" }),
  // b6 se retomó (--seguir) tres días después de integrarla: parcial
  (c) => hilo(c, "b6", { inicio: epoch(hace(24 * 12)), rama: "pa/proy/b6" }),
  (c) => hilo(c, "b11", { origen: "b6", inicio: epoch(hace(24 * 9)), rama: "pa/proy/b11" }),
  // b9 se retomó a la hora de integrarla: retrabajo
  (c) => hilo(c, "b9", { inicio: epoch(hace(2)), rama: "pa/proy/b9" }),
  (c) => hilo(c, "b12", { origen: "b9", inicio: epoch(hace(0.5)), rama: "pa/proy/b12" }),
);

/** Dos integraciones seguidas sobre las mismas líneas: la segunda pisa lo que escribió la primera (retrabajo por líneas). */
function datosLineas(c: Contexto) {
  const git = (...a: string[]) => {
    const r = spawnSync("git", ["-C", c.proyecto, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
    return r.stdout.trim();
  };
  const escribir = (txt: string) => writeFileSync(path.join(c.proyecto, "f.txt"), txt);
  escribir("uno\ndos\ntres\n");
  git("add", "f.txt");
  git("commit", "-q", "-m", "base");
  const c0 = git("rev-parse", "HEAD");
  escribir("uno\nDOS\ntres\n");
  git("commit", "-q", "-am", "primera");
  const c1 = git("rev-parse", "HEAD");
  escribir("uno\nDOS 2\ntres\n");
  git("commit", "-q", "-am", "segunda");
  const c2 = git("rev-parse", "HEAD");
  escribir("uno\nDOS 2\ntres\ncuatro\n");
  git("commit", "-q", "-am", "tercera");
  const c3 = git("rev-parse", "HEAD");
  medicion(
    fila({ fecha: iso(hace(24 * 3)), id: "g1", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0 }),
    fila({ fecha: iso(hace(24 * 3)), id: "g2", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0 }),
    fila({ fecha: iso(hace(24 * 3)), id: "g3", proyecto: "proy", modelo: M, effort: "high", leer: 0, seguir: 0 }),
  )(c);
  integradas(
    c,
    [iso(hace(24 * 3)), "g1", "proy", "pa/proy/g1", "main", c0, c1, "1", "0", "integrada"],
    [iso(hace(24 * 3 - 1)), "g2", "proy", "pa/proy/g2", "main", c1, c2, "1", "0", "integrada"],
    [iso(hace(24 * 3 - 2)), "g3", "proy", "pa/proy/g3", "main", c2, c3, "1", "0", "integrada"],
  );
  for (const id of ["g1", "g2", "g3"]) hilo(c, id, { inicio: epoch(hace(24 * 3)), rama: `pa/proy/${id}` });
}

// ------------------------------------------------------------------------------------------- datos de --modelos

const FALSO_REPARTO = `#!/bin/sh
case "$*" in
  "--tipo codigo-acotado --json") echo '{"modelo":"claude-sonnet-5-5","effort":"high","motivo":"hay cupo\\ty sobra"}' ;;
  "--tipo mecanico --json") echo '{"modelo":"claude-haiku-5-5","effort":null,"motivo":"barato | y rápido"}' ;;
  "--tipo debug --json") echo '{"modelo":"agy:claude-opus-5-5-high","effort":"high","motivo":""}' ;;
  "--tipo "*) echo '{"modelo":"claude-sonnet-5-5","effort":"medium","motivo":"por defecto"}' ;;
  "--tabla --json") echo '{"modelos":[{"id":"claude-sonnet-5-5","calidad":52,"estimada":false,"gratis":false,"permitido":true},{"id":"claude-haiku-5-5","calidad":41.5,"estimada":true,"gratis":false,"permitido":true},{"id":"claude-sonnet-5-5","calidad":99,"estimada":false,"gratis":false,"permitido":true},{"id":"opencode:opencode/big-pickle","calidad":30,"estimada":true,"gratis":true,"permitido":false}]}' ;;
  "--cupos"*) echo "cupos: $* en $REPARTO_STATE ($PA_STATE)"; echo "aviso del reparto" >&2; exit 3 ;;
  *) echo "reparto: $*" >&2; exit 9 ;;
esac
`;
const MODELOS_JSON = {
  version: 1,
  workers: { default: { modelo: "claude-sonnet-5-5", effort: "medium" }, mecanico: { modelo: "claude-haiku-5-5" }, debug: { modelo: "agy:claude-opus-5-5-high", effort: "high" }, final: { modelo: "claude-opus-5-5" }, lectura: { modelo: "ollama:local" } },
  lider: { modelo: "claude-opus-5-5", effort: "medium" },
  excluir: ["fable", "agy:*"],
  reserva: 0.25,
  sin_cupo: "esperar",
  permitir_max: true,
  locales: [{ id: "ollama:local", nombre: "Mi modelo", url: "http://127.0.0.1:1", modelo: "qwen3-coder:30b" }],
};
const conModelos = (conf: unknown) => (c: Contexto) => {
  archivo("modelos.json", typeof conf === "string" ? conf : JSON.stringify(conf))(c);
  return { TRAMA_MODELOS: path.join(c.aux, "modelos.json"), OLLAMA_HOST: "127.0.0.1:1" };
};
/** Sin dsh ni opencode de verdad: el sandbox no depende de lo que haya instalado. */
const sinMotores = (c: Contexto) => ({ HILOS_DSH: path.join(c.aux, "no-hay-dsh"), HILOS_OPENCODE: path.join(c.aux, "no-hay-opencode"), OLLAMA_HOST: "127.0.0.1:1" });
const OPENCODE_FALSO = `#!/bin/sh
printf 'opencode/big-pickle\\n\\033[32mopencode/glm-free\\033[0m\\nopencode/pago-caro\\nopencode/otro-free\\nanthropic/claude\\n'
`;

export const casosMedicion: Caso[] = [
  // --- --bien ---
  pcli("bien sin argumentos", ["--bien"], 2),
  pcli("bien con un valor que no va", ["--bien", "x1", "tal"], 2),
  pcli("bien sin medicion.tsv", ["--bien", "x1", "si"], 1),
  pcli("bien con una corrida que no existe", ["--bien", "nada", "si"], 1, { preparar: datosRinde }),
  pcli("bien anota la columna 13", ["--bien", "r1", "parcial"], 0, { preparar: datosRinde }),
  pcli("bien completa una fila corta", ["--bien", "corta", "no"], 0, { preparar: datosRinde }),
  pcli("bien con el id «id» (el header también cuenta)", ["--bien", "proyecto", "si"], 0, { preparar: medicion(fila({ fecha: iso(hace(1)), id: "x", proyecto: "proy" })) }),

  // --- --rinde ---
  pcli("rinde sin medicion.tsv", ["--rinde"], 0),
  pcli("rinde --json sin medicion.tsv", ["--rinde", "--json"], 0),
  pcli("rinde por tipo", ["--rinde"], 0, { preparar: datosRinde }),
  pcli("rinde --json", ["--rinde", "--json"], 0, { preparar: datosRinde }),
  pcli("rinde --dias 1", ["--rinde", "--dias", "1"], 0, { preparar: datosRinde }),
  pcli("rinde --dias 0042 --json", ["--rinde", "--dias", "0042", "--json"], 0, { preparar: datosRinde }),
  pcli("rinde por fase", ["--rinde", "--por", "fase"], 0, { preparar: datosRinde }),
  pcli("rinde por tarea --json", ["--rinde", "--por", "tarea", "--json"], 0, { preparar: datosRinde }),
  pcli("rinde --por tipo explícito", ["--rinde", "--por", "tipo"], 0, { preparar: datosRinde }),
  pcli("rinde --rubrica", ["--rinde", "--rubrica"], 0, { preparar: datosRinde }),
  pcli("rinde --rubrica --json", ["--rinde", "--rubrica", "--json"], 0, { preparar: datosRinde }),
  pcli("rinde --rubrica sin datos", ["--rinde", "--rubrica"], 0),
  pcli("rinde --rubrica --json sin datos", ["--rinde", "--json", "--rubrica"], 0),
  pcli("rinde --rubrica con --por fase", ["--rinde", "--rubrica", "--por", "fase"], 2),
  pcli("rinde --dias que no es un número", ["--rinde", "--dias", "tres"], 2),
  pcli("rinde --dias sin valor", ["--rinde", "--dias"], 2),
  pcli("rinde --por que no existe", ["--rinde", "--por", "modelo"], 2),
  pcli("rinde con una opción desconocida", ["--rinde", "--tabla"], 2),
  pcli("rinde con el medicion.tsv de antes (header corto)", ["--rinde"], 0, { preparar: (c) => estado(c, "medicion.tsv", `${HEADER_VIEJO}\n${iso(hace(1))}\ta\tproy\t${M}\thigh\t0\t0\t0\t5\t60\t100\t0.2\t\n`) }),

  // --- --bien-auto ---
  pcli("bien-auto sin medicion.tsv", ["--bien-auto"], 1),
  pcli("bien-auto completa bien, integrada y retrabajo", ["--bien-auto"], 0, { preparar: datosBienAuto }),
  {
    herramienta: "pa-cli",
    nombre: "medicion: bien-auto dos veces (la segunda no cambia nada)",
    preparar: datosBienAuto,
    pasos: [{ args: ["--bien-auto"], rc: 0 }, { args: ["--bien-auto"], rc: 0 }],
  },
  pcli("bien-auto con PA_BIEN_DIAS y PA_RETRABAJO_HORAS", ["--bien-auto"], 0, { preparar: datosBienAuto, env: { PA_BIEN_DIAS: "2", PA_RETRABAJO_HORAS: "100" } }),
  pcli("bien-auto con valores que no son números", ["--bien-auto"], 0, { preparar: datosBienAuto, env: { PA_BIEN_DIAS: "x", PA_RETRABAJO_HORAS: "-3" } }),
  pcli("bien-auto sin integradas.tsv ni hilos", ["--bien-auto"], 0, { preparar: datosRinde }),
  pcli("bien-auto actualiza el header viejo", ["--bien-auto"], 0, { preparar: (c) => estado(c, "medicion.tsv", `${HEADER_VIEJO}\n${iso(hace(24 * 12))}\tv1\tproy\t${M}\thigh\t0\t0\t0\t5\t60\t100\t0.2\t\n`) }),
  pcli("bien-auto marca el retrabajo por líneas pisadas (git blame)", ["--bien-auto"], 0, { preparar: datosLineas }),

  // --- --modelos ---
  pcli("modelos sin archivo", ["--modelos"], 0, { env: sinMotores }),
  pcli("modelos --json sin archivo", ["--modelos", "--json"], 0, { env: sinMotores }),
  pcli("modelos con un argumento que no va", ["--modelos", "--tabla"], 2),
  pcli("modelos con modelos.json", ["--modelos"], 0, { env: (c) => ({ ...conModelos(MODELOS_JSON)(c), ...sinMotores(c) }) }),
  pcli("modelos --json con modelos.json", ["--modelos", "--json"], 0, { env: (c) => ({ ...conModelos(MODELOS_JSON)(c), ...sinMotores(c) }) }),
  pcli("modelos con el modelos.json vacío de excluir", ["--modelos"], 0, { env: (c) => ({ ...conModelos({ version: 1, excluir: [], plan: 1 })(c), ...sinMotores(c) }) }),
  pcli("modelos con un modelos.json roto", ["--modelos"], 0, { env: (c) => ({ ...conModelos("{no es json")(c), ...sinMotores(c) }) }),
  pcli("modelos --json con un modelos.json que no va", ["--modelos", "--json"], 0, { env: (c) => ({ ...conModelos({ version: 2 })(c), ...sinMotores(c) }) }),
  pcli("modelos con perfil sin_cupo viejo (gemini.sin_claude)", ["--modelos"], 0, { env: (c) => ({ ...conModelos({ version: 1, gemini: { sin_claude: "fallar" }, reserva: { "5h": 0.5 } })(c), ...sinMotores(c) }) }),
  pcli("modelos con plan max", ["--modelos"], 0, { env: (c) => ({ ...conModelos({ version: 1, workers: { final: { modelo: "claude-opus-5-5" } } })(c), ...sinMotores(c), PA_PLAN: "max" }) }),
  pcli("modelos con reparto automático", ["--modelos"], 0, {
    preparar: (c) => ejecutable(c, "reparto", FALSO_REPARTO),
    env: (c) => ({ ...sinMotores(c), PA_REPARTO: path.join(c.aux, "reparto") }),
  }),
  pcli("modelos --json con reparto automático", ["--modelos", "--json"], 0, {
    preparar: (c) => ejecutable(c, "reparto", FALSO_REPARTO),
    env: (c) => ({ ...conModelos(MODELOS_JSON)(c), ...sinMotores(c), PA_REPARTO: path.join(c.aux, "reparto") }),
  }),
  pcli("modelos con opencode y dsh instalados", ["--modelos"], 0, {
    preparar: todo((c) => ejecutable(c, "opencode", OPENCODE_FALSO), (c) => ejecutable(c, "dsh", "#!/bin/sh\nexit 0\n")),
    env: (c) => ({ HILOS_OPENCODE: path.join(c.aux, "opencode"), HILOS_DSH: path.join(c.aux, "dsh"), DEEPSEEK_API_KEY: "clave", OLLAMA_HOST: "127.0.0.1:1" }),
  }),
  pcli("modelos --json con opencode y dsh instalados sin key", ["--modelos", "--json"], 0, {
    preparar: todo((c) => ejecutable(c, "opencode", OPENCODE_FALSO), (c) => ejecutable(c, "dsh", "#!/bin/sh\nexit 0\n")),
    env: (c) => ({ HILOS_OPENCODE: path.join(c.aux, "opencode"), HILOS_DSH: path.join(c.aux, "dsh"), OLLAMA_HOST: "127.0.0.1:1" }),
  }),

  // --- --cupo-gemini y --gemini-proyectos ---
  pcli("cupo-gemini sin reparto", ["--cupo-gemini"], 1, { env: { PA_REPARTO: "/no/existe/reparto" } }),
  pcli("cupo-gemini pasa los argumentos a reparto --cupos", ["--cupo-gemini", "--json"], 3, { preparar: (c) => ejecutable(c, "reparto", FALSO_REPARTO), env: (c) => ({ PA_REPARTO: path.join(c.aux, "reparto") }) }),
  pcli("gemini-proyectos", ["--gemini-proyectos"], 0),
  pcli("gemini-proyectos --marcar", ["--gemini-proyectos", "--marcar", "demo"], 0),
  pcli("gemini-proyectos --desmarcar", ["--gemini-proyectos", "--desmarcar", "demo"], 0),
  pcli("gemini-proyectos con algo que no va", ["--gemini-proyectos", "demo"], 2),
];
