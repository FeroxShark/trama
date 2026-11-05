// electron/descubrir.ts: el catálogo para descubrir skills y conectores MCP. Todo contra un servidor HTTP FALSO en 127.0.0.1 (nunca la red real) y
// un HOME temporal (nunca se instala en el verdadero). Cubre: el parseo de las dos fuentes, el nombre malicioso, el `http://` rechazado, no pisar
// una skill que ya existe y las respuestas enormes, malformadas o que no llegan.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { catalogo, encabezadoSkill, instalar, itemsMcpDe, nombreConector, previa, rutaSegura, skillsDeArbol, tramoSeguro, urlHttps, type DepsDescubrir } from "../electron/descubrir.ts";

const raizTmp = mkdtempSync(path.join(os.tmpdir(), "descubrir-"));
after(() => rmSync(raizTmp, { recursive: true, force: true }));

const sha = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const MD = (nombre: string, desc: string) => `---\nname: ${nombre}\ndescription: ${desc}\n---\n\n# ${nombre}\n`;

type Archivos = Record<string, string | Buffer>;
type Cruda = { cuerpo: string | Buffer; sinLargo?: boolean } | "colgar" | undefined;
type Escenario = {
  skills: Record<string, Archivos>;
  /** Entradas del árbol que se suman tal cual (rutas raras, enlaces simbólicos). */
  extraArbol?: Record<string, unknown>[];
  paginas: unknown[][];
  /** Respuestas crudas que pisan a las de verdad. */
  registroCrudo?: () => Cruda;
  arbolCrudo?: () => string;
  /** Archivos que se sirven distinto de lo que dice el árbol. */
  corrompidos?: Set<string>;
};

const reg = (nombre: string, extra: Record<string, unknown>, meta: Record<string, unknown> = {}) => ({
  server: { name: nombre, description: `d-${nombre}`, version: "1.0.0", ...extra },
  _meta: { "io.modelcontextprotocol.registry/official": { status: "active", isLatest: true, publishedAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", ...meta } },
});

const SKILLS: Escenario["skills"] = {
  "theme-factory": { "SKILL.md": MD("theme-factory", "Aplicar un tema\n  a documentos"), "LICENSE.txt": "MIT", "assets/a.txt": "hola" },
  "webapp-testing": { "SKILL.md": MD("webapp-testing", "'Probar webs'"), "scripts/run.py": "print(1)\n" },
  docx: { "SKILL.md": MD("docx", "no open source") },
  pdf: { "SKILL.md": MD("pdf", "no open source") },
};

const PAGINAS = [
  [
    reg("io.github.ana/notas", { title: "Notas", websiteUrl: "https://notas.example.com", remotes: [{ type: "streamable-http", url: "https://mcp.notas.example.com/mcp" }] }, { isLatest: false, updatedAt: "2026-01-01T00:00:00Z" }),
    reg("io.github.ana/notas", { title: "Notas", version: "2.0.0", remotes: [{ type: "streamable-http", url: "https://mcp.notas.example.com/mcp", headers: [{ name: "Authorization", isRequired: true }] }] }),
    reg("io.github.luis/archivos", { packages: [{ registryType: "npm", identifier: "archivos-mcp", version: "0.4.1", transport: { type: "stdio" } }] }, { updatedAt: "2026-09-12T08:00:00Z" }),
  ],
  [
    reg("dev.local/inseguro", { remotes: [{ type: "streamable-http", url: "http://prueba.example.com/mcp" }] }),
    reg("dev.local/baja", { remotes: [{ type: "sse", url: "https://baja.example.com/sse" }] }, { status: "deprecated" }),
    reg("dev.local/plantilla", { remotes: [{ type: "streamable-http", url: "https://{region}.example.com/mcp" }] }),
    { server: { name: "dev.local/sinfecha", remotes: [{ type: "sse", url: "https://sf.example.com/sse" }] }, _meta: {} },
  ],
];

async function armar(esc: Partial<Escenario> = {}) {
  const e: Escenario = { skills: SKILLS, paginas: PAGINAS, ...esc };
  const pedidos: string[] = [];
  const arbol = () => {
    const tree: Record<string, unknown>[] = [{ path: "README.md", mode: "100644", type: "blob", size: 3, sha: sha(Buffer.from("abc")) }, { path: "skills", mode: "040000", type: "tree" }];
    for (const [nombre, archivos] of Object.entries(e.skills))
      for (const [ruta, c] of Object.entries(archivos)) {
        const b = Buffer.from(c);
        tree.push({ path: `skills/${nombre}/${ruta}`, mode: ruta.startsWith("scripts/") ? "100755" : "100644", type: "blob", size: b.length, sha: sha(b) });
      }
    return JSON.stringify({ sha: "x", tree: [...tree, ...(e.extraArbol ?? [])], truncated: false });
  };
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    pedidos.push(url.pathname);
    if (url.pathname === "/v0/servers") {
      const crudo = e.registroCrudo?.();
      if (crudo === "colgar") return; // no contesta: lo corta el tiempo del cliente
      if (crudo) {
        res.writeHead(200, { "content-type": "application/json", ...(crudo.sinLargo ? {} : { "content-length": Buffer.byteLength(crudo.cuerpo) }) });
        return void res.end(crudo.cuerpo);
      }
      const i = Number((url.searchParams.get("cursor") ?? "p0").slice(1));
      const sig = i + 1 < e.paginas.length ? `p${i + 1}` : undefined;
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(JSON.stringify({ servers: e.paginas[i] ?? [], metadata: { nextCursor: sig, count: (e.paginas[i] ?? []).length } }));
    }
    if (url.pathname === "/repos/anthropics/skills/git/trees/main") {
      res.writeHead(200, { "content-type": "application/json" });
      return void res.end(e.arbolCrudo ? e.arbolCrudo() : arbol());
    }
    const m = /^\/anthropics\/skills\/main\/skills\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (m) {
      const ruta = decodeURIComponent(m[2]!);
      const c = e.skills[m[1]!]?.[ruta];
      if (c === undefined) {
        res.writeHead(404);
        return void res.end();
      }
      res.writeHead(200);
      return void res.end(e.corrompidos?.has(`${m[1]}/${ruta}`) ? Buffer.alloc(Buffer.from(c).length, 0x78) : c);
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const dir = mkdtempSync(path.join(raizTmp, "t-"));
  const home = path.join(dir, "casa");
  mkdirSync(home);
  const deps: DepsDescubrir = {
    home,
    estado: path.join(dir, "estado"),
    env: { HOME: home, USERPROFILE: home, TRAMA_MCP: path.join(dir, "mcp.json"), TRAMA_CLAVES: path.join(dir, "claves.env") },
    urls: { registro: base, api: base, raw: base },
  };
  return {
    deps,
    base,
    home,
    dir,
    pedidos,
    mcpJson: path.join(dir, "mcp.json"),
    skills: path.join(home, ".claude", "skills"),
    cerrar: () => {
      srv.closeAllConnections();
      return new Promise<void>((r) => srv.close(() => r()));
    },
  };
}

const sinTemporales = (carpeta: string) => !existsSync(carpeta) || readdirSync(carpeta).every((n) => !n.startsWith(".trama-instalando"));

test("parseo: skills con su descripción (sin docx/pdf) y conectores del registro, sin repetidos, bajas ni plantillas", async () => {
  const a = await armar();
  try {
    const c = await catalogo(true, a.deps);
    assert.deepEqual(c.errores, { skills: null, mcp: null });
    assert.deepEqual(c.skills.map((s) => s.nombre), ["theme-factory", "webapp-testing"]);
    assert.equal(c.skills[0]!.descripcion, "Aplicar un tema a documentos");
    assert.equal(c.skills[1]!.descripcion, "Probar webs");
    assert.equal(c.skills[0]!.scripts, false);
    assert.equal(c.skills[1]!.scripts, true);
    assert.equal(c.skills[0]!.fecha, null, "el árbol de GitHub no trae fechas: sin dato");
    assert.equal(c.skills[0]!.instalado, false);
    const nombres = c.mcp.map((m) => m.nombre).sort();
    assert.deepEqual(nombres, ["dev.local/inseguro", "dev.local/sinfecha", "io.github.ana/notas", "io.github.luis/archivos"]);
    const notas = c.mcp.find((m) => m.nombre === "io.github.ana/notas")!;
    assert.equal(notas.version, "2.0.0", "queda la última versión");
    assert.deepEqual(notas.remoto, { url: "https://mcp.notas.example.com/mcp", dominio: "mcp.notas.example.com", seguro: true });
    assert.deepEqual(notas.cabeceras, ["Authorization"]);
    const pq = c.mcp.find((m) => m.nombre === "io.github.luis/archivos")!;
    assert.equal(pq.remoto, null);
    assert.equal(pq.paquete?.comando, "npx -y archivos-mcp@0.4.1");
    assert.equal(pq.paquete?.enlace, "https://www.npmjs.com/package/archivos-mcp");
    assert.equal(pq.fecha, "2026-09-12T08:00:00.000Z");
    assert.equal(c.mcp.find((m) => m.nombre === "dev.local/sinfecha")!.fecha, null);
    // Pagina con nextCursor: hubo dos pedidos al registro.
    assert.equal(a.pedidos.filter((p) => p === "/v0/servers").length, 2);
    // Sin «Actualizar» y con copia de hoy: no vuelve a la red.
    const antes = a.pedidos.length;
    const otra = await catalogo(false, a.deps);
    assert.equal(a.pedidos.length, antes);
    assert.deepEqual(otra.skills.map((s) => s.nombre), ["theme-factory", "webapp-testing"]);
    // Y con la copia vencida sí baja.
    await catalogo(false, { ...a.deps, ahora: () => Date.now() + 25 * 3_600_000 });
    assert.ok(a.pedidos.length > antes);
  } finally {
    await a.cerrar();
  }
});

test("parseo puro: encabezado del SKILL.md, comandos de paquete y nombre de conector", () => {
  assert.deepEqual(encabezadoSkill("---\nname: x\ndescription: >\n  uno\n  dos\n---\ncuerpo"), { nombre: "x", descripcion: "uno dos" });
  assert.deepEqual(encabezadoSkill("sin encabezado"), { nombre: null, descripcion: null });
  const [pypi] = itemsMcpDe([reg("a/b", { packages: [{ registryType: "pypi", identifier: "mi-paquete", version: "1.2" }] })]);
  assert.equal(pypi!.paquete?.comando, "uvx mi-paquete==1.2");
  // Un identificador con metacaracteres de shell no se muestra como comando.
  assert.deepEqual(itemsMcpDe([reg("a/b", { packages: [{ registryType: "npm", identifier: "x$(id)`y`", version: "1" }] })]), []);
  assert.equal(nombreConector("io.github.ana/notas", []), "notas");
  assert.equal(nombreConector("io.github.ana/notas", ["Notas", "notas-2"]), "notas-3");
  assert.equal(nombreConector("x/.._", []), "conector");
});

test("nombre malicioso: rutas con `..`, enlaces, mayúsculas y nombres de Windows no entran al catálogo ni se instalan", async () => {
  assert.ok(tramoSeguro("scripts") && tramoSeguro(".gitignore") && tramoSeguro("a b.txt"));
  for (const x of ["..", ".", ".git", "a:b", "con", "NUL.txt", "a\\b", "x.", "", "a/b"]) assert.equal(tramoSeguro(x), false, x);
  assert.equal(rutaSegura("a/../b"), false);
  assert.equal(rutaSegura("a/b/c.md"), true);

  const a = await armar({
    skills: { ...SKILLS, evil: { "SKILL.md": MD("evil", "x") } },
    extraArbol: [
      { path: "skills/evil/../../escapa/SKILL.md", mode: "100644", type: "blob", size: 1, sha: "a".repeat(40) },
      { path: "skills/MAYUS/SKILL.md", mode: "100644", type: "blob", size: 1, sha: "a".repeat(40) },
      { path: "skills/enlace/SKILL.md", mode: "120000", type: "blob", size: 1, sha: "a".repeat(40) },
      { path: "skills/win/SKILL.md", mode: "100644", type: "blob", size: 1, sha: "a".repeat(40) },
      { path: "skills/win/con", mode: "100644", type: "blob", size: 1, sha: "a".repeat(40) },
    ],
  });
  try {
    const c = await catalogo(true, a.deps);
    const nombres = c.skills.map((s) => s.nombre);
    for (const malo of ["evil", "MAYUS", "enlace", "win", "escapa", "docx", "pdf"]) assert.ok(!nombres.includes(malo), malo);
    for (const id of ["skill:../afuera", "skill:..", "skill:a/b", "skill:a\\b", "skill:docx", "skill:", "mcp:../x", "skill:evil", 42, null]) {
      await assert.rejects(instalar(id, "x", a.deps), /main\.descubrir(Nombre|NoExiste)/, String(id));
      await assert.rejects(previa(id, a.deps), /main\.descubrir(Nombre|NoExiste)/, String(id));
    }
    assert.equal(existsSync(path.join(a.home, ".claude")), false, "no se creó nada en la casa");
    assert.equal(existsSync(path.join(a.dir, "escapa")), false);
  } finally {
    await a.cerrar();
  }
  // Una caché a mano con un nombre o una ruta malos tampoco se cree.
  const b = await armar();
  try {
    mkdirSync(b.deps.estado!, { recursive: true });
    const archivo = (ruta: string) => ({ ruta, tam: 1, sha: "a".repeat(40), ejecutable: false });
    writeFileSync(path.join(b.deps.estado!, "descubrir.json"), JSON.stringify({ version: 1, actualizado: Date.now(), skills: [{ nombre: "../x", archivos: [archivo("SKILL.md")] }, { nombre: "ok", archivos: [archivo("SKILL.md"), archivo("../../etc/passwd")] }], mcp: [] }));
    const c = await catalogo(false, b.deps);
    assert.deepEqual(c.skills.map((s) => s.nombre), ["ok"]);
    assert.equal(c.skills[0]!.archivos, 1, "la ruta mala se descartó");
  } finally {
    await b.cerrar();
  }
});

test("http:// rechazado: un conector sin https se ve pero no se agrega, y nunca se escribe mcp.json", async () => {
  assert.equal(urlHttps("http://a.example.com"), null);
  assert.equal(urlHttps("https://usuario:clave@a.example.com/x"), null);
  assert.equal(urlHttps("javascript:alert(1)"), null);
  assert.equal(urlHttps("file:///etc/passwd"), null);
  assert.equal(urlHttps("https://a.example.com/mcp"), "https://a.example.com/mcp");

  const a = await armar();
  try {
    const c = await catalogo(true, a.deps);
    const m = c.mcp.find((x) => x.nombre === "dev.local/inseguro")!;
    assert.equal(m.remoto?.seguro, false);
    await assert.rejects(previa(m.id, a.deps), /main\.descubrirHttps/);
    await assert.rejects(instalar(m.id, undefined, a.deps), /main\.descubrirHttps/);
    // Un paquete tampoco se "instala": no hay camino que lo ejecute.
    await assert.rejects(instalar("mcp:io.github.luis/archivos", undefined, a.deps), /main\.descubrirHttps/);
    assert.equal(existsSync(a.mcpJson), false);
    // El remoto https sí: sale la previa con el dominio y se agrega a los propios con un nombre válido.
    const p = await previa("mcp:io.github.ana/notas", a.deps);
    assert.equal(p.tipo === "mcp" && p.dominio, "mcp.notas.example.com");
    const r = await instalar("mcp:io.github.ana/notas", undefined, a.deps);
    assert.deepEqual(r, { tipo: "mcp", nombre: "notas" });
    const guardado = JSON.parse(readFileSync(a.mcpJson, "utf8")) as { servidores: { nombre: string; tipo: string; url: string; variables: unknown[] }[] };
    assert.deepEqual(guardado.servidores, [{ nombre: "notas", tipo: "http", url: "https://mcp.notas.example.com/mcp", variables: [] }]);
    // Una segunda vez no pisa el de antes: queda con otro nombre.
    assert.deepEqual(await instalar("mcp:io.github.ana/notas", undefined, a.deps), { tipo: "mcp", nombre: "notas-2" });
    assert.equal((await catalogo(false, a.deps)).mcp.find((x) => x.id === "mcp:io.github.ana/notas")!.agregado, true);
  } finally {
    await a.cerrar();
  }
});

test("instalar una skill: copia la carpeta tal cual, con la previa que avisa de los scripts", async () => {
  const a = await armar();
  try {
    await catalogo(true, a.deps);
    const p = await previa("skill:webapp-testing", a.deps);
    assert.ok(p.tipo === "skill");
    assert.deepEqual(p.archivos.map((f) => f.ruta), ["SKILL.md", "scripts/run.py"]);
    assert.deepEqual(p.scripts, ["scripts/run.py"]);
    assert.equal(p.destino, "~/.claude/skills/webapp-testing");
    // Sin la huella de la previa (o con otra) no se instala.
    await assert.rejects(instalar("skill:webapp-testing", undefined, a.deps), /main\.descubrirCambio/);
    await assert.rejects(instalar("skill:webapp-testing", "0000", a.deps), /main\.descubrirCambio/);
    assert.equal(existsSync(a.skills), false);
    const r = await instalar("skill:webapp-testing", p.huella, a.deps);
    assert.deepEqual(r, { tipo: "skill", nombre: "webapp-testing", carpeta: "~/.claude/skills/webapp-testing", archivos: 2 });
    assert.equal(readFileSync(path.join(a.skills, "webapp-testing", "scripts", "run.py"), "utf8"), "print(1)\n");
    assert.equal(readFileSync(path.join(a.skills, "webapp-testing", "SKILL.md"), "utf8"), MD("webapp-testing", "'Probar webs'"));
    assert.ok(sinTemporales(a.skills));
    assert.equal((await catalogo(false, a.deps)).skills.find((s) => s.nombre === "webapp-testing")!.instalado, true);
  } finally {
    await a.cerrar();
  }
});

test("no pisar: una skill que ya existe queda intacta, y un archivo alterado no deja nada a medias", async () => {
  const a = await armar({ corrompidos: new Set(["theme-factory/LICENSE.txt"]) });
  try {
    await catalogo(true, a.deps);
    // Ya hay una skill con ese nombre (de la persona): ni se toca ni se mezcla.
    const propia = path.join(a.skills, "webapp-testing");
    mkdirSync(propia, { recursive: true });
    writeFileSync(path.join(propia, "SKILL.md"), "MIA");
    const p = await previa("skill:webapp-testing", a.deps);
    assert.ok(p.tipo === "skill");
    await assert.rejects(instalar("skill:webapp-testing", p.huella, a.deps), /main\.descubrirSkillExiste/);
    assert.equal(readFileSync(path.join(propia, "SKILL.md"), "utf8"), "MIA");
    assert.deepEqual(readdirSync(propia), ["SKILL.md"]);
    assert.ok(sinTemporales(a.skills));
    // Un archivo que baja distinto del hash que dio GitHub: error, y ni la carpeta ni un temporal quedan.
    const q = await previa("skill:theme-factory", a.deps);
    assert.ok(q.tipo === "skill");
    await assert.rejects(instalar("skill:theme-factory", q.huella, a.deps), /main\.descubrirCorrupto/);
    assert.equal(existsSync(path.join(a.skills, "theme-factory")), false);
    assert.ok(sinTemporales(a.skills));
    // El catálogo la sigue mostrando como instalada (ya estaba) y la otra no.
    const c = await catalogo(false, a.deps);
    assert.equal(c.skills.find((s) => s.nombre === "webapp-testing")!.instalado, true);
    assert.equal(c.skills.find((s) => s.nombre === "theme-factory")!.instalado, false);
  } finally {
    await a.cerrar();
  }
});

test("respuesta enorme: se corta al pasar el tope (con o sin Content-Length) y se conserva la copia anterior", async () => {
  let modo: "bien" | "grande" | "grande-sin-largo" = "bien";
  const a = await armar({ registroCrudo: () => (modo === "bien" ? undefined : { cuerpo: Buffer.alloc(300_000, 0x20), sinLargo: modo === "grande-sin-largo" }) });
  try {
    const bien = await catalogo(true, a.deps);
    assert.ok(bien.mcp.length > 0);
    for (const m of ["grande", "grande-sin-largo"] as const) {
      modo = m;
      const c = await catalogo(true, { ...a.deps, limites: { pagina: 100_000 } });
      assert.match(c.errores.mcp ?? "", /main\.descubrirGrande/, m);
      assert.equal(c.errores.skills, null, "las skills no se ven afectadas");
      assert.deepEqual(c.mcp.map((x) => x.nombre).sort(), bien.mcp.map((x) => x.nombre).sort(), "queda lo que había");
    }
    // El árbol de GitHub enorme también.
    modo = "bien";
    const d = await catalogo(true, { ...a.deps, limites: { arbol: 200 } });
    assert.match(d.errores.skills ?? "", /main\.descubrirGrande/);
    assert.equal(d.skills.length, 2);
  } finally {
    await a.cerrar();
  }
});

test("respuesta malformada: JSON roto, forma rara o árbol cortado dan un aviso, nunca una excepción ni datos a medias", async () => {
  for (const cuerpo of ["{no es json", "[1,2,3]", JSON.stringify({ servers: 5 }), JSON.stringify({ servers: "x" }), "", "null"]) {
    const a = await armar({ registroCrudo: () => ({ cuerpo }) });
    try {
      const c = await catalogo(true, a.deps);
      assert.match(c.errores.mcp ?? "", /main\.descubrirMalformado/, cuerpo);
      assert.deepEqual(c.mcp, []);
      assert.equal(c.skills.length, 2, "la otra fuente sigue andando");
    } finally {
      await a.cerrar();
    }
  }
  for (const arbol of ["{no es json", JSON.stringify({ tree: "x" }), JSON.stringify({ sha: "x" }), JSON.stringify({ tree: [], truncated: true })]) {
    const a = await armar({ arbolCrudo: () => arbol });
    try {
      const c = await catalogo(true, a.deps);
      assert.match(c.errores.skills ?? "", /main\.descubrir(Malformado|Grande)/, arbol);
      assert.deepEqual(c.skills, []);
      assert.ok(c.mcp.length > 0);
    } finally {
      await a.cerrar();
    }
  }
  // Renglones sueltos raros dentro de una respuesta válida: se ignoran uno por uno.
  const a = await armar({ paginas: [[null, 5, "x", {}, { server: {} }, { server: { name: 7 } }, { server: { name: "bien/uno", remotes: [{ type: "sse", url: "https://u.example.com/sse" }] } }]] });
  try {
    const c = await catalogo(true, a.deps);
    assert.deepEqual(c.mcp.map((m) => m.nombre), ["bien/uno"]);
  } finally {
    await a.cerrar();
  }
  assert.throws(() => skillsDeArbol({ tree: 5 }), /main\.descubrirMalformado/);
});

test("un servidor que no contesta o cae corta por tiempo, y un archivo de la caché enorme o roto se ignora", async () => {
  const a = await armar({ registroCrudo: () => "colgar" });
  try {
    // espera-justificada: el tope de tiempo del cliente (AbortSignal) es lo que se prueba; el servidor no contesta nunca
    const c = await catalogo(true, { ...a.deps, limites: { tiempo: 150 } });
    assert.match(c.errores.mcp ?? "", /main\.descubrirTiempo/);
    assert.equal(c.skills.length, 2);
  } finally {
    await a.cerrar();
  }
  const b = await armar();
  await b.cerrar(); // ahora nadie escucha: conexión rechazada
  const c = await catalogo(true, b.deps);
  assert.match(c.errores.mcp ?? "", /main\.descubrirRed/);
  assert.match(c.errores.skills ?? "", /main\.descubrirRed/);
  // Caché rota o gigante: se ignora y se vuelve a bajar.
  const d = await armar();
  try {
    mkdirSync(d.deps.estado!, { recursive: true });
    writeFileSync(path.join(d.deps.estado!, "descubrir.json"), "{roto");
    assert.equal((await catalogo(false, d.deps)).skills.length, 2);
    writeFileSync(path.join(d.deps.estado!, "descubrir.json"), JSON.stringify({ version: 1, actualizado: Date.now(), skills: [], mcp: [] }));
    const antes = d.pedidos.length;
    assert.equal((await catalogo(false, { ...d.deps, limites: { cache: 10 } })).skills.length, 2, "caché más grande que el tope: se baja de nuevo");
    assert.ok(d.pedidos.length > antes);
  } finally {
    await d.cerrar();
  }
});
