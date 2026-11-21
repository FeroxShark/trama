#!/usr/bin/env node
// Registra `scripts/hook-compactando.sh` (PreCompact y PostCompact) y `motor/hooks/nota-compactar.mjs` (los 4 eventos)
// en `~/.claude/settings.json` para los líderes de terminal. Si `nota_compactar` es `false` en `modelos.json`, saca
// `nota-compactar.mjs` del settings. Idempotente, atómico y sin pisar otros hooks ni cambiar permisos del settings.
// uso: node scripts/registrar-hook.mjs [settings.json]   (default: $CLAUDE_CONFIG_DIR o ~/.claude, settings.json)
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(raiz, "scripts", "hook-compactando.sh");
const EVENTOS = ["PreCompact", "PostCompact"];
const MARCA = /hook-compactando\.sh/;

const notaHookCandidatos = [
  path.resolve(raiz, "..", "motor", "hooks", "nota-compactar.mjs"),
  path.join(raiz, "motor", "hooks", "nota-compactar.mjs"),
];
const EVENTOS_NOTA = [
  { evento: "PostToolUse" },
  { evento: "UserPromptSubmit" },
  { evento: "PreCompact" },
  { evento: "SessionStart", matcher: "compact" },
];
const MARCA_NOTA = /nota-compactar\.mjs/;

// Comillas simples si la ruta tiene algo que el shell de Claude Code podría partir (espacios, etc.).
const shq = (s) => (/^[\w./@+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const esNuestro = (h) => !!h && typeof h === "object" && typeof h.command === "string" && MARCA.test(h.command);
const esNuestroNota = (h) => !!h && typeof h === "object" && typeof h.command === "string" && MARCA_NOTA.test(h.command);

function leerJson(ruta) {
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return null;
  }
}

function rutaModelos(env = process.env) {
  if (env.TRAMA_MODELOS) return env.TRAMA_MODELOS;
  if (env.HILOS_MODELOS) return env.HILOS_MODELOS;
  const cfg = env.XDG_CONFIG_HOME || path.join(env.HOME || homedir(), ".config");
  return path.join(cfg, "trama", "modelos.json");
}

function umbralesDesdeModelos(env = process.env) {
  const c = leerJson(rutaModelos(env));
  const activo = c && typeof c === "object" ? c.nota_compactar !== false : true;
  if (!activo) return { activo: false, fuerte: null, suave: null };
  const modelo = typeof c?.lider?.modelo === "string" && c.lider.modelo ? c.lider.modelo : "claude-opus-5-5";
  const ventana = /\[1m\]/i.test(modelo) || /^claude-[a-z]+-5(?:[-.]|$)/.test(modelo) ? 1_000_000 : 200_000;
  const pctRaw = c?.nota_compactar_pct;
  const pct = typeof pctRaw === "number" && Number.isInteger(pctRaw) && pctRaw >= 50 && pctRaw <= 95 ? pctRaw : 85;
  const tRaw = c?.nota_compactar_tarea_pct;
  const tareaPct =
    tRaw === 0 || (typeof tRaw === "number" && Number.isInteger(tRaw) && tRaw >= 30 && tRaw <= 90) ? tRaw : 60;
  const ac = c?.autocompact_lider ?? c?.autocompact;
  let tope = null;
  if (ac && typeof ac === "object") {
    const por = ac.por_modelo && typeof ac.por_modelo === "object" ? ac.por_modelo : {};
    const mLower = modelo.toLowerCase();
    const fam = ["fable", "opus", "sonnet", "haiku"].find((f) => mLower.includes(f)) ?? null;
    const cand = por[modelo] ?? (fam ? por[fam] : undefined) ?? ac.defecto;
    if (typeof cand === "number" && Number.isFinite(cand) && cand >= 100_000 && cand <= 1_000_000) tope = Math.round(cand);
  }
  const base = tope ? Math.min(tope, ventana) : ventana;
  const pctFuerte = tope ? pct : Math.min(pct, 75);
  const fuerte = Math.max(1, Math.round(base * (pctFuerte / 100)));
  if (tareaPct === 0) return { activo: true, fuerte, suave: null };
  const bruto = Math.round(base * (tareaPct / 100));
  const suave = bruto < fuerte ? Math.max(1, bruto) : Math.max(1, Math.min(fuerte - 1, Math.round(base * (Math.max(1, pctFuerte - 5) / 100))));
  return { activo: true, fuerte, suave };
}

/** Deja un hook nuestro una sola vez en la lista de grupos de un evento (matcheando `esMio` y opcionalmente `matcher`). */
function registrarEvento(grupos, command, { esMio, matcher, timeout } = {}) {
  let cambio = false;
  let puesto = false;
  const salida = [];
  for (const grupo of grupos) {
    if (!grupo || typeof grupo !== "object" || !Array.isArray(grupo.hooks) || !grupo.hooks.some(esMio)) {
      salida.push(grupo);
      continue;
    }
    if (matcher && grupo.matcher !== matcher) {
      // Matcher distinto del pedido: sacamos nuestras entradas de acá para dejarlo limpio.
      const quedan = grupo.hooks.filter((h) => !esMio(h));
      if (quedan.length) salida.push({ ...grupo, hooks: quedan });
      cambio = true;
      continue;
    }
    const hooks = [];
    for (const h of grupo.hooks) {
      if (!esMio(h)) {
        hooks.push(h);
        continue;
      }
      if (puesto) {
        cambio = true;
        continue;
      }
      puesto = true;
      if (h.command !== command) {
        h.command = command;
        cambio = true;
      }
      if (timeout && h.timeout !== timeout) {
        h.timeout = timeout;
        cambio = true;
      }
      hooks.push(h);
    }
    if (hooks.length) salida.push({ ...grupo, hooks });
  }
  if (!puesto) {
    const entrada = { type: "command", command, ...(timeout ? { timeout } : {}) };
    salida.push(matcher ? { matcher, hooks: [entrada] } : { hooks: [entrada] });
    cambio = true;
  }
  return { grupos: salida, cambio };
}

function sacarEvento(grupos, esMio) {
  let cambio = false;
  const salida = [];
  for (const grupo of grupos) {
    if (!grupo || typeof grupo !== "object" || !Array.isArray(grupo.hooks) || !grupo.hooks.some(esMio)) {
      salida.push(grupo);
      continue;
    }
    cambio = true;
    const hooks = grupo.hooks.filter((h) => !esMio(h));
    if (hooks.length) salida.push({ ...grupo, hooks });
  }
  return { grupos: salida, cambio };
}

/** Aplica el registro al objeto de settings (lo muta). Devuelve true si cambió algo. */
function registrar(ajustes, command, env = process.env) {
  if (ajustes.hooks === undefined) ajustes.hooks = {};
  if (!ajustes.hooks || typeof ajustes.hooks !== "object" || Array.isArray(ajustes.hooks)) {
    throw new Error("hooks no es un objeto");
  }
  let cambio = false;
  for (const evento of EVENTOS) {
    const actual = ajustes.hooks[evento];
    if (actual !== undefined && !Array.isArray(actual)) throw new Error(`hooks.${evento} no es una lista`);
    const r = registrarEvento(actual ?? [], command, { esMio: esNuestro });
    if (r.cambio) {
      ajustes.hooks[evento] = r.grupos;
      cambio = true;
    }
  }
  const notaHook = notaHookCandidatos.find((p) => existsSync(p));
  if (notaHook) {
    const u = umbralesDesdeModelos(env);
    const cmdNota = u.activo
      ? `${shq(process.execPath)} ${shq(notaHook)} --umbral ${u.fuerte}${u.suave ? ` --umbral-tarea ${u.suave}` : ""}`
      : null;
    for (const e of EVENTOS_NOTA) {
      const actual = ajustes.hooks[e.evento];
      if (actual !== undefined && !Array.isArray(actual)) throw new Error(`hooks.${e.evento} no es una lista`);
      if (cmdNota) {
        const r = registrarEvento(actual ?? [], cmdNota, { esMio: esNuestroNota, matcher: e.matcher, timeout: 10 });
        if (r.cambio) {
          ajustes.hooks[e.evento] = r.grupos;
          cambio = true;
        }
      } else if (actual) {
        const r = sacarEvento(actual, esNuestroNota);
        if (r.cambio) {
          if (r.grupos.length) ajustes.hooks[e.evento] = r.grupos;
          else delete ajustes.hooks[e.evento];
          cambio = true;
        }
      }
    }
  }
  return cambio;
}

function main() {
  const destino =
    process.argv[2] ?? path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"), "settings.json");
  if (!existsSync(hook)) fail(`no existe ${hook}`);

  // Si el settings es un enlace (dotfiles), se escribe el archivo real: no se reemplaza el enlace.
  const real = existsSync(destino) ? realpathSync(destino) : destino;
  const existe = existsSync(real);
  let ajustes = {};
  if (existe) {
    const texto = readFileSync(real, "utf8");
    if (texto.trim() !== "") {
      try {
        ajustes = JSON.parse(texto);
      } catch {
        fail(`${destino} no es JSON válido; no lo toqué`);
      }
    }
    if (!ajustes || typeof ajustes !== "object" || Array.isArray(ajustes)) fail(`${destino} no es un objeto JSON`);
  }

  let cambio;
  try {
    cambio = registrar(ajustes, shq(hook));
  } catch (e) {
    fail(`${destino}: ${e.message}; no lo toqué`);
  }
  if (!cambio) {
    console.log(`hook de compactando ya registrado en ${destino}`);
    return;
  }

  // Escritura atómica, con el modo del archivo de antes (el settings puede tener secretos: no se abre más amplio).
  mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.${process.pid}.tmp`;
  const modo = existe ? statSync(real).mode & 0o777 : 0o600;
  writeFileSync(tmp, `${JSON.stringify(ajustes, null, 2)}\n`, { mode: modo });
  renameSync(tmp, real);
  console.log(`hook de compactando registrado en ${destino} (${EVENTOS.join(", ")})`);
}

function fail(msg) {
  console.error(`registrar-hook: ${msg}`);
  process.exit(1);
}

main();
