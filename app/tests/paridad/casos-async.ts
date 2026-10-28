// Casos de paridad de la etapa 8 (`pa-async`): --estado, --esperar, --esperar-todos, --parar y --matar del `pa` bash (A) contra
// app/electron/cli/pa/async.ts (B). El estado se arma a mano en `preparar` (los `.running`, `.pid`, `.listo`, `.jefe` que dejaría
// una corrida --async) con procesos de verdad: `sleep` sueltos (colgados de init) para lo vivo y el pid de un `sh` que ya salió
// para lo muerto. `lock/<slug>` vacío hace las veces del archivo que deja flock: es lo que el bash mira para «ya corrió acá».
// El --async en sí (relanzarse y esperar el puesto) necesita el pa que lanza (etapas 6-7): lo prueba tests/cli-pa-async.test.ts.
import { spawnSync } from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto } from "./arnes.ts";

const T1 = "20261028-101010-111";
const T2 = "20261028-101011-222";
const T3 = "20261028-101012-333";
const T4 = "20261028-101013-444";
const VIEJO = 1704110400; // 2024-01-01T12:00:00Z
const FUTURO = 4102444800; // 2100-01-01T00:00:00Z
const ahora = () => Math.floor(Date.now() / 1000);

const escribir = (ruta: string, texto: string) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, texto);
};
/** Un proceso vivo que no es hijo del test (lo adopta init): el pa lo puede matar y nadie queda zombie. */
const vivo = () => Number(spawnSync("sh", ["-c", "sleep 30 >/dev/null 2>&1 & echo $!"], { encoding: "utf8" }).stdout.trim());
/** El pid de un proceso que ya terminó. */
const muerto = () => Number(spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim());

/** `$STATE/proy/<archivo>` (el slug del proyecto `demo` del sandbox es el nombre de su carpeta: `proy`). */
const en = (c: Contexto, archivo: string) => path.join(c.estado, "proy", archivo);
/** El archivo de lock que deja flock: con él, `--esperar proy` reconoce el slug sin pasar por el registry. */
const yaCorrio = (c: Contexto) => escribir(path.join(c.estado, "lock", "proy"), "");

const RES_OK = "RESULTADO: hice la cosa.\nARCHIVOS: a.ts\nVERIFICACION: npm test\n  ok 3\n  fail 0\nDECISION: nada\nSIGUE: nada";
const RES_SIN = "RESULTADO: hice la cosa.\nARCHIVOS: a.ts\nVERIFICACION: ninguna, no había tests\nDECISION: nada";

/** Una corrida async terminada: su JSON de salida, su `.listo` (rc) y su `.pid` (muerto). */
function terminada(c: Contexto, id: string, rc: number, o: { result?: unknown; leer?: boolean; jefe?: string; viejo?: boolean; costo?: number; turnos?: number } = {}) {
  const json = en(c, `${id}.json`);
  escribir(json, JSON.stringify({ type: "result", result: o.result === undefined ? RES_OK : o.result, num_turns: o.turnos ?? 5, duration_ms: 12345, total_cost_usd: o.costo ?? 0.123456, session_id: "s-" + id }));
  escribir(en(c, `${id}.log`), "");
  escribir(en(c, `${id}.pid`), String(muerto()));
  if (o.leer) escribir(en(c, `${id}.leer`), "");
  if (o.jefe !== undefined) escribir(en(c, `${id}.jefe`), `jefe=j\njefe_id=${o.jefe}\n`);
  escribir(en(c, `${id}.listo`), `salida=${json}\nrc=${rc}\nsid=s-${id}\n`);
  if (o.viejo) utimesSync(en(c, `${id}.listo`), VIEJO, VIEJO);
}

const pa = (nombre: string, x: Omit<Caso, "nombre" | "herramienta">): Caso => ({ herramienta: "pa-async", nombre: `pa-async: ${nombre}`, ...x });

// ============================================================================ --estado

const casosEstado: Caso[] = [
  pa("estado sin corridas", { args: ["--estado"], rc: 0 }),
  pa("estado: corriendo (puesto, tree principal, --leer) y huérfano", {
    args: ["--estado"],
    rc: 0,
    preparar: (c) => {
      const v = vivo();
      escribir(path.join(c.estado, "proy.running"), `proyecto=proy\npid=${v}\ninicio=${ahora()}\nid=${T1}\n`);
      escribir(path.join(c.estado, "proy.heartbeat"), `epoch=${ahora()}\ntool=Bash\nenvuelo=1\n`);
      escribir(path.join(c.estado, "proy@2.running"), `proyecto=proy\npid=${v}\ninicio=${ahora()}\nid=${T2}\npuesto=2\n`);
      escribir(path.join(c.estado, "proy@3.running"), `proyecto=proy\npid=${v}\ninicio=${ahora()}\nid=${T4}\npuesto=aca\n`);
      escribir(path.join(c.estado, "proy@3.heartbeat"), `epoch=${ahora()}\ntool=Edit\nenvuelo=0\n`);
      escribir(path.join(c.estado, `proy.leer-${T3}.running`), `proyecto=proy\npid=${v}\ninicio=${ahora()}\nid=${T3}\nleer=1\n`);
      escribir(path.join(c.estado, "zeta.running"), `proyecto=zeta\npid=${muerto()}\nid=${T1}\n`);
      escribir(path.join(c.estado, "zeta.leer-x.running"), `proyecto=zeta\npid=${muerto()}\nleer=1\n`);
    },
  }),
  pa("estado: en cola, murió en cola y --leer en cola o muerto", {
    args: ["--estado"],
    rc: 0,
    preparar: (c) => {
      escribir(en(c, `${T1}.pid`), String(vivo()));
      escribir(en(c, `${T1}.cola`), "tope global: 10 workers vivos");
      escribir(en(c, `${T2}.pid`), String(muerto()));
      escribir(en(c, `${T3}.pid`), String(vivo()));
      escribir(en(c, `${T3}.leer`), "");
      escribir(en(c, `${T3}.cola`), "RAM: no alcanza");
      escribir(en(c, `${T4}.pid`), String(muerto()));
      escribir(en(c, `${T4}.leer`), "");
      // éstas no salen: ya tomó puesto, ya terminó, y un --leer vivo sin cola (está arrancando)
      escribir(path.join(c.estado, "otro", `${T1}.pid`), String(vivo()));
      escribir(path.join(c.estado, "otro", `${T1}.puesto`), "1");
      escribir(path.join(c.estado, "otro", `${T2}.pid`), String(muerto()));
      escribir(path.join(c.estado, "otro", `${T2}.listo`), "rc=0\n");
      escribir(path.join(c.estado, "otro", `${T3}.pid`), String(vivo()));
      escribir(path.join(c.estado, "otro", `${T3}.leer`), "");
      escribir(path.join(c.estado, "otro", `${T4}.pid`), String(vivo()));
    },
  }),
  pa("estado: sesiones, sin verificar, poda, límites y plan max", {
    args: ["--estado"],
    rc: 0,
    env: { PA_PLAN: "max" },
    preparar: (c) => {
      for (const s of ["proy", "zeta"]) {
        escribir(path.join(c.estado, `${s}.session`), `sid-${s}\n`);
        utimesSync(path.join(c.estado, `${s}.session`), VIEJO, VIEJO);
      }
      escribir(en(c, `${T1}.hilo`), "modelo=x\nverificado=0\n");
      escribir(en(c, `${T2}.hilo`), "verificado=0\narchivado=2026-10-27T10:00:00-03:00\n");
      escribir(en(c, `${T3}.hilo`), "verificado=1\n");
      escribir(en(c, `${T4}.hilo`), "verificado=0\n");
      utimesSync(en(c, `${T4}.hilo`), VIEJO, VIEJO);
      escribir(en(c, "lecciones.necesita-poda"), "3500 caracteres (tope 3000)");
      escribir(path.join(c.estado, "limite.hasta"), String(FUTURO));
      escribir(path.join(c.estado, "limite.otra.hasta"), String(FUTURO + 3600 * 5 + 60 * 7));
      escribir(path.join(c.estado, "limite.vencida.hasta"), String(VIEJO));
      escribir(path.join(c.estado, "limite.basura.hasta"), "mañana");
    },
  }),
  pa("estado: RAM que no alcanza con un worker suelto", {
    args: ["--estado"],
    rc: 0,
    env: (c) => ({ PA_MEMINFO: path.join(c.aux, "meminfo"), PA_RAM_WORKER_MB: "1000", PA_RAM_RESERVA_MB: "2000" }),
    preparar: (c) => {
      escribir(path.join(c.aux, "meminfo"), "MemTotal:       16000000 kB\nMemAvailable:    2048000 kB\n");
      // el claude vivo de un pa que ya no está: cuenta para la RAM
      escribir(path.join(c.estado, "proy.running"), `proyecto=proy\npid=${vivo()}\npa_pid=${muerto()}\ninicio=${ahora()}\nid=${T1}\n`);
    },
    estadoIgnorar: [/\.running$/],
  }),
  pa("estado: RAM sin dato (meminfo ilegible)", { args: ["--estado"], rc: 0, env: (c) => ({ PA_MEMINFO: path.join(c.aux, "no-hay") }) }),
];

// ============================================================================ --esperar

const casosEsperar: Caso[] = [
  pa("esperar: sin proyecto", { args: ["--esperar"], rc: 2 }),
  pa("esperar: --timeout sin número", { args: ["--esperar", "demo", "--timeout", "x"], rc: 2 }),
  pa("esperar: --id sin valor", { args: ["--esperar", "demo", "--id"], rc: 2 }),
  pa("esperar: opción desconocida", { args: ["--esperar", "demo", "--rapido"], rc: 2 }),
  pa("esperar: proyecto que no existe", { args: ["--esperar", "fantasma"], rc: 1 }),
  pa("esperar: nunca corrió un worker", { args: ["--esperar", "demo", "--timeout", "1"], rc: 1 }),
  pa("esperar: entrega en orden y después no hay nada", {
    preparar: (c) => {
      yaCorrio(c);
      terminada(c, T1, 0);
      terminada(c, T2, 3, { result: RES_SIN, costo: 2, turnos: 41 });
    },
    pasos: [
      { args: ["--esperar", "demo"], rc: 0 },
      { args: ["--esperar", "proy"], rc: 3 },
      { args: ["--esperar", "demo"], rc: 1 },
    ],
  }),
  pa("esperar: resultado sin RESULTADO, nulo o no texto", {
    preparar: (c) => {
      yaCorrio(c);
      terminada(c, T1, 0, { result: "ok" });
      terminada(c, T2, 0, { result: null });
      terminada(c, T3, 0, { result: 42 });
    },
    pasos: [{ args: ["--esperar", "demo"], rc: 0 }, { args: ["--esperar", "demo"], rc: 0 }, { args: ["--esperar", "demo"], rc: 0 }],
  }),
  pa("esperar --id: claude roto (81) y fuera del PATH (84)", {
    preparar: (c) => {
      yaCorrio(c);
      terminada(c, T1, 81);
      terminada(c, T2, 84);
    },
    env: (c) => ({ CLAUDE_CONOCIDO: path.join(c.aux, "claude") }),
    pasos: [
      { args: ["--esperar", "demo", "--id", T2], rc: 84 },
      { args: ["--esperar", "demo", "--id", T1], rc: 81 },
    ],
  }),
  pa("esperar --id: ya entregada", {
    preparar: (c) => {
      yaCorrio(c);
      terminada(c, T1, 0);
    },
    pasos: [
      { args: ["--esperar", "demo", "--id", T1], rc: 0 },
      { args: ["--esperar", "demo", "--id", T1], rc: 1 },
    ],
  }),
  pa("esperar --id: no existe", { preparar: yaCorrio, args: ["--esperar", "demo", "--id", T1], rc: 1 }),
  pa("esperar --id: murió en cola, corriendo y --leer", {
    preparar: (c) => {
      yaCorrio(c);
      for (const t of [T1, T2, T3]) {
        escribir(en(c, `${t}.pid`), String(muerto()));
        escribir(en(c, `${t}.log`), "");
      }
      escribir(en(c, `${T2}.puesto`), "1");
      escribir(en(c, `${T3}.leer`), "");
    },
    pasos: [
      { args: ["--esperar", "demo", "--id", T1], rc: 82 },
      { args: ["--esperar", "demo", "--id", T2], rc: 82 },
      { args: ["--esperar", "demo", "--id", T3], rc: 82 },
    ],
  }),
  pa("esperar --id: corrió en primer plano (sin .pid)", {
    preparar: (c) => {
      yaCorrio(c);
      escribir(en(c, `${T1}.log`), "");
    },
    args: ["--esperar", "demo", "--id", T1],
    rc: 1,
  }),
  pa("esperar --id: sigue trabajando al vencer el --timeout", {
    preparar: (c) => {
      yaCorrio(c);
      escribir(en(c, `${T1}.pid`), String(vivo()));
      escribir(en(c, `${T1}.log`), "");
    },
    args: ["--esperar", "demo", "--id", T1, "--timeout", "1"],
    rc: 75,
  }),
  pa("esperar: writer tuyo vivo al vencer el --timeout", {
    preparar: (c) => {
      yaCorrio(c);
      escribir(en(c, `${T1}.pid`), String(vivo()));
      escribir(en(c, `${T1}.log`), "");
    },
    args: ["--esperar", "demo", "--timeout", "1"],
    rc: 75,
  }),
  pa("esperar: saltea los vencidos y avisa de los --leer", {
    preparar: (c) => {
      yaCorrio(c);
      terminada(c, T1, 0, { viejo: true });
      terminada(c, T2, 0, { leer: true });
      escribir(path.join(c.estado, `proy.leer-${T3}.running`), `proyecto=proy\npid=${vivo()}\nid=${T3}\nleer=1\n`);
    },
    args: ["--esperar", "demo"],
    rc: 1,
  }),
  pa("esperar: sólo lo de tu jefe", {
    env: { PA_JEFE_ID: "yo" },
    preparar: (c) => {
      yaCorrio(c);
      terminada(c, T1, 0, { jefe: "otro" });
      terminada(c, T2, 0, { jefe: "yo" });
      terminada(c, T3, 0, { jefe: "" });
    },
    pasos: [
      { args: ["--esperar", "demo"], rc: 0 },
      { args: ["--esperar", "demo"], rc: 0 },
      { args: ["--esperar", "demo"], rc: 1 },
    ],
  }),
  pa("esperar: la rama sin commits de la corrida", {
    preparar: (c) => {
      yaCorrio(c);
      spawnSync("git", ["-C", c.proyecto, "branch", "pa/proy/x"]);
      terminada(c, T1, 0);
      escribir(en(c, `${T1}.corrida`), `rama=pa/proy/x\nruta_trabajo=${c.proyecto}\nproyecto=demo\n`);
    },
    args: ["--esperar", "demo"],
    rc: 0,
  }),
];

// ============================================================================ --esperar-todos

const casosTodos: Caso[] = [
  pa("esperar-todos: nada pendiente", { args: ["--esperar-todos"], rc: 1 }),
  pa("esperar-todos: --timeout sin número", { args: ["--esperar-todos", "--timeout"], rc: 2 }),
  pa("esperar-todos: opción desconocida", { args: ["--esperar-todos", "x"], rc: 2 }),
  pa("esperar-todos: cobra todas y sale con el primer rc distinto de 0", {
    env: { PA_JEFE_ID: "yo" },
    preparar: (c) => {
      yaCorrio(c);
      terminada(c, T1, 0, { jefe: "yo" });
      terminada(c, T2, 5, { jefe: "yo", leer: true });
      terminada(c, T3, 7, { jefe: "yo" });
      terminada(c, T4, 0, { jefe: "otro" });
      escribir(path.join(c.estado, "lock", "zeta"), "");
      escribir(path.join(c.estado, "zeta", `${T1}.pid`), String(muerto()));
      escribir(path.join(c.estado, "zeta", `${T1}.entregado`), "rc=0\n");
    },
    pasos: [{ args: ["--esperar-todos", "--timeout", "30"], rc: 5 }, { args: ["--esperar-todos"], rc: 1 }],
  }),
];

// ============================================================================ --parar / --matar

const corriendo = (c: Contexto, nombre: string, id: string, extra = "") =>
  escribir(path.join(c.estado, nombre), `proyecto=proy\npid=${vivo()}\npa_pid=${vivo()}\nid=${id}\ninicio=${ahora()}\n${extra}`);

const casosParar: Caso[] = [
  pa("parar: sin id", { args: ["--parar"], rc: 2 }),
  pa("parar: id que no existe", { args: ["--parar", T1], rc: 1 }),
  pa("parar: en cola", {
    preparar: (c) => {
      escribir(en(c, `${T1}.pid`), String(vivo()));
      escribir(en(c, `${T1}.log`), "");
    },
    args: ["--parar", T1],
    rc: 0,
  }),
  pa("parar: corriendo (pa + claude) con la forma <proyecto> --parar", {
    preparar: (c) => {
      escribir(en(c, `${T1}.hilo`), "modelo=x\n");
      corriendo(c, "proy@2.running", T1, "puesto=2\n");
      escribir(path.join(c.estado, "proy@2.heartbeat"), "tool=Bash\n");
    },
    args: ["demo", "--parar", T1],
    rc: 0,
  }),
  pa("parar: ni corriendo ni en cola", {
    preparar: (c) => escribir(en(c, `${T1}.hilo`), "fin=1700000000\n"),
    args: ["--parar", T1],
    rc: 1,
  }),
];

const casosMatar: Caso[] = [
  pa("matar: no hay worker", { args: ["demo", "--matar"], rc: 1 }),
  pa("matar: --leer sin --leer vivos", { args: ["demo", "--matar", "--leer"], rc: 1 }),
  pa("matar: --id que no está", { args: ["demo", "--matar", "--id", T1], rc: 1 }),
  pa("matar: el writer vivo", {
    preparar: (c) => {
      escribir(en(c, `${T1}.hilo`), "modelo=x\n");
      corriendo(c, "proy.running", T1);
    },
    args: ["demo", "--matar"],
    rc: 0,
  }),
  pa("matar: a secas no toca los --leer", {
    preparar: (c) => escribir(path.join(c.estado, `proy.leer-${T1}.running`), `proyecto=proy\npid=${vivo()}\nid=${T1}\nleer=1\n`),
    args: ["demo", "--matar"],
    rc: 1,
  }),
  pa("matar: --leer baja todos los --leer", {
    preparar: (c) => {
      corriendo(c, `proy.leer-${T1}.running`, T1, "leer=1\n");
      corriendo(c, `proy.leer-${T2}.running`, T2, "leer=1\n");
    },
    args: ["demo", "--matar", "--leer"],
    rc: 0,
  }),
  pa("matar: --id de un writer de otro puesto", {
    preparar: (c) => {
      corriendo(c, "proy.running", T1);
      corriendo(c, "proy@2.running", T2, "puesto=2\n");
    },
    args: ["demo", "--matar", "--id", T2],
    rc: 0,
    estadoIgnorar: [/\.running$/],
  }),
  pa("matar: dos writers vivos sin jefe que decida", {
    preparar: (c) => {
      escribir(path.join(c.estado, "proy.running"), `proyecto=proy\npid=${vivo()}\nid=${T1}\npuesto=1\njefe=uno\ntarea=arreglar el login de la app que se rompió ayer después de la migración de la base\n`);
      escribir(path.join(c.estado, "proy@2.running"), `proyecto=proy\npid=${vivo()}\nid=${T2}\npuesto=2\njefe=dos\ntarea=x\n`);
    },
    args: ["demo", "--matar"],
    rc: 2,
  }),
  pa("matar: dos writers vivos, uno de tu jefe", {
    env: { PA_JEFE_ID: "yo" },
    preparar: (c) => {
      corriendo(c, "proy.running", T1, "jefe_id=otro\n");
      corriendo(c, "proy@2.running", T2, "puesto=2\njefe_id=yo\n");
    },
    args: ["demo", "--matar"],
    rc: 0,
    estadoIgnorar: [/\.running$/],
  }),
  pa("matar: .running colgado de un pa muerto", {
    preparar: (c) => escribir(path.join(c.estado, "proy.running"), `proyecto=proy\npid=${muerto()}\nid=${T1}\n`),
    args: ["demo", "--matar"],
    rc: 0,
  }),
];

export const casosAsync: Caso[] = [...casosEstado, ...casosEsperar, ...casosTodos, ...casosParar, ...casosMatar];
