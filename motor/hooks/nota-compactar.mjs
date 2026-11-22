#!/usr/bin/env node
// nota-compactar.mjs — hook de Claude Code para líderes de la app y workers de `pa`:
//   - PostToolUse / UserPromptSubmit («pedir»): si el contexto pasó `--umbral <tokens>`, pide UNA vez por ciclo (marca
//     `<estado>/notas/<session_id>.pedida` creada con `wx`) que el modelo escriba su nota entre `[[nota-compactar]]` y
//     `[[/nota-compactar]]`. Si el uso bajó de la mitad del umbral y la marca existe, la borra.
//   - PostToolUse / UserPromptSubmit / PreCompact («copiar»): guarda el último bloque `[[nota-compactar]]…[[/nota-compactar]]`
//     del asistente en `<estado>/notas/<session_id>.md` (modo 0600) si difiere de lo guardado.
//   - SessionStart con `source === "compact"` («devolver»): devuelve la nota (de `.md` o, si falta, de la cola del transcript)
//     recortada a 12 000 caracteres y borra `.pedida`. Otros `source`: no hace nada.
// Barato (lee sólo los últimos ~256 KB del transcript), ignora subagentes (`isSidechain`), nunca bloquea y siempre sale con 0.
import { chmodSync, closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const env = process.env;
export const TAIL_BYTES = 256 * 1024;
export const MAX_COLA_BYTES = 16 * 1024 * 1024;
export const SESION_OK = /^[A-Za-z0-9._-]{1,128}$/;

/** Estado de la app (`HILOS_STATE` o el default por plataforma; misma regla que `cierre-cupo.mjs` / `rutas.ts`). */
export function estadoHilos(e = env, plat = process.platform) {
  if (e.HILOS_STATE) return e.HILOS_STATE;
  const win = plat === "win32";
  const casa = win ? e.USERPROFILE || e.HOME || homedir() : e.HOME || homedir();
  return win
    ? path.win32.join(e.LOCALAPPDATA || path.win32.join(casa, "AppData", "Local"), "trama", "estado", "hilos")
    : path.posix.join(casa, ".local", "state", "hilos");
}

const leerJson = (f) => {
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
};

/** El idioma de la app (`preferencias.json` de su estado); sin él, el de la terminal; por defecto `es`. */
function idiomaDeLaApp(hilos = estadoHilos()) {
  const p = leerJson(path.join(hilos, "preferencias.json"));
  if (p && (p.idioma === "es" || p.idioma === "en")) return p.idioma;
  return /^en/i.test(env.LC_ALL || env.LANG || "") ? "en" : "es";
}

/** Parsea `--umbral <tokens>` y `--umbral-tarea <tokens>` de argv; `null` si falta o no es un entero positivo. */
export function parsearArgs(argv = process.argv.slice(2)) {
  let umbral = null;
  let umbralTarea = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--umbral" && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) umbral = Math.floor(n);
    } else if (typeof a === "string" && a.startsWith("--umbral=")) {
      const n = Number(a.slice("--umbral=".length));
      if (Number.isFinite(n) && n > 0) umbral = Math.floor(n);
    } else if (a === "--umbral-tarea" && i + 1 < argv.length) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) umbralTarea = Math.floor(n);
    } else if (typeof a === "string" && a.startsWith("--umbral-tarea=")) {
      const n = Number(a.slice("--umbral-tarea=".length));
      if (Number.isFinite(n) && n > 0) umbralTarea = Math.floor(n);
    }
  }
  return { umbral, umbralTarea };
}

const rutaEsSubagente = (ruta) => typeof ruta === "string" && /(?:^|[\\/])subagents[\\/]/.test(ruta);

function ultimaLineaEsSubagente(lineas) {
  for (let i = lineas.length - 1; i >= 0; i--) {
    let o;
    try {
      o = JSON.parse(lineas[i]);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object") continue;
    return o.isSidechain === true;
  }
  return false;
}

function tieneAsistentePrincipal(lineas) {
  for (let i = lineas.length - 1; i >= 0; i--) {
    try {
      const o = JSON.parse(lineas[i]);
      if (!o || typeof o !== "object" || o.isSidechain === true) continue;
      if (o.type === "assistant" && o.isApiErrorMessage !== true && o.message?.model !== "<synthetic>") return true;
    } catch {}
  }
  return false;
}

function rescatarAsistenteCortado(fragmento) {
  if (!fragmento || /"isSidechain"\s*:\s*true/.test(fragmento) || /"model"\s*:\s*"<synthetic>"/.test(fragmento)) return null;
  let usage = null;
  const mUso = /"usage"\s*:\s*(\{[^{}]*\})/.exec(fragmento);
  if (mUso) {
    try {
      usage = JSON.parse(mUso[1]);
    } catch {}
  }
  let textoDesescapado = fragmento;
  try {
    textoDesescapado = fragmento.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  } catch {}
  const nota = extraerNotaDeTexto(textoDesescapado);
  if (!usage && !nota) return null;
  return JSON.stringify({
    type: "assistant",
    message: {
      id: "parcial",
      model: "claude",
      content: nota ? `${TAG_NOTA_ABRE}\n${nota}\n${TAG_NOTA_CIERRA}` : "",
      ...(usage ? { usage } : {}),
    },
  });
}

function leerTramoCola(fd, size, maxBytes) {
  const start = Math.max(0, size - maxBytes);
  const leerDesde = start > 0 ? start - 1 : 0;
  const len = size - leerDesde;
  const buf = Buffer.allocUnsafe(len);
  let off = 0;
  while (off < len) {
    const n = readSync(fd, buf, off, len - off, leerDesde + off);
    if (n <= 0) break;
    off += n;
  }
  const real = buf.subarray(0, off);
  const alineado = start === 0 || (real.length > 0 && real[0] === 0x0a);
  let texto = (start > 0 ? real.subarray(1) : real).toString("utf8");
  let cortada = "";
  if (!alineado) {
    const nl = texto.indexOf("\n");
    if (nl >= 0) {
      cortada = texto.slice(0, nl).replace(/\r$/, "");
      texto = texto.slice(nl + 1);
    } else {
      cortada = texto.replace(/\r$/, "");
      texto = "";
    }
  }
  return { start, lineas: texto.split(/\r?\n/).filter(Boolean), cortada };
}

/** Lee sólo los últimos `maxBytes` del transcript (expandiendo si una línea grande oculta al último asistente) y conserva líneas alineadas al offset. */
export function leerColaTranscript(ruta, maxBytes = TAIL_BYTES) {
  if (typeof ruta !== "string" || !ruta) return [];
  let fd;
  try {
    fd = openSync(ruta, "r");
    const size = fstatSync(fd).size;
    if (size <= 0) return [];
    let ventana = Math.max(1, maxBytes);
    const tope = maxBytes >= TAIL_BYTES ? Math.max(maxBytes, MAX_COLA_BYTES) : maxBytes;
    let tramo = leerTramoCola(fd, size, ventana);
    while (!tieneAsistentePrincipal(tramo.lineas) && tramo.start > 0 && ventana < tope) {
      ventana = Math.min(tope, ventana * 2);
      tramo = leerTramoCola(fd, size, ventana);
    }
    if (!tieneAsistentePrincipal(tramo.lineas) && tramo.cortada) {
      const rescatada = rescatarAsistenteCortado(tramo.cortada);
      if (rescatada) return [rescatada, ...tramo.lineas];
    }
    return tramo.lineas;
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        /* nada */
      }
    }
  }
}

const num = (x) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

/**
 * Tokens de contexto del último mensaje del asistente (sin subagentes ni sintéticos):
 * `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
 * Si después de él hay un `compact_boundary`, el uso quedó viejo y devuelve `{ tokens: null, compactada: true }`.
 */
export function ultimoUsoDeLineas(lineas) {
  for (let i = lineas.length - 1; i >= 0; i--) {
    let o;
    try {
      o = JSON.parse(lineas[i]);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || o.isSidechain === true) continue;
    if (o.type === "system" && o.subtype === "compact_boundary") return { tokens: null, compactada: true };
    if (o.type !== "assistant") continue;
    if (o.isApiErrorMessage === true || o.message?.model === "<synthetic>") continue;
    const u = o.message?.usage;
    if (!u || typeof u !== "object") continue;
    const tiene = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"].some(
      (k) => typeof u[k] === "number" && Number.isFinite(u[k]) && u[k] >= 0,
    );
    if (!tiene) continue;
    return {
      tokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens),
      compactada: false,
    };
  }
  return { tokens: null, compactada: false };
}

const textoDeContenido = (c) =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n")
      : "";

const TAG_NOTA_ABRE = "[[nota-compactar]]";
const TAG_NOTA_CIERRA = "[[/nota-compactar]]";

function abrirCerca(linea) {
  const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(linea);
  if (!m) return null;
  const char = m[1][0];
  if (char === "`" && m[2].includes("`")) return null;
  return { char, largo: m[1].length };
}

function cierraCerca(linea, cerca) {
  return new RegExp(`^ {0,3}${cerca.char}{${cerca.largo},}[ \\t]*$`).test(linea);
}

function buscarTagFueraDeCodigo(texto, objetivo, desde = 0) {
  let i = desde;
  let cerca = null;
  while (i < texto.length) {
    const enInicioLinea = i === 0 || texto[i - 1] === "\n";
    if (enInicioLinea) {
      const finLinea = texto.indexOf("\n", i);
      const corte = finLinea === -1 ? texto.length : finLinea;
      const linea = texto.slice(i, corte).replace(/\r$/, "");
      if (cerca) {
        if (cierraCerca(linea, cerca)) cerca = null;
        i = finLinea === -1 ? texto.length : finLinea + 1;
        continue;
      }
      const nueva = abrirCerca(linea);
      if (nueva) {
        cerca = nueva;
        i = finLinea === -1 ? texto.length : finLinea + 1;
        continue;
      }
    }
    if (!cerca && texto[i] === "`") {
      let largo = 1;
      while (i + largo < texto.length && texto[i + largo] === "`") largo++;
      let j = i + largo;
      let encontroCierre = false;
      while (j < texto.length) {
        if (texto[j] === "`") {
          let cierreLargo = 1;
          while (j + cierreLargo < texto.length && texto[j + cierreLargo] === "`") cierreLargo++;
          if (cierreLargo === largo) {
            i = j + cierreLargo;
            encontroCierre = true;
            break;
          }
          j += cierreLargo;
          continue;
        }
        j++;
      }
      if (encontroCierre) continue;
      i += largo;
      continue;
    }
    if (texto.startsWith(objetivo, i)) return i;
    i++;
  }
  return -1;
}

/** Extrae el último bloque no vacío entre `[[nota-compactar]]` y `[[/nota-compactar]]` de un texto (ignorando código inline y cercas). */
export function extraerNotaDeTexto(texto) {
  if (typeof texto !== "string" || !texto.includes(TAG_NOTA_ABRE)) return null;
  let hallada = null;
  let desde = 0;
  while (desde < texto.length) {
    const ini = buscarTagFueraDeCodigo(texto, TAG_NOTA_ABRE, desde);
    if (ini === -1) break;
    const despuesAbre = ini + TAG_NOTA_ABRE.length;
    const fin = buscarTagFueraDeCodigo(texto, TAG_NOTA_CIERRA, despuesAbre);
    if (fin === -1) break;
    const limpio = texto.slice(despuesAbre, fin).trim();
    if (limpio) hallada = limpio;
    desde = fin + TAG_NOTA_CIERRA.length;
  }
  return hallada;
}

const tsDe = (o) => {
  const t = typeof o?.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * Última nota escrita por el asistente en la cola del transcript (ignora subagentes y sintéticos).
 * `trasCompact`: en `SessionStart(compact)`, el `compact_boundary` de esta compactación ya está al final y se salta una vez.
 */
export function ultimaNotaDeLineas(lineas, { trasCompact = false } = {}) {
  let vioCompact = false;
  let idActual = null;
  let acum = "";
  let tsActual = null;
  const contarBoundariesHasta = (hasta) => {
    let n = 0;
    for (let k = 0; k <= hasta && k < lineas.length; k++) {
      try {
        const x = JSON.parse(lineas[k]);
        if (x && typeof x === "object" && x.isSidechain !== true && x.type === "system" && x.subtype === "compact_boundary") n++;
      } catch {}
    }
    return n;
  };
  const revisarAcum = (hastaIdx) => {
    const n = extraerNotaDeTexto(acum);
    return n ? { texto: n, tsMs: tsActual, ciclo: contarBoundariesHasta(hastaIdx) } : null;
  };
  for (let i = lineas.length - 1; i >= 0; i--) {
    let o;
    try {
      o = JSON.parse(lineas[i]);
    } catch {
      continue;
    }
    if (!o || typeof o !== "object" || o.isSidechain === true) continue;
    if (o.type === "system" && o.subtype === "compact_boundary") {
      const r = revisarAcum(i);
      if (r) return r;
      idActual = null;
      acum = "";
      tsActual = null;
      if (trasCompact && !vioCompact) {
        vioCompact = true;
        continue;
      }
      return null;
    }
    if (o.type !== "assistant" || o.isApiErrorMessage === true || o.message?.model === "<synthetic>") continue;
    const t = textoDeContenido(o.message?.content);
    if (!t) continue;
    const mid = typeof o.message?.id === "string" && o.message.id ? o.message.id : null;
    if (mid !== null && mid === idActual) {
      acum = `${t}\n${acum}`;
      tsActual ??= tsDe(o);
    } else {
      const r = revisarAcum(i);
      if (r) return r;
      idActual = mid;
      acum = t;
      tsActual = tsDe(o);
    }
  }
  return revisarAcum(-1);
}

function guardarNota(dirNotas, archivoNota, nota) {
  let actual = null;
  try {
    actual = readFileSync(archivoNota, "utf8");
  } catch {
    actual = null;
  }
  if (actual === nota) return false;
  mkdirSync(dirNotas, { recursive: true });
  const tmp = path.join(dirNotas, `.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    writeFileSync(tmp, nota, { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      /* en Windows el modo POSIX no aplica */
    }
    renameSync(tmp, archivoNota);
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* nada */
    }
    throw e;
  }
  return true;
}

const cargarTextos = () => import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "nota-compactar-textos.mjs")).href);

/** Lógica principal separada para tests (sin stdin ni salida del proceso). */
export async function decidir({
  evento,
  source,
  sesion,
  transcript,
  umbral = null,
  umbralTarea = null,
  hilos = estadoHilos(),
  ahoraMs = Date.now(),
  idioma,
  tailBytes = TAIL_BYTES,
  esSubagente = false,
}) {
  if (!SESION_OK.test(sesion || "")) return null;
  if (evento === "SessionStart" && source !== "compact") return null;
  if (!["PostToolUse", "UserPromptSubmit", "PreCompact", "SessionStart"].includes(evento)) return null;

  const dirNotas = path.join(hilos, "notas");
  const archivoMarca = path.join(dirNotas, `${sesion}.pedida`);
  const archivoSugerida = path.join(dirNotas, `${sesion}.sugerida`);
  const archivoNota = path.join(dirNotas, `${sesion}.md`);
  const archivoDevuelta = path.join(dirNotas, `${sesion}.devuelta.md`);
  const archivoFirma = path.join(dirNotas, `${sesion}.devuelta.firma`);
  const candadoDevuelta = path.join(dirNotas, `${sesion}.devuelta.lock.d`);
  const limpiarMarcas = () => {
    try {
      rmSync(archivoMarca, { force: true });
    } catch {
      /* nada */
    }
    try {
      rmSync(archivoSugerida, { force: true });
    } catch {
      /* nada */
    }
  };

  if (evento === "SessionStart") {
    limpiarMarcas();
    const lineas = leerColaTranscript(transcript, tailBytes);
    const hallada = ultimaNotaDeLineas(lineas, { trasCompact: true });
    let hayArchivo = false;
    try {
      hayArchivo = statSync(archivoNota).isFile();
    } catch {}
    if (!hayArchivo && !hallada) return null;

    let nota = "";
    let minutos = null;
    let archivo = "";
    let tieneCandado = false;
    try {
      mkdirSync(dirNotas, { recursive: true });
      const fin = Date.now() + 2000;
      for (;;) {
        try {
          mkdirSync(candadoDevuelta);
          tieneCandado = true;
          break;
        } catch (e) {
          if (e?.code !== "EEXIST" || Date.now() >= fin) break;
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
      }
    } catch {}
    try {
      try {
        const guardada = readFileSync(archivoNota, "utf8").trim();
        let mtime = null;
        try {
          mtime = statSync(archivoNota).mtimeMs;
        } catch {
          mtime = null;
        }
        if (guardada) {
          nota = guardada;
          minutos = mtime !== null ? Math.max(0, Math.floor((ahoraMs - mtime) / 60_000)) : null;
          try {
            rmSync(archivoDevuelta, { force: true });
            renameSync(archivoNota, archivoDevuelta);
            archivo = archivoDevuelta;
          } catch {
            archivo = archivoNota;
          }
          try {
            const firma = hallada ? `${hallada.ciclo ?? 0}:${hallada.texto}` : `md:${nota}`;
            writeFileSync(archivoFirma, firma, { mode: 0o600 });
          } catch {}
        } else {
          try {
            rmSync(archivoNota, { force: true });
          } catch {
            /* nada */
          }
        }
      } catch {
        /* sin archivo: cae al transcript */
      }
      if (!nota) {
        if (!hallada) return null;
        const firma = `${hallada.ciclo ?? 0}:${hallada.texto}`;
        let previa = null;
        try {
          previa = readFileSync(archivoFirma, "utf8");
        } catch {
          previa = null;
        }
        if (previa === firma) return null;
        try {
          mkdirSync(dirNotas, { recursive: true });
          writeFileSync(archivoFirma, firma, { mode: 0o600 });
        } catch {}
        nota = hallada.texto;
        let refMs = hallada.tsMs;
        if (refMs === null && typeof transcript === "string" && transcript) {
          try {
            refMs = statSync(transcript).mtimeMs;
          } catch {
            refMs = null;
          }
        }
        minutos = refMs !== null ? Math.max(0, Math.floor((ahoraMs - refMs) / 60_000)) : null;
      }
    } finally {
      if (tieneCandado) {
        try {
          rmdirSync(candadoDevuelta);
        } catch {}
      }
    }
    const { textoDevolucionNota } = await cargarTextos();
    return {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: textoDevolucionNota({ idioma: idioma ?? idiomaDeLaApp(hilos), nota, minutos, archivo }),
      },
    };
  }

  // El `PostToolUse` de un subagente no debe copiar notas ajenas ni gastar `.pedida`/`.sugerida`.
  if (esSubagente || rutaEsSubagente(transcript)) return null;

  const lineas = leerColaTranscript(transcript, tailBytes);
  const hallada = ultimaNotaDeLineas(lineas);
  if (hallada) {
    try {
      guardarNota(dirNotas, archivoNota, hallada.texto);
    } catch {
      /* mejor esfuerzo */
    }
  }
  if (evento === "PreCompact") return null;
  if (evento === "PostToolUse" && ultimaLineaEsSubagente(lineas)) return null;

  const conFuerte = typeof umbral === "number" && Number.isFinite(umbral) && umbral > 0;
  const conSuave = typeof umbralTarea === "number" && Number.isFinite(umbralTarea) && umbralTarea > 0;
  if (!conFuerte && !conSuave) return null;

  const uso = ultimoUsoDeLineas(lineas);
  if (
    uso.compactada ||
    (uso.tokens !== null && ((conFuerte && uso.tokens < umbral / 2) || (conSuave && uso.tokens < umbralTarea / 2)))
  ) {
    limpiarMarcas();
    return null;
  }
  if (uso.tokens === null) return null;

  const idiomaFinal = idioma ?? idiomaDeLaApp(hilos);
  const hookEventName = evento === "UserPromptSubmit" ? "UserPromptSubmit" : "PostToolUse";

  if (conFuerte && uso.tokens >= umbral) {
    try {
      mkdirSync(dirNotas, { recursive: true });
      writeFileSync(archivoMarca, `${Math.floor(ahoraMs / 1000)}\n`, { flag: "wx", mode: 0o600 });
    } catch {
      return null; // ya pedida en este ciclo (o sin dónde marcar: no repetir en cada turno)
    }
    const { textoPedidoNota } = await cargarTextos();
    return {
      hookSpecificOutput: {
        hookEventName,
        additionalContext: textoPedidoNota({ idioma: idiomaFinal }),
      },
    };
  }

  if (conSuave && uso.tokens >= umbralTarea) {
    try {
      mkdirSync(dirNotas, { recursive: true });
      writeFileSync(archivoSugerida, `${Math.floor(ahoraMs / 1000)}\n`, { flag: "wx", mode: 0o600 });
    } catch {
      return null;
    }
    const pct = conFuerte ? Math.min(99, Math.max(1, Math.round((uso.tokens * 85) / umbral))) : null;
    const { textoPedidoNotaSuave } = await cargarTextos();
    return {
      hookSpecificOutput: {
        hookEventName,
        additionalContext: textoPedidoNotaSuave({ idioma: idiomaFinal, pct }),
      },
    };
  }

  return null;
}

function main() {
  const { umbral, umbralTarea } = parsearArgs();
  let doc = {};
  try {
    doc = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  if (!doc || typeof doc !== "object") return;
  const esSubagente = Boolean(doc.agent_id || doc.parent_tool_use_id || rutaEsSubagente(doc.transcript_path));
  return decidir({
    evento: doc.hook_event_name,
    source: doc.source,
    sesion: doc.session_id,
    transcript: doc.transcript_path,
    umbral,
    umbralTarea,
    esSubagente,
  }).then((r) => {
    if (r) process.stdout.write(JSON.stringify(r) + "\n");
  });
}

// Como programa corre; importado (los tests) no hace nada.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  Promise.resolve()
    .then(main)
    .catch(() => {})
    .finally(() => process.exit(0));
}
