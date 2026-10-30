// Los archivos que una herramienta de un worker, un subagente o un líder lee, escribe o edita: de qué ruta se trata
// y qué tipo de archivo es, para que la vista de actividad los abra en el visor (src/hilo/VerArchivo.tsx). Puro y
// sin Node (lo importa también la interfaz): el que lee del disco es archivo-ver.ts. Las herramientas son las de
// Claude Code (Read, Write, Edit…) y, por si llegan sin traducir, las de agy (view_file, write_to_file…) y las del
// gemini-cli (read_file, write_file, replace…).
import { rutaAbsoluta, type RutaImagen } from "./imagen-ruta.ts";

export type AccionArchivo = "leer" | "escribir" | "editar";

/** Qué hace cada herramienta con su archivo (sin importar mayúsculas ni guiones bajos: `ReadFile` = `read_file`). */
const ACCION: Readonly<Record<string, AccionArchivo>> = {
  read: "leer",
  notebookread: "leer",
  readfile: "leer",
  viewfile: "leer",
  viewfileoutline: "leer",
  viewcodeitem: "leer",
  write: "escribir",
  writefile: "escribir",
  writetofile: "escribir",
  edit: "editar",
  multiedit: "editar",
  notebookedit: "editar",
  replace: "editar",
  replacefilecontent: "editar",
  multireplacefilecontent: "editar",
  sedfile: "editar",
};

/** Los campos donde cada motor deja la ruta, en este orden. */
const CAMPOS = ["file_path", "notebook_path", "absolute_path", "AbsolutePath", "TargetFile", "FilePath", "filePath", "path", "Path"];

const norm = (s: string) => s.toLowerCase().replace(/[_-]/g, "");

/** Qué hace la herramienta `nombre` con un archivo; `null` si no es una de archivo. */
export const accionDeHerramienta = (nombre: string): AccionArchivo | null => ACCION[norm(nombre ?? "")] ?? null;

/** La ruta del archivo que usa una llamada, tal como la dejó el modelo (puede ser relativa); `null` si no es una herramienta de archivo o no trae ruta. */
export function rutaDeHerramienta(nombre: string, entrada: unknown): string | null {
  if (!accionDeHerramienta(nombre) || !entrada || typeof entrada !== "object") return null;
  const e = entrada as Record<string, unknown>;
  for (const c of CAMPOS) {
    const v = e[c];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export type TipoArchivo = "imagen" | "pdf" | "markdown" | "texto" | "audio" | "video" | "otro";

const POR_EXT: Readonly<Record<string, [TipoArchivo, string]>> = {
  png: ["imagen", "image/png"],
  jpg: ["imagen", "image/jpeg"],
  jpeg: ["imagen", "image/jpeg"],
  gif: ["imagen", "image/gif"],
  webp: ["imagen", "image/webp"],
  bmp: ["imagen", "image/bmp"],
  svg: ["imagen", "image/svg+xml"],
  avif: ["imagen", "image/avif"],
  ico: ["imagen", "image/x-icon"],
  pdf: ["pdf", "application/pdf"],
  md: ["markdown", "text/markdown"],
  markdown: ["markdown", "text/markdown"],
  mp3: ["audio", "audio/mpeg"],
  wav: ["audio", "audio/wav"],
  ogg: ["audio", "audio/ogg"],
  oga: ["audio", "audio/ogg"],
  m4a: ["audio", "audio/mp4"],
  flac: ["audio", "audio/flac"],
  opus: ["audio", "audio/ogg"],
  mp4: ["video", "video/mp4"],
  webm: ["video", "video/webm"],
  mov: ["video", "video/quicktime"],
  m4v: ["video", "video/mp4"],
  ogv: ["video", "video/ogg"],
};

const TEXTO = new Set(
  (
    "txt log text csv tsv json jsonc json5 jsonl ndjson yaml yml toml ini cfg conf env xml html htm css scss sass less " +
    "js mjs cjs jsx ts mts cts tsx vue svelte astro py pyi rb php pl lua r go rs java kt kts scala swift c h cc cpp cxx hpp hh cs " +
    "sh bash zsh fish ps1 psm1 bat cmd sql graphql gql proto diff patch lock mod sum gradle properties tex rst org " +
    "dockerfile makefile qml ipynb"
  ).split(" "),
);

/** Archivos de texto sin extensión que se conocen por el nombre. */
const TEXTO_POR_NOMBRE = new Set(["dockerfile", "makefile", "license", "readme", "changelog", "procfile", "gemfile", "rakefile", ".gitignore", ".gitattributes", ".editorconfig", ".prettierrc", ".eslintrc"]);

/** El nombre del archivo de una ruta de Windows o de Linux. */
const base = (ruta: string) => ruta.split(/[\\/]/).filter(Boolean).pop() ?? ruta;

/** La extensión en minúsculas, sin el punto (`""` si no tiene). */
export const extensionDe = (ruta: string): string => /\.([A-Za-z0-9]+)$/.exec(base(ruta))?.[1]?.toLowerCase() ?? "";

/** Qué tipo de archivo es (por su extensión) y su tipo MIME para servirlo; `"otro"` es lo que no se muestra y se abre con la app del sistema. */
export function tipoDeArchivo(ruta: string): { tipo: TipoArchivo; mime: string } {
  const ext = extensionDe(ruta);
  const conocido = POR_EXT[ext];
  if (conocido) return { tipo: conocido[0], mime: conocido[1] };
  if (TEXTO.has(ext) || TEXTO_POR_NOMBRE.has(base(ruta).toLowerCase())) return { tipo: "texto", mime: "text/plain" };
  return { tipo: "otro", mime: "application/octet-stream" };
}

/** Formatos de documentos y de medios que el visor no muestra pero que la app del sistema sí abre (sin macros ni nada que se ejecute). */
const ABRIBLES = new Set(
  "doc docx dot dotx xls xlsx ppt pptx odt ods odp rtf epub zip 7z rar tar gz tgz bz2 xz psd ai heic heif tif tiff mkv avi wmv flv aac wma 3gp".split(" "),
);

/**
 * Si se puede pedir que la app del sistema abra el archivo: sólo imágenes, PDF, audio, video, markdown y documentos conocidos.
 * Nunca un programa o un script (.exe, .bat, .sh, .py…): abrirlos los ejecutaría. El texto y el código se ven en el visor, no se abren afuera.
 */
export function abribleConSistema(ruta: string): boolean {
  const { tipo } = tipoDeArchivo(ruta);
  return (tipo === "imagen" && extensionDe(ruta) !== "svg") || tipo === "pdf" || tipo === "audio" || tipo === "video" || tipo === "markdown" || ABRIBLES.has(extensionDe(ruta));
}

/** Un archivo de una herramienta, listo para la vista: la ruta tal cual, qué hizo la herramienta, el tipo y, si es absoluta y válida, la ruta limpia. */
export type ArchivoDeHerramienta = {
  ruta: string;
  accion: AccionArchivo;
  tipo: TipoArchivo;
  mime: string;
  /** La ruta absoluta validada (de Windows o de Linux); `null` si es relativa o no vale: ahí no se puede abrir. */
  absoluta: RutaImagen | null;
};

/** El archivo que toca una llamada (`nombre` + `entrada`), o `null` si no toca ninguno. */
export function archivoDeHerramienta(nombre: string, entrada: unknown): ArchivoDeHerramienta | null {
  const accion = accionDeHerramienta(nombre);
  const ruta = rutaDeHerramienta(nombre, entrada);
  if (!accion || !ruta) return null;
  return { ruta, accion, ...tipoDeArchivo(ruta), absoluta: rutaAbsoluta(ruta) };
}

/** La ruta ya absoluta (de un paso de worker, que trae la ruta sola) como archivo; `null` si no vale. */
export function archivoDeRuta(ruta: string, accion: AccionArchivo): ArchivoDeHerramienta | null {
  if (!ruta || !ruta.trim()) return null;
  return { ruta, accion, ...tipoDeArchivo(ruta), absoluta: rutaAbsoluta(ruta) };
}

/** Lo que el visor sabe mostrar: los bytes en base64 (imagen, PDF, audio, video) o el texto. */
export type ArchivoVisto =
  | { tipo: "imagen" | "pdf" | "audio" | "video"; mime: string; datos: string }
  | { tipo: "texto" | "markdown"; texto: string; recortado: boolean };

/** Una respuesta del IPC sin validar → `ArchivoVisto`, o `null` si no tiene esa forma. */
export function archivoVistoDe(x: unknown): ArchivoVisto | null {
  const o = x as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return null;
  if ((o.tipo === "texto" || o.tipo === "markdown") && typeof o.texto === "string") return { tipo: o.tipo, texto: o.texto, recortado: o.recortado === true };
  if ((o.tipo === "imagen" || o.tipo === "pdf" || o.tipo === "audio" || o.tipo === "video") && typeof o.mime === "string" && /^[a-z]+\/[a-z0-9.+-]+$/.test(o.mime) && typeof o.datos === "string" && o.datos)
    return { tipo: o.tipo, mime: o.mime, datos: o.datos };
  return null;
}
