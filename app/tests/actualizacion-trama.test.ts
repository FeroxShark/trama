// El aviso de "hay una Trama nueva" (electron/actualizacion-trama.ts): la comparación por semver (la instalada 0.2.0
// contra el release v0.1.4 NO avisa), la validación estricta del tag, el argv de Actualizar (sin shell), el checkout que
// anota el instalador y el aviso entero con un GitHub y un git de mentira. Nunca toca la red ni corre el instalador real.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configTrama } from "../electron/rutas.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-act-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
const m = await import("../electron/actualizacion-trama.ts");

// --- la comparación ---

test("0.2.0 instalada contra v0.1.4 no es más nueva (semver, no texto)", () => {
  assert.equal(m.esMasNueva("0.2.0", "v0.1.4"), false);
  assert.equal(m.esMasNueva("0.2.0", "v0.2.0"), false);
  assert.equal(m.esMasNueva("0.2.0", "v0.2.1"), true);
  assert.equal(m.esMasNueva("0.1.4", "v0.2.0"), true);
});

test("la comparación es número a número: 0.10.0 es más nueva que 0.9.0 y 0.2.0 que 0.1.14", () => {
  assert.equal(m.esMasNueva("0.9.0", "v0.10.0"), true);
  assert.equal(m.esMasNueva("0.10.0", "v0.9.0"), false);
  assert.equal(m.esMasNueva("0.1.14", "v0.2.0"), true);
  assert.equal(m.esMasNueva("1.0.0", "v0.99.99"), false);
});

test("sin instalada o sin tag entendible no hay aviso", () => {
  assert.equal(m.esMasNueva(null, "v1.0.0"), false);
  assert.equal(m.esMasNueva("0.1.0", null), false);
  assert.equal(m.esMasNueva("0.1.0", "latest"), false);
  assert.equal(m.esMasNueva("0.1.0", "v1.0.0-rc1"), false);
});

// --- el tag ---

test("tagValido: sólo vX.Y.Z", () => {
  for (const ok of ["v0.1.4", "v10.20.30", "v0.0.0"]) assert.equal(m.tagValido(ok), true, ok);
  const mal = ["0.1.4", "v0.1", "v0.1.4.1", "v0.1.4-beta", "v0.1.4\n", " v0.1.4", "v0.1.4 ", "V0.1.4", "v0.1.x", "v٠.١.٢", "--upload-pack=x", "v1.2.3; rm -rf ~", "v1.2.3\nv4.5.6", "../v1.2.3", "refs/tags/v1.2.3", "", null, undefined, 123, {}];
  for (const x of mal) assert.equal(m.tagValido(x), false, JSON.stringify(x));
});

test("tagDeRelease: del JSON de GitHub, sólo un release publicado con un tag válido", () => {
  assert.equal(m.tagDeRelease({ tag_name: "v0.1.4", draft: false, prerelease: false }), "v0.1.4");
  assert.equal(m.tagDeRelease({ tag_name: "v0.1.4" }), "v0.1.4");
  assert.equal(m.tagDeRelease({ tag_name: "v0.1.4", prerelease: true }), null);
  assert.equal(m.tagDeRelease({ tag_name: "v0.1.4", draft: true }), null);
  assert.equal(m.tagDeRelease({ tag_name: "v0.1.4; id" }), null);
  assert.equal(m.tagDeRelease({ tag_name: 4 }), null);
  assert.equal(m.tagDeRelease({ message: "API rate limit exceeded" }), null);
  assert.equal(m.tagDeRelease(null), null);
  assert.equal(m.tagDeRelease("v0.1.4"), null);
});

test("repoDe: del campo repository de package.json (URL, abreviatura u objeto); lo que no es de GitHub, null", () => {
  assert.equal(m.repoDe("https://github.com/dueno/proyecto.git"), "dueno/proyecto");
  assert.equal(m.repoDe("git+https://github.com/dueno/proyecto.git"), "dueno/proyecto");
  assert.equal(m.repoDe("github:dueno/proyecto"), "dueno/proyecto");
  assert.equal(m.repoDe({ type: "git", url: "https://github.com/dueno/proyecto" }), "dueno/proyecto");
  for (const x of ["https://gitlab.com/a/b", "github:a/b/../c", "https://github.com/a/b?x=1", "", null, 3]) assert.equal(m.repoDe(x), null, JSON.stringify(x));
});

test("urlNotas sólo arma el link de un tag y un repo válidos", () => {
  assert.equal(m.urlNotas("v0.1.4", "dueno/proyecto"), "https://github.com/dueno/proyecto/releases/tag/v0.1.4");
  assert.equal(m.urlNotas("v0.1.4/../../x", "dueno/proyecto"), null);
  assert.equal(m.urlNotas("v0.1.4", null), null);
  assert.equal(m.urlNotas("v0.1.4", "a/b/../c"), null);
});

// --- el argv de Actualizar ---

test("pasosActualizar: fetch --tags, checkout --detach refs/tags/<tag> y el instalador, todo por argv", () => {
  const dir = "/home/u/trama";
  const p = m.pasosActualizar("v0.3.1", dir);
  assert.deepEqual(
    p.map((x) => [x.cmd, ...x.args]),
    [
      ["git", "fetch", "--tags"],
      ["git", "-c", "advice.detachedHead=false", "checkout", "--detach", "refs/tags/v0.3.1"],
      ["bash", path.join(dir, "motor", "scripts", "instalar-producto.sh"), "--fuente", dir],
    ],
  );
  for (const x of p) assert.equal(x.cwd, dir);
  assert.equal(p[2].env?.TRAMA_SIN_REINICIO_VENTANA, "1");
  // Ningún argumento sale del tag tal cual: el tag nunca se pega a un shell ni queda suelto como opción.
  assert.ok(p.every((x) => !x.args.includes("v0.3.1")));
});

test("pasosActualizar rechaza un tag o una ruta que no valen (nunca llegan a git)", () => {
  for (const tag of ["--force", "v1.2.3; touch /tmp/x", "main", "v1.2", "$(id)", "v1.2.3\n--exec=x"]) assert.throws(() => m.pasosActualizar(tag, "/x"), /tag inválido/, tag);
  assert.throws(() => m.pasosActualizar("v1.2.3", "relativa/trama"), /checkout inválido/);
  assert.throws(() => m.pasosActualizar("v1.2.3", "/x\0y"), /checkout inválido/);
});

test("falloDelInstalador: las líneas AVISO app… del instalador (que sale 0) son una falla; las demás no", () => {
  assert.equal(m.falloDelInstalador("ok  algo\nAVISO  app: la compilación falló (ver /x/.build.log)\n"), "app: la compilación falló (ver /x/.build.log)");
  assert.equal(m.falloDelInstalador("AVISO  app de escritorio: sin node"), "app de escritorio: sin node");
  assert.equal(m.falloDelInstalador("AVISO  apt-get update falló\nok  todo"), null);
  assert.equal(m.falloDelInstalador("listo."), null);
});

// --- el checkout que anota el instalador ---

function checkoutFalso(ok = true) {
  const dir = mkdtempSync(path.join(tmp, "co-"));
  if (ok) {
    mkdirSync(path.join(dir, ".git"));
    mkdirSync(path.join(dir, "motor", "scripts"), { recursive: true });
    writeFileSync(path.join(dir, "motor", "scripts", "instalar-producto.sh"), "#!/bin/bash\n");
  }
  return dir;
}
function configCon(linea: string | null) {
  const cfg = mkdtempSync(path.join(tmp, "cfg-"));
  const env = { XDG_CONFIG_HOME: cfg, HOME: cfg, USERPROFILE: cfg, LOCALAPPDATA: cfg } as NodeJS.ProcessEnv;
  const dir = configTrama(env);
  mkdirSync(dir, { recursive: true });
  if (linea !== null) writeFileSync(path.join(dir, "checkout"), linea);
  return env;
}

test("leerCheckout: la ruta anotada si sigue siendo un checkout de Trama; si no, null", () => {
  const co = checkoutFalso();
  assert.equal(m.leerCheckout(configCon(`${co}\n`)), co);
  assert.equal(m.leerCheckout(configCon(co)), co);
  assert.equal(m.leerCheckout(configCon(null)), null);
  assert.equal(m.leerCheckout(configCon("")), null);
  assert.equal(m.leerCheckout(configCon("relativa\n")), null);
  assert.equal(m.leerCheckout(configCon(`${checkoutFalso(false)}\n`)), null);
});

// --- el aviso entero, con GitHub y git de mentira ---

type Llamada = { cmd: string; args: string[]; cwd: string; env?: Record<string, string> };
type Opciones = { instalada: string; tag?: string | null; sucio?: boolean; sinRed?: boolean; falla?: string; avisoInstalador?: string; checkout?: string | null; archivo?: string; archivoAct?: string; ocupacion?: () => import("../electron/actualizacion-trama.ts").Ocupacion; vivo?: (pid: number) => boolean; esperaMs?: number; quietas?: number };
function armar(o: Opciones) {
  const llamadas: Llamada[] = [];
  let pedidos = 0;
  let reloj = 1_000_000;
  const co = o.checkout === undefined ? checkoutFalso() : o.checkout;
  const archivo = o.archivo ?? path.join(mkdtempSync(path.join(tmp, "st-")), "trama-version.json");
  const act = m.crearActualizacionTrama({
    archivo,
    archivoAct: o.archivoAct ?? path.join(path.dirname(archivo), "trama-actualizacion.json"),
    registro: path.join(path.dirname(archivo), "trama-actualizacion.log"),
    ...(o.ocupacion ? { ocupacion: o.ocupacion } : {}),
    ...(o.vivo ? { vivo: o.vivo } : {}),
    esperaMs: o.esperaMs ?? 5,
    quietas: o.quietas ?? 2,
    checkout: () => co,
    instalada: () => o.instalada,
    repo: () => "dueno/proyecto",
    ahora: () => reloj,
    cada: () => {},
    despues: () => {},
    traer: async () => {
      pedidos++;
      if (o.sinRed) throw new Error("ENOTFOUND api.github.com");
      return { ok: true, json: async () => (o.tag === null ? { message: "Not Found" } : { tag_name: o.tag ?? "v0.1.4" }) };
    },
    correr: async (p) => {
      llamadas.push({ cmd: p.cmd, args: p.args, cwd: p.cwd, env: p.env });
      if (p.cmd === "git" && p.args[0] === "status") return { code: 0, salida: o.sucio ? " M motor/bin/pa\n" : "" };
      if (o.falla && p.args.join(" ").includes(o.falla)) return { code: 128, salida: "fatal: unable to access 'https://github.com/x': Could not resolve host\n" };
      if (p.cmd === "bash") return { code: 0, salida: o.avisoInstalador ?? "listo. Para abrir la interfaz: trama-motor abrir\n" };
      return { code: 0, salida: "" };
    },
  });
  return { act, llamadas, pedidos: () => pedidos, avanzar: (ms: number) => (reloj += ms), co, archivo };
}

test("instalada 0.2.0 y último release v0.1.4: no avisa", async () => {
  const x = armar({ instalada: "0.2.0", tag: "v0.1.4" });
  assert.equal(await x.act.leerAviso(), null);
  assert.equal(x.pedidos(), 1);
});

test("instalada 0.1.0 y último v0.1.4: avisa con la versión nueva y si el checkout está sucio", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4" });
  assert.deepEqual(await x.act.leerAviso(), { instalada: "0.1.0", ultima: "0.1.4", sucio: false, notas: "https://github.com/dueno/proyecto/releases/tag/v0.1.4" });
  const y = armar({ instalada: "0.1.0", tag: "v0.1.4", sucio: true });
  assert.equal((await y.act.leerAviso())?.sucio, true);
});

test("sin red o con un GitHub que no contesta bien: silencio, y no se insiste en cada pedido", async () => {
  const x = armar({ instalada: "0.1.0", sinRed: true });
  assert.equal(await x.act.leerAviso(), null);
  assert.equal(await x.act.leerAviso(), null);
  assert.equal(x.pedidos(), 1);
  x.avanzar(16 * 60_000);
  await x.act.leerAviso();
  assert.equal(x.pedidos(), 2);
  const y = armar({ instalada: "0.1.0", tag: null });
  assert.equal(await y.act.leerAviso(), null);
});

test("se vuelve a preguntar a los 2 min, no antes (los releases de Trama salen varias veces por día)", async () => {
  const x = armar({ instalada: "0.1.0" });
  await x.act.leerAviso();
  x.avanzar(60_000);
  await x.act.leerAviso();
  assert.equal(x.pedidos(), 1);
  x.avanzar(60_000);
  await x.act.leerAviso();
  assert.equal(x.pedidos(), 2);
});

test("Buscar (Ajustes) consulta siempre, aunque el chequeo de hace 10 min no toque; si hay una nueva avisa a la barra", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4" });
  const avisos: Array<{ ultima: string } | null> = [];
  x.act.alCambiarAviso((a) => avisos.push(a));
  await x.act.leerAviso();
  x.avanzar(10 * 60_000);
  assert.deepEqual(await x.act.buscar(), { ultima: "0.1.4", nueva: true });
  assert.equal(x.pedidos(), 2);
  assert.equal(avisos.at(-1)?.ultima, "0.1.4");
});

test("Buscar con la versión instalada al día: no es nueva, y la última queda para mostrarla", async () => {
  const x = armar({ instalada: "0.2.0", tag: "v0.1.4" });
  assert.deepEqual(await x.act.buscar(), { ultima: "0.1.4", nueva: false });
});

test("Buscar sin red o sin checkout anotado: no sabe (ultima null), y sólo sin checkout no consulta", async () => {
  const sinRed = armar({ instalada: "0.1.0", sinRed: true });
  assert.deepEqual(await sinRed.act.buscar(), { ultima: null, nueva: false });
  assert.equal(sinRed.pedidos(), 1);
  const sinCo = armar({ instalada: "0.1.0", tag: "v0.1.4", checkout: null });
  assert.deepEqual(await sinCo.act.buscar(), { ultima: null, nueva: false });
  assert.equal(sinCo.pedidos(), 0);
});

test("sin checkout anotado no hay aviso ni consulta ni Actualizar", async () => {
  const x = armar({ instalada: "0.1.0", checkout: null });
  assert.equal(await x.act.leerAviso(), null);
  assert.equal(x.pedidos(), 0);
  const r = await x.act.actualizar();
  assert.equal(r.ok, false);
  assert.equal(x.llamadas.length, 0);
});

test("Ahora no: oculta esa versión y avisa si sale otra más nueva", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4" });
  assert.ok(await x.act.leerAviso());
  let visto: unknown = "nada";
  x.act.alCambiarAviso((a) => (visto = a));
  await x.act.descartar();
  assert.equal(visto, null);
  x.avanzar(7 * 60 * 60_000);
  assert.equal(await x.act.leerAviso(), null);
  // El mismo archivo de estado con un release más nuevo: la versión ocultada no vale para la siguiente.
  const otra = armar({ instalada: "0.1.0", tag: "v0.1.4" });
  await otra.act.leerAviso();
  await otra.act.descartar();
  const z = armar({ instalada: "0.1.0", tag: "v0.1.5", archivo: otra.archivo, checkout: otra.co });
  assert.equal(await z.act.leerAviso(), null, "la ocultada 0.1.4 sigue oculta mientras el release sea el mismo día");
  z.avanzar(7 * 60 * 60_000);
  assert.equal((await z.act.leerAviso())?.ultima, "0.1.5");
});

// --- GitHub de mentira: cada respuesta la decide `responder(n)`; `ciclo()` y `reintento()` disparan lo que el proceso dejó armado ---
type Resp = { status?: number; tag?: string; etag?: string; headers?: Record<string, string>; red?: boolean };
const flush = () => new Promise((r) => setTimeout(r, 10));
function armarGitHub(o: { instalada: string; responder: (n: number) => Resp }) {
  const pedidos: Array<Record<string, string>> = [];
  const esperas: number[] = [];
  let reloj = 1_000_000;
  let ciclo: () => void = () => {};
  let reintento: () => void = () => {};
  const archivo = path.join(mkdtempSync(path.join(tmp, "gh-")), "trama-version.json");
  const act = m.crearActualizacionTrama({
    archivo,
    archivoAct: path.join(path.dirname(archivo), "trama-actualizacion.json"),
    registro: path.join(path.dirname(archivo), "trama-actualizacion.log"),
    checkout: () => checkoutFalso(),
    instalada: () => o.instalada,
    repo: () => "dueno/proyecto",
    ahora: () => reloj,
    cada: (f) => (ciclo = f),
    despues: (f, ms) => ((reintento = f), esperas.push(ms)),
    traer: async (_url, init) => {
      pedidos.push({ ...init.headers });
      const r = o.responder(pedidos.length);
      if (r.red) throw new Error("ENOTFOUND api.github.com");
      const cab = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      if (r.etag) cab.etag = r.etag;
      return { ok: (r.status ?? 200) < 300, status: r.status ?? 200, headers: { get: (k: string) => cab[k.toLowerCase()] ?? null }, json: async () => (r.tag ? { tag_name: r.tag } : { message: "x" }) };
    },
    correr: async () => ({ code: 0, salida: "" }),
  });
  return { act, pedidos, esperas, avanzar: (ms: number) => (reloj += ms), ciclo: () => ciclo(), reintento: () => reintento() };
}

test("ETag: el ciclo manda If-None-Match con el del último release; un 304 no cambia el aviso ni es un error", async () => {
  const x = armarGitHub({ instalada: "0.1.0", responder: (n) => (n === 1 ? { tag: "v0.1.4", etag: 'W/"a"' } : { status: 304 }) });
  assert.equal((await x.act.leerAviso())?.ultima, "0.1.4");
  assert.equal(x.pedidos[0]["if-none-match"], undefined);
  x.avanzar(2 * 60_000);
  x.ciclo();
  await flush();
  assert.equal(x.pedidos[1]["if-none-match"], 'W/"a"');
  assert.equal((await x.act.leerAviso())?.ultima, "0.1.4");
  assert.equal(x.pedidos.length, 2);
});

test("200 con una versión nueva: el aviso sube a la nueva aunque se haya descartado la anterior", async () => {
  const x = armarGitHub({ instalada: "0.1.0", responder: (n) => (n === 1 ? { tag: "v0.1.4", etag: 'W/"a"' } : { tag: "v0.1.5", etag: 'W/"b"' }) });
  const vistos: Array<string | null> = [];
  await x.act.leerAviso();
  x.act.alCambiarAviso((a) => vistos.push(a?.ultima ?? null));
  await x.act.descartar();
  x.avanzar(2 * 60_000);
  x.ciclo();
  await flush();
  assert.deepEqual(vistos, [null, "0.1.5"]);
  assert.equal(x.pedidos[1]["if-none-match"], 'W/"a"');
});

test("200 con una versión nueva mientras el aviso sigue abierto: la barra recibe la nueva sin cerrar nada", async () => {
  const x = armarGitHub({ instalada: "0.1.0", responder: (n) => (n === 1 ? { tag: "v0.1.4" } : { tag: "v0.1.5" }) });
  const vistos: Array<string | null> = [];
  await x.act.leerAviso();
  x.act.alCambiarAviso((a) => vistos.push(a?.ultima ?? null));
  x.avanzar(2 * 60_000);
  x.ciclo();
  await flush();
  assert.deepEqual(vistos, ["0.1.5"]);
  assert.equal((await x.act.leerAviso())?.ultima, "0.1.5");
});

test("403: GitHub limita → espera lo que dice (Retry-After), sin error ni aviso borrado; después vuelve a preguntar", async () => {
  const x = armarGitHub({ instalada: "0.1.0", responder: (n) => (n === 1 ? { tag: "v0.1.4" } : n === 2 ? { status: 403, headers: { "retry-after": "600" } } : { tag: "v0.1.5" }) });
  const vistos: Array<string | null> = [];
  await x.act.leerAviso();
  x.act.alCambiarAviso((a) => vistos.push(a?.ultima ?? null));
  x.avanzar(2 * 60_000);
  x.ciclo();
  await flush();
  assert.equal(x.pedidos.length, 2);
  x.avanzar(5 * 60_000);
  await x.act.refrescar();
  x.ciclo();
  await flush();
  assert.equal(x.pedidos.length, 2, "dentro de la pausa no sale ninguna consulta");
  assert.ok(vistos.length > 0 && vistos.every((v) => v === "0.1.4"), "el límite no borra ni muestra nada");
  x.avanzar(6 * 60_000);
  x.ciclo();
  await flush();
  assert.equal(x.pedidos.length, 3);
  assert.equal((await x.act.leerAviso())?.ultima, "0.1.5");
});

test("Buscar con GitHub limitado: no es un error, da lo último que se supo", async () => {
  const x = armarGitHub({ instalada: "0.1.0", responder: (n) => (n === 1 ? { tag: "v0.1.4" } : { status: 429 }) });
  await x.act.leerAviso();
  x.avanzar(60_000);
  assert.deepEqual(await x.act.buscar(), { ultima: "0.1.4", nueva: true });
  assert.equal(x.pedidos.length, 2);
});

test("sin red: el reintento es a los 30 s y no espera al ciclo; al volver la red el aviso aparece", async () => {
  const x = armarGitHub({ instalada: "0.1.0", responder: (n) => (n === 1 ? { red: true } : { tag: "v0.1.4" }) });
  assert.equal(await x.act.leerAviso(), null);
  assert.deepEqual(x.esperas, [30_000]);
  x.avanzar(30_000);
  x.reintento();
  await flush();
  assert.equal(x.pedidos.length, 2);
  assert.equal((await x.act.leerAviso())?.ultima, "0.1.4");
});

test("consultarRelease: 304 igual, 429 límite con sus cabeceras, 500 fallo, sin red red; un release nuevo trae su ETag", async () => {
  const con = (r: Resp) => (async () => ({ ok: (r.status ?? 200) < 300, status: r.status ?? 200, headers: { get: (k: string) => ({ etag: 'W/"z"', "retry-after": "30" } as Record<string, string>)[k] ?? null }, json: async () => ({ tag_name: r.tag }) }));
  assert.deepEqual(await m.consultarRelease(con({ status: 304 }), "d/p", 'W/"z"'), { estado: "igual" });
  assert.deepEqual(await m.consultarRelease(con({ status: 429 }), "d/p"), { estado: "limite", retryAfter: "30", reset: null });
  assert.deepEqual(await m.consultarRelease(con({ status: 500 }), "d/p"), { estado: "fallo" });
  assert.deepEqual(await m.consultarRelease(con({ tag: "v0.1.4" }), "d/p"), { estado: "nueva", tag: "v0.1.4", etag: 'W/"z"' });
  assert.deepEqual(await m.consultarRelease(async () => { throw new Error("ENOTFOUND"); }, "d/p"), { estado: "red" });
});

test("pausaDeLimite: Retry-After o hasta x-ratelimit-reset; sin dato 15 min; entre 1 min y 1 h", () => {
  assert.equal(m.pausaDeLimite("600", null, 0), 600_000);
  assert.equal(m.pausaDeLimite(null, String(1000 + 120), 1_000_000), 120_000);
  assert.equal(m.pausaDeLimite(null, null, 0), 15 * 60_000);
  assert.equal(m.pausaDeLimite("1", null, 0), 60_000);
  assert.equal(m.pausaDeLimite("999999", null, 0), 3_600_000);
});

test("Actualizar corre fetch, checkout del tag y el instalador, en ese orden y en el checkout", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4" });
  await x.act.leerAviso();
  x.llamadas.length = 0;
  const r = await x.act.actualizar();
  assert.deepEqual(r, { ok: true, version: "0.1.4" });
  assert.deepEqual(
    x.llamadas.map((l) => [l.cmd, ...l.args]),
    [
      ["git", "status", "--porcelain", "--untracked-files=no"],
      ["git", "fetch", "--tags"],
      ["git", "-c", "advice.detachedHead=false", "checkout", "--detach", "refs/tags/v0.1.4"],
      ["bash", path.join(x.co!, "motor", "scripts", "instalar-producto.sh"), "--fuente", x.co!],
    ],
  );
  assert.ok(x.llamadas.every((l) => l.cwd === x.co));
});

test("Actualizar con cambios sin commitear: no corre fetch ni checkout ni el instalador", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", sucio: true });
  await x.act.leerAviso();
  x.llamadas.length = 0;
  const r = await x.act.actualizar();
  assert.equal(r.ok, false);
  assert.match(String(!r.ok && r.error), /main\.tramaSucio/);
  assert.deepEqual(x.llamadas.map((l) => l.args[0]), ["status"]);
});

test("Actualizar sin versión nueva no corre nada", async () => {
  const x = armar({ instalada: "0.2.0", tag: "v0.1.4" });
  await x.act.leerAviso();
  x.llamadas.length = 0;
  const r = await x.act.actualizar();
  assert.equal(r.ok, false);
  assert.equal(x.llamadas.length, 0);
});

test("Actualizar: si git falla, el motivo corto es lo último que dijo y no sigue con los demás pasos", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", falla: "fetch" });
  await x.act.leerAviso();
  x.llamadas.length = 0;
  const r = await x.act.actualizar();
  assert.deepEqual(r, { ok: false, error: "fatal: unable to access 'https://github.com/x': Could not resolve host" });
  assert.deepEqual(x.llamadas.map((l) => l.args[0]), ["status", "fetch"]);
});

test("Actualizar: un AVISO app… del instalador (que sale 0) es una falla", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", avisoInstalador: "AVISO  app: la compilación falló (ver /x/.build.log)\nlisto.\n" });
  await x.act.leerAviso();
  const r = await x.act.actualizar();
  assert.deepEqual(r, { ok: false, error: "app: la compilación falló (ver /x/.build.log)" });
});

// --- Actualizar sin cortar trabajo: esperar a que terminen, o ya ---

const LIBRE = { lideres: 0, workers: 0, otras: 0, leyendo: false };
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Espera (con tope) a que se cumpla algo asíncrono. */
async function hasta(cond: () => boolean | Promise<boolean>, ms = 2000) {
  const fin = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > fin) throw new Error("no se cumplió a tiempo");
    await dormir(2);
  }
}
const instalador = (x: { llamadas: Llamada[] }) => x.llamadas.filter((l) => l.cmd === "bash");

test("pedir('esperar') con un líder trabajando y un worker vivo: espera, no corre nada, y cuando terminan actualiza solo", async () => {
  let ocupado = { lideres: 1, workers: 1, otras: 0, leyendo: false };
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", ocupacion: () => ocupado });
  await x.act.leerAviso();
  x.llamadas.length = 0;
  const estados: string[] = [];
  x.act.alCambiarActualizacion((e) => estados.push(e.fase));
  assert.deepEqual(await x.act.pedir("esperar"), { ok: true, version: "0.1.4" });
  assert.deepEqual(await x.act.estadoActual(), { fase: "esperando", version: "0.1.4" });
  await dormir(40);
  assert.equal(instalador(x).length, 0, "con trabajo en curso no se instala");
  assert.equal(x.llamadas.some((l) => l.args[0] === "fetch"), false);
  // Termina el líder pero el worker sigue vivo: sigue esperando.
  ocupado = { lideres: 0, workers: 1, otras: 0, leyendo: false };
  await dormir(40);
  assert.equal(instalador(x).length, 0, "con un worker vivo tampoco");
  ocupado = LIBRE;
  await hasta(() => estados.includes("hecho"));
  assert.deepEqual(estados, ["esperando", "instalando", "hecho"]);
  assert.deepEqual(instalador(x)[0].args, [path.join(x.co!, "motor", "scripts", "instalar-producto.sh"), "--fuente", x.co!, ...instalador(x)[0].args.slice(3)]);
});

test("la espera pide varias miradas seguidas sin nada ocupado: un hueco entre dos turnos no dispara la instalación", async () => {
  const lecturas: boolean[] = [];
  const y = armar({
    instalada: "0.1.0",
    tag: "v0.1.4",
    quietas: 3,
    ocupacion: () => {
      const o = lecturas.length < 1 ? { lideres: 1, workers: 0, otras: 0, leyendo: false } : lecturas.length === 2 ? { lideres: 0, workers: 1, otras: 0, leyendo: false } : LIBRE;
      lecturas.push(true);
      return o;
    },
  });
  await y.act.leerAviso();
  y.llamadas.length = 0;
  await y.act.pedir("esperar"); // lectura 0: ocupado, espera
  await hasta(async () => (await y.act.estadoActual()).fase === "hecho");
  // Lecturas: 0 ocupado (pedido), 1 libre, 2 ocupado (reinicia la cuenta), 3, 4, 5 libres: recién ahí instala.
  assert.ok(lecturas.length >= 6, `miradas: ${lecturas.length}`);
});

test("pedir('esperar') sin nada ocupado actualiza enseguida; pedir('ya') actualiza aunque haya trabajo", async () => {
  const libre = armar({ instalada: "0.1.0", tag: "v0.1.4", ocupacion: () => LIBRE });
  await libre.act.leerAviso();
  await libre.act.pedir("esperar");
  await hasta(async () => (await libre.act.estadoActual()).fase === "hecho");
  assert.equal(instalador(libre).length, 1);

  const ocupado = armar({ instalada: "0.1.0", tag: "v0.1.4", ocupacion: () => ({ lideres: 2, workers: 3, otras: 0, leyendo: false }) });
  await ocupado.act.leerAviso();
  assert.deepEqual(await ocupado.act.pedir("ya"), { ok: true, version: "0.1.4" });
  await hasta(async () => (await ocupado.act.estadoActual()).fase === "hecho");
  assert.equal(instalador(ocupado).length, 1);
});

test("cancelarEspera: deja de esperar y no instala aunque después se libere", async () => {
  let ocupado = true;
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", ocupacion: () => (ocupado ? { lideres: 1, workers: 0, otras: 0, leyendo: false } : LIBRE) });
  await x.act.leerAviso();
  await x.act.pedir("esperar");
  assert.equal((await x.act.estadoActual()).fase, "esperando");
  await x.act.cancelarEspera();
  assert.deepEqual(await x.act.estadoActual(), { fase: "nada" });
  ocupado = false;
  await dormir(40);
  assert.equal(instalador(x).length, 0);
});

test("un segundo pedido mientras espera o instala se rechaza con el motivo; sin versión nueva o con checkout sucio ni siquiera espera", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", ocupacion: () => ({ lideres: 1, workers: 0, otras: 0, leyendo: false }) });
  await x.act.leerAviso();
  assert.equal((await x.act.pedir("esperar")).ok, true);
  const otra = await x.act.pedir("ya");
  assert.equal(otra.ok, false);
  assert.match(String(!otra.ok && otra.error), /main\.tramaYaEnCurso/);
  await x.act.cancelarEspera();

  const sucio = armar({ instalada: "0.1.0", tag: "v0.1.4", sucio: true, ocupacion: () => ({ lideres: 1, workers: 0, otras: 0, leyendo: false }) });
  await sucio.act.leerAviso();
  assert.equal((await sucio.act.pedir("esperar")).ok, false);
  assert.equal((await sucio.act.estadoActual()).fase, "nada");

  const vieja = armar({ instalada: "0.2.0", tag: "v0.1.4" });
  await vieja.act.leerAviso();
  assert.equal((await vieja.act.pedir("ya")).ok, false);
});

test("si falla el instalador, el estado es error con el motivo y limpiar vuelve a nada", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", avisoInstalador: "AVISO  app: la compilación falló\n", ocupacion: () => LIBRE });
  await x.act.leerAviso();
  await x.act.pedir("ya");
  await hasta(async () => (await x.act.estadoActual()).fase === "error");
  assert.deepEqual(await x.act.estadoActual(), { fase: "error", error: "app: la compilación falló" });
  await x.act.limpiar();
  assert.deepEqual(await x.act.estadoActual(), { fase: "nada" });
});

test("limpiar no pisa una espera en curso", async () => {
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", ocupacion: () => ({ lideres: 1, workers: 0, otras: 0, leyendo: false }) });
  await x.act.leerAviso();
  await x.act.pedir("esperar");
  await x.act.limpiar();
  assert.equal((await x.act.estadoActual()).fase, "esperando");
  await x.act.cancelarEspera();
});

// --- el estado sobrevive al reinicio del motor ---

function conArchivos(estado: object, registro?: string) {
  const dir = mkdtempSync(path.join(tmp, "re-"));
  const archivo = path.join(dir, "trama-version.json");
  writeFileSync(path.join(dir, "trama-actualizacion.json"), JSON.stringify({ version: 1, ...estado }));
  if (registro !== undefined) writeFileSync(path.join(dir, "trama-actualizacion.log"), registro);
  return archivo;
}

test("motor nuevo tras el reinicio del instalador: un 'instalando' sin instalador vivo y sin AVISO es 'hecho' (la ventana ofrece reiniciarse)", async () => {
  const archivo = conArchivos({ fase: "instalando", version: "0.1.4", pid: 4242 }, "ok  motor\nlisto.\n");
  const x = armar({ instalada: "0.1.4", archivo, vivo: () => false });
  assert.deepEqual(await x.act.estadoActual(), { fase: "hecho", version: "0.1.4" });
  // Lo cerrado se guarda: otro motor lo lee igual.
  const y = armar({ instalada: "0.1.4", archivo, vivo: () => false });
  assert.deepEqual(await y.act.estadoActual(), { fase: "hecho", version: "0.1.4" });
});

test("motor nuevo: un 'instalando' cuyo instalador sigue vivo se queda instalando; con AVISO app… en la salida es error", async () => {
  const vivo = armar({ instalada: "0.1.0", archivo: conArchivos({ fase: "instalando", version: "0.1.4", pid: 7 }), vivo: (pid) => pid === 7 });
  assert.deepEqual(await vivo.act.estadoActual(), { fase: "instalando", version: "0.1.4" });
  const roto = armar({ instalada: "0.1.0", archivo: conArchivos({ fase: "instalando", version: "0.1.4", pid: 7 }, "AVISO  app: la compilación falló\n"), vivo: () => false });
  assert.deepEqual(await roto.act.estadoActual(), { fase: "error", error: "app: la compilación falló" });
});

test("motor nuevo: el instalador seguía vivo al arrancar y murió después; Actualizar no queda trabado en 'ya en curso'", async () => {
  let vive = true;
  const x = armar({ instalada: "0.1.4", tag: "v0.1.5", archivo: conArchivos({ fase: "instalando", version: "0.1.4", pid: 7 }, "ok  motor\nlisto.\n"), vivo: () => vive });
  assert.deepEqual(await x.act.estadoActual(), { fase: "instalando", version: "0.1.4" });
  vive = false;
  const r = await x.act.pedir("ya");
  assert.ok(r.ok || !r.error.includes("tramaYaEnCurso"), JSON.stringify(r));
  assert.deepEqual(await x.act.estadoActual(), { fase: "hecho", version: "0.1.4" });
});

test("motor nuevo: una espera que dejó el anterior sigue esperando y actualiza cuando se libera", async () => {
  let ocupado = true;
  const archivo = conArchivos({ fase: "esperando", version: "0.1.4" });
  const x = armar({ instalada: "0.1.0", tag: "v0.1.4", archivo, ocupacion: () => (ocupado ? { lideres: 1, workers: 0, otras: 0, leyendo: false } : LIBRE) });
  await x.act.leerAviso();
  x.llamadas.length = 0;
  await x.act.retomar();
  assert.equal((await x.act.estadoActual()).fase, "esperando");
  await dormir(30);
  assert.equal(instalador(x).length, 0);
  ocupado = false;
  await hasta(async () => (await x.act.estadoActual()).fase === "hecho");
  assert.equal(instalador(x).length, 1);
});

test("el caso exacto: 'instalando' 0.2.10 (pid muerto) en memoria desde que el motor arrancó con el instalador vivo: se descarta, instalada 0.2.15", async () => {
  let vivo = true;
  const archivo = conArchivos({ fase: "instalando", version: "0.2.10", pid: 2906155 }, "ok  motor\nlisto.\n");
  const x = armar({ instalada: "0.2.15", archivo, vivo: (pid) => vivo && pid === 2906155 });
  assert.deepEqual(await x.act.estadoActual(), { fase: "instalando", version: "0.2.10" }, "con el instalador vivo no se toca");
  vivo = false;
  assert.deepEqual(await x.act.estadoActual(), { fase: "nada" });
  // Lo descartado se guarda: otro motor que lee el mismo archivo tampoco lo levanta.
  const y = armar({ instalada: "0.2.15", archivo, vivo: () => false });
  assert.deepEqual(await y.act.estadoActual(), { fase: "nada" });
});

test("'instalando' en memoria con el pid muerto: si la versión es más nueva que la instalada, cierra en 'hecho' (no sólo lo del disco)", async () => {
  let vivo = true;
  const archivo = conArchivos({ fase: "instalando", version: "0.2.16", pid: 7 }, "ok  motor\nlisto.\n");
  const x = armar({ instalada: "0.2.15", archivo, vivo: (pid) => vivo && pid === 7 });
  assert.deepEqual(await x.act.estadoActual(), { fase: "instalando", version: "0.2.16" });
  vivo = false;
  assert.deepEqual(await x.act.estadoActual(), { fase: "hecho", version: "0.2.16" });
});

test("un archivo de estado roto o raro vale como 'nada'", async () => {
  for (const crudo of ["no es json", JSON.stringify({ fase: "instalando" }), JSON.stringify({ fase: "volando", version: "1.0.0" })]) {
    const dir = mkdtempSync(path.join(tmp, "raro-"));
    writeFileSync(path.join(dir, "trama-actualizacion.json"), crudo);
    const x = armar({ instalada: "0.1.0", archivo: path.join(dir, "trama-version.json") });
    assert.deepEqual(await x.act.estadoActual(), { fase: "nada" }, crudo);
  }
});

test("modoValido: sólo 'ya' y 'esperar'; total cuenta lo que cortaría", () => {
  assert.equal(m.modoValido("ya"), true);
  assert.equal(m.modoValido("esperar"), true);
  for (const x of ["", "YA", null, undefined, 1, {}]) assert.equal(m.modoValido(x), false);
  assert.equal(m.total(LIBRE), 0);
  assert.equal(m.total({ lideres: 1, workers: 2, otras: 1, leyendo: true }), 5);
});
