// El modo Objetivo de pa (`--objetivo … --verificar …`): el bucle lanza el worker, corre el verificador en su worktree y lo relanza con
// --seguir mientras falle. El motor es falso: cada "intento" es una función que deja el rastro que dejaría un pa de verdad.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testPosix } from "./plataforma.ts";
import { main, type Deps } from "../electron/cli/pa/cli.ts";
import type { Env, Io } from "../electron/cli/pa/entorno.ts";
import { mensajeDeFalla, resultadoFinal, ultimasLineas } from "../electron/cli/pa/objetivo.ts";
import type { Llamada } from "../electron/cli/pa/politica.ts";
import type { Reparto } from "../electron/cli/pa/programas.ts";

function captura(): Io & { o: string; e: string } {
  const c = { o: "", e: "", out: (s: string) => void (c.o += s), err: (s: string) => void (c.e += s) };
  return c;
}

/** Un sandbox: HOME, estado, registry con el proyecto git `demo`, un worktree de mentira y un env limpio. */
function sandbox() {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-pa-objetivo-")));
  const home = path.join(raiz, "home");
  const proyecto = path.join(raiz, "demo");
  const estado = path.join(raiz, "estado");
  const trabajo = path.join(raiz, "worktree");
  mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
  mkdirSync(proyecto, { recursive: true });
  mkdirSync(trabajo, { recursive: true });
  spawnSync("git", ["-C", proyecto, "init", "-q", "-b", "main"]);
  const reg = path.join(home, ".config", "proyectos", "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE)/.test(k)) env[k] = v;
  Object.assign(env, { HOME: home, USER: "gonza", XDG_CONFIG_HOME: path.join(home, ".config"), PA_STATE: estado, PROYECTOS_REGISTRY: reg, TRAMA_MODELOS: path.join(home, "no-hay.json"), PA_JEFE: "", PA_JEFE_ID: "" });
  return { env, raiz, proyecto, estado, trabajo, dir: path.join(estado, "demo") };
}

/** El verificador: cuenta cuántas veces corrió en `contador` y sale 0 sólo desde la corrida `pasaEn` (0 = nunca). Escribe dónde corrió. */
function verificador(raiz: string, pasaEn: number): { cmd: string; contador: string } {
  const contador = path.join(raiz, "veces");
  const js = path.join(raiz, "verif.mjs");
  writeFileSync(
    js,
    [
      'import { appendFileSync, readFileSync, existsSync } from "node:fs";',
      `const c = ${JSON.stringify(contador)};`,
      'appendFileSync(c, process.cwd() + "\\n");',
      'const n = readFileSync(c, "utf8").trim().split("\\n").length;',
      `console.log("corrida " + n + " del verificador");`,
      'console.error("fallo: falta algo");',
      `process.exit(${pasaEn} > 0 && n >= ${pasaEn} ? 0 : 3);`,
    ].join("\n"),
  );
  return { cmd: `"${process.execPath}" "${js}"`, contador };
}

type Llamado = { argv: string[]; extra: Env };

/** Un motor falso: anota cada intento y deja su .corrida (ruta del worktree) y su .hilo (modelo) como los de un pa de verdad. */
function motorFalso(s: ReturnType<typeof sandbox>, rcs: number[] = []): { llamados: Llamado[]; relanzar: NonNullable<Deps["relanzar"]> } {
  const llamados: Llamado[] = [];
  return {
    llamados,
    relanzar: (argv, extra) => {
      llamados.push({ argv, extra });
      const ts = extra.PA_TS!;
      mkdirSync(s.dir, { recursive: true });
      writeFileSync(path.join(s.dir, `${ts}.corrida`), `ruta_trabajo=${s.trabajo}\nrama=pa/demo/${ts}\n`);
      writeFileSync(path.join(s.dir, `${ts}.hilo`), "modelo=claude-sonnet-5-5\neffort=high\n");
      return rcs[llamados.length - 1] ?? 0;
    },
  };
}

function repartoFalso(tabla = ""): Reparto {
  return { ruta: "/falso/reparto", ejecutable: () => true, enfriado: async () => null, elegir: async () => ({ rc: 1, salida: "" }), tabla: async () => tabla, cuentaPara: async () => "", plan: () => 0 };
}

async function pa(argv: string[], s: ReturnType<typeof sandbox>, deps: Deps = {}) {
  const io = captura();
  const rc = await main(argv, s.env, io, { reparto: () => repartoFalso(), ...deps });
  return { rc, o: io.o, e: io.e };
}

const tabla = (libre: number) => JSON.stringify({ modelos: [{ id: "claude-sonnet-5-5", cupo_libre: libre }] });

test("el motor falla 2 veces y pasa a la 3.ª: 3 intentos, cada uno --seguir del anterior, y el RESULTADO lo cuenta", async () => {
  const s = sandbox();
  const v = verificador(s.raiz, 3);
  const m = motorFalso(s);
  const r = await pa(["demo", "--objetivo", "que compile todo", "--verificar", v.cmd], s, { relanzar: m.relanzar });
  assert.equal(r.rc, 0, r.e);
  assert.equal(m.llamados.length, 3);
  // el verificador corrió en el worktree del intento, no en el tree principal
  assert.deepEqual(readFileSync(v.contador, "utf8").trim().split("\n"), [s.trabajo, s.trabajo, s.trabajo]);
  const [a, b, c] = m.llamados as [Llamado, Llamado, Llamado];
  // el primero: la meta con "Listo cuando" y "Cómo verificar"; sin --seguir
  assert.ok(!a.argv.includes("--seguir"));
  const tarea = a.argv[a.argv.length - 1]!;
  assert.match(tarea, /^que compile todo/);
  assert.match(tarea, /Listo cuando: el comando de verificación sale con código 0/);
  assert.ok(tarea.includes(`Cómo verificar: ${v.cmd}`));
  // los otros dos: --seguir --id <el anterior>, mismo modelo y la salida del verificador
  assert.deepEqual(b.argv.slice(0, 4), ["demo", "--seguir", "--id", a.extra.PA_TS!]);
  assert.deepEqual(c.argv.slice(0, 4), ["demo", "--seguir", "--id", b.extra.PA_TS!]);
  for (const x of [b, c]) {
    assert.ok(x.argv.join(" ").includes("-m claude-sonnet-5-5 --exacto --effort high"));
    const msg = x.argv[x.argv.length - 1]!;
    assert.match(msg, /^El verificador falló \(código 3\), arreglalo\./);
    assert.match(msg, /corrida \d del verificador/);
    assert.match(msg, /fallo: falta algo/);
  }
  assert.equal(new Set(m.llamados.map((x) => x.extra.PA_TS)).size, 3, "cada intento tiene su id");
  assert.ok(m.llamados.every((x) => x.extra.PA_ASYNC === ""));
  // el resultado final y el log del id del objetivo
  assert.match(r.o, /RESULTADO: objetivo cumplido, el verificador pasó \(3 intentos de 3\)/);
  assert.match(r.o, /VERIFICACION: .* → código 0\ncorrida 3 del verificador/);
  const log = readFileSync(path.join(s.dir, `${a.extra.PA_TS}.log`), "utf8");
  assert.equal([...log.matchAll(/— objetivo: intento \d de 3/g)].length, 3);
  assert.match(log, /RESULTADO: objetivo cumplido/);
});

test("el motor agota los intentos: sale 94 y el RESULTADO trae los intentos y la salida del último verificador", async () => {
  const s = sandbox();
  const v = verificador(s.raiz, 0);
  const m = motorFalso(s);
  const r = await pa(["demo", "--objetivo", "x", "--verificar", v.cmd, "--intentos", "2"], s, { relanzar: m.relanzar });
  assert.equal(r.rc, 94);
  assert.equal(m.llamados.length, 2);
  assert.match(r.o, /RESULTADO: objetivo NO cumplido: se agotaron los 2 intentos sin que el verificador pasara \(2 intentos de 2\)/);
  assert.match(r.o, /VERIFICACION: .* → código 3\ncorrida 2 del verificador\nfallo: falta algo/);
  assert.ok(r.o.includes(`INTENTOS: ${m.llamados[0]!.extra.PA_TS}, ${m.llamados[1]!.extra.PA_TS}`));
});

test("default de 3 intentos", async () => {
  const s = sandbox();
  const m = motorFalso(s);
  const r = await pa(["demo", "--objetivo", "x", "--verificar", verificador(s.raiz, 0).cmd], s, { relanzar: m.relanzar });
  assert.equal(r.rc, 94);
  assert.equal(m.llamados.length, 3);
});

test("el cupo libre del modelo bajo el tope corta antes de relanzar (99); con un tope menor sigue", async () => {
  const s = sandbox();
  const v = verificador(s.raiz, 0);
  const m = motorFalso(s);
  const r = await pa(["demo", "--objetivo", "x", "--verificar", v.cmd], s, { relanzar: m.relanzar, reparto: () => repartoFalso(tabla(0.05)) });
  assert.equal(r.rc, 99);
  assert.equal(m.llamados.length, 1);
  assert.match(r.o, /objetivo NO cumplido: el cupo libre de claude-sonnet-5-5 \(5 %\) bajó del tope de 10 %: no relanzo \(1 intento de 3\)/);
  const m2 = motorFalso(s);
  const r2 = await pa(["demo", "--objetivo", "x", "--verificar", v.cmd, "--tope-cupo", "3", "--intentos", "2"], s, { relanzar: m2.relanzar, reparto: () => repartoFalso(tabla(0.05)) });
  assert.equal(r2.rc, 94);
  assert.equal(m2.llamados.length, 2);
});

test("si el worker sale con error no se corre el verificador y se devuelve su código", async () => {
  const s = sandbox();
  const v = verificador(s.raiz, 0);
  const m = motorFalso(s, [76]);
  const r = await pa(["demo", "--objetivo", "x", "--verificar", v.cmd], s, { relanzar: m.relanzar });
  assert.equal(r.rc, 76);
  assert.equal(m.llamados.length, 1);
  assert.ok(!existsSync(v.contador));
  assert.match(r.o, /el intento 1 del worker terminó con código 76 antes de verificar/);
  assert.match(r.o, /VERIFICACION: ninguna/);
});

test("los flags del jefe pasan al primer intento (modelo, esfuerzo, tipo) y el --seguir no repite el tipo", async () => {
  const s = sandbox();
  const m = motorFalso(s);
  await pa(["demo", "-m", "claude-haiku-5-5", "--effort", "xhigh", "--tipo", "mecanico", "--objetivo", "x", "--verificar", verificador(s.raiz, 2).cmd], s, { relanzar: m.relanzar });
  const [a, b] = m.llamados as [Llamado, Llamado];
  assert.deepEqual(a.argv.slice(0, 7), ["demo", "-m", "claude-haiku-5-5", "--effort", "xhigh", "--max-turns", a.argv[6]!]);
  assert.ok(a.argv.join(" ").includes("--tipo mecanico"));
  assert.ok(!b.argv.includes("--tipo"));
});

test("--objetivo pide --verificar y no va con --leer ni --seguir", async () => {
  const s = sandbox();
  for (const argv of [["demo", "--objetivo", "x"], ["demo", "--verificar", "true"], ["demo", "--objetivo", "x", "--verificar", "true", "--leer"], ["demo", "--objetivo", "x", "--verificar", "true", "--seguir"], ["demo", "--objetivo", "x", "--verificar", "true", "--intentos", "0"]]) {
    const r = await pa(argv, s, { relanzar: () => 0 });
    assert.equal(r.rc, 2, argv.join(" "));
  }
});

testPosix("con --async el bucle corre desacoplado: el hijo recibe el modo Objetivo (sin --async), el id y el log", async () => {
  const s = sandbox();
  const salida = path.join(s.raiz, "hijo.json");
  const hijo = path.join(s.raiz, "hijo.mjs");
  writeFileSync(
    hijo,
    [
      'import { writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(salida)}, JSON.stringify({ argv: process.argv.slice(2), ts: process.env.PA_TS, asinc: process.env.PA_ASYNC }));`,
      `writeFileSync(${JSON.stringify(s.dir)} + "/" + process.env.PA_TS + ".listo", "salida=\\nrc=0\\nsid=\\n");`,
    ].join("\n"),
  );
  const r = await pa(["demo", "--async", "--objetivo", "m", "--verificar", "true", "--intentos", "2", "--tope-cupo", "5", "-m", "claude-haiku-5-5"], s, {
    relanzar: () => 0,
    objetivo: { comando: [process.execPath, hijo], pausaAsyncMs: 20 },
  });
  assert.equal(r.rc, 0, r.e);
  assert.match(r.o, /lanzado en background/);
  const h = JSON.parse(readFileSync(salida, "utf8")) as { argv: string[]; ts: string; asinc: string };
  assert.ok(!h.argv.includes("--async"));
  assert.equal(h.asinc, "1");
  assert.deepEqual(h.argv.slice(0, 3), ["demo", "-m", "claude-haiku-5-5"]);
  assert.deepEqual(h.argv.slice(h.argv.indexOf("--objetivo")), ["--objetivo", "m", "--verificar", "true", "--intentos", "2", "--tope-cupo", "5"]);
  assert.ok(existsSync(path.join(s.dir, `${h.ts}.log`)));
});

testPosix("hijo de --async: el bucle deja el resultado en <id>.objetivo.json y el .listo con el código", async () => {
  const s = sandbox();
  const v = verificador(s.raiz, 2);
  const m = motorFalso(s);
  s.env.PA_ASYNC = "1";
  s.env.PA_TS = "20261101-000000-77";
  const r = await pa(["demo", "--objetivo", "x", "--verificar", v.cmd], s, { relanzar: m.relanzar });
  assert.equal(r.rc, 0, r.e);
  assert.equal(m.llamados[0]!.extra.PA_TS, "20261101-000000-77");
  const listo = readFileSync(path.join(s.dir, "20261101-000000-77.listo"), "utf8");
  assert.match(listo, /^salida=.*20261101-000000-77\.objetivo\.json\nrc=0\n/);
  const j = JSON.parse(readFileSync(path.join(s.dir, "20261101-000000-77.objetivo.json"), "utf8")) as { result: string };
  assert.match(j.result, /^RESULTADO: objetivo cumplido/);
});

test("piezas: últimas líneas, mensaje de falla y resultado", () => {
  assert.equal(ultimasLineas("a\nb\nc\n\n", 2), "b\nc");
  assert.equal(ultimasLineas(Array.from({ length: 200 }, (_, i) => `l${i}`).join("\n")).split("\n").length, 80);
  const l = { objetivo: "meta", verificar: "npm test", intentos: 3 } as Llamada;
  assert.match(mensajeDeFalla(l, 1, "salida"), /^El verificador falló \(código 1\), arreglalo\.\nMeta: meta\nComando que verifica \(corre en tu worktree\): npm test/);
  assert.match(resultadoFinal(l, { cumplido: false, motivo: "m", intentos: [{ ts: "a", rc: 0 }], ultimo: null }), /\(1 intento de 3\)/);
});

test("--integrar-si-pasa: si el verificador pasa integra el último intento y deja «integrada»", async () => {
  const s = sandbox();
  const v = verificador(s.raiz, 2);
  const m = motorFalso(s);
  const integrados: string[] = [];
  const r = await pa(["demo", "--objetivo", "x", "--verificar", v.cmd, "--integrar-si-pasa"], s, {
    relanzar: m.relanzar,
    objetivo: { integrar: (id) => void integrados.push(id) ?? 0 },
  });
  assert.equal(r.rc, 0, r.e);
  assert.deepEqual(integrados, [m.llamados[1]!.extra.PA_TS]);
  assert.match(r.o, /RESULTADO: objetivo cumplido/);
  assert.ok(r.o.trimEnd().endsWith("\nintegrada"), r.o);
});

test("--integrar-si-pasa: si la integración se niega, «no integrada: rc N, motivo» y sale con ese rc", async () => {
  const s = sandbox();
  const m = motorFalso(s);
  const r = await pa(["demo", "--objetivo", "x", "--verificar", verificador(s.raiz, 1).cmd, "--integrar-si-pasa"], s, {
    relanzar: m.relanzar,
    objetivo: { integrar: () => 93 },
  });
  assert.equal(r.rc, 93);
  assert.match(r.o.trimEnd().split("\n").pop()!, /^no integrada: rc 93, los tests del registry dieron rojo/);
});

test("--integrar-si-pasa: sin integrador inyectado relanza `pa <proy> --integrar <id> --tests`", async () => {
  const s = sandbox();
  const m = motorFalso(s);
  const r = await pa(["demo", "--objetivo", "x", "--verificar", verificador(s.raiz, 1).cmd, "--integrar-si-pasa"], s, { relanzar: m.relanzar });
  assert.equal(r.rc, 0, r.e);
  const ult = m.llamados[m.llamados.length - 1]!;
  assert.deepEqual(ult.argv, ["demo", "--integrar", m.llamados[0]!.extra.PA_TS, "--tests"]);
  assert.match(r.o, /\nintegrada\n$/);
});

test("--integrar-si-pasa: si el objetivo no se cumple no integra y lo dice", async () => {
  const s = sandbox();
  const m = motorFalso(s);
  let llamado = false;
  const r = await pa(["demo", "--objetivo", "x", "--verificar", verificador(s.raiz, 0).cmd, "--intentos", "1", "--integrar-si-pasa"], s, {
    relanzar: m.relanzar,
    objetivo: { integrar: () => void (llamado = true) ?? 0 },
  });
  assert.equal(r.rc, 94);
  assert.equal(llamado, false);
  assert.match(r.o.trimEnd().split("\n").pop()!, /^no integrada: rc 94, el objetivo no se cumplió/);
});

test("sin --integrar-si-pasa no integra ni agrega línea; y el flag solo, sin --objetivo, se rechaza", async () => {
  const s = sandbox();
  const m = motorFalso(s);
  let llamado = false;
  const r = await pa(["demo", "--objetivo", "x", "--verificar", verificador(s.raiz, 1).cmd], s, { relanzar: m.relanzar, objetivo: { integrar: () => void (llamado = true) ?? 0 } });
  assert.equal(r.rc, 0);
  assert.equal(llamado, false);
  assert.ok(!/integrada/.test(r.o));
  const x = await pa(["demo", "--integrar-si-pasa", "tarea"], s);
  assert.equal(x.rc, 2);
  assert.match(x.e, /--integrar-si-pasa va con el modo Objetivo/);
});
