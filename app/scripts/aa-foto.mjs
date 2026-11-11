// `node scripts/aa-foto.mjs [caché] [salida]`: saca una foto de la caché de Artificial Analysis del dueño (la que baja la app con su
// API key: <estado>/reparto/aa-modelos.json) a motor/datos/aa-foto.json. Es lo que `reparto` usa cuando no hay caché (sin key), así
// hay curva por esfuerzo igual. Sólo copia campos de datos de cada modelo: nada de claves ni de lo que no sea el índice.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const estado = process.env.PA_STATE || path.join(os.homedir(), ".local", "state", "pa");
const origen = process.argv[2] || process.env.REPARTO_AA || path.join(process.env.REPARTO_STATE || path.join(estado, "reparto"), "aa-modelos.json");
const destino = process.argv[3] || path.join(RAIZ, "motor", "datos", "aa-foto.json");
const CAMPOS = ["name", "slug", "creator", "intelligence", "coding", "agentic", "cost", "tokens", "time"];

const j = JSON.parse(readFileSync(origen, "utf8"));
if (!Array.isArray(j.modelos) || !Number.isFinite(Date.parse(j.fetched))) throw new Error(`${origen}: no es una caché de Artificial Analysis (modelos/fetched)`);
const modelos = j.modelos
  .filter((m) => m && typeof m === "object" && typeof m.intelligence === "number")
  .map((m) => Object.fromEntries(CAMPOS.filter((c) => m[c] !== undefined && m[c] !== null).map((c) => [c, m[c]])));
if (!modelos.length) throw new Error(`${origen}: ningún modelo con índice de inteligencia`);

const foto = { fecha: new Date(j.fetched).toISOString().slice(0, 10), fuente: "artificialanalysis.ai (API), foto de la caché del dueño", modelos };
mkdirSync(path.dirname(destino), { recursive: true });
const tmp = `${destino}.${process.pid}.tmp`;
writeFileSync(tmp, JSON.stringify(foto, null, 1) + "\n");
renameSync(tmp, destino);
console.log(`${destino}: ${modelos.length} modelos, datos del ${foto.fecha}`);
