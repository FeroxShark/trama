// Las acciones sobre la otra máquina (etapa 7, M4; electron/maquinas.ts `enrutar`): con el mismo build van al motor de
// la fila. Dos núcleos de verdad (la PC en este proceso, el Dell en otro: tests/fixtures/motor-otra.ts en 127.0.0.2),
// cada uno con su `pa` y su `claude` falsos y su tmp. Desde la PC se crea un líder en el Dell (con el selector), se le
// escribe y se le integra un worker; lo de acá nunca se hace en el Dell ni lo del Dell acá. Con el Dell caído o con otro
// build la acción se rechaza con aviso y no se hace en ningún lado (un cliente falso prueba la versión distinta).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const raiz = path.join(import.meta.dirname, "..");
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-maq-acciones-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const entorno = (quien: string) => ({
  HILOS_STATE: path.join(tmp, quien, "estado"),
  HILOS_SESIONES: path.join(tmp, quien, "sesiones"),
  CLAUDE_CONFIG_DIR: path.join(tmp, quien, "claude"),
  PA_STATE: path.join(tmp, quien, "pa"),
  PA_FALSO_LOG: path.join(tmp, quien, "pa.log"),
  PA_FALSO_AHORA: "1790000000",
  HILOS_PA: path.join(raiz, "scripts", "pa-falso.sh"),
  HILOS_CLAUDE: path.join(raiz, "scripts", "claude-falso.mjs"),
  TRAMA_FALSO_DICHO: path.join(tmp, quien, "dicho.jsonl"),
  HILOS_HISTORIAL: "0",
  HILOS_CLAUDE_SETTINGS: path.join(tmp, quien, "claude-settings.json"),
  PROYECTOS_REGISTRY: path.join(tmp, quien, "registry.json"),
});
const DELL = entorno("dell");
const PC = entorno("pc");
// Antes de cualquier import de electron/: las rutas del estado se fijan al importar.
Object.assign(process.env, PC);
for (const e of [DELL, PC]) {
  for (const d of [e.HILOS_STATE, e.PA_STATE]) mkdirSync(d, { recursive: true });
  mkdirSync(path.join(e.HILOS_STATE, "..", "proy", "atlas"), { recursive: true });
  writeFileSync(e.PROYECTOS_REGISTRY, JSON.stringify({ projects: [{ name: "atlas", path: path.join(e.HILOS_STATE, "..", "proy", "atlas"), desc: "La web" }] }));
}
writeFileSync(path.join(DELL.HILOS_STATE, "preload.cjs"), "");

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta<T>(f: () => Promise<T | null | false> | T | null | false, ms = 15_000): Promise<T> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > fin) assert.fail("no pasó a tiempo");
    await espera(50);
  }
}
const leer = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const dicho = (e: { TRAMA_FALSO_DICHO: string }) =>
  leer(e.TRAMA_FALSO_DICHO)
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { sid: string; texto: string });

async function arrancarDell(puerto = 0) {
  const p = spawn(process.execPath, [path.join(raiz, "tests", "fixtures", "motor-otra.ts")], {
    env: { ...process.env, ...DELL, PUERTO: String(puerto) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  after(() => void p.kill("SIGKILL"));
  const port = await new Promise<number>((ok, mal) => {
    let t = "";
    p.stdout.on("data", (b) => {
      t += b;
      if (t.includes("\n")) ok(Number(t.trim()));
    });
    p.on("exit", (c) => mal(new Error(`el Dell salió con ${c}`)));
  });
  return { p, port };
}

const MODELO = { modelo: "claude-opus-5-5", effort: "medium" };

test("desde la PC se crea un líder en el Dell, se le escribe y se le integra un worker; con el Dell caído nada se hace en ningún lado", async () => {
  const dell = await arrancarDell();
  writeFileSync(
    path.join(PC.HILOS_STATE, "maquinas.json"),
    JSON.stringify({ version: 1, esta: "pc", maquinas: [{ id: "dell", nombre: "Dell", url: `http://127.0.0.2:${dell.port}` }] }),
  );
  const nucleo = await import("../electron/nucleo.ts");
  nucleo.armarNucleo();
  after(() => nucleo.correrSalida());
  const pedir = (canal: string, ...args: unknown[]) => nucleo.llamarLocal(canal, args, "prueba");
  const lista = async () => ((await pedir("hilos:completa")) as { datos?: { hilos: { id: string }[] } }).datos?.hilos ?? [];
  await pedir("hilos:leer");
  await hasta(async () => (await lista()).some((h) => h.id === "dell:20261003-100000-11111"));

  // El selector dice Dell: el líder nace allá (su claude falso recibe el mensaje) y vuelve con el prefijo.
  const sid = (await pedir("lider:nuevo", { texto: "hola, Dell", ...MODELO, maquina: "dell" })) as string;
  assert.match(sid, /^dell:[0-9a-f-]{36}$/);
  await hasta(() => dicho(DELL).length === 1);
  assert.deepEqual(dicho(DELL).map((d) => d.texto), ["hola, Dell"]);
  assert.equal(`dell:${dicho(DELL)[0].sid}`, sid);
  assert.equal(dicho(PC).length, 0, "no se hizo acá");

  // Escribirle y la cola van a su motor con su id de allá.
  await hasta(async () => {
    try {
      await pedir("lider:mandar", { sid, texto: "otra cosa", ...MODELO });
      return true;
    } catch (e) {
      if (/respondiendo/.test(String(e))) return false; // el primer turno del Dell todavía no terminó
      throw e;
    }
  });
  await hasta(() => dicho(DELL).length === 2);
  assert.equal(dicho(DELL)[1].sid, sid.slice(5));
  await pedir("lider:encolar", { sid, texto: "en cola", ...MODELO });
  await hasta(() => dicho(DELL).length === 3, 20_000);
  assert.equal(dicho(PC).length, 0);

  // Integrar un worker del Dell: su `pa` lo corre (con el id de allá); el de la PC no se entera.
  await pedir("pa:rama", "integrar", { id: "dell:20261003-100000-11111", proyecto: "atlas" });
  assert.match(leer(DELL.PA_FALSO_LOG), /--integrar 20261003-100000-11111/);
  assert.doesNotMatch(leer(PC.PA_FALSO_LOG), /--integrar/);
  // Archivar (cerrar sin rama) y parar un worker del Dell, también allá.
  await pedir("pa:cerrar", { id: "dell:20261003-100100-22222", proyecto: "atlas", rama: null, origen: "jefe" });
  assert.match(leer(DELL.PA_FALSO_LOG), /22222/);
  await pedir("pa:parar", "dell:20261003-100300-44444");
  assert.match(leer(DELL.PA_FALSO_LOG), /--parar 20261003-100300-44444/);
  assert.doesNotMatch(leer(PC.PA_FALSO_LOG), /--parar|22222/);

  // El archivo adjunto de un líder de allá queda en el Dell (su ruta es de allá).
  const ruta = (await pedir("lider:archivo", { nombre: "nota.md", datos: new TextEncoder().encode("# hola"), maquina: "dell" })) as string;
  assert.ok(ruta.startsWith(DELL.HILOS_STATE) && readFileSync(ruta, "utf8") === "# hola");

  // Sin selector (o con la de acá) todo es de acá, como siempre.
  // Cada líder es un proceso `claude` falso aparte: sin esperar al primero, cuál anota antes su mensaje es una carrera.
  await pedir("lider:nuevo", { texto: "de acá", ...MODELO });
  await hasta(() => dicho(PC).length === 1);
  await pedir("lider:nuevo", { texto: "de acá también", ...MODELO, maquina: "pc" });
  await hasta(() => dicho(PC).length === 2);
  assert.deepEqual(dicho(PC).map((d) => d.texto), ["de acá", "de acá también"]);
  assert.ok(!dicho(DELL).some((d) => d.texto.startsWith("de acá")));

  // El brief de Ramas con filas de las dos: cada una a su máquina, y vuelve con el id de cada una.
  const fila = (id: string) => ({ id, proyecto: "atlas", rama: "pa/atlas/20261003-100000-11111", estado: "listo", commits: 2, tarea: "t", resultado: null, decision: null, fin: 1, jefe_id: null });
  const brief = (await pedir("ramas:brief", [fila("20261003-100000-11111"), fila("dell:20261003-100000-11111")])) as { id: string }[];
  assert.deepEqual(brief.map((b) => b.id).sort(), ["20261003-100000-11111", "dell:20261003-100000-11111"]);

  // Una máquina que no existe no cae en ésta: falla.
  await assert.rejects(pedir("lider:nuevo", { texto: "x", ...MODELO, maquina: "nube" }), /main\.maquinaDesconocida/);

  // El Dell se muere: lo pedido para allá se rechaza con aviso, no se hace acá ni en ningún lado.
  const antes = { pc: dicho(PC).length, log: leer(PC.PA_FALSO_LOG) };
  dell.p.kill("SIGKILL");
  await hasta(async () => !(await lista()).some((h) => h.id.startsWith("dell:")));
  await assert.rejects(pedir("lider:nuevo", { texto: "perdido", ...MODELO, maquina: "dell" }), /main\.maquinaSinConexion/);
  await assert.rejects(pedir("lider:mandar", { sid, texto: "perdido", ...MODELO }), /main\.maquinaSinConexion/);
  await assert.rejects(pedir("pa:rama", "integrar", { id: "dell:20261003-100000-11111", proyecto: "atlas" }), /main\.maquinaSinConexion/);
  await assert.rejects(pedir("tablero:agregar", "algo", null, "dell"), /main\.maquinaSinConexion/);
  await espera(300);
  assert.equal(dicho(PC).length, antes.pc);
  assert.equal(leer(PC.PA_FALSO_LOG), antes.log);
});

test("otro build: lo que se lee pasa, toda acción se rechaza con aviso y no se manda nada", async () => {
  const { crearMaquinas } = await import("../electron/maquinas.ts");
  const { compatible, HUELLA, PROTOCOLO } = await import("../electron/maquinas-contrato.ts");
  const pedidos: [string, unknown[]][] = [];
  let aviso: ((e: unknown) => void) | undefined;
  const saludo = { version: 1, protocolo: PROTOCOLO + 1, huella: HUELLA, maquina: "dell" };
  assert.equal(compatible(saludo), "leer");
  const m = crearMaquinas({
    config: { version: 1, esta: "pc", nombre: "PC", color: null, maquinas: [{ id: "dell", nombre: "Dell", url: "http://127.0.0.2:1" }], malas: [] } as never,
    alEvento: () => {},
    alCambio: () => {},
    cliente: (o) => {
      aviso = o.alCambiar as never;
      return {
        estado: () => ({ fase: "conectada", saludo, acceso: "leer" }),
        pedir: async (c, a = []) => (pedidos.push([c, a]), { ok: true }),
        cerrar() {},
      };
    },
  })!;
  aviso?.({ fase: "conectada", saludo, acceso: "leer" } as never);
  await assert.rejects(m.enrutar("lider:nuevo", [{ texto: "x", maquina: "dell" }], "v")!, /main\.maquinaSoloLectura/);
  await assert.rejects(m.enrutar("lider:mandar", [{ sid: "dell:s1", texto: "x" }], "v")!, /main\.maquinaSoloLectura/);
  await assert.rejects(m.enrutar("pa:rama", ["integrar", { id: "dell:1", proyecto: "atlas" }], "v")!, /main\.maquinaSoloLectura/);
  await assert.rejects(m.enrutar("tablero:agregar", ["algo", null, "dell"], "v")!, /main\.maquinaSoloLectura/);
  await assert.rejects(m.enrutar("ramas:brief", [[{ id: "dell:1", rama: "pa/x/1" }]], "v", async () => [])!, /main\.maquinaSoloLectura/);
  assert.equal(pedidos.filter(([c]) => c !== "hilos:leer" && !c.endsWith(":leer") && c !== "lider:colas" && c !== "tablero:leer").length, 0);
  // Lo que se lee sigue pasando, con el id de allá.
  await m.enrutar("pa:hilo", [{ id: "dell:7", n: 5 }], "v");
  assert.deepEqual(pedidos.at(-1), ["pa:hilo", [{ id: "7", n: 5 }]]);
  // Y lo de acá no se toca.
  assert.equal(m.enrutar("lider:nuevo", [{ texto: "x" }], "v"), null);
  assert.equal(m.enrutar("pa:rama", ["integrar", { id: "7", proyecto: "atlas" }], "v"), null);
});

// El núcleo de acá deja sus watchers armados (como en la app): el proceso de prueba sale solo.
after(() => void setTimeout(() => process.exit(0), 50).unref());
