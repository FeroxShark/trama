"use strict";
// La limpieza de lo que Trama dejó fuera de su carpeta, según manifiesto.js. Sin Electron: wsl.exe, el disco
// de Windows y el registro entran por `deps`, así que los tests la corren con falsos.
//
// REGLA DURA (la repiten los tests):
//  · Nunca se borran datos de la persona (proyectos, tablero, sesiones, sesiones iniciadas de Claude/Gemini,
//    configuración). Las entradas «nunca» ni se miran; las «datos» (lo propio de la app de Windows) sólo las
//    quita el desinstalador y después de preguntar.
//  · Cada cosa se comprueba otra vez al quitarla: si ya no es de Trama (un archivo en vez de un enlace nuestro,
//    una carpeta con algo más adentro), queda «ajeno» y no se toca.
//  · Una distro de WSL nunca se desregistra si Trama no la creó (la marca la deja el asistente) o si tiene algo
//    que no es de Trama, y aun así sólo con la confirmación explícita (el nombre de la distro).

const { ENTRADAS, muerta } = require("./manifiesto");

class ErrorLimpieza extends Error {
  constructor(mensaje, detalle = "") {
    super(mensaje);
    this.name = "ErrorLimpieza";
    this.detalle = detalle;
  }
}

const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// Lo que quita o mira cada tipo de entrada de WSL. `estado_de` dice presente | ajeno | ausente y es lo que
// vuelve a correr `quitar` justo antes de borrar.
const PRELUDIO = String.raw`
exp() { case "$1" in "~/"*) printf '%s' "$HOME/$(printf '%s' "$1" | cut -c3-)" ;; *) printf '%s' "$1" ;; esac; }
estado_de() {  # tipo ruta regla valor
  local tipo="$1" r="$2" rt="$3" rv="$4"
  case "$tipo" in
    enlace)
      if [ -L "$r" ]; then case "$(readlink "$r")" in *"$rv"*) echo presente ;; *) echo ajeno ;; esac
      elif [ -e "$r" ]; then echo ajeno; else echo ausente; fi ;;
    archivo|sudoers|unit)
      if [ -L "$r" ]; then echo ajeno
      elif [ -f "$r" ]; then
        if [ -z "$rv" ] || grep -qF -- "$rv" "$r" 2>/dev/null; then echo presente; else echo ajeno; fi
      elif [ -e "$r" ]; then echo ajeno; else echo ausente; fi ;;
    carpeta)
      if [ -L "$r" ]; then echo ajeno
      elif [ -d "$r" ]; then
        if [ "$rt" = soloEnlaces ] && [ -n "$(find "$r" -mindepth 1 ! -type l 2>/dev/null | head -n 1)" ]; then echo ajeno; else echo presente; fi
      elif [ -e "$r" ]; then echo ajeno; else echo ausente; fi ;;
    bloque)
      if [ -f "$r" ] && grep -qxF '# trama:path' "$r"; then echo presente; else echo ausente; fi ;;
    hooks)
      if [ -f "$r" ] && grep -qE 'destructive-guard\.sh|statusline-espejo\.sh' "$r"; then echo presente; else echo ausente; fi ;;
    *) echo ajeno ;;
  esac
}
prueba() { local r; r="$(exp "$3")"; echo "$1=$(estado_de "$2" "$r" "$4" "$5")"; }
`;

const QUITAR = String.raw`
dentro_de_home() { case "$1" in "$HOME"/?*/?*) return 0 ;; *) return 1 ;; esac; }
quitar() {  # id tipo ruta regla valor
  local id="$1" tipo="$2" r e; r="$(exp "$3")"; e="$(estado_de "$tipo" "$r" "$4" "$5")"
  if [ "$e" != presente ]; then echo "$id=$e"; return; fi
  case "$tipo" in
    enlace|sudoers) rm -f -- "$r" ;;
    archivo) rm -f -- "$r" && { rmdir -- "$(dirname "$r")" 2>/dev/null || true; } ;;
    carpeta) dentro_de_home "$r" && rm -rf -- "$r" && { rmdir -- "$(dirname "$r")" 2>/dev/null || true; } ;;
    unit)
      systemctl --user disable --now trama-motor.service >/dev/null 2>&1 || true
      rm -f -- "$r"; systemctl --user daemon-reload >/dev/null 2>&1 || true ;;
    bloque)
      awk 'salto { salto=0; next } $0 == "# trama:path" { salto=1; next } { print }' "$r" > "$r.trama-tmp" && cat "$r.trama-tmp" > "$r"; local rc=$?; rm -f "$r.trama-tmp"; [ $rc -eq 0 ] ;;
    hooks) command -v python3 >/dev/null 2>&1 && python3 -c "$PY_HOOKS" "$r" ;;
    *) false ;;
  esac && echo "$id=quitado" || echo "$id=error"
}
`;

// Saca de ~/.claude/settings.json sólo lo que puso instalar-producto.sh: el gancho destructive-guard y la
// statusline-espejo (si envolvía a la de la persona, la devuelve como estaba). Deja una copia al lado.
const PY_HOOKS = String.raw`
import json, os, re, shlex, shutil, sys
p = sys.argv[1]
with open(p) as f:
    d = json.load(f)
if not isinstance(d, dict):
    sys.exit(1)
cambio = False
hooks = d.get("hooks")
pre = hooks.get("PreToolUse") if isinstance(hooks, dict) else None
if isinstance(pre, list):
    nuevo = []
    for g in pre:
        hs = g.get("hooks", []) if isinstance(g, dict) else []
        resto = [h for h in hs if "destructive-guard.sh" not in str(h.get("command", ""))]
        if len(resto) != len(hs):
            cambio = True
            if resto:
                g = dict(g); g["hooks"] = resto; nuevo.append(g)
        else:
            nuevo.append(g)
    if nuevo: hooks["PreToolUse"] = nuevo
    else: del hooks["PreToolUse"]
    if not hooks: del d["hooks"]
sl = d.get("statusLine")
cmd = sl.get("command", "") if isinstance(sl, dict) else ""
if "statusline-espejo.sh" in cmd:
    m = re.match(r'^bash "[^"]*statusline-espejo\.sh" bash -c (.*)$', cmd, re.S)
    if m:
        sl["command"] = shlex.split(m.group(1))[0]
    else:
        del d["statusLine"]
    cambio = True
if not cambio:
    sys.exit(0)
shutil.copy2(p, p + ".trama-bak-quitar")
tmp = p + ".trama-tmp"
with open(tmp, "w") as f:
    json.dump(d, f, indent=2); f.write("\n")
os.replace(tmp, p)
`;

// ¿Hay en la distro algo que no sea de Trama? Conservador: todo lo que no reconoce cuenta como de la persona.
const REVISAR_DISTRO = String.raw`
revisar() {  # carpeta-visible, carpeta, permitidos...
  local vis="$1" dir="$2" f n; shift 2
  for f in "$dir"/* "$dir"/.[!.]*; do
    [ -e "$f" ] || [ -L "$f" ] || continue
    n="$(basename "$f")"
    case " $* " in *" $n "*) ;; *) echo "ajeno=$vis/$n" ;; esac
  done
}
revisar '~' "$HOME" .bashrc .profile .bash_logout .bash_history .sudo_as_admin_successful .motd_shown .lesshst .wget-hsts .viminfo .local .config .cache .claude .claude.json .gemini .antigravity .npm .node_repl_history .gitconfig CLAUDE.md GEMINI.md
revisar '~/.config' "$HOME/.config" trama proyectos systemd configstore
revisar '~/.local/bin' "$HOME/.local/bin" pa tablero trama-estado trama-motor proyecto-ruta workers claude agy node npm npx
revisar '~/.local/share' "$HOME/.local/share" trama claude antigravity
revisar '~/.local/state' "$HOME/.local/state" hilos pa claude
for d in /home/*; do [ -d "$d" ] && [ "$d" != "$HOME" ] && echo "ajeno=$d"; done
REG="$HOME/.config/proyectos/registry.json"
if [ -f "$REG" ] && command -v python3 >/dev/null 2>&1; then
  n="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d.get("projects", [])) if isinstance(d, dict) else 1)' "$REG" 2>/dev/null || echo 1)"
  [ "$n" != 0 ] && echo "ajeno=proyectos registrados ($n)"
fi
true
`;

function crearLimpieza(deps) {
  const {
    wsl, // (args, {input, onLinea, timeoutMs}) → {code, stdout, stderr, falta}
    win, // {expandir(ruta), tipo(ruta) → "carpeta"|"archivo"|null, borrar(ruta), registro: {hay(clave, valor), quitar(clave, valor)}}
    estado: store, // {cargar(), guardar(obj)}
    version, // la versión de la app que corre
    distro = "Ubuntu-24.04",
    entradas = ENTRADAS,
    ahora = () => new Date().toISOString(),
  } = deps;

  const guardado = () => ({ ...(store.cargar() || {}) });
  const guardar = (c) => store.guardar({ ...guardado(), ...c });
  const sh = (script, { root = false, timeoutMs = 60000 } = {}) =>
    wsl(["-d", distro, ...(root ? ["-u", "root"] : []), "-e", "bash", "-s"], { input: `${script}\n`, timeoutMs });
  const claves = (texto) => {
    const o = [];
    for (const l of String(texto).split(/\r?\n/)) {
      const m = /^([^=\s][^=]*)=(.*)$/.exec(l.trim());
      if (m) o.push([m[1], m[2]]);
    }
    return o;
  };

  async function hayDistro() {
    const r = await wsl(["-l", "-q"], { timeoutMs: 20000 });
    if (r.falta || r.code !== 0) return false;
    const nombres = String(r.stdout).split(/\r?\n/).map((l) => l.replace(/\0/g, "").replace(/\(.*\)/, "").trim());
    return nombres.some((n) => n.toLowerCase() === distro.toLowerCase());
  }

  const regla = (e) => {
    const d = e.dueno || {};
    if (d.enlaceA) return ["enlaceA", d.enlaceA];
    if (d.contiene) return ["contiene", d.contiene];
    if (d.soloEnlaces) return ["soloEnlaces", "1"];
    return ["", ""];
  };
  const lineaWsl = (fn, e) => `${fn} ${[e.id, e.tipo, e.ruta, ...regla(e)].map(q).join(" ")}`;

  // ---------- el lado de Windows ----------
  const rutaWin = (e) => (e.tipo === "registro" ? e.ruta : win.expandir(e.ruta));
  function sanaWin(e, ruta) {
    // Una variable sin expandir o una ruta corta: no se borra nada.
    return !/%/.test(ruta) && ruta.length > 12 && /[\\/]/.test(ruta) && !/^[A-Za-z]:[\\/]?$/.test(ruta);
  }
  async function estadoWin(e) {
    if (e.tipo === "registro") {
      const [clave, valor] = e.ruta.split("|");
      return (await win.registro.hay(clave, valor)) ? "presente" : "ausente";
    }
    if (e.tipo === "path") {
      // Una carpeta en el PATH del usuario (Trama nativo): `ruta` es la carpeta que se sumó.
      if (!win.path) return "ausente";
      return (await win.path.tiene(rutaWin(e))) ? "presente" : "ausente";
    }
    if (e.tipo === "carpeta") {
      const ruta = rutaWin(e);
      if (!sanaWin(e, ruta)) return "ajeno";
      const t = await win.tipo(ruta);
      return t === "carpeta" ? "presente" : t ? "ajeno" : "ausente";
    }
    return "ajeno";
  }
  async function quitarWin(e) {
    const antes = await estadoWin(e);
    if (antes !== "presente") return antes;
    try {
      if (e.tipo === "registro") {
        const [clave, valor] = e.ruta.split("|");
        await win.registro.quitar(clave, valor);
      } else if (e.tipo === "path") await win.path.quitar(rutaWin(e));
      else await win.borrar(rutaWin(e));
      return "quitado";
    } catch {
      return "error";
    }
  }

  // ---------- el lado de WSL ----------
  async function estadosWsl(lista) {
    const out = {};
    if (!lista.length) return out;
    if (!(await hayDistro())) {
      for (const e of lista) out[e.id] = "ausente";
      return out;
    }
    for (const root of [false, true]) {
      const grupo = lista.filter((e) => !!e.root === root);
      if (!grupo.length) continue;
      const r = await sh(`${PRELUDIO}\n${grupo.map((e) => lineaWsl("prueba", e)).join("\n")}`, { root });
      if (r.code !== 0) throw new ErrorLimpieza("No pude mirar qué dejó Trama en Ubuntu.", String(r.stderr || r.stdout).trim().slice(-600));
      for (const [k, v] of claves(r.stdout)) out[k] = v;
      for (const e of grupo) out[e.id] = out[e.id] || "ausente";
    }
    return out;
  }

  async function quitarWsl(lista) {
    const out = {};
    if (!lista.length) return out;
    for (const root of [false, true]) {
      const grupo = lista.filter((e) => !!e.root === root);
      if (!grupo.length) continue;
      const script = `PY_HOOKS=${q(PY_HOOKS)}\n${PRELUDIO}\n${QUITAR}\n${grupo.map((e) => lineaWsl("quitar", e)).join("\n")}`;
      const r = await sh(script, { root, timeoutMs: 120000 });
      for (const [k, v] of claves(r.stdout)) out[k] = v;
      for (const e of grupo) out[e.id] = out[e.id] || "error";
    }
    return out;
  }

  // ---------- la distro ----------
  // ¿Se puede desregistrar? Sólo si la creó Trama y no hay nada ajeno adentro.
  async function evaluarDistro() {
    const existe = await hayDistro();
    const creada = guardado().distroCreada === distro;
    const base = { existe, creada, ajenos: [], puede: false, motivo: "" };
    if (!existe) return { ...base, motivo: `${distro} no está instalada.` };
    if (!creada) return { ...base, motivo: `${distro} ya estaba antes de Trama (o no hay registro de que la haya creado): no se desregistra.` };
    const r = await sh(REVISAR_DISTRO, { timeoutMs: 60000 });
    if (r.code !== 0) return { ...base, motivo: `No pude revisar qué hay adentro de ${distro}: no se desregistra.` };
    const ajenos = claves(r.stdout).filter(([k]) => k === "ajeno").map(([, v]) => v);
    if (ajenos.length) return { ...base, ajenos, motivo: `${distro} tiene cosas que no son de Trama: no se desregistra.` };
    return { ...base, puede: true };
  }

  // ---------- el plan ----------
  // modo "restos": sólo lo que la versión actual ya no usa. modo "desinstalar": todo lo de Trama.
  async function planificar({ modo = "restos" } = {}) {
    if (modo !== "restos" && modo !== "desinstalar") throw new ErrorLimpieza(`Modo desconocido: ${modo}`);
    const candidatas = entradas.filter((e) => e.tipo !== "gestionado" && (modo === "desinstalar" || muerta(e, version)));
    const aMirar = (ambito) => candidatas.filter((e) => e.ambito === ambito && ["seguro", "datos"].includes(e.quitar) && e.tipo !== "distro");

    const estados = {};
    for (const e of aMirar("windows")) estados[e.id] = await estadoWin(e);
    Object.assign(estados, await estadosWsl(aMirar("wsl")));

    const items = [];
    for (const e of candidatas) {
      if (e.quitar === "distro") continue;
      if (e.quitar === "nunca") {
        if (modo === "desinstalar" && e.tipo === "compartido") items.push({ id: e.id, ambito: e.ambito, tipo: e.tipo, ruta: e.ruta, que: e.que, accion: "queda" });
        continue;
      }
      const est = estados[e.id];
      if (est === "ausente") continue;
      const accion = est === "ajeno" ? "ajeno" : e.quitar === "datos" ? "datos" : "quitar";
      items.push({ id: e.id, ambito: e.ambito, tipo: e.tipo, ruta: e.ruta, que: e.que, grupo: e.grupo, accion, auto: !!e.auto && e.quitar === "seguro" });
    }
    let distroInfo = null;
    const ed = candidatas.find((e) => e.quitar === "distro");
    if (ed) {
      const ev = await evaluarDistro();
      if (ev.existe) distroInfo = { id: ed.id, nombre: distro, que: ed.que, pierde: ed.pierde, ...ev };
    }
    return { modo, version, items, distro: distroInfo };
  }

  // Quita lo pedido (`ids`) y sólo si el plan de ahora lo permite. `datos`: ids de datos propios que la persona
  // aceptó borrar (sólo en el modo desinstalar). `confirmarDistro`: el nombre de la distro, escrito por la persona.
  async function ejecutar({ modo = "restos", ids = [], datos = [], confirmarDistro = null } = {}) {
    const plan = await planificar({ modo });
    const resultados = [];
    const pedido = new Set(ids);
    const aQuitar = plan.items.filter((i) => i.accion === "quitar" && pedido.has(i.id));
    const aDatos = modo === "desinstalar" ? plan.items.filter((i) => i.accion === "datos" && datos.includes(i.id)) : [];
    for (const id of [...pedido, ...datos]) {
      if (![...aQuitar, ...aDatos].some((i) => i.id === id) && id !== plan.distro?.id) {
        const it = plan.items.find((i) => i.id === id);
        resultados.push({ id, estado: it?.accion === "ajeno" ? "ajeno" : it?.accion === "datos" ? "omitido" : "omitido" });
      }
    }
    const porId = (id) => entradas.find((e) => e.id === id);
    const wslE = [...aQuitar, ...aDatos].filter((i) => i.ambito === "wsl").map((i) => porId(i.id));
    const winE = [...aQuitar, ...aDatos].filter((i) => i.ambito === "windows").map((i) => porId(i.id));
    for (const e of winE) resultados.push({ id: e.id, estado: await quitarWin(e) });
    const r = await quitarWsl(wslE);
    for (const e of wslE) resultados.push({ id: e.id, estado: r[e.id] });

    if (pedido.has(plan.distro?.id)) {
      if (confirmarDistro !== distro) resultados.push({ id: plan.distro.id, estado: "omitido", detalle: "Falta la confirmación escrita del nombre de la distro." });
      else resultados.push({ id: plan.distro.id, ...(await quitarDistro()) });
    }
    const quitados = resultados.filter((x) => x.estado === "quitado").map((x) => x.id);
    if (quitados.length) guardar({ limpieza: { version, modo, fecha: ahora(), quitados } });
    return { resultados };
  }

  async function quitarDistro() {
    const ev = await evaluarDistro();
    if (!ev.puede) return { estado: "ajeno", detalle: ev.motivo };
    await wsl(["--terminate", distro], { timeoutMs: 30000 });
    const r = await wsl(["--unregister", distro], { timeoutMs: 120000 });
    if (r.code !== 0) return { estado: "error", detalle: String(r.stderr || r.stdout).trim().slice(-300) };
    guardar({ distroCreada: null });
    return { estado: "quitado" };
  }

  // Después de actualizar: quita sola sólo lo que la versión nueva dejó de usar Y está marcado `auto`.
  // Corre una vez por versión. Nunca toca datos, la distro ni lo que pide confirmar.
  async function despuesDeActualizar() {
    if (guardado().limpiezaAuto === version) return { hecho: false, resultados: [] };
    const plan = await planificar({ modo: "restos" });
    const ids = plan.items.filter((i) => i.accion === "quitar" && i.auto).map((i) => i.id);
    const { resultados } = ids.length ? await ejecutar({ modo: "restos", ids }) : { resultados: [] };
    guardar({ limpiezaAuto: version });
    return { hecho: true, resultados, pendientes: plan.items.filter((i) => i.accion === "quitar" && !i.auto).length + (plan.distro ? 1 : 0) };
  }

  return { planificar, ejecutar, evaluarDistro, despuesDeActualizar };
}

module.exports = { crearLimpieza, ErrorLimpieza };
