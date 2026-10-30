// El panel derecho de contexto en el main: junta lo que hace falta para cada canal (`contexto:desglose`, `skills:catalogo`,
// `apagados:leer` y `apagados:fijar`). Lo puro está en contexto-desglose.ts, skills-catalogo.ts y apagados.ts; acá se leen los
// transcripts, el inventario de Claude Code y el proceso del líder. Nunca lee ni devuelve credenciales (`~/.claude.json` no se toca: el
// inventario sólo saca nombres, y enmascarados).
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fijarApagadoTrama, HERRAMIENTAS_PROTEGIDAS, leerApagadosTrama, TIPOS_APAGADO, type Apagados } from "./apagados.ts";
import { inventario, rutasClaude } from "./conectores-claude.ts";
import { sidDeWorker, transcriptDe as transcriptPorSid, TRANSCRIPTS } from "./consumo.ts";
import { cwdDe, desdeClaude, desdeTranscript, memoriaDeSesion, sinDesglose, usosDe, type Desglose } from "./contexto-desglose.ts";
import { errorT } from "./errores.ts";
import { aplicarApagadosLideres, claseDeLider, contextoVivo, transcriptDe as transcriptDeLider } from "./lider.ts";
import { PA_STATE } from "./pa.ts";
import { buscarSkills, catalogoSkills, type SkillCatalogo } from "./skills-catalogo.ts";

const SID = /^[0-9a-f-]{36}$/;
const ID_WORKER = /^[\w.@-]{1,120}$/;

const lineas = async (f: string | null) => (f ? (await readFile(f, "utf8").catch(() => "")).split("\n").filter(Boolean) : []);

/** Las skills que carga una sesión en `cwd` (estimado): las prendidas del usuario, de plugins y de claude.ai, y las de ese proyecto. */
async function skillsDeSesion(cwd: string | null, apagados: Apagados) {
  const inv = await inventario(rutasClaude());
  const dentro = (de: string) => !!cwd && (cwd === de || cwd.startsWith(de + path.sep));
  return catalogoSkills(inv, apagados)
    .filter((s) => s.estado === "activa" && (s.origen !== "proyecto" || dentro(s.de)))
    .map((s) => ({ nombre: s.clave, origen: s.origen, plugin: s.origen === "plugin" || s.origen === "claudeai" ? s.de : null, tokens: s.tokens }));
}

/**
 * El desglose de un líder (`{ lider: sid }`) o de un worker de `pa` (`{ worker: id }`). Líder de Claude vivo: su `/context` (exacto). Si no:
 * su transcript (estimado). Gemini, dsh y OpenCode: sin desglose.
 */
export async function desgloseContexto(x: unknown): Promise<Desglose> {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  const apagados = leerApagadosTrama();
  const claudeDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  if (typeof o.lider === "string") {
    const sid = o.lider;
    if (!SID.test(sid)) throw errorT("main.sesionRara", { v: sid.slice(0, 80) });
    const l = await claseDeLider(sid);
    const motor = l ? (l.local ? "local" : l.clase) : "claude";
    if (l && l.clase !== "claude") return sinDesglose({ tipo: "lider", id: sid, motor, modelo: l.modelo });
    const t = await transcriptDeLider(sid, l?.cwd).catch(() => null);
    const ls = await lineas(t);
    const vivo = l && !l.local ? await contextoVivo(sid) : null;
    if (vivo) return desdeClaude(vivo, { id: sid, usos: usosDe(ls) });
    if (!ls.length) return sinDesglose({ tipo: "lider", id: sid, motor, modelo: l?.modelo, motivo: "sin-transcript" });
    const cwd = cwdDe(ls) ?? l?.cwd ?? os.homedir();
    const memoria = await memoriaDeSesion({ cwd, claudeDir, excludes: apagados.memoria });
    return desdeTranscript(ls, { tipo: "lider", id: sid, motor, memoria, skills: l?.local ? [] : await skillsDeSesion(cwd, apagados) });
  }
  if (typeof o.worker === "string") {
    const id = o.worker;
    if (!ID_WORKER.test(id)) throw errorT("main.apagadoRaro", { v: id.slice(0, 80) });
    const sid = await sidDeWorker(PA_STATE, id);
    const t = sid ? await transcriptPorSid(TRANSCRIPTS, sid) : null;
    const ls = await lineas(t);
    // Sin transcript de Claude: un worker de otro motor (agy, dsh, OpenCode) o uno que todavía no arrancó.
    if (!ls.length) return sinDesglose({ tipo: "worker", id, motor: sid ? "claude" : "otro", motivo: sid ? "sin-transcript" : "motor-sin-desglose" });
    const cwd = cwdDe(ls) ?? os.homedir();
    // `pa` le saca al worker el CLAUDE.md del home (`claudeMdExcludes` de su --settings), además de lo que apagó Trama.
    const memoria = await memoriaDeSesion({ cwd, claudeDir, excludes: [path.join(os.homedir(), "CLAUDE.md"), ...apagados.memoria] });
    return desdeTranscript(ls, { tipo: "worker", id, motor: "claude", memoria, skills: await skillsDeSesion(cwd, apagados) });
  }
  throw errorT("main.apagadoRaro", { v: "?" });
}

export type Catalogo = { version: 1; skills: SkillCatalogo[]; total: number; exactos: boolean };

/** El catálogo de skills, filtrado por `q`. Con `sid` de un líder de Claude vivo, los tokens de cada skill son los que dice él. */
export async function catalogoContexto(x: unknown): Promise<Catalogo> {
  const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
  const exactos = new Map<string, number>();
  if (typeof o.sid === "string" && SID.test(o.sid)) {
    const r = (await contextoVivo(o.sid).catch(() => null)) as { skills?: { skillFrontmatter?: { name?: unknown; tokens?: unknown }[] } } | null;
    for (const s of r?.skills?.skillFrontmatter ?? []) if (typeof s.name === "string" && typeof s.tokens === "number") exactos.set(s.name, s.tokens);
  }
  const todas = catalogoSkills(await inventario(rutasClaude()), leerApagadosTrama(), exactos);
  return { version: 1, skills: buscarSkills(todas, o.q), total: todas.length, exactos: exactos.size > 0 };
}

export type VistaApagados = {
  version: 1;
  apagados: Apagados;
  tipos: readonly string[];
  /** Herramientas que no se dejan apagar. */
  protegidas: readonly string[];
  /** En qué motores se aplica: sólo Claude (workers y líderes); los otros no cargan skills ni memoria de Claude Code. */
  motores: { claude: true; gemini: false; dsh: false; opencode: false; ollama: false; local: false };
};

const vista = (a: Apagados): VistaApagados => ({
  version: 1,
  apagados: a,
  tipos: TIPOS_APAGADO,
  protegidas: HERRAMIENTAS_PROTEGIDAS,
  motores: { claude: true, gemini: false, dsh: false, opencode: false, ollama: false, local: false },
});

export const leerApagadosPanel = (): VistaApagados => vista(leerApagadosTrama());

/**
 * Apaga o prende una cosa para todo Trama. Los workers que se lancen desde ya lo toman (va en su `--settings`); los líderes de Claude se
 * relanzan sin perder la conversación (`aplicarApagadosLideres`): `aviso: "proximo-mensaje"` para que la vista lo diga.
 */
export async function fijarApagadoPanel(tipo: unknown, nombre: unknown, apagado: unknown): Promise<VistaApagados & { lideres: { reiniciados: number; pendientes: number }; aviso: "proximo-mensaje" }> {
  const antes = JSON.stringify(leerApagadosTrama());
  const a = fijarApagadoTrama(tipo, nombre, apagado);
  // Si ya estaba así, no se relanza a nadie.
  const lideres = JSON.stringify(a) === antes ? { reiniciados: 0, pendientes: 0 } : await aplicarApagadosLideres();
  return { ...vista(a), lideres, aviso: "proximo-mensaje" };
}
