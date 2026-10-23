// El aviso de build nuevo de trama y el reinicio que pide Ana (electron/relanzar.ts): con un build de
// mentira en una carpeta temporal, mirado con inotify de verdad. Lo que importa: nunca se reinicia sola,
// y pedido el reinicio nunca corta un turno ni la espera de un líder.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { COLGADO_MS, LISTO, crearRelanzador, esperandoWorkers, lideresConWorkers, mirarBuild, selloDe, sinEventos, workersEsperados } from "../electron/relanzar.ts";

const tmp = mkdtempSync(path.join(tmpdir(), "trama-relanzar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms;
  while (!cond() && Date.now() < fin) await dormir(10);
  return cond();
}

/** Un checkout de mentira con su build hecho. */
function checkout(nombre: string) {
  const raiz = path.join(tmp, nombre);
  mkdirSync(path.join(raiz, "dist-electron"), { recursive: true });
  mkdirSync(path.join(raiz, "dist"), { recursive: true });
  const build = (v: string) => {
    writeFileSync(path.join(raiz, "dist-electron", "main.js"), `// ${v}\n`);
    writeFileSync(path.join(raiz, "dist-electron", "preload.cjs"), "// preload\n");
    writeFileSync(path.join(raiz, "dist", "index.html"), `<script src="/assets/index-${v}.js"></script>\n`);
  };
  build("v1");
  return { raiz, build };
}

/** El relanzador armado como en main.ts, con los líderes que responden de mentira. */
function armar(nombre: string) {
  const c = checkout(nombre);
  const x = { respondiendo: 0, relanzos: 0, avisos: 0, hilos: [] as { id: string; estado: string; en_cola?: boolean; jefe_id: string | null }[], lideres: [] as string[] };
  const rel = crearRelanzador({
    sello: () => selloDe(c.raiz),
    ocupado: () => x.respondiendo > 0 || esperandoWorkers(x.hilos, x.lideres) > 0,
    relanzar: () => void x.relanzos++,
    avisar: () => void x.avisos++,
    quietoMs: 40,
    graciaMs: 20,
    repasoMs: 10_000,
  });
  const soltar = mirarBuild(c.raiz, rel.cambio);
  return { ...c, x, rel, parar: () => (soltar(), rel.parar()) };
}

test("selloDe: cambia con el contenido del build, no con la fecha; null si falta algo", () => {
  const { raiz, build } = checkout("sello");
  const a = selloDe(raiz);
  assert.match(a ?? "", /^[0-9a-f]{40}$/);
  build("v1");
  assert.equal(selloDe(raiz), a, "el mismo build hecho de nuevo");
  build("v2");
  assert.notEqual(selloDe(raiz), a);
  writeFileSync(path.join(raiz, "dist-electron", "main.js.map"), "{}");
  const b = selloDe(raiz);
  build("v2");
  assert.equal(selloDe(raiz), b, "lo que no se carga no cuenta");
  rmSync(path.join(raiz, "dist"), { recursive: true });
  assert.equal(selloDe(raiz), null, "build a medias");
  assert.equal(selloDe(path.join(tmp, "no-existe")), null);
});

test("build más nuevo = avisa y NO se reinicia sola; otro build encima sigue siendo un solo aviso", async () => {
  const t = armar("aviso");
  assert.equal(t.rel.hay(), false);
  t.build("v2");
  assert.ok(await hasta(() => t.rel.hay()), "vio el build nuevo");
  assert.equal(t.x.avisos, 1);
  await dormir(200);
  assert.equal(t.x.relanzos, 0, "nadie tocó Reiniciar");
  // Queda libre un líder, pasa el tiempo: sigue sin reiniciarse.
  t.rel.libre();
  await dormir(100);
  assert.equal(t.x.relanzos, 0);
  t.build("v3");
  await dormir(200);
  assert.equal(t.x.avisos, 1, "un solo cartel");
  assert.equal(t.rel.hay(), true);
  assert.equal(t.rel.pedido(), false);
  assert.equal(t.x.relanzos, 0);
  t.parar();
});

test("Reiniciar sin nada corriendo = se reinicia ya (una sola vez)", async () => {
  const t = armar("libre");
  t.rel.pedir();
  assert.equal(t.x.relanzos, 0, "sin build nuevo no hay nada que reiniciar");
  t.build("v2");
  assert.ok(await hasta(() => t.rel.hay()));
  t.rel.pedir();
  assert.equal(t.x.relanzos, 1, "en el acto");
  t.rel.pedir();
  t.build("v3");
  await dormir(150);
  assert.equal(t.x.relanzos, 1, "el proceso ya se está yendo: no se reinicia dos veces");
  t.parar();
});

test("Reiniciar con un líder respondiendo = queda pedido, y se reinicia cuando termina el turno", async () => {
  const t = armar("ocupado");
  t.x.respondiendo = 1;
  t.build("v2");
  assert.ok(await hasta(() => t.rel.hay()), "vio el build nuevo");
  t.rel.pedir();
  assert.equal(t.rel.pedido(), true);
  assert.equal(t.x.avisos, 2, "el cartel pasa a decir que espera");
  await dormir(150);
  assert.equal(t.x.relanzos, 0, "nunca se corta un turno por esto");
  // Otro líder termina, pero éste sigue: todavía no.
  t.rel.libre();
  await dormir(100);
  assert.equal(t.x.relanzos, 0);
  // Termina el turno: lider.alCambiar avisa (`libre`) y, pasada la gracia, se reinicia.
  t.x.respondiendo = 0;
  t.rel.libre();
  assert.equal(t.x.relanzos, 0, "no en el acto: la cola manda lo que esperaba apenas termina el turno");
  assert.ok(await hasta(() => t.x.relanzos === 1));
  t.parar();
});

test("si en la gracia arranca otro turno, sigue esperando", async () => {
  const t = armar("gracia");
  t.x.respondiendo = 1;
  t.build("v2");
  assert.ok(await hasta(() => t.rel.hay()));
  t.rel.pedir();
  t.x.respondiendo = 0;
  t.rel.libre();
  t.x.respondiendo = 1; // el mensaje en cola salió apenas terminó el anterior
  await dormir(150);
  assert.equal(t.x.relanzos, 0);
  t.x.respondiendo = 0;
  t.rel.libre();
  assert.ok(await hasta(() => t.x.relanzos === 1));
  t.parar();
});

test("Cancelar mientras espera: el aviso sigue, pero ya no se reinicia al quedar libre", async () => {
  const t = armar("cancelar");
  t.x.respondiendo = 1;
  t.build("v2");
  assert.ok(await hasta(() => t.rel.hay()));
  t.rel.pedir();
  t.rel.cancelar();
  assert.equal(t.rel.pedido(), false);
  assert.equal(t.rel.hay(), true);
  assert.equal(t.x.avisos, 3, "apareció, espera, dejó de esperar");
  t.x.respondiendo = 0;
  t.rel.libre();
  await dormir(150);
  assert.equal(t.x.relanzos, 0);
  t.rel.pedir();
  assert.equal(t.x.relanzos, 1, "y se puede volver a pedir");
  t.parar();
});

test("pedido y sin nadie que avise que quedó libre, se vuelve a mirar solo cada tanto", async () => {
  const c = checkout("repaso");
  const x = { ocupado: true, relanzos: 0 };
  const rel = crearRelanzador({ sello: () => selloDe(c.raiz), ocupado: () => x.ocupado, relanzar: () => void x.relanzos++, quietoMs: 20, graciaMs: 20, repasoMs: 40 });
  c.build("v2");
  rel.cambio();
  assert.ok(await hasta(() => rel.hay()));
  rel.pedir();
  await dormir(100);
  assert.equal(x.relanzos, 0);
  x.ocupado = false;
  assert.ok(await hasta(() => x.relanzos === 1));
  rel.parar();
});

test("un build que deja lo mismo, o uno a medias, no avisa nada", async () => {
  const t = armar("igual");
  t.build("v1");
  await dormir(200);
  assert.equal(t.rel.hay(), false, "mismo contenido");
  // `vite build` vacía dist/ antes de escribir: mientras falte index.html no hay build que comparar.
  rmSync(path.join(t.raiz, "dist"), { recursive: true });
  await dormir(200);
  assert.equal(t.rel.hay(), false, "build a medias");
  // Vuelve dist/ (carpeta nueva: la tiene que volver a mirar) con el build nuevo completo.
  mkdirSync(path.join(t.raiz, "dist"));
  t.build("v2");
  assert.ok(await hasta(() => t.rel.hay()), "al completarse el build nuevo, avisa");
  assert.equal(t.x.avisos, 1);
  assert.equal(t.x.relanzos, 0);
  t.parar();
});

test("un build nuevo que se deshace: el aviso se va, y el reinicio pedido también", async () => {
  const t = armar("deshecho");
  t.x.respondiendo = 1;
  t.build("v2");
  assert.ok(await hasta(() => t.rel.hay()));
  t.rel.pedir();
  t.build("v1");
  assert.ok(await hasta(() => !t.rel.hay()));
  assert.equal(t.rel.pedido(), false);
  t.x.respondiendo = 0;
  t.rel.libre();
  await dormir(150);
  assert.equal(t.x.relanzos, 0);
  t.parar();
});

// Un líder de la app que terminó su turno pero espera a sus workers (`pa --esperar` en segundo plano,
// adentro de su `claude`): relanzar mataría la espera y nadie cobraría el resultado.

test("esperandoWorkers: cuenta líderes de la app con workers vivos, no workers ni líderes ajenos", () => {
  const hilos = [
    { id: "1", estado: "trabajando", jefe_id: "app-a" },
    { id: "2", estado: "colgado", jefe_id: "app-a" },
    { id: "3", estado: "listo", en_cola: true, jefe_id: "app-b" },
    { id: "4", estado: "trabajando", jefe_id: "terminal" },
    { id: "5", estado: "trabajando", jefe_id: null },
    { id: "6", estado: "murio", jefe_id: "app-c" },
    { id: "7", estado: "decision", jefe_id: "app-c" },
  ];
  assert.equal(esperandoWorkers(hilos, ["app-a", "app-b", "app-c"]), 2, "a (dos workers, un líder) y b (en cola)");
  assert.equal(esperandoWorkers(hilos, ["app-c"]), 0, "lo que ya terminó o murió no se espera");
  assert.equal(esperandoWorkers(hilos, []), 0);
  assert.equal(esperandoWorkers([], ["app-a"]), 0);
});

test("workersEsperados: los workers vivos de los líderes de la app, de a uno", () => {
  const hilos = [
    { id: "1", estado: "trabajando", jefe_id: "app-a" },
    { id: "2", estado: "colgado", jefe_id: "app-a" },
    { id: "3", estado: "listo", en_cola: true, jefe_id: "app-b" },
    { id: "4", estado: "trabajando", jefe_id: "terminal" },
    { id: "5", estado: "murio", jefe_id: "app-a" },
  ];
  assert.equal(workersEsperados(hilos, ["app-a", "app-b"]), 3);
  assert.equal(workersEsperados(hilos, ["app-b"]), 1);
  assert.equal(workersEsperados(hilos, []), 0);
});

test("Reiniciar con un líder de la app esperando a su worker = espera, y se reinicia cuando el worker termina", async () => {
  const t = armar("worker");
  t.x.lideres = ["s-app"];
  t.x.hilos = [{ id: "1", estado: "trabajando", jefe_id: "s-app" }];
  t.build("v2");
  assert.ok(await hasta(() => t.rel.hay()), "ve el build nuevo");
  t.rel.pedir();
  await dormir(150);
  assert.equal(t.x.relanzos, 0, "el líder está en reposo pero su worker no terminó");
  // Otra lista con el worker todavía colgado: se reevalúa y sigue esperando.
  t.x.hilos = [{ id: "1", estado: "colgado", jefe_id: "s-app" }];
  t.rel.libre();
  await dormir(100);
  assert.equal(t.x.relanzos, 0, "colgado también se espera");
  t.x.hilos = [{ id: "1", estado: "listo", jefe_id: "s-app" }];
  t.rel.libre();
  assert.ok(await hasta(() => t.x.relanzos === 1), "terminó el worker: se reinicia");
  t.parar();
});

test("Reiniciar con un líder de la app cuyo proceso salió, uno de terminal con worker vivo, o uno sin workers = se reinicia ya", async () => {
  for (const [nombre, lideres, hilos] of [
    ["salio", [], [{ id: "1", estado: "trabajando", jefe_id: "s-app" }]],
    ["terminal", ["s-app"], [{ id: "1", estado: "trabajando", jefe_id: "s-terminal" }]],
    ["sin-workers", ["s-app"], [{ id: "1", estado: "integrado", jefe_id: "s-app" }, { id: "2", estado: "trabajando", jefe_id: null }]],
  ] as const) {
    const t = armar(nombre);
    t.x.lideres = [...lideres];
    t.x.hilos = hilos.map((h) => ({ ...h }));
    t.build("v2");
    assert.ok(await hasta(() => t.rel.hay()));
    t.rel.pedir();
    assert.equal(t.x.relanzos, 1, nombre);
    t.parar();
  }
});

test("lideresConWorkers: quiénes son, sin repetir; sinEventos: 20 min", () => {
  const hilos = [
    { estado: "trabajando", jefe_id: "a" },
    { estado: "colgado", jefe_id: "a" },
    { estado: "listo", en_cola: true, jefe_id: "b" },
    { estado: "integrado", jefe_id: "c" },
    { estado: "trabajando", jefe_id: "terminal" },
  ];
  assert.deepEqual(lideresConWorkers(hilos, ["a", "b", "c"]).sort(), ["a", "b"]);
  assert.equal(esperandoWorkers(hilos, ["a", "b", "c"]), 2);
  assert.equal(sinEventos(1000, 1000 + COLGADO_MS - 1), false);
  assert.equal(sinEventos(1000, 1000 + COLGADO_MS), true);
});

test("Reiniciar igual: con algo vivo espera, salvo que lleve 20 min sin eventos; nunca sin pedirlo", async () => {
  const c = checkout("igual");
  const x = { ocupado: true, colgado: false, relanzos: 0 };
  const rel = crearRelanzador({
    sello: () => selloDe(c.raiz),
    ocupado: () => x.ocupado,
    colgado: () => x.colgado,
    relanzar: () => void x.relanzos++,
    quietoMs: 40,
    graciaMs: 20,
    repasoMs: 10_000,
  });
  const soltar = mirarBuild(c.raiz, rel.cambio);
  c.build("v2");
  assert.ok(await hasta(() => rel.hay()));
  await dormir(150);
  assert.equal(x.relanzos, 0, "con un build nuevo no se reinicia sola, ni con algo colgado");
  x.colgado = true;
  await dormir(150);
  assert.equal(x.relanzos, 0, "colgado no reinicia: hace falta que Ana lo pida");
  // "Reiniciar igual" con lo que espera vivo y con eventos hace poco: no vale, queda esperando.
  x.colgado = false;
  rel.pedir(true);
  assert.equal(x.relanzos, 0, "no estaba colgado: espera como siempre");
  assert.equal(rel.pedido(), true);
  // Ahora sí lleva 20 min quieto.
  x.colgado = true;
  rel.pedir(true);
  assert.equal(x.relanzos, 1, "reinicia sin esperar a lo colgado");
  rel.pedir(true);
  assert.equal(x.relanzos, 1, "una sola vez");
  soltar();
  rel.parar();
});

test("con `.listo` (lo último que escribe el build) se avisa enseguida, sin esperar la quietud larga", async () => {
  const c = checkout("listo");
  const vistos: { quietoMs: number; conMarca: boolean }[] = [];
  const rel = crearRelanzador({ sello: () => selloDe(c.raiz), ocupado: () => false, relanzar: () => {}, visto: (v) => void vistos.push(v), quietoMs: 3000, listoMs: 30 });
  const soltar = mirarBuild(c.raiz, rel.cambio);
  try {
    c.build("v2");
    await dormir(150);
    assert.equal(rel.hay(), false, "sin la marca vale la quietud larga");
    writeFileSync(path.join(c.raiz, "dist-electron", LISTO), "");
    assert.ok(await hasta(() => rel.hay(), 1500), "con la marca, enseguida");
    assert.deepEqual(vistos.map((v) => [v.quietoMs, v.conMarca]), [[30, true]]);
  } finally {
    soltar();
    rel.parar();
  }
});
