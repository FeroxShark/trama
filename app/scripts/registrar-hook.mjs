#!/usr/bin/env node
// Registra `scripts/hook-compactando.sh` en `~/.claude/settings.json` (PreCompact y PostCompact, con el mismo
// comando): sin eso trama no ve quién compacta (electron/compactando.ts). Lo llama `scripts/instalar.sh`; también
// se puede correr a mano. Idempotente: el hook queda una sola vez por evento, con la ruta de este checkout (si
// había otra, de un checkout viejo, la reemplaza). Los otros hooks y el resto del settings no se tocan. Si el
// archivo no es JSON válido no se lo toca y sale con 1. Si no cambia nada, no lo reescribe.
// uso: node scripts/registrar-hook.mjs [settings.json]   (default: $CLAUDE_CONFIG_DIR o ~/.claude, settings.json)
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(raiz, "scripts", "hook-compactando.sh");
const EVENTOS = ["PreCompact", "PostCompact"];
const MARCA = /hook-compactando\.sh/;

// Comillas simples si la ruta tiene algo que el shell de Claude Code podría partir (espacios, etc.).
const shq = (s) => (/^[\w./@+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const esNuestro = (h) => !!h && typeof h === "object" && typeof h.command === "string" && MARCA.test(h.command);

/** Deja nuestro hook una sola vez en la lista de grupos de un evento. Devuelve la lista y si cambió. */
function registrarEvento(grupos, command) {
  let cambio = false;
  let puesto = false;
  const salida = [];
  for (const grupo of grupos) {
    if (!grupo || typeof grupo !== "object" || !Array.isArray(grupo.hooks) || !grupo.hooks.some(esNuestro)) {
      salida.push(grupo);
      continue;
    }
    const hooks = [];
    for (const h of grupo.hooks) {
      if (!esNuestro(h)) {
        hooks.push(h);
        continue;
      }
      if (puesto) {
        cambio = true; // duplicado: sale
        continue;
      }
      puesto = true;
      if (h.command !== command) {
        h.command = command;
        cambio = true;
      }
      hooks.push(h);
    }
    if (hooks.length) salida.push({ ...grupo, hooks });
  }
  if (!puesto) {
    salida.push({ hooks: [{ type: "command", command }] });
    cambio = true;
  }
  return { grupos: salida, cambio };
}

/** Aplica el registro al objeto de settings (lo muta). Devuelve true si cambió algo. */
function registrar(ajustes, command) {
  if (ajustes.hooks === undefined) ajustes.hooks = {};
  if (!ajustes.hooks || typeof ajustes.hooks !== "object" || Array.isArray(ajustes.hooks)) {
    throw new Error("hooks no es un objeto");
  }
  let cambio = false;
  for (const evento of EVENTOS) {
    const actual = ajustes.hooks[evento];
    if (actual !== undefined && !Array.isArray(actual)) throw new Error(`hooks.${evento} no es una lista`);
    const r = registrarEvento(actual ?? [], command);
    if (r.cambio) {
      ajustes.hooks[evento] = r.grupos;
      cambio = true;
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
