"use strict";
// El asistente en pantalla: una pantalla por paso. La lógica (qué falta, qué hacer) está en el main
// (src/pasos-nativo.js); esto sólo pinta lo que ese devuelve y manda los clics. Todo texto entra por
// textContent: nada de innerHTML.

const TEXTOS = {
  abriendo: { t: "Abriendo Trama…", d: "Un momento." },
  login: { t: "Conectá tus cuentas", d: "Trama usa tu propio Claude Code y tu Gemini (agy). Con una alcanza: conectá la que tengas o las dos. Lo que dejes para después lo conectás desde Ajustes." },
  ollama: { t: "Modelos locales", d: "Opcional: con Ollama podés correr modelos en tu propia PC." },
  motor: { t: "Arrancando Trama", d: "Casi listo." },
};

// Los pasos de instalación (pasos-nativo.js).
const TEXTOS_INSTALACION = {
  instalar: {
    t: "Instalando Trama",
    d: "Copiamos el motor y sus herramientas a tu carpeta de usuario. Tarda un momento.",
    n: "Trama corre directo en Windows: no hace falta WSL ni Linux.",
  },
  instalarAct: { t: "Actualizando el motor", d: "Hay una versión nueva. Queda lista en un momento." },
  sistema: { t: "Comandos y arranque", d: "Sumamos los comandos de Trama a tu PATH y la dejamos arrancando con Windows, en segundo plano. No pide permiso de administrador." },
};
const texto = (clave) => TEXTOS_INSTALACION[clave] || TEXTOS[clave];

const ahora = { paso: "abriendo", pasos: [], hechos: new Set(), lineas: [], actualizando: false, conectado: null, sondeo: null, ocupado: false };
const $ = (id) => document.getElementById(id);

function h(tag, attrs, ...hijos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "onclick") e.addEventListener("click", v);
    else if (k === "class") e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of hijos.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

function pintarProgreso() {
  const lista = $("progreso");
  lista.replaceChildren(...ahora.pasos.map((p) => h("li", { "data-estado": ahora.hechos.has(p.id) ? "ok" : p.id === ahora.paso ? "actual" : "" })));
  const i = ahora.pasos.findIndex((p) => p.id === ahora.paso);
  $("contador").textContent = i >= 0 ? `Paso ${i + 1} de ${ahora.pasos.length}` : "";
}

const barra = () => h("div", { class: "barra", role: "progressbar", "aria-label": "En curso" }, h("i"));
const registro = () => h("ul", { class: "registro", "aria-label": "Detalle" }, ahora.lineas.slice(-6).map((l) => h("li", {}, l)));

function pantallaTrabajo(clave) {
  const x = texto(clave);
  return [h("h1", {}, x.t), h("p", {}, x.d), x.n ? h("p", { class: "nota ancho" }, x.n) : null, barra(), ahora.lineas.length ? registro() : null];
}

function pantallaError(e) {
  const nombre = (ahora.pasos.find((p) => p.id === e.paso) || {}).titulo;
  return [
    h("h1", {}, "No pudimos terminar"),
    h("div", { class: "error", role: "alert" }, nombre ? h("b", {}, `${nombre}: `) : null, e.mensaje),
    e.detalle ? h("details", {}, h("summary", {}, "Ver detalle"), h("pre", {}, e.detalle)) : null,
    h("div", { class: "acciones" }, h("button", { class: "primario", onclick: () => iniciar() }, "Reintentar")),
    h("p", { class: "nota ancho" }, `Si se repite, el registro está en %APPDATA%\\Trama-nativo\\carcasa.log.`),
  ];
}

function chip(texto, ok) {
  return h("span", { class: `chip${ok ? " ok" : ""}` }, h("i"), texto);
}

function estadoProveedor(p) {
  return p.logueado ? "Conectado" : p.saltado ? "Lo hago después" : p.instalado ? "Sin conectar" : "No instalado";
}

function pantallaLogin(info) {
  const tarjeta = (clave, nombre, boton, prov) =>
    h(
      "div",
      { class: "tarjeta" },
      h("div", { class: "quien" }, h("b", {}, nombre), h("span", { class: "sub" }, prov.instalado || prov.logueado ? "Con tu cuenta personal" : "Hay que instalarlo primero")),
      chip(estadoProveedor(prov), prov.logueado),
      prov.logueado ? null : h("button", { class: ahora.conectado || info.puedeContinuar ? "" : "primario", onclick: () => conectar(clave) }, boton),
      prov.logueado || prov.saltado ? null : h("button", { class: "suave salto", onclick: () => saltarLogin(clave) }, "Seguir sin iniciar sesión (lo hago después)"),
    );
  return [
    h("h1", {}, TEXTOS.login.t),
    h("p", {}, TEXTOS.login.d),
    h("div", { class: "tarjetas" }, tarjeta("claude", "Claude", "Conectar Claude", info.claude), tarjeta("gemini", "Gemini", "Conectar Gemini", info.agy)),
    info.cuentasImportadas > 0
      ? h("p", { class: "nota ancho" }, `Se ${info.cuentasImportadas === 1 ? "importó 1 cuenta" : `importaron ${info.cuentasImportadas} cuentas`} de tu Trama anterior.`)
      : null,
    ahora.conectado
      ? h("p", { class: "nota ancho" }, "Se abrió una consola. Iniciá sesión ahí y volvé: acá se detecta solo. Trama no se pone encima mientras escribís.")
      : h("p", { class: "nota ancho" }, "Se abre una consola para que inicies sesión; Trama nunca ve tu contraseña."),
    h("p", { class: "nota ancho" }, "Claude va a abrir tu navegador y pedir «autorizar acceso»: es normal, es el inicio de sesión de tu cuenta."),
    info.puedeContinuar
      ? null
      : h("p", { class: "nota ancho" }, "Podés entrar sin cuenta (usando sólo Ollama) y conectarte después desde Ajustes: elegí «Seguir sin iniciar sesión» en las dos tarjetas."),
    h(
      "div",
      { class: "acciones" },
      info.puedeContinuar ? h("button", { class: "primario", onclick: () => continuarLogin() }, "Continuar") : null,
      h("button", { class: "suave", onclick: () => iniciar() }, "Revisar ahora"),
    ),
  ];
}

function pantallaOllama(info) {
  const aviso = ahora.mensajeOllama;
  const acciones = [];
  let cuerpo;
  if (info.detectado) {
    cuerpo = h("p", { class: "ancho" }, `Detectamos Ollama en tu PC${info.modelos.length ? ` con ${info.modelos.length} modelo${info.modelos.length === 1 ? "" : "s"}` : ""}.`);
  } else {
    cuerpo = h("p", { class: "ancho" }, "No encontramos Ollama. Instalalo si querés usar modelos en tu PC; si no, podés seguir sin él y sumarlo después.");
    acciones.push(h("button", { onclick: () => window.carcasa.abrir("https://ollama.com/download") }, "Abrir ollama.com"), h("button", { onclick: () => iniciar() }, "Ya lo instalé"));
  }
  acciones.push(h("button", { class: "primario", onclick: () => saltar() }, "Continuar sin Ollama"));
  return [
    h("h1", {}, TEXTOS.ollama.t),
    h("div", { class: "tarjeta" }, h("div", { class: "quien" }, h("b", {}, "Ollama"), h("span", { class: "sub" }, "http://localhost:11434")), chip(info.detectado ? "Detectado" : "No detectado", info.detectado)),
    cuerpo,
    aviso ? h("p", { class: "nota ancho" }, aviso) : null,
    h("div", { class: "acciones" }, acciones),
  ];
}

function pintar(contenido) {
  pintarProgreso();
  $("pantalla").replaceChildren(...contenido.flat().filter(Boolean));
  const foco = $("pantalla").querySelector("button.primario, button");
  if (foco && document.activeElement === document.body) foco.focus({ preventScroll: true });
}

function mostrarPaso(id, actualizacion) {
  ahora.paso = id;
  ahora.firma = null;
  pintar(pantallaTrabajo(id === "instalar" && actualizacion ? "instalarAct" : id));
}

function alEvento(e) {
  if (e.tipo === "ok") ahora.hechos.add(e.paso);
  else if (e.tipo === "inicia") {
    ahora.lineas = [];
    mostrarPaso(e.paso, e.actualizacion);
  } else if (e.tipo === "linea") {
    ahora.lineas.push(e.texto);
    if (ahora.lineas.length > 40) ahora.lineas.shift();
    if (ahora.paso === e.paso) pintar(pantallaTrabajo(e.paso === "instalar" && ahora.actualizando ? "instalarAct" : e.paso));
  }
  if (e.tipo === "inicia") ahora.actualizando = !!e.actualizacion;
}

async function iniciar() {
  if (ahora.ocupado) return;
  ahora.ocupado = true;
  clearInterval(ahora.sondeo);
  ahora.lineas = [];
  if (ahora.paso === "abriendo") pintar(pantallaTrabajo("abriendo"));
  let r;
  try {
    r = await window.carcasa.avanzar();
  } catch (e) {
    r = { error: { mensaje: String(e.message || e), detalle: "" } };
  }
  ahora.ocupado = false;
  if (r.listo) return; // el main ya está cargando Trama
  if (r.error) {
    ahora.paso = r.error.paso || ahora.paso;
    ahora.firma = null;
    return pintar(pantallaError(r.error));
  }
  ahora.paso = r.espera;
  const firma = JSON.stringify([r.espera, r.info, ahora.conectado, ahora.mensajeOllama]);
  const igual = firma === ahora.firma;
  ahora.firma = firma;
  ahora.esperaOllama = r.espera === "ollama" && !r.info.detectado;
  if (r.espera === "login") {
    if (!igual) pintar(pantallaLogin(r.info));
    // Mientras la persona inicia sesión en la consola, se vuelve a mirar sola.
    ahora.sondeo = setInterval(() => ahora.conectado && iniciar(), 3000);
    return;
  }
  if (r.espera === "ollama") {
    if (!igual) pintar(pantallaOllama(r.info));
    ahora.sondeo = setInterval(() => ahora.esperaOllama && iniciar(), 4000);
  }
}

async function conectar(proveedor) {
  ahora.conectado = proveedor;
  const r = await window.carcasa.conectar(proveedor);
  if (r?.error) return pintar(pantallaError({ paso: "login", mensaje: "No pude abrir la consola.", detalle: r.error }));
  iniciar();
}

async function continuarLogin() {
  const r = await window.carcasa.continuarLogin();
  if (r?.error) return pintar(pantallaError({ paso: "login", mensaje: "No pude seguir.", detalle: r.error }));
  ahora.firma = null;
  iniciar();
}

async function saltarLogin(proveedor) {
  await window.carcasa.saltarLogin(proveedor);
  ahora.firma = null;
  iniciar();
}

async function saltar() {
  await window.carcasa.saltarOllama();
  ahora.mensajeOllama = null;
  iniciar();
}

function avisoActualizacion(a) {
  const cont = $("actualizacion");
  if (!a || a.fase !== "lista") return cont.replaceChildren(a?.fase === "descargando" ? `Descargando la versión ${a.version}…` : "");
  cont.replaceChildren(`Trama ${a.version} está lista · `, h("button", { class: "suave", onclick: () => window.carcasa.reiniciarParaActualizar() }, "Reiniciar"));
}

// ?demo=<pantalla> pinta una pantalla sin hablar con el main (capturas y diseño).
function demo(nombre) {
  ahora.pasos = [
    { id: "instalar", titulo: "Instalar Trama" }, { id: "sistema", titulo: "Comandos y arranque" }, { id: "login", titulo: "Conectar tu cuenta" },
    { id: "ollama", titulo: "Modelos locales (Ollama)" }, { id: "motor", titulo: "Arrancar Trama" },
  ];
  $("version").textContent = "Trama";
  const previos = { instalar: [], login: ["instalar", "sistema"], "login-uno": ["instalar", "sistema"], ollama: ["instalar", "sistema", "login"], error: [] };
  ahora.hechos = new Set(previos[nombre] || []);
  if (nombre === "login" || nombre === "login-uno") {
    ahora.paso = "login";
    pintar(
      pantallaLogin(
        nombre === "login-uno"
          ? { claude: { instalado: true, logueado: true }, agy: { instalado: true, logueado: false }, puedeContinuar: true }
          : { claude: { instalado: true, logueado: false }, agy: { instalado: true, logueado: false } },
      ),
    );
  } else if (nombre === "ollama") {
    ahora.paso = "ollama";
    pintar(pantallaOllama({ detectado: true, modelos: ["qwen3-coder:30b"] }));
  } else if (nombre === "error") {
    ahora.paso = "instalar";
    pintar(pantallaError({ paso: "instalar", mensaje: "No pude correr el instalador de Trama.", detalle: "EPERM: operation not permitted, copyfile 'node.exe'" }));
  } else {
    ahora.paso = "instalar";
    ahora.lineas = ["Copiando node.exe…", "Copiando la app de Trama…", "Copiando los comandos (pa, trama-estado)…"];
    pintar(pantallaTrabajo("instalar"));
  }
  $("progreso").dataset.demo = nombre;
}

async function arrancar() {
  const demoId = new URLSearchParams(location.search).get("demo");
  if (demoId) return demo(demoId);
  ahora.pasos = await window.carcasa.pasos();
  $("version").textContent = `Trama ${await window.carcasa.version()}`;
  window.carcasa.onEvento(alEvento);
  window.carcasa.onActualizacion(avisoActualizacion);
  avisoActualizacion(await window.carcasa.actualizacion());
  iniciar();
}

arrancar();
