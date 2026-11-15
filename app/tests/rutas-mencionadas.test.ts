import assert from "node:assert/strict";
import test from "node:test";
import { acortarRuta, carpetaDe, nombreRuta, partirProsa, rutaDeCodigo, rutasMencionadas, rutasSinLugar } from "../src/hilo/rutas-mencionadas.ts";

test("detecta carpetas y archivos .html en Linux (prosa y código en línea)", () => {
  const texto = [
    "Dejé los bocetos en `~/Proyectos/taller` y el reporte en /home/ana/salida/.",
    "Podés abrir /home/ana/salida/resumen.html, o mirar `~/docs/Indice.HTML`.",
  ].join("\n");

  assert.deepEqual(rutasMencionadas(texto, "linux"), [
    { tipo: "carpeta", ruta: "~/Proyectos/taller" },
    { tipo: "carpeta", ruta: "/home/ana/salida/" },
    { tipo: "html", ruta: "/home/ana/salida/resumen.html" },
    { tipo: "html", ruta: "~/docs/Indice.HTML" },
  ]);
});

test("detecta rutas de Windows en win32 incluso con espacios entre comillas", () => {
  const texto = [
    "Guardado en `C:\\Users\\Ana\\Mi Proyecto` y el informe en \"D:\\Salidas Web\\vista final.html\".",
    "También la carpeta ~\\Documentos\\taller\\ para revisar.",
  ].join("\n");

  assert.deepEqual(rutasMencionadas(texto, "win32"), [
    { tipo: "carpeta", ruta: "C:\\Users\\Ana\\Mi Proyecto" },
    { tipo: "html", ruta: "D:\\Salidas Web\\vista final.html" },
    { tipo: "carpeta", ruta: "~\\Documentos\\taller\\" },
  ]);
});

test("ignora URLs, rutas relativas, bloques de código, links, comodines y navegación padre", () => {
  const texto = [
    "No tomar https://ejemplo.com/guia.html ni file:///home/ana/a.html.",
    "Tampoco rutas relativas salidas/local/ o ./vista.html ni comandos /orquestar o /ayuda/.",
    "Tampoco /home/ana/../secreto.html ni /home/ana/*.html.",
    "Ni links [ver reporte](https://ejemplo.com/link.html) ni imágenes ![foto](/home/ana/foto.png).",
    "Ni archivos que no se muestran como /home/ana/paquete.zip o `/home/ana/setup.exe`, ni `.png` suelto.",
    "```bash",
    "open /home/ana/dentro-de-bloque.html",
    "ls /home/ana/carpeta-en-bloque/",
    "```",
  ].join("\n");

  assert.deepEqual(rutasMencionadas(texto, "linux"), []);
});

test("respeta la plataforma actual al filtrar sintaxis ajena", () => {
  const conWin = "Abrí C:\\Users\\Ana\\pagina.html o `C:\\Users\\Ana\\carpeta`.";
  assert.deepEqual(rutasMencionadas(conWin, "linux"), []);

  const conLinux = "Abrí /home/ana/pagina.html o `/home/ana/carpeta`.";
  assert.deepEqual(rutasMencionadas(conLinux, "win32"), []);
});

test("desduplica variantes equivalentes y limita a 6 rutas", () => {
  const linux = [
    "/home/ana/uno/ y `/home/ana/uno` son la misma carpeta.",
    "Luego /home/ana/dos.html, /home/ana/tres/, /home/ana/cuatro.html, /home/ana/cinco.md, /home/ana/seis.png y /home/ana/siete.pdf.",
  ].join("\n");

  assert.deepEqual(rutasMencionadas(linux, "linux"), [
    { tipo: "carpeta", ruta: "/home/ana/uno/" },
    { tipo: "html", ruta: "/home/ana/dos.html" },
    { tipo: "carpeta", ruta: "/home/ana/tres/" },
    { tipo: "html", ruta: "/home/ana/cuatro.html" },
    { tipo: "archivo", ruta: "/home/ana/cinco.md" },
    { tipo: "archivo", ruta: "/home/ana/seis.png" },
  ]);

  const win = "`C:\\Users\\Ana\\Docs` y `c:/users/ana/docs\\` deben quedar una vez.";
  assert.deepEqual(rutasMencionadas(win, "win32"), [
    { tipo: "carpeta", ruta: "C:\\Users\\Ana\\Docs" },
  ]);
});

test("encuentra rutas dentro de listas, citas, títulos y tablas", () => {
  const texto = [
    "## Salida /home/ana/titulo/",
    "",
    "> Revisar `/home/ana/cita/tabla.html`",
    "",
    "- Carpeta: /home/ana/lista/",
    "",
    "| Ruta | Estado |",
    "| --- | --- |",
    "| `/home/ana/tabla` | listo |",
  ].join("\n");

  assert.deepEqual(rutasMencionadas(texto, "linux"), [
    { tipo: "carpeta", ruta: "/home/ana/titulo/" },
    { tipo: "html", ruta: "/home/ana/cita/tabla.html" },
    { tipo: "carpeta", ruta: "/home/ana/lista/" },
    { tipo: "carpeta", ruta: "/home/ana/tabla" },
  ]);
});

test("nombreRuta extrae el último tramo en Linux y Windows", () => {
  assert.equal(nombreRuta("/home/ana/proyectos/trama/"), "trama");
  assert.equal(nombreRuta("~/maquetas/e-taller.html"), "e-taller.html");
  assert.equal(nombreRuta("C:\\Users\\Ana\\Mis Documentos\\"), "Mis Documentos");
  assert.equal(nombreRuta("D:\\reportes\\final.html"), "final.html");
});

test("acortarRuta recorta por el medio manteniendo extremos legibles", () => {
  assert.equal(acortarRuta("~/corto/dir", 40), "~/corto/dir");
  const largaLinux = "/home/ana/proyectos/trama/maquetas/taller/e-taller.html";
  const acLinux = acortarRuta(largaLinux, 42);
  assert.ok(acLinux.length <= 42);
  assert.ok(acLinux.startsWith("/home/ana"));
  assert.ok(acLinux.includes("…"));
  assert.ok(acLinux.endsWith("e-taller.html"));

  const largaWin = "C:\\Users\\Ana\\Proyectos\\Cliente\\Entregables\\reporte-final.html";
  const acWin = acortarRuta(largaWin, 42);
  assert.ok(acWin.length <= 42);
  assert.ok(acWin.startsWith("C:\\Users"));
  assert.ok(acWin.includes("…"));
  assert.ok(acWin.endsWith("reporte-final.html"));
});

test("carpetaDe da la carpeta que contiene al archivo en Linux y Windows", () => {
  assert.equal(carpetaDe("/home/ana/salida/resumen.html"), "/home/ana/salida");
  assert.equal(carpetaDe("~/maquetas/e-taller.html"), "~/maquetas");
  assert.equal(carpetaDe("/resumen.html"), "/");
  assert.equal(carpetaDe("C:\\Users\\Ana\\reporte.html"), "C:\\Users\\Ana");
  assert.equal(carpetaDe("C:\\reporte.html"), "C:\\");
});

test("detecta archivos mostrables con tilde y ~, e ignora .png suelto sin ruta", () => {
  const ejemploConSuelto =
    "La tarjeta ya tiene al nene en el centro, en `~/Imágenes/invitacion-juan-manuel-7.jpg` (para WhatsApp) y `.png`. El recorte solo está en `~/Imágenes/juan-manuel-recorte.png`.";
  assert.deepEqual(rutasMencionadas(ejemploConSuelto, "linux"), [
    { tipo: "archivo", ruta: "~/Imágenes/invitacion-juan-manuel-7.jpg" },
    { tipo: "archivo", ruta: "~/Imágenes/juan-manuel-recorte.png" },
  ]);

  const tresRutas =
    "La tarjeta ya tiene al nene en el centro, en `~/Imágenes/invitacion-juan-manuel-7.jpg` (para WhatsApp) y ~/Imágenes/invitacion-juan-manuel-7.png. El recorte solo está en `~/Imágenes/juan-manuel-recorte.png`.";
  assert.deepEqual(rutasMencionadas(tresRutas, "linux"), [
    { tipo: "archivo", ruta: "~/Imágenes/invitacion-juan-manuel-7.jpg" },
    { tipo: "archivo", ruta: "~/Imágenes/invitacion-juan-manuel-7.png" },
    { tipo: "archivo", ruta: "~/Imágenes/juan-manuel-recorte.png" },
  ]);

  assert.deepEqual(rutasMencionadas("Dejé un .png y otro .jpg sueltos.", "linux"), []);
});

test("detecta archivos en Windows y todos los tipos de tipoDeArchivo", () => {
  const win = "Mirá `C:\\Users\\x\\Pictures\\a.png` y ~\\Documentos\\resumen.pdf.";
  assert.deepEqual(rutasMencionadas(win, "win32"), [
    { tipo: "archivo", ruta: "C:\\Users\\x\\Pictures\\a.png" },
    { tipo: "archivo", ruta: "~\\Documentos\\resumen.pdf" },
  ]);

  const varios = [
    "/home/ana/docs/notas.md",
    "`/home/ana/src/index.ts`",
    "/home/ana/media/audio.mp3",
    "/home/ana/media/video.mp4",
    "/home/ana/web/vista.html",
  ].join(" ");
  assert.deepEqual(rutasMencionadas(varios, "linux"), [
    { tipo: "archivo", ruta: "/home/ana/docs/notas.md" },
    { tipo: "archivo", ruta: "/home/ana/src/index.ts" },
    { tipo: "archivo", ruta: "/home/ana/media/audio.mp3" },
    { tipo: "archivo", ruta: "/home/ana/media/video.mp4" },
    { tipo: "html", ruta: "/home/ana/web/vista.html" },
  ]);
});

test("rutasSinLugar: al pie sólo quedan las imágenes; carpetas y archivos se tocan en su lugar", () => {
  const texto = [
    "1. **Shell:** las tareas `~/Proyectos/shell/docs/tarea.md` y `~/Proyectos/shell/docs/otra.md`.",
    "- Documentar en `~/sistema/` y mirar /home/ana/salida/ y `/home/ana/foto.png`.",
  ].join("\n");
  assert.deepEqual(rutasSinLugar(texto, "linux"), [{ tipo: "archivo", ruta: "/home/ana/foto.png" }]);
  assert.deepEqual(rutaDeCodigo(" ~/Proyectos/shell/docs/tarea.md ", "linux"), { tipo: "archivo", ruta: "~/Proyectos/shell/docs/tarea.md" });
  assert.deepEqual(rutaDeCodigo("~/sistema", "linux"), { tipo: "carpeta", ruta: "~/sistema" });
  assert.equal(rutaDeCodigo("npm test", "linux"), null);
});

test("partirProsa: corta la prosa en texto y rutas, en su lugar y sin la puntuación de al lado", () => {
  assert.deepEqual(partirProsa("Dejé el reporte en /home/ana/salida/, y armé /home/ana/x/e-taller.html para revisar.", "linux"), [
    "Dejé el reporte en ",
    { tipo: "carpeta", ruta: "/home/ana/salida/" },
    ", y armé ",
    { tipo: "html", ruta: "/home/ana/x/e-taller.html" },
    " para revisar.",
  ]);
  assert.deepEqual(partirProsa('Abrí "C:\\Users\\Ana\\Mis docs\\" ya.', "win32"), ['Abrí "', { tipo: "carpeta", ruta: "C:\\Users\\Ana\\Mis docs\\" }, '" ya.']);
  assert.deepEqual(partirProsa("sin rutas acá, sólo a/b", "linux"), ["sin rutas acá, sólo a/b"]);
});
