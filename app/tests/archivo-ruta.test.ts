// Los archivos que tocan las herramientas de la actividad (Read/Write/Edit de Claude y los equivalentes de agy y
// gemini): de qué ruta se trata y qué tipo de archivo es, también con rutas de Windows. Fixtures inventados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { accionDeHerramienta, archivoDeHerramienta, archivoDeRuta, extensionDe, rutaDeHerramienta, tipoDeArchivo } from "../electron/archivo-ruta.ts";
import { herramientaClaude } from "../electron/agy-stream.ts";
import { rutaAbsoluta } from "../electron/imagen-ruta.ts";

test("rutaDeHerramienta: Read, Write, Edit, MultiEdit y NotebookEdit de Claude", () => {
  assert.equal(rutaDeHerramienta("Read", { file_path: "/home/ana/proy/captura.png" }), "/home/ana/proy/captura.png");
  assert.equal(rutaDeHerramienta("Write", { file_path: "/tmp/a.md", content: "x" }), "/tmp/a.md");
  assert.equal(rutaDeHerramienta("Edit", { file_path: "/tmp/a.ts", old_string: "a", new_string: "b" }), "/tmp/a.ts");
  assert.equal(rutaDeHerramienta("MultiEdit", { file_path: "/tmp/a.ts", edits: [] }), "/tmp/a.ts");
  assert.equal(rutaDeHerramienta("NotebookEdit", { notebook_path: "/tmp/n.ipynb" }), "/tmp/n.ipynb");
  assert.equal(rutaDeHerramienta("Read", { file_path: "  /tmp/con espacios.pdf  " }), "/tmp/con espacios.pdf");
});

test("rutaDeHerramienta: una ruta de Windows con backslash y letra de unidad", () => {
  assert.equal(rutaDeHerramienta("Read", { file_path: "C:\\Users\\ana\\Documents\\informe final.pdf" }), "C:\\Users\\ana\\Documents\\informe final.pdf");
  const a = archivoDeHerramienta("Edit", { file_path: "D:\\proy\\src\\app.tsx" });
  assert.equal(a?.tipo, "texto");
  assert.equal(a?.accion, "editar");
  assert.deepEqual(a?.absoluta, { estilo: "win32", ruta: "D:\\proy\\src\\app.tsx" });
});

test("rutaDeHerramienta: lo que no es de archivo o no trae ruta es null", () => {
  assert.equal(rutaDeHerramienta("Bash", { command: "ls", file_path: "/tmp/x" }), null);
  assert.equal(rutaDeHerramienta("Grep", { pattern: "a", path: "/tmp" }), null);
  assert.equal(rutaDeHerramienta("Read", {}), null);
  assert.equal(rutaDeHerramienta("Read", null), null);
  assert.equal(rutaDeHerramienta("Read", { file_path: 3 }), null);
  assert.equal(rutaDeHerramienta("Read", { file_path: "   " }), null);
});

test("herramientas de agy y de gemini: view_file, write_to_file, replace_file_content, read_file, write_file, replace", () => {
  assert.equal(accionDeHerramienta("view_file"), "leer");
  assert.equal(accionDeHerramienta("write_to_file"), "escribir");
  assert.equal(accionDeHerramienta("replace_file_content"), "editar");
  assert.equal(accionDeHerramienta("multi_replace_file_content"), "editar");
  assert.equal(accionDeHerramienta("read_file"), "leer");
  assert.equal(accionDeHerramienta("ReadFile"), "leer");
  assert.equal(accionDeHerramienta("write_file"), "escribir");
  assert.equal(accionDeHerramienta("replace"), "editar");
  assert.equal(accionDeHerramienta("run_command"), null);
  assert.equal(rutaDeHerramienta("view_file", { AbsolutePath: "C:\\proy\\logo.png" }), "C:\\proy\\logo.png");
  assert.equal(rutaDeHerramienta("write_to_file", { TargetFile: "/tmp/nota.md", CodeContent: "x" }), "/tmp/nota.md");
  assert.equal(rutaDeHerramienta("read_file", { absolute_path: "/tmp/x.txt" }), "/tmp/x.txt");
  assert.equal(rutaDeHerramienta("write_file", { file_path: "/tmp/x.txt", content: "x" }), "/tmp/x.txt");
  assert.equal(rutaDeHerramienta("replace", { file_path: "/tmp/x.txt", old_string: "a", new_string: "b" }), "/tmp/x.txt");
});

test("lo que agy traduce a Claude (herramientaClaude) también da su archivo", () => {
  const v = herramientaClaude("view_file", { AbsolutePath: "C:\\proy\\foto.jpg" });
  assert.equal(rutaDeHerramienta(v.name, v.input), "C:\\proy\\foto.jpg");
  const w = herramientaClaude("write_to_file", { TargetFile: "/tmp/p/salida.json", CodeContent: "{}" });
  assert.equal(archivoDeHerramienta(w.name, w.input)?.accion, "escribir");
  const r = herramientaClaude("replace_file_content", { TargetFile: "/tmp/p/a.py" });
  assert.equal(archivoDeHerramienta(r.name, r.input)?.tipo, "texto");
  const l = herramientaClaude("list_dir", { DirectoryPath: "/tmp/p" });
  assert.equal(archivoDeHerramienta(l.name, l.input), null);
});

test("tipoDeArchivo: imágenes, PDF, texto y código, markdown, audio y video", () => {
  for (const f of ["a.png", "b.JPG", "c.jpeg", "d.webp", "e.gif", "f.svg"]) assert.equal(tipoDeArchivo(f).tipo, "imagen", f);
  assert.equal(tipoDeArchivo("x.svg").mime, "image/svg+xml");
  assert.equal(tipoDeArchivo("C:\\docs\\Informe.PDF").tipo, "pdf");
  assert.equal(tipoDeArchivo("/tmp/a.md").tipo, "markdown");
  for (const f of ["a.ts", "a.tsx", "a.py", "a.json", "a.rs", "a.yml", "a.sh", "a.log", "a.css", "C:\\x\\Dockerfile", "/tmp/Makefile", "/tmp/.gitignore"]) assert.equal(tipoDeArchivo(f).tipo, "texto", f);
  assert.equal(tipoDeArchivo("/tmp/a.mp3").tipo, "audio");
  assert.equal(tipoDeArchivo("/tmp/a.wav").mime, "audio/wav");
  assert.equal(tipoDeArchivo("/tmp/a.mp4").tipo, "video");
  assert.equal(tipoDeArchivo("/tmp/a.webm").mime, "video/webm");
});

test("tipoDeArchivo: lo que no se muestra es otro (se abre con la app del sistema)", () => {
  for (const f of ["/tmp/a.zip", "/tmp/a.docx", "/tmp/a.exe", "/tmp/sinextension", "C:\\x\\y.xlsx"]) assert.equal(tipoDeArchivo(f).tipo, "otro", f);
  // El punto del directorio no es una extensión.
  assert.equal(extensionDe("/tmp/dir.png/archivo"), "");
  assert.equal(extensionDe("C:\\dir.v2\\README"), "");
});

test("archivoDeHerramienta: absoluta sólo si la ruta vale (una relativa o con .. no se abre)", () => {
  assert.equal(archivoDeHerramienta("Read", { file_path: "src/a.ts" })?.absoluta, null);
  assert.equal(archivoDeHerramienta("Read", { file_path: "/tmp/../etc/passwd" })?.absoluta, null);
  assert.equal(archivoDeHerramienta("Read", { file_path: "\\\\servidor\\recurso\\a.txt" })?.absoluta, null);
  assert.deepEqual(archivoDeHerramienta("Read", { file_path: "/tmp/a.pdf" })?.absoluta, { estilo: "posix", ruta: "/tmp/a.pdf" });
  assert.equal(archivoDeHerramienta("Bash", { command: "ls" }), null);
});

test("archivoDeRuta: la ruta sola de un paso de worker", () => {
  const a = archivoDeRuta("/home/ana/proy/doc.pdf", "leer");
  assert.equal(a?.tipo, "pdf");
  assert.equal(a?.accion, "leer");
  assert.equal(archivoDeRuta("", "leer"), null);
  assert.equal(archivoDeRuta("C:\\proy\\a.png", "escribir")?.absoluta?.estilo, "win32");
});

test("rutaAbsoluta: sin exigir extensión", () => {
  assert.deepEqual(rutaAbsoluta("/tmp/Makefile"), { estilo: "posix", ruta: "/tmp/Makefile" });
  assert.deepEqual(rutaAbsoluta("C:\\a\\LEEME"), { estilo: "win32", ruta: "C:\\a\\LEEME" });
  assert.equal(rutaAbsoluta("relativa/a.txt"), null);
});
