// electron/identidad.ts + lo que remoto.ts sirve con ella: el celular con una entrada por máquina (PC y Dell).
// El servidor de verdad en 127.0.0.1 (como tests/remoto.test.ts), una vez por máquina.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { identidadDe, icono, iconoPng, manifest, type Identidad } from "../electron/identidad.ts";
import { parsearMaquinas, SOLA } from "../electron/maquinas-config.ts";
import { conPuente, crearRemoto } from "../electron/remoto.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-identidad-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const dist = path.join(tmp, "dist");
mkdirSync(dist);
writeFileSync(path.join(dist, "index.html"), '<html><head><title>trama</title><script type="module" src="./a.js"></script></head><body></body></html>');
writeFileSync(path.join(dist, "icon-192.png"), "viejo");
writeFileSync(path.join(dist, "manifest.webmanifest"), '{"name":"Trama"}');
writeFileSync(path.join(tmp, "preload.cjs"), "");

const pc = identidadDe({ ...SOLA, maquinas: [{ id: "dell", nombre: "Dell", url: "http://192.0.2.2:4545" }] });
const dell = identidadDe({ esta: "dell", maquinas: [] });

test("identidad: sin otra máquina es la de siempre; con otra, cada una la suya", () => {
  assert.equal(identidadDe(SOLA).propia, false);
  assert.equal(pc.propia, true);
  assert.deepEqual([pc.titulo, pc.corto, pc.fondo, pc.trazo], ["trama · PC", "Trama PC", "#0a0a0a", "#fafafa"]);
  assert.deepEqual([dell.titulo, dell.corto], ["trama · Dell", "Trama Dell"]);
  assert.equal(dell.propia, true, "el Dell se sabe el Dell aunque no conozca a nadie más");
  assert.notEqual(dell.fondo, pc.fondo);
  assert.notEqual(dell.trazo, pc.trazo);
  // El nombre y el color los puede poner el archivo.
  const c = parsearMaquinas({ version: 1, esta: "dell", nombre: "Servidor", color: "#FF8800" });
  assert.ok(!("error" in c));
  const s = identidadDe(c as never);
  assert.deepEqual([s.nombre, s.trazo], ["Servidor", "#ff8800"]);
  assert.equal(parsearMaquinas({ version: 1, color: "rojo" }).malas?.length, 1, "un color que no es #rrggbb se anota y se ignora");
  // Un id sin nombre ni color conocido elige uno solo, siempre el mismo.
  assert.equal(identidadDe({ esta: "nube", maquinas: [] }).trazo, identidadDe({ esta: "nube", maquinas: [] }).trazo);
});

test("identidad: el manifest y el SVG llevan el nombre y los colores de la máquina", () => {
  for (const i of [pc, dell]) {
    const m = JSON.parse(manifest(i));
    assert.deepEqual([m.name, m.short_name, m.theme_color, m.background_color], [i.corto, i.corto, i.fondo, i.fondo]);
    assert.equal(m.icons.length, 3);
    assert.ok(icono(i).includes(i.trazo) && icono(i).includes(i.fondo));
  }
});

/** Un PNG RGBA de 8 bits sin entrelazar, abierto: su ancho y un lector de píxeles. */
function abrir(b: Buffer) {
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const ancho = b.readUInt32BE(16);
  assert.equal(b.readUInt32BE(20), ancho);
  assert.deepEqual([b[24], b[25]], [8, 6]);
  let datos = Buffer.alloc(0);
  for (let o = 8; o < b.length; ) {
    const n = b.readUInt32BE(o);
    if (b.toString("latin1", o + 4, o + 8) === "IDAT") datos = Buffer.concat([datos, b.subarray(o + 8, o + 8 + n)]);
    o += 12 + n;
  }
  const crudo = inflateSync(datos);
  return { ancho, px: (x: number, y: number) => [...crudo.subarray(y * (ancho * 4 + 1) + 1 + x * 4).subarray(0, 4)] };
}
const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

test("identidad: el PNG es de verdad (tamaño, esquinas, fondo y trazo del color de la máquina)", () => {
  for (const i of [pc, dell]) {
    for (const [tam, mascara] of [[192, false], [512, false], [512, true]] as const) {
      const p = abrir(iconoPng(i, tam, mascara));
      assert.equal(p.ancho, tam);
      // Abajo al medio no hay logo: el fondo. Las esquinas: transparentes (o llenas si es enmascarable).
      assert.deepEqual(p.px(tam / 2, Math.round(tam * 0.9)).slice(0, 3), hex(i.fondo), `${i.id} ${tam} fondo`);
      assert.equal(p.px(0, 0)[3], mascara ? 255 : 0);
      // El trazo entero de la izquierda (2,5 a 5; 8,5 de alto) a media altura de su tramo.
      const e = mascara ? 0.62 : 1;
      const en64 = (v: number) => 32 + (10 + (11 / 6) * v - 32) * e;
      const t = p.px(Math.round((tam * en64(3.75)) / 64), Math.round((tam * en64(8.5)) / 64));
      assert.deepEqual(t.slice(0, 3), hex(i.trazo), `${i.id} ${tam} trazo`);
    }
  }
  assert.notDeepEqual(iconoPng(pc, 192), iconoPng(dell, 192));
});

test("identidad: la página cambia título y color sólo con identidad propia; sin ella, igual que antes", () => {
  const html = '<html><head><title>trama</title><script type="module"></script></head></html>';
  const hoy = conPuente(html);
  assert.ok(hoy.includes("<title>trama</title>") && hoy.includes('content="#0a0a0a"') && !hoy.includes("apple"));
  assert.equal(conPuente(html, identidadDe(SOLA)), hoy);
  const d = conPuente(html, dell);
  assert.ok(d.includes("<title>trama · Dell</title>") && d.includes(`content="${dell.fondo}"`) && d.indexOf("remoto.js") < d.indexOf('type="module"'));
  const malo = conPuente(html, { ...dell, titulo: '</title><script>alert(1)</script>', corto: '"><b>' });
  assert.ok(!malo.includes("<script>alert") && !malo.includes('"><b>'), "el nombre se escapa");
});

/** Un servidor como el del celular, de la máquina `yo`. */
async function servir(yo: Identidad | undefined) {
  const r = crearRemoto({
    dist,
    preload: path.join(tmp, "preload.cjs"),
    nombres: ["trama.test"],
    propias: ["127.0.0.1"],
    entra: async () => true,
    llamar: async () => null,
    consulta: () => ({}),
    identidad: yo && (() => yo),
    seFue: () => {},
    changelog: "",
  });
  const s = await r.escuchar("127.0.0.1", 0);
  after(() => {
    s.closeAllConnections();
    s.close();
  });
  const puerto = (s.address() as { port: number }).port;
  return (ruta: string) =>
    new Promise<{ codigo: number; tipo: string; cuerpo: Buffer }>((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port: puerto, path: ruta, headers: { host: "trama.test", "x-forwarded-for": "192.0.2.9" } }, (res) => {
          const partes: Buffer[] = [];
          res.on("data", (d) => partes.push(d));
          res.on("end", () => resolve({ codigo: res.statusCode ?? 0, tipo: String(res.headers["content-type"]), cuerpo: Buffer.concat(partes) }));
        })
        .on("error", reject);
    });
}

test("remoto: cada máquina sirve su título, su manifest y su ícono; sin identidad, los archivos de dist/", async () => {
  const pedirPc = await servir(pc);
  const pedirDell = await servir(dell);
  const pedirSola = await servir(identidadDe(SOLA));
  for (const [pedir, i] of [[pedirPc, pc], [pedirDell, dell]] as const) {
    const pag = (await pedir("/")).cuerpo.toString();
    assert.ok(pag.includes(`<title>${i.titulo}</title>`) && pag.includes(`content="${i.fondo}"`) && pag.includes('rel="manifest"'), i.id);
    const m = await pedir("/manifest.webmanifest");
    assert.equal(m.tipo, "application/manifest+json");
    assert.equal(JSON.parse(m.cuerpo.toString()).name, i.corto);
    const ic = await pedir("/icon-192.png");
    assert.equal(ic.tipo, "image/png");
    assert.equal(abrir(ic.cuerpo).ancho, 192);
    assert.deepEqual(ic.cuerpo, iconoPng(i, 192));
    assert.ok((await pedir("/favicon.svg")).cuerpo.toString().includes(i.trazo));
  }
  assert.notDeepEqual((await pedirPc("/icon-512.png")).cuerpo, (await pedirDell("/icon-512.png")).cuerpo);
  // Sin otra máquina: lo de dist/, tal cual.
  assert.equal((await pedirSola("/icon-192.png")).cuerpo.toString(), "viejo");
  assert.equal((await pedirSola("/manifest.webmanifest")).cuerpo.toString(), '{"name":"Trama"}');
  assert.ok((await pedirSola("/")).cuerpo.toString().includes("<title>trama</title>"));
  // Y las reglas del remoto siguen: lo que no es de una de las dos entradas sigue sin existir.
  assert.equal((await pedirDell("/secreto.txt")).codigo, 404);
});
