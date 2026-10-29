// La limpieza de worktrees y ramas viejos de `pa` en la app (electron/limpieza-pa.ts): lo que se le pide a `pa`, cómo se lee lo que
// contesta, la config (apagada de entrada) y la pasada automática. `pa` va falso: nunca se borra nada de verdad.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  argvLimpieza,
  aplicarLimpieza,
  CONFIG_LIMPIEZA_DEFAULT,
  configLimpieza,
  diasLimpieza,
  hayAlgo,
  pasadaAutomatica,
  planDe,
  programarPasadas,
  verLimpieza,
  type Corrida,
} from "../electron/limpieza-pa.ts";
import { cuantas, DIAS_OFRECIDOS, tamano } from "../src/paneles/limpieza-vista.ts";

const JSON_PA = JSON.stringify({
  dias: 7,
  aplicado: false,
  enUso: ["proy@2"],
  builds: [{ puesto: "proy@3", dir: "target", bytes: 3000 }],
  worktrees: [{ puesto: "proy@4", dias: 30, bytes: 55 }],
  ramas: [{ proyecto: "proy", rama: "pa/proy/20260101-101010-5001", dias: 300, commits: 1 }],
  bytes: 3055,
});

test("limpieza: por defecto la pasada automática está APAGADA y a los 7 días", () => {
  assert.deepEqual(CONFIG_LIMPIEZA_DEFAULT, { auto: false, dias: 7 });
});

test("limpieza: los días valen de 1 a 365, enteros", () => {
  for (const ok of [1, 7, 365, "14"]) assert.notEqual(diasLimpieza(ok), null, String(ok));
  for (const mal of [0, -1, 366, 1.5, "x", "", null, undefined, NaN, "7; rm"]) assert.equal(diasLimpieza(mal), null, String(mal));
});

test("limpieza: la config ignora lo que no vale y deja lo que había", () => {
  const a = { auto: true, dias: 14 };
  assert.deepEqual(configLimpieza(a, { auto: false }), { auto: false, dias: 14 });
  assert.deepEqual(configLimpieza(a, { dias: 30 }), { auto: true, dias: 30 });
  assert.deepEqual(configLimpieza(a, { dias: 0, auto: "si" }), a);
  assert.deepEqual(configLimpieza(a, null), a);
  assert.deepEqual(configLimpieza(a, "x"), a);
});

test("limpieza: ver no toca y aplicar sí, siempre con los días y por JSON", () => {
  assert.deepEqual(argvLimpieza("ver", 7), ["--limpiar", "--ver", "--dias", "7", "--json"]);
  assert.deepEqual(argvLimpieza("aplicar", 30), ["--limpiar", "--si", "--dias", "30", "--json"]);
});

test("limpieza: planDe lee lo que dice pa y descarta lo mal formado", () => {
  const p = planDe(`${JSON_PA}\n`);
  assert.equal(p.worktrees[0]!.puesto, "proy@4");
  assert.equal(p.ramas[0]!.commits, 1);
  assert.equal(p.bytes, 3055);
  assert.equal(hayAlgo(p), true);
  const raro = planDe(JSON.stringify({ dias: 7, aplicado: true, worktrees: [{ puesto: 3 }, "x", { puesto: "a", dias: 1, bytes: 2 }], ramas: "no" }));
  assert.deepEqual(raro.worktrees, [{ puesto: "a", dias: 1, bytes: 2 }]);
  assert.deepEqual(raro.ramas, []);
  assert.equal(raro.aplicado, true);
  assert.equal(hayAlgo(planDe(JSON.stringify({ dias: 7 }))), false);
  assert.throws(() => planDe("no es json"));
  assert.throws(() => planDe("{}"));
});

test("limpieza: ver y aplicar le piden a pa lo justo y rechazan con lo que dijo", async () => {
  const pedidos: string[][] = [];
  const bien: Corrida = async (a) => (pedidos.push(a), { rc: 0, out: JSON_PA, dijo: "" });
  assert.equal((await verLimpieza(bien, 7)).dias, 7);
  assert.equal((await aplicarLimpieza(bien, "30")).dias, 7);
  assert.deepEqual(pedidos, [argvLimpieza("ver", 7), argvLimpieza("aplicar", 30)]);
  await assert.rejects(verLimpieza(async () => ({ rc: 3, out: "", dijo: "pa: algo falló" }), 7), /algo falló/);
  // días inválidos: ni se llama a pa
  pedidos.length = 0;
  await assert.rejects(verLimpieza(bien, 0));
  await assert.rejects(aplicarLimpieza(bien, "7; ls"));
  assert.equal(pedidos.length, 0);
});

test("limpieza: la pasada automática sólo corre si el usuario la prendió", async () => {
  const pedidos: string[][] = [];
  const pa: Corrida = async (a) => (pedidos.push(a), { rc: 0, out: JSON_PA, dijo: "" });
  assert.equal(await pasadaAutomatica(async () => ({ auto: false, dias: 7 }), pa), null);
  assert.equal(pedidos.length, 0);
  const r = await pasadaAutomatica(async () => ({ auto: true, dias: 14 }), pa);
  assert.equal(r?.dias, 7);
  assert.deepEqual(pedidos, [argvLimpieza("aplicar", 14)]);
  // si pa falla no tira
  assert.equal(await pasadaAutomatica(async () => ({ auto: true, dias: 7 }), async () => ({ rc: 1, out: "", dijo: "x" })), null);
});

test("limpieza: el reloj repite las pasadas y se puede parar", async () => {
  let n = 0;
  const parar = programarPasadas(async () => void n++, { primera: 5, cada: 10 });
  await new Promise((r) => setTimeout(r, 80));
  parar();
  const visto = n;
  assert.ok(visto >= 2, `corrió ${visto} veces`);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(n, visto);
  // una pasada que rechaza no corta el reloj
  let m = 0;
  const parar2 = programarPasadas(async () => { m++; throw new Error("x"); }, { primera: 5, cada: 10 });
  await new Promise((r) => setTimeout(r, 60));
  parar2();
  assert.ok(m >= 2);
});

test("limpieza: la vista", () => {
  assert.equal(tamano(0), "0 B");
  assert.equal(tamano(1536), "1,5 KB");
  assert.equal(tamano(1536, "."), "1.5 KB");
  assert.equal(tamano(3.4 * 1024 ** 3), "3,4 GB");
  assert.equal(tamano(20 * 1024 ** 2), "20 MB");
  assert.equal(cuantas(planDe(JSON_PA)), 3);
  for (const d of DIAS_OFRECIDOS) assert.notEqual(diasLimpieza(d), null);
  assert.ok(DIAS_OFRECIDOS.includes(CONFIG_LIMPIEZA_DEFAULT.dias as 7));
});

test("limpieza: los cuatro canales están en el contrato, son locales y los que escriben, sólo de la PC", () => {
  const contrato = readFileSync(new URL("../electron/canales/contrato.ts", import.meta.url), "utf8");
  const maquinas = readFileSync(new URL("../electron/maquinas-contrato.ts", import.meta.url), "utf8");
  const nucleo = readFileSync(new URL("../electron/nucleo.ts", import.meta.url), "utf8");
  for (const c of ["limpieza:leer", "limpieza:guardar", "limpieza:ver", "limpieza:aplicar"]) {
    assert.match(contrato, new RegExp(`\\["${c}", "invoke"\\]`), c);
    assert.match(maquinas, new RegExp(`"${c}": "local"`), c);
  }
  for (const c of ["limpieza:guardar", "limpieza:aplicar"]) assert.match(nucleo, new RegExp(`SOLO_PC_TAILNET[^\\n]*"${c}"`), c);
});

test("limpieza: la pasada automática del main sólo se arma fuera de bench y capturas", () => {
  const nucleo = readFileSync(new URL("../electron/nucleo.ts", import.meta.url), "utf8");
  assert.match(nucleo, /HILOS_BENCH[^\n]*programarPasadas\(\(\) => pasadaAutomatica\(leerLimpieza, ejecutar\)\)/);
});
