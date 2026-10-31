import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fijarApagadoTrama } from "../electron/apagados.ts";
import { carpetaSkillsDe, sincronizarSkillsParaMotor, skillsClaude, type MotorSkills } from "../electron/cli/pa/skills-motores.ts";
import { configTrama } from "../electron/rutas.ts";

const MOTORES: MotorSkills[] = ["agy", "codex", "opencode"];

/** Un SKILL.md inventado. */
function escribirSkill(dir: string, nombre: string, cuerpo = `# ${nombre}`) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${nombre}\ndescription: skill ${nombre} inventada\n---\n\n${cuerpo}\n`);
}

/** Una casa inventada: `~/.claude/skills` con `alfa` y `beta`, y un plugin habilitado (`ejemplo@mercado`) con la skill `pulido`. */
function casa() {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "skills-motores-"));
  const home = path.join(raiz, "ana");
  const claude = path.join(home, ".claude");
  const env = { HOME: home, XDG_CONFIG_HOME: path.join(home, ".config") };
  escribirSkill(path.join(claude, "skills", "alfa"), "alfa");
  escribirSkill(path.join(claude, "skills", "beta"), "beta");
  const instalado = path.join(claude, "plugins", "cache", "mercado", "ejemplo", "1.0.0");
  escribirSkill(path.join(instalado, "skills", "pulido"), "pulido");
  writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ enabledPlugins: { "ejemplo@mercado": true } }));
  writeFileSync(
    path.join(claude, "plugins", "installed_plugins.json"),
    JSON.stringify({ version: 2, plugins: { "ejemplo@mercado": [{ scope: "user", installPath: instalado, version: "1.0.0" }] } }),
  );
  return { raiz, home, env, claude, dir: configTrama(env, home, "linux") };
}

/** Qué hay en `dir`: nombre, inodo y, si es enlace, a dónde apunta. Para ver que una segunda corrida no toca nada. */
const estado = (dir: string) =>
  readdirSync(dir)
    .sort()
    .map((n) => {
      const st = lstatSync(path.join(dir, n));
      return [n, st.ino, st.isSymbolicLink() ? readlinkSync(path.join(dir, n)) : "-"];
    });

test("dos skills, una apagada: en cada motor aparece sólo la otra, como enlace", () => {
  const c = casa();
  fijarApagadoTrama("skills", "beta", true, c.dir);
  for (const motor of MOTORES) {
    const r = sincronizarSkillsParaMotor(motor, c.env, c.home, "linux");
    const destino = carpetaSkillsDe(motor, c.env, c.home, "linux");
    assert.deepEqual(readdirSync(destino).sort(), ["alfa", "pulido"], motor);
    assert.deepEqual([...r.creadas].sort(), ["alfa", "pulido"], motor);
    assert.ok(lstatSync(path.join(destino, "alfa")).isSymbolicLink(), motor);
    assert.match(readFileSync(path.join(destino, "alfa", "SKILL.md"), "utf8"), /# alfa/, motor);
    assert.equal(r.fallidas.length, 0, motor);
  }
});

test("segunda corrida sin cambios: no crea, no quita y no recrea ningún enlace", () => {
  const c = casa();
  fijarApagadoTrama("skills", "beta", true, c.dir);
  for (const motor of MOTORES) sincronizarSkillsParaMotor(motor, c.env, c.home, "linux");
  for (const motor of MOTORES) {
    const destino = carpetaSkillsDe(motor, c.env, c.home, "linux");
    const antes = estado(destino);
    const r = sincronizarSkillsParaMotor(motor, c.env, c.home, "linux");
    assert.deepEqual(r, { creadas: [], actualizadas: [], quitadas: [], respetadas: [], fallidas: [] }, motor);
    assert.deepEqual(estado(destino), antes, motor);
  }
});

test("un archivo, carpeta o enlace del usuario con el nombre de una skill no se pisa", () => {
  const c = casa();
  const destino = carpetaSkillsDe("codex", c.env, c.home, "linux");
  const mio = path.join(c.raiz, "mio");
  escribirSkill(path.join(destino, "alfa"), "alfa", "versión propia");
  mkdirSync(mio, { recursive: true });
  symlinkSync(mio, path.join(destino, "pulido"), "dir");
  writeFileSync(path.join(destino, "notas.md"), "mías\n");
  symlinkSync(mio, path.join(destino, "ajena"), "dir");
  const r = sincronizarSkillsParaMotor("codex", c.env, c.home, "linux");
  assert.deepEqual(r.respetadas.sort(), ["alfa", "pulido"]);
  assert.deepEqual(r.creadas, ["beta"]);
  assert.match(readFileSync(path.join(destino, "alfa", "SKILL.md"), "utf8"), /versión propia/);
  assert.equal(readlinkSync(path.join(destino, "pulido")), mio);
  assert.equal(readFileSync(path.join(destino, "notas.md"), "utf8"), "mías\n");
  assert.equal(readlinkSync(path.join(destino, "ajena")), mio);
});

test("prender y apagar después: el enlace aparece o se quita, sin tocar el resto", () => {
  const c = casa();
  fijarApagadoTrama("skills", "beta", true, c.dir);
  sincronizarSkillsParaMotor("agy", c.env, c.home, "linux");
  const destino = carpetaSkillsDe("agy", c.env, c.home, "linux");
  fijarApagadoTrama("skills", "beta", false, c.dir);
  assert.deepEqual(sincronizarSkillsParaMotor("agy", c.env, c.home, "linux").creadas, ["beta"]);
  fijarApagadoTrama("skills", "alfa", true, c.dir);
  assert.deepEqual(sincronizarSkillsParaMotor("agy", c.env, c.home, "linux").quitadas, ["alfa"]);
  assert.deepEqual(readdirSync(destino).sort(), ["beta", "pulido"]);
  // la skill que se quitó es sólo el enlace: la original de Claude sigue ahí
  assert.match(readFileSync(path.join(c.claude, "skills", "alfa", "SKILL.md"), "utf8"), /# alfa/);
});

test("la skill de un plugin va con clave plugin:skill y se apaga con esa clave", () => {
  const c = casa();
  const { skills, raices } = skillsClaude(c.claude);
  assert.deepEqual(skills.map((s) => s.clave).sort(), ["alfa", "beta", "ejemplo:pulido"]);
  assert.ok(raices.some((r) => r.endsWith("1.0.0")), "la carpeta del plugin es raíz");
  fijarApagadoTrama("skills", "ejemplo:pulido", true, c.dir);
  sincronizarSkillsParaMotor("codex", c.env, c.home, "linux");
  assert.deepEqual(readdirSync(carpetaSkillsDe("codex", c.env, c.home, "linux")).sort(), ["alfa", "beta"]);
});

test("las rutas de cada motor: agy en ~/.gemini/config, codex en $CODEX_HOME o ~/.codex, opencode en su config", () => {
  assert.equal(carpetaSkillsDe("agy", {}, "/h/ana", "linux"), "/h/ana/.gemini/config/skills");
  assert.equal(carpetaSkillsDe("codex", {}, "/h/ana", "linux"), "/h/ana/.codex/skills");
  assert.equal(carpetaSkillsDe("codex", { CODEX_HOME: "/otro" }, "/h/ana", "linux"), "/otro/skills");
  assert.equal(carpetaSkillsDe("opencode", {}, "/h/ana", "linux"), "/h/ana/.config/opencode/skills");
  assert.equal(carpetaSkillsDe("opencode", { XDG_CONFIG_HOME: "/xdg" }, "/h/ana", "linux"), "/xdg/opencode/skills");
  assert.equal(carpetaSkillsDe("agy", {}, "C:\\Users\\ana", "win32"), path.win32.join("C:\\Users\\ana", ".gemini", "config", "skills"));
});
