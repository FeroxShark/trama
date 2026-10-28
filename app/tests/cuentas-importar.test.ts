// `cuentas importar-perfiles` (electron/cli/cuentas.ts): trae las cuentas de Claude de una Trama vieja (perfiles_claude/) con perfiles
// falsos (emails y tokens inventados). Importa, no duplica en la segunda corrida, no toca los originales y no imprime secretos.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../electron/cli/cuentas.ts";
import { testPosix } from "./plataforma.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-importar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const TOKENS = ["sk-ant-INVENTADO-ana", "sk-ant-INVENTADO-bruno", "sk-ant-INVENTADO-huerfana", "sk-ant-r-INVENTADO-ana"];

function escribir(f: string, t: string) {
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, t);
}

/** Un home con una Trama vieja: ana y bruno en perfiles.json, una carpeta huérfana y una sin credenciales. */
function banco() {
  const raiz = mkdtempSync(path.join(tmp, "b-"));
  const home = path.join(raiz, "home");
  const viejo = path.join(home, ".local", "state", "hilos", "perfiles_claude");
  const perfil = (id: string, email: string, token: string | null) => {
    if (token) escribir(path.join(viejo, id, ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: token, refreshToken: "sk-ant-r-INVENTADO-ana" } }));
    escribir(path.join(viejo, id, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: email } }));
  };
  perfil("cuenta_1", "ana@example.com", TOKENS[0]!);
  perfil("cuenta_2", "bruno@example.com", TOKENS[1]!);
  perfil("huerfana", "huerfana@example.com", TOKENS[2]!);
  perfil("cuenta_3", "sin@example.com", null);
  escribir(
    path.join(viejo, "perfiles.json"),
    JSON.stringify({
      version: 1,
      activa: "cuenta_1",
      cuentas: [
        { id: "cuenta_1", email: "ana@example.com", nombre: "ana@example.com", activa: true, creada: 1 },
        { id: "cuenta_2", email: "bruno@example.com", nombre: "Trabajo", activa: false, creada: 2 },
        { id: "cuenta_3", email: "sin@example.com", nombre: "Sin credenciales", activa: false, creada: 3 },
      ],
    }),
  );
  const env = { HOME: home, TRAMA_CUENTAS_HOME: home, TRAMA_CUENTAS: path.join(raiz, "config", "cuentas.json"), PATH: "/usr/bin:/bin" };
  const correr = async (...args: string[]) => {
    let out = "";
    let err = "";
    const rc = await main(args, env, { out: (s) => void (out += s), err: (s) => void (err += s) });
    return { rc, out, err };
  };
  const registro = () => (JSON.parse(readFileSync(env.TRAMA_CUENTAS, "utf8")) as { cuentas: Record<string, string>[] }).cuentas;
  return { raiz, home, viejo, env, correr, registro };
}

/** Contenido, permisos y fecha de cada archivo bajo `d`: para ver que una corrida no tocó nada. */
function huella(d: string): string[] {
  const out: string[] = [];
  const ir = (x: string) => {
    for (const n of readdirSync(x).sort()) {
      const f = path.join(x, n);
      const st = statSync(f);
      if (st.isDirectory()) ir(f);
      else out.push(`${path.relative(d, f)} ${st.mode & 0o777} ${st.mtimeMs} ${createHash("sha256").update(readFileSync(f)).digest("hex")}`);
    }
  };
  ir(d);
  return out;
}

test("importa cada perfil con credenciales y deja su carpeta con .credentials.json y .claude.json", async () => {
  const b = banco();
  const r = await b.correr("importar-perfiles");
  assert.equal(r.rc, 0);
  assert.match(r.out, /importada: ana-example-com \(ana@example\.com\)/);
  assert.match(r.out, /importada: trabajo \(Trabajo\)/);
  assert.match(r.out, /importada: huerfana-example-com \(huerfana@example\.com\)/);
  assert.match(r.out, /salteada: cuenta_3/);
  assert.match(r.out, /importadas: 3\n$/);
  const ids = b.registro().map((c) => c.id);
  assert.deepEqual(ids, ["ana-example-com", "trabajo", "huerfana-example-com"]);
  assert.equal(b.registro()[1]!.email, "bruno@example.com");
  const carpeta = path.join(b.raiz, "config", "cuentas", "trabajo");
  assert.equal(readFileSync(path.join(carpeta, ".credentials.json"), "utf8"), readFileSync(path.join(b.viejo, "cuenta_2", ".credentials.json"), "utf8"));
  assert.equal(readFileSync(path.join(carpeta, ".claude.json"), "utf8"), readFileSync(path.join(b.viejo, "cuenta_2", ".claude.json"), "utf8"));
  // la cuenta importada es una cuenta de Claude más: `env` la apunta a su carpeta
  const env = await b.correr("env", "trabajo");
  assert.match(env.out, new RegExp(`CLAUDE_CONFIG_DIR=${carpeta.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

testPosix("las credenciales copiadas quedan sólo para el usuario (0600, carpeta 0700)", async () => {
  const b = banco();
  await b.correr("importar-perfiles");
  const carpeta = path.join(b.raiz, "config", "cuentas", "ana-example-com");
  assert.equal(statSync(path.join(carpeta, ".credentials.json")).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(carpeta, ".claude.json")).mode & 0o777, 0o600);
  assert.equal(statSync(carpeta).mode & 0o777, 0o700);
});

test("la segunda corrida no duplica nada (mismo email) y no cambia el registro", async () => {
  const b = banco();
  await b.correr("importar-perfiles");
  const antes = readFileSync(b.env.TRAMA_CUENTAS, "utf8");
  const r = await b.correr("importar-perfiles", "--json");
  assert.equal(r.rc, 0);
  assert.deepEqual(JSON.parse(r.out), { importadas: 0, omitidas: 4, cuentas: [] });
  assert.equal(readFileSync(b.env.TRAMA_CUENTAS, "utf8"), antes);
});

test("una cuenta que ya existe con ese email (aunque se llame distinto, o sea la de siempre) no se vuelve a crear", async () => {
  const b = banco();
  await b.correr("agregar", "claude", "Mi trabajo", "--id", "mio");
  escribir(path.join(b.raiz, "config", "cuentas", "mio", ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "BRUNO@example.com" } }));
  escribir(path.join(b.home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "huerfana@example.com" } }));
  const r = await b.correr("importar-perfiles", "--json");
  assert.deepEqual(JSON.parse(r.out), { importadas: 1, omitidas: 3, cuentas: ["ana-example-com"] });
});

test("no toca los originales: ni borra, ni mueve, ni cambia contenido, permisos o fecha", async () => {
  const b = banco();
  const antes = huella(b.viejo);
  await b.correr("importar-perfiles");
  await b.correr("importar-perfiles");
  assert.deepEqual(huella(b.viejo), antes);
});

test("no imprime el contenido de las credenciales (ni en texto, ni en --json, ni por stderr)", async () => {
  const b = banco();
  const todo = [await b.correr("importar-perfiles"), await b.correr("importar-perfiles", "--json"), await b.correr("listar", "--json")];
  for (const r of todo) for (const t of TOKENS) assert.ok(!(r.out + r.err).includes(t), `se coló ${t}`);
  assert.ok(!readFileSync(b.env.TRAMA_CUENTAS, "utf8").includes("INVENTADO"));
});

test("--dir importa de otra carpeta; sin la carpeta vieja no hace nada y sale 0; flags de más: uso (2)", async () => {
  const b = banco();
  const sin = await b.correr("importar-perfiles", "--dir", path.join(b.raiz, "no-hay"), "--json");
  assert.equal(sin.rc, 0);
  assert.deepEqual(JSON.parse(sin.out), { importadas: 0, omitidas: 0, cuentas: [] });
  const otra = path.join(b.raiz, "otra");
  escribir(path.join(otra, "x", ".credentials.json"), "{}");
  const r = await b.correr("importar-perfiles", "--dir", otra, "--json");
  assert.deepEqual(JSON.parse(r.out), { importadas: 1, omitidas: 0, cuentas: ["x"] });
  assert.equal((await b.correr("importar-perfiles", "--dir")).rc, 2);
  assert.equal((await b.correr("importar-perfiles", "--otra")).rc, 2);
});

test("un id de perfil con .. en perfiles.json no sale de la carpeta vieja", async () => {
  const b = banco();
  escribir(path.join(b.raiz, "home", ".local", "state", "hilos", "afuera", ".credentials.json"), "{}");
  escribir(path.join(b.viejo, "perfiles.json"), JSON.stringify({ version: 1, cuentas: [{ id: "../afuera", nombre: "Mala" }] }));
  const r = await b.correr("importar-perfiles", "--json");
  assert.equal(JSON.parse(r.out).cuentas.includes("mala"), false);
});
