// electron/local.ts: el socket local del motor. La carpeta queda 0700 (y el socket 0600), el socket es el
// candado (otro que abre en la misma carpeta recibe null; un archivo que quedó de un motor muerto no
// frena), y por ahí andan los mismos /rpc y /eventos que por red, sin Origin ni Tailscale.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import http from "node:http";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-local-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
process.env.HILOS_STATE = path.join(tmp, "estado");

const { abrirLocal, arranqueDe, carpetaLocal, hayMotor, motorVivo } = await import("../electron/local.ts");

const modo = (p: string) => statSync(p).mode & 0o777;

/** Un pedido por el socket. */
function pedir(sock: string, ruta: string, o: { metodo?: string; cuerpo?: unknown; cliente?: string } = {}): Promise<{ codigo: number; cuerpo: string }> {
  return new Promise((ok, mal) => {
    const cuerpo = o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo);
    const headers: Record<string, string> = {};
    if (cuerpo !== undefined) headers["content-type"] = "application/json";
    if (o.cliente) headers["x-trama-cliente"] = o.cliente;
    const r = http.request({ socketPath: sock, path: ruta, method: o.metodo ?? "GET", headers }, (res) => {
      let t = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (t += d));
      res.on("end", () => ok({ codigo: res.statusCode ?? 0, cuerpo: t }));
    });
    r.on("error", mal);
    r.end(cuerpo);
  });
}

/** Abre /eventos y junta lo que llega hasta que `listo` diga que alcanza; devuelve el texto y con qué cortar. */
function oir(sock: string, ruta: string, listo: (t: string) => boolean): Promise<{ texto: string; cortar(): void }> {
  return new Promise((ok, mal) => {
    const r = http.get({ socketPath: sock, path: ruta }, (res) => {
      let t = "";
      res.setEncoding("utf8");
      res.on("data", (d) => {
        t += d;
        if (listo(t)) ok({ texto: t, cortar: () => r.destroy() });
      });
    });
    r.on("error", mal);
  });
}

test("carpetaLocal: dentro de XDG_RUNTIME_DIR", () => {
  assert.equal(carpetaLocal({ XDG_RUNTIME_DIR: "/run/user/1000" }), "/run/user/1000/trama");
});

test("la carpeta queda 0700 y el socket 0600, aunque la carpeta ya existiera abierta", async () => {
  const carpeta = path.join(tmp, "run1", "trama");
  mkdirSync(carpeta, { recursive: true });
  chmodSync(carpeta, 0o755);
  const l = await abrirLocal({ carpeta, llamar: async () => null, seFue() {} });
  assert.ok(l);
  try {
    assert.equal(modo(carpeta), 0o700);
    assert.equal(modo(l.ruta), 0o600);
    assert.ok(statSync(l.ruta).isSocket());
  } finally {
    await l.cerrar();
  }
  assert.ok(!existsSync(l.ruta), "al cerrar se va el socket");
});

test("candado: con un motor escuchando, otro no abre; un archivo que quedó no frena", async () => {
  const carpeta = path.join(tmp, "run2", "trama");
  const a = await abrirLocal({ carpeta, llamar: async () => null, seFue() {} });
  assert.ok(a);
  assert.equal(await hayMotor(a.ruta), true);
  assert.equal(await abrirLocal({ carpeta, llamar: async () => null, seFue() {} }), null);
  await a.cerrar();
  assert.equal(await hayMotor(a.ruta), false);
  // Lo que deja un SIGKILL: el archivo, sin nadie atrás.
  writeFileSync(a.ruta, "");
  const b = await abrirLocal({ carpeta, llamar: async () => null, seFue() {} });
  assert.ok(b);
  await b.cerrar();
});

test("/rpc sin Origin: llama al núcleo con quién pide; sin cliente no", async () => {
  const carpeta = path.join(tmp, "run3", "trama");
  const vistos: unknown[] = [];
  const l = await abrirLocal({
    carpeta,
    llamar: async (canal, args, cliente) => {
      vistos.push([canal, args, cliente]);
      if (canal === "falla") throw new Error("no");
      return { eco: args };
    },
    seFue() {},
  });
  assert.ok(l);
  try {
    const r = await pedir(l.ruta, "/rpc", { metodo: "POST", cliente: "abcdef12", cuerpo: { canal: "hilos:leer", args: [1, "x"] } });
    assert.equal(r.codigo, 200);
    assert.deepEqual(JSON.parse(r.cuerpo), { ok: true, valor: { eco: [1, "x"] } });
    assert.deepEqual(vistos, [["hilos:leer", [1, "x"], "abcdef12"]]);
    const f = await pedir(l.ruta, "/rpc", { metodo: "POST", cliente: "abcdef12", cuerpo: { canal: "falla", args: [] } });
    assert.deepEqual(JSON.parse(f.cuerpo), { ok: false, error: "no" });
    assert.equal((await pedir(l.ruta, "/rpc", { metodo: "POST", cuerpo: { canal: "x", args: [] } })).codigo, 403);
    assert.equal((await pedir(l.ruta, "/rpc", { cliente: "abcdef12" })).codigo, 403);
    assert.equal((await pedir(l.ruta, "/", {})).codigo, 404);
  } finally {
    await l.cerrar();
  }
});

test("/eventos: lo difundido llega, y quien vuelve con `desde` recibe lo que se perdió", async () => {
  const carpeta = path.join(tmp, "run4", "trama");
  const l = await abrirLocal({ carpeta, llamar: async () => null, seFue() {} });
  assert.ok(l);
  try {
    const uno = await oir(l.ruta, "/eventos?c=abcdef12", (t) => t.includes("event: hola"));
    const id = /id: (\S+)/.exec(uno.texto.slice(uno.texto.indexOf("event: hola")))![1];
    uno.cortar();
    await new Promise((r) => setTimeout(r, 50));
    l.difundir("lider:texto", { n: 1 });
    l.difundir("lider:texto", { n: 2 });
    const dos = await oir(l.ruta, `/eventos?c=abcdef12&desde=${id}`, (t) => t.includes("event: hola"));
    dos.cortar();
    const datos = [...dos.texto.matchAll(/^data: (\{.*\})$/gm)].map((m) => JSON.parse(m[1]));
    assert.deepEqual(datos, [
      { c: "lider:texto", d: { n: 1 } },
      { c: "lider:texto", d: { n: 2 } },
    ]);
    // Uno de otra corrida (otra época) se resincroniza entero.
    const tres = await oir(l.ruta, "/eventos?c=abcdef12&desde=otra-1", (t) => t.includes("resinc"));
    tres.cortar();
  } finally {
    await l.cerrar();
  }
});

test("motorVivo: hace falta dueno con el mismo proceso vivo y el socket contestando", async () => {
  const carpeta = path.join(tmp, "run-vivo", "trama");
  const dueno = path.join(tmp, "dueno-vivo");
  const l = await abrirLocal({ carpeta, llamar: async () => null, seFue() {} });
  assert.ok(l);
  try {
    assert.equal(await motorVivo(dueno, l.ruta), false, "sin dueno no hay motor");
    const procStart = arranqueDe(process.pid);
    writeFileSync(dueno, JSON.stringify({ version: 1, pid: process.pid, procStart, desde: 0 }));
    assert.equal(await motorVivo(dueno, l.ruta), true);
    writeFileSync(dueno, JSON.stringify({ version: 1, pid: process.pid, procStart: "1", desde: 0 }));
    assert.equal(await motorVivo(dueno, l.ruta), false, "otro proceso con el mismo pid no cuenta");
    writeFileSync(dueno, JSON.stringify({ version: 2, pid: process.pid, procStart, desde: 0 }));
    assert.equal(await motorVivo(dueno, l.ruta), false, "versión desconocida");
    writeFileSync(dueno, JSON.stringify({ version: 1, pid: process.pid, procStart, desde: 0 }));
    assert.equal(await motorVivo(dueno, path.join(tmp, "otro.sock")), false, "sin socket que conteste no hay motor");
  } finally {
    await l.cerrar();
  }
});

test("cerrar: lo último que se difundió le llega a quien oía, aunque se cierre en el mismo tick", async () => {
  const carpeta = path.join(tmp, "run-cierre", "trama");
  const l = await abrirLocal({ carpeta, llamar: async () => null, seFue() {} });
  assert.ok(l);
  const visto = oir(l.ruta, "/eventos?c=abcdef12", (t) => t.includes("event: hola"));
  const antes = await visto;
  let todo = antes.texto;
  const fin = new Promise<string>((ok) => {
    const r = http.get({ socketPath: l.ruta, path: "/eventos?c=abcdef34" }, (res) => {
      let t = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (t += d));
      res.on("close", () => ok(t));
    });
    r.on("error", () => ok("error"));
  });
  await new Promise((r) => setTimeout(r, 100));
  l.difundir("reinicio:cambio", { saliendo: true });
  await l.cerrar();
  todo = await fin;
  antes.cortar();
  assert.match(todo, /"saliendo":true/);
});

test("prepararCarpeta: el /tmp/trama-<uid> intermedio tiene que ser una carpeta propia y no un enlace", async () => {
  const { prepararCarpeta } = await import("../electron/local.ts");
  const { symlinkSync } = await import("node:fs");
  const uid = 900000000 + (process.pid % 90000);
  const padre = path.join(os.tmpdir(), `trama-${uid}`);
  const otro = mkdtempSync(path.join(os.tmpdir(), "otro-"));
  try {
    symlinkSync(otro, padre);
    assert.throws(() => prepararCarpeta(path.join(padre, "trama")), /no es una carpeta/);
    rmSync(padre, { force: true });
    prepararCarpeta(path.join(padre, "trama"));
    assert.equal(statSync(padre).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(padre, "trama")).mode & 0o777, 0o700);
  } finally {
    rmSync(padre, { recursive: true, force: true });
    rmSync(otro, { recursive: true, force: true });
  }
});
