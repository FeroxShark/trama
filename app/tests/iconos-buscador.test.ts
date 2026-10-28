// El buscador de íconos de los proyectos (electron/iconos.ts) con carpetas falsas: el orden de los lugares, package.json y electron-builder,
// lo que no se pisa (node_modules, .git, dist, más de tres niveles, salir de la carpeta), el SVG limpio, el caché por fecha y el
// logo elegido a mano. Todo en un tmp.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { iconoDe, iconosDe, limpiarSvg, LADO_MAX, logoDeBytes, medidaPng, pngDeIco, validarLogo } from "../electron/iconos.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "iconos-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
/** Una carpeta de proyecto nueva con estos archivos (ruta relativa → contenido). */
function proyecto(archivos: Record<string, string | Buffer>): string {
  const dir = path.join(tmp, `p${n++}`);
  for (const [rel, datos] of Object.entries(archivos)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), datos);
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Un PNG falso: la firma y la cabecera IHDR con ese tamaño (lo único que lee el buscador). */
function png(w: number, h: number, relleno = 0): Buffer {
  const b = Buffer.alloc(33 + relleno);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
const svg = (marca: string) => `<svg xmlns="http://www.w3.org/2000/svg"><title>${marca}</title></svg>`;
const url = (tipo: string, b: Buffer | string) => `data:${tipo};base64,${Buffer.from(b).toString("base64")}`;
const sinAchicar = null;
/** Un achicador falso: lo devuelve como PNG de 64 px. */
const achicar = (b: Buffer) => url("image/png", png(Math.min(LADO_MAX, medidaPng(b)?.w ?? 1), Math.min(LADO_MAX, medidaPng(b)?.h ?? 1)));

test("sin ícono en ningún lugar: null (van las iniciales)", async () => {
  assert.equal(await iconoDe({ ruta: proyecto({ "README.md": "x", "src/main.ts": "x" }), icono: null }), null);
});

test("el orden: favicon antes que logo, logo antes que icon, y estos antes que public/ y app/public/", async () => {
  const todo = { "src-tauri/icons/icon.png": png(32, 32), "build/icon.svg": svg("build"), "assets/icon.svg": svg("assets"), "app/public/favicon.svg": svg("apppublic"), "public/favicon.svg": svg("public"), "icon.svg": svg("icon"), "logo.svg": svg("logo"), "favicon.png": png(16, 16), "favicon.svg": svg("favicon") };
  const quitar = ["favicon.svg", "favicon.png", "logo.svg", "icon.svg", "public/favicon.svg", "app/public/favicon.svg", "assets/icon.svg", "build/icon.svg"];
  const dir = proyecto(todo);
  const quien = async () => /<title>(\w+)<\/title>/.exec(Buffer.from(((await iconoDe({ ruta: dir, icono: null }, achicar)) ?? "").split(",")[1] ?? "", "base64").toString())?.[1] ?? "png";
  const orden: string[] = [];
  for (const q of quitar) {
    orden.push(await quien());
    rmSync(path.join(dir, q));
  }
  assert.deepEqual(orden, ["favicon", "png", "logo", "icon", "public", "apppublic", "assets", "build"]);
  // Lo último que queda es el de Tauri.
  assert.match((await iconoDe({ ruta: dir, icono: null }, achicar)) ?? "", /^data:image\/png/);
});

test("package.json (icon y build.icon) y electron-builder.yml, después de los lugares fijos y solo adentro de la carpeta", async () => {
  const a = proyecto({ "package.json": JSON.stringify({ icon: "recursos/marca.svg" }), "recursos/marca.svg": svg("pkg") });
  assert.equal(await iconoDe({ ruta: a, icono: null }), url("image/svg+xml", svg("pkg")));
  // Uno fijo gana a lo que dice el package.json.
  const b = proyecto({ "package.json": JSON.stringify({ icon: "recursos/marca.svg" }), "recursos/marca.svg": svg("pkg"), "logo.svg": svg("fijo") });
  assert.equal(await iconoDe({ ruta: b, icono: null }), url("image/svg+xml", svg("fijo")));
  // electron-builder: `build.icon` sin extensión se busca en build/ (su buildResources) y en la carpeta.
  const c = proyecto({ "package.json": JSON.stringify({ build: { icon: "marca" } }), "build/marca.png": png(48, 48) });
  assert.match((await iconoDe({ ruta: c, icono: null }, achicar)) ?? "", /^data:image\/png/);
  const d = proyecto({ "electron-builder.yml": "appId: x\nmac:\n  category: y\n  icon: iconos/app.svg # el de la Mac\n", "iconos/app.svg": svg("yml") });
  assert.equal(await iconoDe({ ruta: d, icono: null }), url("image/svg+xml", svg("yml")));
  // En app/: el package.json de una subcarpeta (Electron con la app adentro).
  const e = proyecto({ "app/package.json": JSON.stringify({ build: { linux: { icon: "build/linux.png" } } }), "app/build/linux.png": png(64, 64) });
  assert.match((await iconoDe({ ruta: e, icono: null }, achicar)) ?? "", /^data:image\/png/);
  // package.json roto o sin icon: no pasa nada.
  assert.equal(await iconoDe({ ruta: proyecto({ "package.json": "{no es json" }), icono: null }), null);
});

test("no pisa node_modules, .git ni dist, no baja de tres niveles y no sale de la carpeta", async () => {
  for (const ref of ["node_modules/x/icon.svg", ".git/icon.svg", "dist/icon.svg", "a/b/c/d/icon.svg", "../fuera.svg", "/etc/icono.svg"]) {
    const dir = proyecto({ "package.json": JSON.stringify({ icon: ref }), [ref.replace(/^[./]+/, "")]: svg("malo") });
    writeFileSync(path.join(tmp, "fuera.svg"), svg("fuera"));
    assert.equal(await iconoDe({ ruta: dir, icono: null }), null, ref);
  }
  // Tres niveles sí.
  const ok = proyecto({ "package.json": JSON.stringify({ icon: "a/b/c/icon.svg" }), "a/b/c/icon.svg": svg("tres") });
  assert.equal(await iconoDe({ ruta: ok, icono: null }), url("image/svg+xml", svg("tres")));
  // Un favicon adentro de node_modules no está entre los lugares.
  assert.equal(await iconoDe({ ruta: proyecto({ "node_modules/pkg/favicon.svg": svg("malo") }), icono: null }), null);
});

test("el campo icono del registry gana, y el logo elegido a mano gana a todo", async () => {
  const dir = proyecto({ "favicon.svg": svg("favicon"), "marca.svg": svg("registry") });
  assert.equal(await iconoDe({ ruta: dir, icono: "marca.svg" }), url("image/svg+xml", svg("registry")));
  const elegido = url("image/png", png(40, 40));
  assert.equal(await iconoDe({ ruta: dir, icono: "marca.svg", logo: elegido }), elegido);
  // Un logo guardado que ya no vale (a mano en el registry) se ignora.
  assert.equal(await iconoDe({ ruta: dir, icono: null, logo: "data:image/png;base64,AAAA" }), url("image/svg+xml", svg("favicon")));
});

test("un PNG grande va al achicador; sin achicador sólo pasan los que ya son de 64 px o menos", async () => {
  const dir = proyecto({ "icon.png": png(512, 512) });
  assert.equal(await iconoDe({ ruta: dir, icono: null }, sinAchicar), null);
  const chico = proyecto({ "icon.png": png(32, 32) });
  assert.equal(await iconoDe({ ruta: chico, icono: null }, sinAchicar), url("image/png", png(32, 32)));
  const r = (await iconoDe({ ruta: dir, icono: null }, achicar)) as string;
  const m = medidaPng(Buffer.from(r.split(",")[1], "base64"));
  assert.ok(m && m.w <= LADO_MAX && m.h <= LADO_MAX);
  // Un archivo de megas no se lee.
  assert.equal(await iconoDe({ ruta: proyecto({ "icon.png": png(16, 16, 600 * 1024) }), icono: null }, achicar), null);
});

test(".ico: se saca el PNG más grande de adentro; sin PNG (mapas de bits) no hay ícono", async () => {
  const ico = (...imagenes: Buffer[]) => {
    const cab = Buffer.alloc(6 + 16 * imagenes.length);
    cab.writeUInt16LE(1, 2);
    cab.writeUInt16LE(imagenes.length, 4);
    let desde = cab.length;
    imagenes.forEach((im, i) => {
      cab.writeUInt32LE(im.length, 6 + i * 16 + 8);
      cab.writeUInt32LE(desde, 6 + i * 16 + 12);
      desde += im.length;
    });
    return Buffer.concat([cab, ...imagenes]);
  };
  const chico = png(16, 16);
  const grande = png(48, 48);
  assert.deepEqual(pngDeIco(ico(chico, grande)), grande);
  assert.equal(pngDeIco(ico(Buffer.alloc(40, 1))), null);
  assert.equal(pngDeIco(Buffer.from("no es un ico")), null);
  const dir = proyecto({ "favicon.ico": ico(chico, grande) });
  assert.equal(await iconoDe({ ruta: dir, icono: null }, sinAchicar), url("image/png", grande));
  assert.equal(logoDeBytes(ico(Buffer.alloc(40, 1)), ".ico", sinAchicar), null);
});

test("limpiarSvg: saca scripts, foreignObject y manejadores; rechaza lo que trae cosas de afuera", () => {
  const limpio = limpiarSvg(`<?xml version="1.0"?><!-- hola --><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><div>x</div></foreignObject><circle r="4" onclick='x()' fill="url(#g)"/><use href="#a"/></svg>`);
  assert.ok(limpio);
  assert.doesNotMatch(limpio, /script|foreignObject|onload|onclick|<\?xml|hola/i);
  assert.match(limpio, /<circle r="4"/);
  assert.match(limpio, /href="#a"/);
  for (const malo of [
    `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://sitio.malo/x.png"/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href='//malo/x.png'/></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect/></a></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://malo/x.css);</style></svg>`,
    `<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(http://malo/x)"/></svg>`,
    `<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg">&x;</svg>`,
    `<html><body>no soy un svg</body></html>`,
  ]) assert.equal(limpiarSvg(malo), null, malo);
  // Una imagen embebida en base64 está bien.
  assert.ok(limpiarSvg(`<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>`));
  // El SVG con script pasa a data URL ya limpio.
  const dir = proyecto({ "favicon.svg": `<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script><rect/></svg>` });
  return iconoDe({ ruta: dir, icono: null }).then((u) => {
    assert.ok(u);
    assert.doesNotMatch(Buffer.from(u.split(",")[1], "base64").toString(), /script/);
  });
});

test("validarLogo: sólo un PNG de hasta 64 px o un SVG limpio, en data URL", () => {
  const bueno = url("image/png", png(64, 40));
  assert.equal(validarLogo(bueno), bueno);
  assert.equal(validarLogo(url("image/png", png(65, 10))), null);
  assert.equal(validarLogo(url("image/png", png(0, 0))), null);
  assert.equal(validarLogo(url("image/png", Buffer.from("no es png"))), null);
  assert.equal(validarLogo(url("image/png", png(8, 8, 70 * 1024))), null);
  assert.equal(validarLogo(url("image/jpeg", png(8, 8))), null);
  assert.equal(validarLogo("/home/yo/logo.png"), null);
  assert.equal(validarLogo("data:image/png;base64,!!!"), null);
  assert.equal(validarLogo(null), null);
  assert.equal(validarLogo(url("image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>`))?.includes("script"), false);
  assert.equal(validarLogo(url("image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg"><image href="http://malo/x"/></svg>`)), null);
});

test("el caché es por archivo y fecha: cambia el archivo y cambia el ícono; sin cambios no se vuelve a leer", async () => {
  const dir = proyecto({ "favicon.svg": svg("uno") });
  const archivo = path.join(dir, "favicon.svg");
  assert.equal(await iconoDe({ ruta: dir, icono: null }), url("image/svg+xml", svg("uno")));
  writeFileSync(archivo, svg("dos"));
  utimesSync(archivo, new Date(2030, 0, 1), new Date(2030, 0, 1));
  assert.equal(await iconoDe({ ruta: dir, icono: null }), url("image/svg+xml", svg("dos")));
  // Lo mismo por proyecto en el mapa.
  assert.deepEqual(Object.keys(await iconosDe([{ slug: "con", ruta: dir, icono: null }, { slug: "sin", ruta: proyecto({}), icono: null }])), ["con"]);
});
