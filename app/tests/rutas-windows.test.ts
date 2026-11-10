// Rutas de Windows: los adjuntos y las carpetas de los líderes llegan con "\" (o con "/" si el motor los normaliza), y
// tienen que reconocerse igual que las de POSIX. Rutas literales de Windows (nunca rutas reales: el disco es el de acá) y
// disco falso donde haga falta: lo puro va sin disco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esRutaAbsoluta, nombreDeRuta, PREFIJOS_ADJUNTO, separarAdjuntos } from "../electron/adjunto.ts";
import { avanzarTema, proyectoEnTexto, proyectoPorUso, TEMA0, tituloCorto, tituloDeTexto } from "../electron/tema.ts";

const [en0, es0] = PREFIJOS_ADJUNTO;

// La casa y las carpetas, de Windows, escritas a mano.
const HOME = "C:\\Users\\Ana";
const REG = [
  { nombre: "app", slug: "app", ruta: "C:\\Users\\Ana\\Proyectos\\app" },
  { nombre: "trama", slug: "trama", ruta: "C:\\Users\\Ana\\Proyectos\\trama" },
  { nombre: "omc", slug: "omc", ruta: "C:\\Users\\Ana\\omc" },
];

const usuario = (t: string) => JSON.stringify({ type: "user", message: { role: "user", content: t } });
const editar = (file_path: string) =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Edit", input: { file_path } }] } });
const transcript = (...ls: string[]) => avanzarTema(TEMA0, ls.join("\n") + "\n");

test("esRutaAbsoluta: de POSIX, de Windows (con \"\\\" o con \"/\") y UNC", () => {
  assert.ok(esRutaAbsoluta("/home/ana/x.md"));
  assert.ok(esRutaAbsoluta("C:\\Users\\Ana\\x.md"));
  assert.ok(esRutaAbsoluta("c:/users/ana/x.md"));
  assert.ok(esRutaAbsoluta("\\\\servidor\\compartir\\x.md"));
  // No son absolutas: un nombre suelto o una unidad relativa.
  assert.equal(esRutaAbsoluta("notas.md"), false);
  assert.equal(esRutaAbsoluta("C:notas.md"), false);
  assert.equal(esRutaAbsoluta(""), false);
});

test("nombreDeRuta: lo último, sea con \"/\" o con \"\\\"", () => {
  assert.equal(nombreDeRuta("C:\\Users\\Ana\\notas.md"), "notas.md");
  assert.equal(nombreDeRuta("C:/Users/Ana/notas.md"), "notas.md");
  assert.equal(nombreDeRuta("\\\\servidor\\compartir\\notas.md"), "notas.md");
  assert.equal(nombreDeRuta("/home/ana/notas.md"), "notas.md");
});

test("separarAdjuntos: reconoce las rutas de Windows y saca el nombre del archivo", () => {
  const win = "C:\\Users\\Ana\\Documents\\diagnostico-sistema.md";
  const unc = "\\\\servidor\\compartir\\b.pdf";
  const winBarra = "C:/Users/Ana/Documents/c.md";
  for (const p of PREFIJOS_ADJUNTO) {
    const linea = (r: string) => p + r;
    assert.deepEqual(separarAdjuntos(linea(win)).archivos, [{ nombre: "diagnostico-sistema.md", ruta: win }]);
    assert.deepEqual(separarAdjuntos(linea(unc)).archivos, [{ nombre: "b.pdf", ruta: unc }]);
    assert.deepEqual(separarAdjuntos(linea(winBarra)).archivos, [{ nombre: "c.md", ruta: winBarra }]);
  }
  // Varias, en orden, y el texto sin ellas.
  const texto = `mirá esto\n\n${es0}${win}\n${en0}${unc}`;
  assert.deepEqual(separarAdjuntos(texto), {
    texto: "mirá esto",
    archivos: [
      { nombre: "diagnostico-sistema.md", ruta: win },
      { nombre: "b.pdf", ruta: unc },
    ],
  });
  // Sin ruta absoluta no es una línea de archivo (ni "C:notas.md", que es relativa a la unidad).
  assert.deepEqual(separarAdjuntos(`${en0}notas.md`).archivos, []);
  assert.deepEqual(separarAdjuntos(`${en0}C:notas.md`).archivos, []);
});

test("el título del líder con un adjunto de Windows es el nombre del archivo", () => {
  const win = "C:\\Users\\Ana\\Documents\\diagnostico-sistema.md";
  assert.equal(tituloDeTexto(`${es0}${win}`), "diagnostico-sistema.md");
  assert.equal(tituloDeTexto(`revisá esto\n\n${es0}${win}`), "revisá esto");
  assert.equal(tituloCorto(`${es0}${win}`), "diagnostico-sistema.md");
});

test("proyectoEnTexto: una ruta de Windows nombra al proyecto", () => {
  assert.equal(proyectoEnTexto("mirá C:\\Users\\Ana\\Proyectos\\app\\src", REG, HOME), "app");
  assert.equal(proyectoEnTexto("revisá C:/Users/Ana/Proyectos/trama/README.md", REG, HOME), "trama");
  // Con "~" en vez del home.
  assert.equal(proyectoEnTexto("mirá ~\\omc\\PLAN.md", REG, HOME), "omc");
  // Por nombre, como siempre.
  assert.equal(proyectoEnTexto("arreglá el login de omc", REG, HOME), "omc");
});

test("proyectoPorUso: las ediciones con \"\\\" reubican al líder en su proyecto", () => {
  const t = transcript(
    usuario("hola"),
    editar("C:\\Users\\Ana\\Proyectos\\app\\src\\main.ts"),
    editar("C:\\Users\\Ana\\Proyectos\\app\\src\\otro.ts"),
    editar("C:\\Users\\Ana\\.claude\\plans\\x.md"),
  );
  assert.equal(proyectoPorUso(t.usos, REG, HOME), "app");
  // Con una sola edición no alcanza (igual que en Linux).
  const uno = transcript(usuario("hola"), editar("C:\\Users\\Ana\\Proyectos\\app\\src\\main.ts"));
  assert.equal(proyectoPorUso(uno.usos, REG, HOME), null);
  // El home no es un proyecto: un archivo del home no reubica a nadie.
  const enCasa = transcript(usuario("hola"), editar("C:\\Users\\Ana\\notas.md"), editar("C:\\Users\\Ana\\otro.md"));
  assert.equal(proyectoPorUso(enCasa.usos, REG, HOME), null);
  // Las rutas con "~" también: "~" es el home.
  const conTilde = transcript(usuario("hola"), editar("~/Proyectos/trama/a.ts"), editar("~/Proyectos/trama/b.ts"));
  assert.equal(proyectoPorUso(conTilde.usos, REG, HOME), "trama");
});
