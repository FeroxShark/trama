// El modo local (electron/modo-local.ts): el servidor en 127.0.0.1 sin Tailscale, y la detección de lo que hay
// en la máquina (electron/capacidades.ts). Servidor de verdad en un puerto libre; nada toca la red de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { capacidades, hayClaude } from "../electron/capacidades.ts";
import { crearRemotoLocal, esLoopback, modoLocal, puertoLocal } from "../electron/modo-local.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-local-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const dist = path.join(tmp, "dist");
mkdirSync(dist, { recursive: true });
writeFileSync(path.join(dist, "index.html"), '<html><head><script type="module" src="./a.js"></script></head><body>trama</body></html>');
const preload = path.join(tmp, "preload.cjs");
writeFileSync(preload, '"use strict";\n');

const opciones = {
  dist,
  preload,
  llamar: async (canal: string) => ({ canal }),
  consulta: () => ({}),
  seFue: () => {},
  changelog: "https://example.com/cambios",
  latidoMs: 60_000,
};
// Sin token (`TRAMA_TOKEN=0`): el comportamiento de siempre; los tests de más abajo con token usan otro servidor.
const remoto = crearRemotoLocal(opciones, { TRAMA_TOKEN: "0" });
const servidor = await remoto.escuchar(0);
after(() => servidor.closeAllConnections?.() ?? servidor.close());
const { address, port } = servidor.address() as net.AddressInfo;

type Respuesta = { codigo: number; cuerpo: string; cabeceras: http.IncomingHttpHeaders };
/** Pedido con el `Host` que se diga, al 127.0.0.1 del servidor (por defecto el sin token). */
const pedirEn = (puerto: number, host: string, ruta = "/", extra: http.OutgoingHttpHeaders = {}, metodo = "GET", cuerpo?: string) =>
  new Promise<Respuesta>((resolve, reject) => {
    const r = http.request({ host: "127.0.0.1", port: puerto, path: ruta, method: metodo, headers: { host, ...extra } }, (res) => {
      let texto = "";
      res.on("data", (d) => (texto += d));
      res.on("end", () => resolve({ codigo: res.statusCode ?? 0, cuerpo: texto, cabeceras: res.headers }));
    });
    r.on("error", reject);
    r.end(cuerpo);
  });
const pedir = (host: string, ruta = "/", extra: http.OutgoingHttpHeaders = {}) => pedirEn(port, host, ruta, extra);

test("escucha sólo en 127.0.0.1 y contesta 200 con la página", async () => {
  assert.equal(address, "127.0.0.1");
  const por127 = await pedir(`127.0.0.1:${port}`);
  assert.equal(por127.codigo, 200);
  assert.match(por127.cuerpo, /remoto\.js/);
  assert.equal((await pedir(`localhost:${port}`)).codigo, 200);
});

test("no escucha en ninguna otra interfaz (LAN ni ::1)", async () => {
  const otras = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal)
    .map((i) => i!.address);
  for (const ip of [...otras, "::1"]) {
    const abre = await new Promise<boolean>((resolve) => {
      const s = net.connect({ host: ip, port });
      s.once("connect", () => (s.destroy(), resolve(true)));
      s.once("error", () => resolve(false));
    });
    assert.equal(abre, false, `no debía escuchar en ${ip}`);
  }
});

test("un Host que no es de esta máquina se rechaza (DNS rebinding) y X-Forwarded-For no cambia nada", async () => {
  assert.equal((await pedir(`evil.example:${port}`)).codigo, 403);
  assert.equal((await pedir(`192.168.1.20:${port}`)).codigo, 403);
  // Desde 127.0.0.1 sigue entrando aunque la cabecera diga otra IP: no se mira.
  assert.equal((await pedir(`localhost:${port}`, "/", { "x-forwarded-for": "8.8.8.8" })).codigo, 200);
  // Un pedido a /rpc desde otro sitio no pasa.
  assert.equal((await pedir(`localhost:${port}`, "/", { origin: "http://evil.example" })).codigo, 403);
});

test("esLoopback y el puerto", () => {
  for (const ip of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1"]) assert.equal(esLoopback(ip), true, ip);
  for (const ip of ["", "0.0.0.0", "192.168.1.5", "192.0.2.9", "::", "fe80::1"]) assert.equal(esLoopback(ip), false, ip);
  assert.equal(modoLocal({}), false);
  assert.equal(modoLocal({ TRAMA_LOCAL: "1" }), true);
  assert.equal(modoLocal({ TRAMA_LOCAL: "0" }), false);
  assert.equal(puertoLocal({}), 8791);
  assert.equal(puertoLocal({ TRAMA_PUERTO: "9000" }), 9000);
  for (const mal of ["80", "70000", "abc", "", "8791.5"]) assert.equal(puertoLocal({ TRAMA_PUERTO: mal }), 8791, mal);
});

test("hayClaude: HILOS_CLAUDE manda; sin eso el PATH o ~/.local/bin; una captura lo supone", () => {
  const casa = "/no/existe";
  assert.equal(hayClaude({ PATH: "" }, casa, () => false), false);
  assert.equal(hayClaude({ PATH: "/usr/bin" }, casa, (f) => f === "/usr/bin/claude"), true);
  assert.equal(hayClaude({ PATH: "" }, casa, (f) => f === "/no/existe/.local/bin/claude"), true);
  assert.equal(hayClaude({ HILOS_CLAUDE: "/x/falso", PATH: "" }, casa, (f) => f === "/x/falso"), true);
  assert.equal(hayClaude({ HILOS_CLAUDE: "/x/falso", PATH: "/usr/bin" }, casa, (f) => f === "/usr/bin/claude"), false);
  assert.equal(hayClaude({ HILOS_CAPTURA: "1", PATH: "" }, casa, () => false), true);
});

test("capacidades con PATH vacío: no hay nada", () => {
  const casa = path.join(tmp, "casa");
  mkdirSync(casa);
  assert.deepEqual(capacidades({ PATH: "" }, casa), { tailscale: false, hyprctl: false, kitten: false });
  assert.deepEqual(capacidades({}, casa), { tailscale: false, hyprctl: false, kitten: false });
});

test("capacidades: se detecta por el PATH, ~/.local/bin o la variable HILOS_*", () => {
  const casa = path.join(tmp, "casa2");
  const bin = path.join(tmp, "bin");
  mkdirSync(path.join(casa, ".local", "bin"), { recursive: true });
  mkdirSync(bin);
  const falso = (d: string, n: string) => (writeFileSync(path.join(d, n), "#!/bin/sh\n"), chmodSync(path.join(d, n), 0o755));
  falso(bin, "hyprctl");
  assert.deepEqual(capacidades({ PATH: bin }, casa), { tailscale: false, hyprctl: true, kitten: false });
  falso(path.join(casa, ".local", "bin"), "kitten");
  assert.deepEqual(capacidades({ PATH: bin }, casa), { tailscale: false, hyprctl: true, kitten: true });
  assert.equal(capacidades({ PATH: "", HILOS_TAILSCALE: "/x/tailscale" }, casa).tailscale, true);
  // Un archivo sin permiso de ejecución no cuenta.
  writeFileSync(path.join(bin, "tailscale"), "");
  assert.equal(capacidades({ PATH: bin }, casa).tailscale, false);
});

test("sin registry.json la lista de proyectos queda vacía, sin tirar", async () => {
  // `registro.ts` lee la ruta al importarse: se prueba el módulo en un proceso aparte con otro HOME.
  const { execFileSync } = await import("node:child_process");
  const salida = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `const { registro, destinos } = await import(${JSON.stringify(path.resolve("electron/registro.ts"))}); console.log(JSON.stringify([await registro(), await destinos()]));`],
    { env: { PATH: process.env.PATH, HOME: path.join(tmp, "sin-nada") }, encoding: "utf8" },
  );
  assert.equal(salida.trim(), "[[],[]]");
});

// --- el token de la instalación ---
const config = path.join(tmp, "config");
const envToken = { XDG_CONFIG_HOME: config };
const conToken = crearRemotoLocal(opciones, envToken);
const servidorT = await conToken.escuchar(0);
after(() => servidorT.closeAllConnections?.() ?? servidorT.close());
const pt = (servidorT.address() as net.AddressInfo).port;
const hostT = `localhost:${pt}`;
const archivoToken = path.join(config, "trama", "token");
const token = readFileSync(archivoToken, "utf8").trim();
const rpc = (extra: http.OutgoingHttpHeaders = {}) =>
  pedirEn(pt, hostT, "/rpc", { "x-trama-cliente": "abcdef0123456789", origin: `http://${hostT}`, "content-type": "application/json", ...extra }, "POST", JSON.stringify({ canal: "x:y", args: [] }));

test("token: se crea de 32 bytes hex, archivo 0600 y carpeta 0700", () => {
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(statSync(archivoToken).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(archivoToken)).mode & 0o777, 0o700);
  // Arrancar de nuevo reusa el mismo.
  crearRemotoLocal(opciones, envToken);
  assert.equal(readFileSync(archivoToken, "utf8").trim(), token);
});

test("token: sin cookie /rpc, /eventos y los assets dan 401; / da 401 con la página que explica", async () => {
  assert.equal((await rpc()).codigo, 401);
  assert.equal((await pedirEn(pt, hostT, "/eventos")).codigo, 401);
  assert.equal((await pedirEn(pt, hostT, "/remoto.js")).codigo, 401);
  assert.equal((await pedirEn(pt, hostT, "/assets/a.js")).codigo, 401);
  const p = await pedirEn(pt, hostT, "/");
  assert.equal(p.codigo, 401);
  assert.match(p.cabeceras["content-type"] ?? "", /text\/html/);
  assert.match(p.cuerpo, /trama-motor abrir/);
  assert.doesNotMatch(p.cuerpo, /remoto\.js/);
  // Una cookie con otro valor tampoco.
  assert.equal((await rpc({ cookie: `trama=${"0".repeat(64)}` })).codigo, 401);
});

test("token: /?t=malo da 401 y sin cookie; /?t=bueno da 303 + cookie HttpOnly SameSite=Strict", async () => {
  const mala = await pedirEn(pt, hostT, "/?t=malo");
  assert.equal(mala.codigo, 401);
  assert.equal(mala.cabeceras["set-cookie"], undefined);
  const buena = await pedirEn(pt, hostT, `/?t=${token}`);
  assert.equal(buena.codigo, 303);
  assert.equal(buena.cabeceras.location, "/");
  const cookie = String(buena.cabeceras["set-cookie"]);
  assert.match(cookie, new RegExp(`^trama=${token};`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.equal((await pedirEn(pt, hostT, `/index.html?t=${token}`)).codigo, 303);
});

test("token: con la cookie la página y /rpc andan; el Host sigue controlado", async () => {
  const cookie = `trama=${token}`;
  const p = await pedirEn(pt, hostT, "/", { cookie });
  assert.equal(p.codigo, 200);
  assert.match(p.cuerpo, /remoto\.js/);
  const r = await rpc({ cookie });
  assert.equal(r.codigo, 200);
  assert.deepEqual(JSON.parse(r.cuerpo), { ok: true, valor: { canal: "x:y" } });
  assert.equal((await pedirEn(pt, `evil.example:${pt}`, "/", { cookie })).codigo, 403);
});

test("TRAMA_TOKEN=0: como antes, sin cookie entra (el servidor del principio)", async () => {
  assert.equal((await pedir(`localhost:${port}`)).codigo, 200);
  assert.equal((await pedirEn(port, `localhost:${port}`, "/rpc", { "x-trama-cliente": "abcdef0123456789", origin: `http://localhost:${port}`, "content-type": "application/json" }, "POST", JSON.stringify({ canal: "x:y", args: [] }))).codigo, 200);
});
