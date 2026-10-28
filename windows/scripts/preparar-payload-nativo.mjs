// Deja en windows/payload-nativo/ el árbol del Trama nativo de Windows (sin WSL ni bash), por lista permitida
// (src/payload-nativo.js): la app compilada, los hooks .mjs, la skill, las plantillas, bin\*.cmd y un node.exe fijado por
// sha256. Falla si el resultado lleva un .sh o algo que invoque bash. Anda en Linux y en Windows (el job de CI lo corre en
// windows-latest); no usa bash.
//
// uso (con app/ ya compilada: npm run build en app/):
//   node scripts/preparar-payload-nativo.mjs [--node <node.exe ya bajado>]
// Sin --node baja el node.exe fijado (NODE en src/payload-nativo.js) a windows/.cache/ y lo verifica; TRAMA_NODE_EXE hace lo
// mismo que --node.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { NODE, EXCEPCIONES, armarPayload, revisarSinBash, sha256 } = require("../src/payload-nativo.js");

const aqui = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(aqui);
const destino = process.env.TRAMA_PAYLOAD_DEST || path.join(aqui, "payload-nativo");

function morir(m) {
  console.error(`preparar-payload-nativo: ${m}`);
  process.exit(1);
}

async function nodeExe() {
  const i = process.argv.indexOf("--node");
  const dado = i > 0 ? process.argv[i + 1] : process.env.TRAMA_NODE_EXE;
  const ruta = dado || path.join(aqui, ".cache", `node-${NODE.version}-win-x64.exe`);
  if (!dado && !existsSync(ruta)) {
    console.log(`bajando ${NODE.url}`);
    const r = await fetch(NODE.url);
    if (!r.ok) morir(`no pude bajar node.exe (${r.status})`);
    mkdirSync(path.dirname(ruta), { recursive: true });
    writeFileSync(`${ruta}.tmp`, Buffer.from(await r.arrayBuffer()));
    renameSync(`${ruta}.tmp`, ruta);
  }
  if (!existsSync(ruta)) morir(`no existe ${ruta}`);
  const h = sha256(ruta);
  if (h !== NODE.sha256) morir(`el sha256 de ${ruta} no es el fijado para ${NODE.version}:\n  esperado ${NODE.sha256}\n  tiene    ${h}`);
  return ruta;
}

let r;
try {
  r = armarPayload({ repo, destino, nodeExe: await nodeExe() });
} catch (e) {
  morir(e.message);
}
const { problemas, sobran } = revisarSinBash(destino);
if (problemas.length) morir(`el payload de Windows no puede llevar bash:\n${problemas.map((p) => `  ${p.archivo}: ${p.problema}`).join("\n")}`);
for (const s of sobran) console.log(`aviso: la excepción de ${s} ya no hace falta (sacala de EXCEPCIONES en src/payload-nativo.js)`);
for (const e of EXCEPCIONES.filter((x) => !sobran.includes(x.archivo))) console.log(`pendiente: ${e.archivo}: ${e.motivo}`);
console.log(`herramientas en bin\\: ${r.herramientas.join(", ") || "ninguna"}${r.faltan.length ? ` (todavía sin portar: ${r.faltan.join(", ")})` : ""}`);
console.log(`payload-nativo: ${r.version} (node ${NODE.version}) en ${destino}`);
