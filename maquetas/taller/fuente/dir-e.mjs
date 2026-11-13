// Dirección E · «Taller»: la interfaz de hoy, con todas sus funciones, vestida como «Charla» y con paneles que se arrastran.
// Arma el HTML: node /home/ferox/.cache/trama-plan/roast/fuente/dir-e.mjs
// No toca dir-d.mjs ni base.mjs: de base sólo toma SPRITE e I (íconos).
import { writeFileSync } from "node:fs";
import { SPRITE, I } from "./base.mjs";

const SALIDA = "/home/ferox/.cache/trama-plan/roast/direcciones/e-taller.html";

// Íconos que base.mjs no tiene (sprite propio).
const EXTRA = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">
<symbol id="i-ampliar" viewBox="0 0 24 24"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></symbol>
<symbol id="i-archivo" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></symbol>
<symbol id="i-grip" viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g></symbol>
<symbol id="i-puntos" viewBox="0 0 24 24"><g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></g></symbol>
<symbol id="i-p-izq" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></symbol>
<symbol id="i-p-der" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></symbol>
<symbol id="i-p-abajo" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/></symbol>
<symbol id="i-paneles" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M9 12h12"/></symbol>
<symbol id="i-pausa" viewBox="0 0 24 24"><path d="M9 6v12M15 6v12"/></symbol>
<symbol id="i-info" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.5"/></symbol>
<symbol id="i-ayuda" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 17v.5"/></symbol>
<symbol id="i-hojas" viewBox="0 0 24 24"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M10 14l-7 7"/></symbol>
<symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3v9M7 6.5a7 7 0 1 0 10 0"/></symbol>
<symbol id="i-resetea" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/></symbol>
<symbol id="i-trabado" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" stroke-dasharray="3 3.2"/></symbol>
<symbol id="i-rayo-v" viewBox="0 0 24 24"><path d="M13 2L4 14h8l-1 8 9-12h-8l1-8z" stroke-dasharray="2.5 3"/></symbol>
<symbol id="i-micro" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></symbol>
<symbol id="i-fuera" viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></symbol>
<symbol id="i-chat" viewBox="0 0 24 24"><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/></symbol>
<symbol id="i-capas" viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></symbol>
<symbol id="i-libro" viewBox="0 0 24 24"><path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M5 17a3 3 0 0 1 3-3h10"/></symbol>
<symbol id="i-ojo" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-llave" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></symbol>
<symbol id="i-chispa" viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 16v4M17 18h4"/></symbol>
<symbol id="i-memoria" viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></symbol>
<symbol id="i-merge" viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="17" r="2"/><path d="M6 7v14M6 11c0 4 4 6 10 6"/></symbol>
<symbol id="i-diff" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M6 9h4M8 7v4M14.5 15h4"/></symbol>
<symbol id="i-calendario" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></symbol>
<symbol id="i-paleta" viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.4-.8-.4-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01"/></symbol>
<symbol id="i-abrir" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></symbol>
</svg>`;

// ---------- Números que se comparten: un solo juego, de acá salen todos los textos ----------
const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Cupo: igual que en Charla (dir-d.mjs). La semana arranca el sábado 13:30; «ahora» es miércoles 09:30.
const CUPO = { usado: 61, pasaron: 3 + 20 / 24, semana: 7, hastaHoy: [7, 23, 39, 55], ahoraHora: 9.5, cinco: 34 };
const queda = CUPO.semana - CUPO.pasaron;
const tope = (100 - CUPO.usado) / queda;
const DIAS = ["miércoles", "jueves", "viernes", "sábado"];
const MODOS = [
  { id: "r1", v: "v1", nombre: "Normal", ritmo: CUPO.usado / CUPO.pasaron, que: "El modelo que elige el reparto y hasta 4 workers a la vez." },
  { id: "r2", v: "v2", nombre: "Cuidado", ritmo: 10.4, que: "Workers un nivel más abajo y de a 2 por vez." },
  { id: "r3", v: "v3", nombre: "Mínimo", ritmo: 6, que: "Sigue lo que ya corre; lo nuevo espera al sábado." },
].map((m) => {
  const dias = (100 - CUPO.usado) / m.ritmo;
  const seAcaba = dias < queda;
  const h = CUPO.ahoraHora + dias * 24;
  const cortes = [(24 - CUPO.ahoraHora) / 24, (48 - CUPO.ahoraHora) / 24, (72 - CUPO.ahoraHora) / 24, queda];
  return {
    ...m,
    seAcaba,
    llega: Math.round(Math.min(100, CUPO.usado + m.ritmo * queda)),
    cuando: seAcaba ? `el ${DIAS[Math.floor(h / 24)]} a las ${Math.round(h % 24)} h` : "",
    antes: Math.round((queda - dias) * 24),
    proy: cortes.map((t) => Math.min(100, Math.round(CUPO.usado + m.ritmo * t))),
  };
});
console.assert(Math.round(tope) === 12 && Math.round(MODOS[0].ritmo) === 16, "ritmo y tope");
const porDia = (x) => `${Math.round(x)} % por día`;
const corto = (c) => c.replace(" a las", "");

const nombresDia = ["sáb", "dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const grafico = (m) => {
  const W = 280, H = 138, x0 = 40, base = 112, alto = 92, paso = (W - x0) / nombresDia.length;
  const y = (v) => base - (v / 100) * alto;
  const ejes = [0, 50, 100].map((v) => `<line x1="${x0}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)"/><text x="${x0 - 6}" y="${y(v) + 4}" text-anchor="end">${v} %</text>`).join("");
  const rojo = `stroke="var(--bad)"`, gris = `stroke="var(--muted)"`;
  const barras = nombresDia
    .map((d, i) => {
      const bx = x0 + i * paso + 4, bw = paso - 8, cx = bx + bw / 2;
      const pie = `<text x="${cx}" y="${H - 8}" text-anchor="middle">${d}</text>`;
      const caja = (v, desde, trazo) => `<rect x="${bx}" y="${y(v)}" width="${bw}" height="${y(desde) - y(v)}" rx="2" fill="none" ${trazo} stroke-dasharray="3 2"/>`;
      if (i < 4) return `<rect x="${bx}" y="${y(CUPO.hastaHoy[i])}" width="${bw}" height="${base - y(CUPO.hastaHoy[i])}" rx="2" fill="var(--soft)"/>${pie}`;
      if (i === 4) return `<rect x="${bx}" y="${y(CUPO.usado)}" width="${bw}" height="${base - y(CUPO.usado)}" rx="2" fill="var(--accent)"/><text x="${cx}" y="${y(CUPO.usado) - 5}" text-anchor="middle" style="fill:var(--text)">${CUPO.usado}</text>${pie}`;
      const v = m.proy[i - 4], lleno = v >= 100;
      const ultimo = i === nombresDia.length - 1;
      const primeroLleno = lleno && m.proy[i - 5] < 100;
      const rotulo = primeroLleno ? `<text x="${cx}" y="${y(v) - 5}" text-anchor="middle" style="fill:var(--bad)">se acaba</text>` : ultimo && !lleno ? `<text x="${cx}" y="${y(v) - 5}" text-anchor="middle" style="fill:var(--text)">${v}</text>` : "";
      return `${caja(v, 0, lleno ? rojo : gris)}${rotulo}${pie}`;
    })
    .join("");
  const dice = m.seAcaba ? `a ritmo ${m.nombre} se acaba ${m.cuando}` : `a ritmo ${m.nombre} llegás al sábado con ${m.llega} %`;
  return `<svg class="graf ${m.v}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cupo de la semana acumulado por día: ${CUPO.usado} % hoy; ${dice}">${ejes}${barras}</svg>`;
};
const aviso = (m) =>
  m.seAcaba
    ? `<div class="aviso ${m.v}">${I("alerta")}<p>A este ritmo <b>se acaba ${m.cuando}</b>, ${m.antes} horas antes de que vuelva.</p></div>`
    : `<div class="aviso ${m.v}">${I("check", "bien")}<p>A este ritmo <b>llegás al sábado con ${m.llega} % usado</b>.</p></div>`;
const medidor = (m) => {
  const escala = 20;
  return `<div class="medidor ${m.v}"><div class="pista"><i${m.ritmo > tope ? ' class="pasa"' : ""} style="width:${(m.ritmo / escala) * 100}%"></i></div><u style="left:${(tope / escala) * 100}%"></u><span class="tope" style="left:${(tope / escala) * 100}%">para llegar: ${porDia(tope)}</span></div>`;
};
// Resumen de una línea del cupo (panel plegado) y palabra del riel: salen de MODOS, siguen la marcha elegida.
const resumenCupo = MODOS.map((m) => `<span class="${m.v}">${CUPO.usado} % usado · ${m.seAcaba ? `a ritmo ${m.nombre} se acaba ${corto(m.cuando)}` : `a ritmo ${m.nombre} llegás con ${m.llega} %`}</span>`).join("");

// ---------- La barra: un solo arreglo de datos; de él salen filas, chips de arriba, marcas del riel y «N en marcha» ----------
const PROY = {
  trama: { sig: "tr", color: "#8fb5f0" },
  cauce: { sig: "ca", color: "#e0a07e" },
  atlas: { sig: "at", color: "#a9cf7c" },
  brote: { sig: "br", color: "#e58fae" },
  eco: { sig: "ec", color: "#9ba7b8" },
};
// Corona: resp = responde ahora; dirige = quieto pero corren workers suyos; quieta; fria = caché vencido;
// espera = te espera; murio; cerrado. Worker: corre ok fallo decide cola frenado trabado falta.
const DATOS = [
  {
    p: "trama",
    lideres: [
      {
        t: "Rediseño de la interfaz", corona: "dirige", modelo: "Opus high", rayo: "59m", tiempo: "hace 1 m", actual: true,
        workers: [
          { t: "Maqueta del chat nuevo", e: "corre", modelo: "Sonnet high", tiempo: "corre hace 4 m", tierna: "se esponja" },
          { t: "Capturas a 1280 px", e: "corre", modelo: "Haiku xhigh", tiempo: "corre hace 38 s", tierna: "hilvana" },
          { t: "Revisar los textos en inglés", e: "cola", modelo: "Haiku xhigh" },
        ],
        terminados: [
          { t: "Mapa de funciones de la barra", e: "ok", modelo: "Sonnet high", rayo: "4m", tiempo: "hace 1 h" },
          { t: "Inventario del panel Contexto", e: "ok", modelo: "Haiku xhigh", rayo: "52m", tiempo: "hace 2 h" },
        ],
      },
      { t: "Orden de la barra por proyecto", corona: "quieta", modelo: "Opus medium", rayo: "12m", tiempo: "hace 2 h" },
    ],
    claudeCode: [["Retomar pendientes del tablero", "hace 6 h"], ["Notas del reparto", "ayer"], ["Prueba de paridad en Windows", "hace 3 d"]],
    nClaudeCode: 12,
  },
  {
    p: "cauce",
    lideres: [
      {
        t: "Cierre de caja y conciliación", corona: "quieta", modelo: "Sonnet high", rayo: "21m", tiempo: "hace 25 m",
        workers: [
          { t: "Reintentar el cierre de caja", e: "fallo", modelo: "Sonnet high", tiempo: "hace 6 m" },
          { t: "Auditar los índices de envíos", e: "corre", modelo: "Sonnet high", tiempo: "corre hace 9 m", tierna: "se esponja" },
          { t: "Conciliar con el banco", e: "falta", modelo: "Haiku high", tiempo: "hace 40 m" },
        ],
        terminados: [{ t: "Redondeo del resumen mensual", e: "ok", modelo: "Haiku xhigh", rayo: "18m", tiempo: "hace 3 h" }],
      },
    ],
  },
  {
    p: "atlas",
    lideres: [
      {
        t: "Paginado del listado de envíos", corona: "espera", modelo: "Opus high", rayo: "8m",
        workers: [
          { t: "Elegir el tipo de paginado", e: "decide", modelo: "Sonnet high" },
          { t: "Migrar la config a TOML", e: "frenado", modelo: "Haiku xhigh", tiempo: "hace 1 h" },
          { t: "Medir el arranque en frío", e: "trabado", modelo: "Sonnet high", tiempo: "sin avance 14 m" },
        ],
        terminados: [
          { t: "Índices del listado", e: "ok", modelo: "Sonnet high", rayo: "30m", tiempo: "hace 5 h" },
          { t: "Export a CSV", e: "ok", modelo: "Haiku xhigh", tiempo: "hace 7 h" },
          { t: "Tests del paginado viejo", e: "ok", modelo: "Haiku xhigh", tiempo: "ayer" },
        ],
      },
      { t: "Auditoría de las rutas", corona: "murio", tiempo: "hace 3 h" },
      { t: "Revisión del esquema", corona: "cerrado", tiempo: "hace 22 m" },
    ],
  },
  {
    p: "brote",
    lideres: [
      {
        t: "Recordatorio de riego", corona: "resp", modelo: "Opus medium", sub: 2, tiempo: "12 s",
        workers: [
          { t: "Exportar el calendario a ICS", e: "corre", modelo: "Sonnet high", tiempo: "corre hace 40 s", tierna: "se esponja" },
          { t: "Probar el riego de los lunes", e: "ok", modelo: "Haiku xhigh", rayo: "4m", tiempo: "hace 1 h" },
        ],
      },
      { t: "Notas de la huerta", corona: "fria", modelo: "Opus medium", tiempo: "hace 2 d" },
    ],
    masQuietos: 2,
  },
  { p: "eco", plegado: "3 hilos, hace 3 d", lideres: [] },
  { p: "inicio", plegado: "12 hilos, hace 3 h", lideres: [] },
];
const cuenta = { espera: 0, fallo: 0 };
const marcha = {};
for (const g of DATOS) {
  marcha[g.p] = 0;
  g.hay = { fallo: 0, espera: 0 };
  for (const l of g.lideres) {
    if (l.corona === "espera") { cuenta.espera++; g.hay.espera++; }
    if (l.corona === "resp") marcha[g.p]++;
    for (const w of l.workers || []) {
      if (w.e === "decide") { cuenta.espera++; g.hay.espera++; }
      if (w.e === "fallo") { cuenta.fallo++; g.hay.fallo++; }
      if (w.e === "corre") marcha[g.p]++;
    }
  }
}
const esperan = cuenta.espera === 1 ? "1 espera" : `${cuenta.espera} esperan`;
const fallan = cuenta.fallo === 1 ? "1 falló" : `${cuenta.fallo} fallaron`;

// Marca de familia: forma + tono propios (rombo Opus, círculo Sonnet, triángulo Haiku). El chip sigue gris; sólo la marca lleva color.
const FAM = { opus: "op", sonnet: "so", haiku: "ha" };
const mfam = (n) => `<i class="mf ${FAM[n.toLowerCase()] || ""}" aria-hidden="true"></i>`;
const chipM = (m) => {
  if (!m) return "";
  const [n, e] = m.split(" ");
  return `<span class="chip" title="${m}">${mfam(n)}<span class="lg">${m}</span><span class="sh">${n[0]}${e ? " " + e : n.slice(1)}</span></span>`;
};
const rayo = (r, vencido) =>
  vencido
    ? `<span class="rayo frio" title="Caché vencido: el próximo mensaje relee todo y gasta más cupo">${I("rayo-v")}<span class="vh">Caché vencido</span></span>`
    : r
      ? `<span class="rayo" title="Caché caliente: dura ${r.replace("m", " min")} más; retomarlo ahora sale barato">${I("rayo")}${r}</span>`
      : "";
const COR = {
  resp: ["oro lleno", "Responde ahora", "corona"],
  dirige: ["oro", "Quieto; corren workers suyos", "corona"],
  quieta: ["gris", "Quieto", "corona"],
  fria: ["gris frio", "Quieto y con el caché vencido", "corona"],
  espera: ["espera", "Te espera: terminó su turno", "corona"],
  murio: ["murio", "Murió: se cayó con Trama andando", "corona"],
  cerrado: ["gris", "Cerrado: sin proceso, cerrado bien", "corona"],
};
const GL = {
  corre: `<span class="gl corre" title="Corre"><i></i></span>`,
  ok: `<span class="gl ok" title="Terminó">${I("check")}</span>`,
  fallo: `<span class="gl fallo" title="Falló: murió sin que nadie lo frenara">${I("x")}</span>`,
  decide: `<span class="gl decide" title="Pide que elijas algo">${I("preg")}</span>`,
  cola: `<span class="gl quieto" title="En cola">${I("reloj")}</span>`,
  frenado: `<span class="gl quieto" title="Lo paró pa --parar a propósito">${I("pausa")}</span>`,
  trabado: `<span class="gl trabado" title="Sin avance hace rato">${I("trabado")}</span>`,
  falta: `<span class="gl falta" title="Frenó porque le faltó información">${I("info")}</span>`,
};
const pal = (c, txt, ic) => `<span class="pal ${c}">${ic ? I(ic) : ""}${txt}</span>`;
const nota = (ic, txt, c = "") => `<span class="nota ${c}">${ic ? I(ic) : ""}${txt}</span>`;

const filaLider = (l, g) => {
  const [cl, tip, ic] = COR[l.corona];
  const apagado = l.corona === "fria" ? " apagada" : "";
  const sub = l.sub ? `<span class="rayo" title="Corren ${l.sub} subagentes: la sesión trabaja, no se enfría"><i class="pt"></i>${l.sub} sub.</span>` : "";
  let der = "";
  if (l.corona === "murio") der = pal("fallo", "Murió", "x") + `<span class="tiempo">${l.tiempo}</span>`;
  else if (l.corona === "cerrado") der = nota("fuera", "Cerrado") + `<span class="tiempo">${l.tiempo}</span>`;
  else if (l.corona === "espera") der = chipM(l.modelo) + rayo(l.rayo) + pal("espera", "te espera", "preg");
  else der = chipM(l.modelo) + (sub || rayo(l.rayo, l.corona === "fria")) + `<span class="tiempo">${l.tiempo}</span>`;
  const accion = l.corona === "resp" ? "Cerrar" : "Archivar";
  return `<a class="f lider${apagado}" href="#" style="--p:${PROY[g.p].color}"${l.actual ? ' aria-current="page"' : ""} title="${l.t} · ${tip}">
    <span class="cr ${cl}" title="${tip}">${I(ic, cl.includes("lleno") ? "llena" : "")}</span><span class="t">${l.t}</span>${der}${l.corona === "espera" ? "" : `<span class="acc"><button class="bm" tabindex="-1">${accion}</button></span>`}</a>`;
};
const filaWorker = (w, g) => {
  let der = "";
  const t = w.tiempo ? `<span class="tiempo">${w.tiempo}</span>` : "";
  const tierna = w.tierna ? `<span class="tierna">${w.tierna}</span>` : "";
  if (w.e === "corre") der = tierna + chipM(w.modelo) + t;
  else if (w.e === "ok") der = chipM(w.modelo) + rayo(w.rayo) + t;
  else if (w.e === "fallo") der = chipM(w.modelo) + pal("fallo", "falló", "x") + t;
  else if (w.e === "decide") der = chipM(w.modelo) + pal("decide", "decidir", "preg");
  else if (w.e === "cola") der = chipM(w.modelo) + nota("", "En cola");
  else if (w.e === "frenado") der = chipM(w.modelo) + nota("", "Frenado") + t;
  else if (w.e === "trabado") der = chipM(w.modelo) + nota("", "Trabado", "ambar");
  else if (w.e === "falta") der = chipM(w.modelo) + `<span class="pal suave">${I("info")}le falta info</span>`;
  const acc = w.e === "ok" ? "Integrar" : w.e === "fallo" ? "Retomar" : "";
  return `<a class="f worker ${w.e}" href="#" style="--p:${PROY[g.p].color}" title="${w.t}">${GL[w.e]}<span class="t">${w.t}</span>${der}${acc ? `<span class="acc"><button class="bm" tabindex="-1">${acc}</button></span>` : ""}</a>`;
};
const pliegue = (txt, cuerpo, abierto) => `<details class="plg"${abierto ? " open" : ""}><summary>${txt}${I("chev")}</summary>${cuerpo}</details>`;

const grupoHtml = (g) => {
  const c = PROY[g.p] || { sig: "", color: "#8f8f99" };
  const nombre = g.p === "inicio" ? "Inicio" : g.p;
  const mg = g.p === "inicio" ? `<span class="mg" style="--p:${c.color}">${I("casa")}</span>` : `<span class="mg" style="--p:${c.color}">${c.sig}</span>`;
  const m = marcha[g.p];
  if (g.plegado) {
    return `<section class="gr plegada" style="--p:${c.color}"><div class="gh"><button class="cv" aria-label="Desplegar ${nombre}" aria-expanded="false">${I("chev")}</button>${mg}<b>${nombre}</b><span class="marcha">${g.plegado}</span><button class="mas" aria-label="Chat nuevo en ${nombre}" title="Chat nuevo en ${nombre}">${I("mas")}</button></div></section>`;
  }
  const cuerpo = g.lideres
    .map((l) => {
      const ws = (l.workers || []).map((w) => filaWorker(w, g)).join("");
      const term = l.terminados?.length ? `<div class="hilo-p">${pliegue(`${l.terminados.length} ${l.terminados.length === 1 ? "terminado" : "terminados"}`, l.terminados.map((w) => filaWorker(w, g)).join(""))}</div>` : "";
      return filaLider(l, g) + `<div class="cuelga">${ws}${term}</div>`;
    })
    .join("");
  const cc = g.claudeCode ? pliegue(`De Claude Code (${g.nClaudeCode})`, g.claudeCode.map(([t, h]) => `<a class="f lider ext" href="#" title="${t}">${`<span class="cr gris">${I("corona")}</span>`}<span class="t">${t}</span><span class="tiempo">${h}</span></a>`).join("")) : "";
  const mq = g.masQuietos ? pliegue(`Ver ${g.masQuietos} más`, ["Riego de la terraza", "Semillas del invierno"].map((t) => `<a class="f lider apagada" href="#"><span class="cr gris">${I("corona")}</span><span class="t">${t}</span><span class="tiempo">hace 9 d</span></a>`).join("")) : "";
  return `<section class="gr" style="--p:${c.color}"><div class="gh"><button class="cv ab" aria-label="Plegar ${nombre}" aria-expanded="true">${I("chev")}</button>${mg}<b>${nombre}</b>${m ? `<span class="marcha"><i class="pt"></i>${m} en marcha</span>` : '<span class="marcha"></span>'}<button class="mas" aria-label="Chat nuevo en ${nombre}" title="Chat nuevo en ${nombre}">${I("mas")}</button></div>${cuerpo}${mq}${cc}</section>`;
};

const panelChats = `
<div class="top">
  <div class="fila-b"><label class="busca">${I("busca")}<span>Buscar chats</span><kbd>Ctrl K</kbd></label><button class="nuevo" aria-label="Chat nuevo" title="Chat nuevo · Ctrl N">${I("mas")}</button></div>
  <div class="fila-c">
    <button class="chp espera" aria-pressed="false" title="Líderes y workers que te esperan">${I("preg")}${esperan}</button>
    <button class="chp fallo" aria-pressed="false" title="Fallos sin resolver">${I("x")}${fallan}</button>
    <button class="orden" title="Orden de la lista">Recientes ${I("abajo")}</button>
  </div>
</div>
<nav class="lista" aria-label="Chats por proyecto">
  ${DATOS.map(grupoHtml).join("")}
  <div class="gr cerrados">${pliegue("Cerrados · 14", `<a class="f lider ext" href="#"><span class="raya" style="--p:${PROY.atlas.color}"></span><span class="t">Revisión del esquema</span><span class="nota">Integrado</span><span class="tiempo">hace 3 d</span></a><a class="f lider ext" href="#"><span class="raya" style="--p:${PROY.cauce.color}"></span><span class="t">Cierre del mes pasado</span><span class="nota">Descartado</span><span class="tiempo">hace 4 d</span></a>`)}</div>
</nav>`;
const resumenChats = `${esperan} · ${fallan}`;

// ---------- Contexto: una sola lista; el anillo, la barra y los porcentajes salen de ella ----------
const LIMITE = 300000;
const CAT = [
  { id: "msg", ic: "chat", n: "Mensajes", tono: "a", ayuda: "Lo que se dijeron vos y el modelo en esta conversación.", sub: [["Tuyos", 41230], ["Del modelo", 118604], ["De tools", 48753]], boton: true },
  { id: "tools", ic: "llave", n: "Tools", tono: "b", t: 2907, ayuda: "Las herramientas que el modelo puede usar." },
  { id: "mcp", ic: "enchufe", n: "MCP", tono: "b", t: 449, ayuda: "Herramientas de servidores MCP conectados." },
  { id: "skills", ic: "chispa", n: "Skills", tono: "c", ayuda: "Instrucciones que se cargan cuando una skill se activa.", items: [["ferox-orquestar", 2104, 1], ["taste-skill", 2011, 1], ["ui-ux-pro-max", 1893, 1], ["trama-orquestar", 1148, 1], ["Otras 6 skills", 934, 1], ["caveman", 1407, 0]] },
  { id: "mem", ic: "memoria", n: "Memoria", tono: "c", ayuda: "Archivos de instrucciones y memoria que se leen siempre.", items: [["CLAUDE.md", 2134, 1, "/home/ferox/CLAUDE.md"], ["AGENTS.md", 1933, 1, "/home/ferox/Proyectos/trama/AGENTS.md"], ["MEMORY.md", 506, 1, "~/.claude/projects/trama/memory"]] },
  { id: "sis", ic: "escudo", n: "Sistema", tono: "d", t: 3749, ayuda: "El prompt de sistema y las definiciones fijas." },
];
for (const c of CAT) {
  if (c.sub) c.t = c.sub.reduce((a, [, v]) => a + v, 0);
  if (c.items) c.t = c.items.filter((x) => x[2]).reduce((a, x) => a + x[1], 0);
}
const TOTAL = CAT.reduce((a, c) => a + c.t, 0);
const APAGADO = CAT.flatMap((c) => c.items || []).filter((x) => !x[2]).reduce((a, x) => a + x[1], 0);
console.assert(TOTAL === 228355, "el contexto tiene que sumar 228.355, suma " + TOTAL);
console.assert(TOTAL + APAGADO === 229762, "medido 229.762");
console.assert(CAT[0].t === 208587 && CAT[4].t === 4573 && CAT[3].t === 8090, "categorías");
const pct1 = (t) => ((t / LIMITE) * 100).toFixed(1).replace(".", ",") + " %";
const pctR = Math.round((TOTAL / LIMITE) * 100);

const sw = (nom, on) => `<button class="sw" role="switch" aria-checked="${on ? "true" : "false"}" aria-label="${nom}">${I("check")}<i></i></button>`;
const catHtml = (c) => {
  let cuerpo = "";
  if (c.sub) cuerpo += `<div class="sbs">${c.sub.map(([n, v]) => `<div class="sb"><span>${n}</span><span class="n">${miles(v)}</span></div>`).join("")}</div>`;
  if (c.id === "mem") cuerpo += c.items.map(([n, v, on, ruta]) => `<div class="arch2" data-tok="${v}" data-cat="${c.id}"><div><b class="mono">${n}</b><small class="mono">${ruta}</small></div><span class="n">${miles(v)}</span>${sw(n, on)}</div>`).join("");
  if (c.id === "skills") cuerpo += c.items.map(([n, v, on]) => `<div class="arch2 sk" data-tok="${v}" data-cat="${c.id}"><div><b>${n}</b></div><span class="n">${miles(v)}</span>${sw(n, on)}</div>`).join("");
  if (c.boton) cuerpo += `<div class="cmp"><button class="btn">${I("hojas")}Compactar</button><span class="gris">Resume lo viejo para liberar lugar.</span></div>`;
  const abierto = c.id === "msg" || c.id === "mem" || c.id === "skills";
  return `<details class="cat" data-id="${c.id}"${abierto ? " open" : ""}><summary><span class="ci t-${c.tono}">${I(c.ic)}</span><b>${c.n}</b><span class="n tok">${miles(c.t)}</span><span class="pc">${pct1(c.t)}</span><span class="cvr">${I("abajo")}</span><button class="ay" type="button" aria-label="Qué es ${c.n}" title="${c.ayuda}">${I("ayuda")}</button></summary>${cuerpo}</details>`;
};
const R = 34, CIRC = +(2 * Math.PI * R).toFixed(1);
const segs = CAT.map((c) => `<i class="seg t-${c.tono}" data-cat="${c.id}" style="width:${((c.t / LIMITE) * 100).toFixed(3)}%" title="${c.n}: ${miles(c.t)}"></i>`).join("");
const panelContexto = `
<div class="pestañas" role="tablist" aria-label="Contexto">
  <button role="tab" aria-selected="true" data-t="ses">${I("lista")}Sesiones</button><button role="tab" aria-selected="false" data-t="cat">${I("libro")}Catálogo<span class="x"> de skills</span></button><button role="tab" aria-selected="false" data-t="vp">${I("ojo")}Vista<span class="x"> previa</span></button>
</div>
<div class="tp" data-tp="ses">
  <div class="nota-c">${I("info")}<p>Apagar algo vale para toda Trama: los workers nuevos y el líder, desde su próximo mensaje.</p></div>
  <div class="lid"><span class="gris">Líder</span><b>Rediseño de la interfaz</b><span class="gris der">${mfam("Opus")}Opus 5.5</span></div>
  <div class="anillo-c">
    <svg viewBox="0 0 88 88" width="88" height="88" role="img" aria-label="${pctR} % del límite usado"><circle cx="44" cy="44" r="${R}" class="pista"/><circle id="ctx-arco" cx="44" cy="44" r="${R}" class="arco" stroke-dasharray="${((TOTAL / LIMITE) * CIRC).toFixed(1)} ${CIRC}" transform="rotate(-90 44 44)"/></svg>
    <div><b id="ctx-pct">${pctR} %</b><span id="ctx-tok">${miles(TOTAL)} de ${miles(LIMITE)} tokens</span></div>
  </div>
  <p class="medido">Medido: <span id="ctx-med">${miles(TOTAL + APAGADO)}</span> tokens. Sin lo que está apagado: <span id="ctx-sin">${miles(TOTAL)}</span>, desde el próximo mensaje.</p>
  <div class="pila" role="img" aria-label="Contexto por categoría, sobre un límite de ${miles(LIMITE)} tokens">${segs}</div>
  <div class="esc"><span>0</span><span>${miles(LIMITE)} tokens</span></div>
  <div class="cats">${CAT.map(catHtml).join("")}</div>
</div>
<div class="tp" data-tp="cat" hidden>
  <div class="nota-c">${I("info")}<p>Las skills que Trama encuentra en tu máquina. Una apagada no se carga en ningún chat.</p></div>
  ${[["ferox-orquestar", "Delegar trabajo de un proyecto a un worker", 1], ["taste-skill", "Dirección de arte sin lugares comunes", 1], ["ui-ux-pro-max", "Búsqueda de estilos, paletas y reglas de UX", 1], ["trama-orquestar", "Lanzar workers con pa", 1], ["caveman", "Voz terse", 0]].map(([n, d, on]) => `<div class="arch2 cs"><div><b>${n}</b><small>${d}</small></div>${sw(n, on)}</div>`).join("")}
</div>
<div class="tp" data-tp="vp" hidden>
  <div class="nota-c">${I("info")}<p>Así llega el contexto al modelo en el próximo mensaje, con lo apagado ya sacado.</p></div>
  <pre class="vp"><code>Sistema            ${miles(3749)}
Tools y MCP        ${miles(3356)}
Skills             ${miles(8090)}
Memoria            ${miles(4573)}
  CLAUDE.md        ${miles(2134)}
  AGENTS.md        ${miles(1933)}
  MEMORY.md        ${miles(506)}
Mensajes           ${miles(208587)}
-------------------------------
Total              ${miles(TOTAL)}</code></pre>
</div>`;
console.assert(2907 + 449 === 3356, "tools + mcp");
const resumenContexto = `${pctR} % · ${miles(TOTAL)} de ${miles(LIMITE)} tokens`;

// ---------- Cupo: el detalle, tres columnas cuando el panel es ancho ----------
const panelCupo = `
<div class="c3">
  <div class="col">
    <div class="cifra"><b>${CUPO.usado} %</b><span>usado · vuelve el sábado 13:30</span></div>
    ${MODOS.map(grafico).join("")}
    ${MODOS.map(aviso).join("")}
  </div>
  <div class="col">
    <div class="sub">Ritmo de los workers</div>
    <div class="seg3" role="radiogroup" aria-label="Ritmo de los workers">${MODOS.map((m, i) => `<input type="radio" name="r" id="${m.id}"${i === 0 ? " checked" : ""}><label for="${m.id}">${m.nombre}</label>`).join("")}</div>
    ${MODOS.map((m) => `<p class="modo ${m.v}">${m.que}</p>`).join("")}
    <div class="dato"><span>Gasto</span>${MODOS.map((m) => `<b class="${m.v}${m.ritmo > tope ? " pasa" : ""}">${porDia(m.ritmo)}</b>`).join("")}</div>
    ${MODOS.map(medidor).join("")}
    <div class="sub">Cupo de 5 horas</div>
    <div class="dato"><span>Usado</span><b>${CUPO.cinco} %</b><div class="tira"><i class="hoy" style="width:${CUPO.cinco}%"></i></div><small>vuelve en 2 h 14 min</small></div>
  </div>
  <div class="col">
    <div class="sub">En qué se fue esta semana</div>
    <div class="dato"><span>${mfam("Opus")}Opus 5.5</span><b>34 %</b><div class="tira"><i class="op" style="width:34%"></i></div></div>
    <div class="dato"><span>${mfam("Sonnet")}Sonnet 5.5</span><b>21 %</b><div class="tira"><i class="so" style="width:21%"></i></div></div>
    <div class="dato"><span>${mfam("Haiku")}Haiku 5.5</span><b>6 %</b><div class="tira"><i class="ha" style="width:6%"></i></div></div>
    <div class="sub">Hoy</div>
    <div class="dato"><span>Este chat</span><b>4 %</b></div>
    <div class="dato"><span>Sus workers</span><b>2 %</b></div>
    <div class="sub">Otras suscripciones</div>
    <div class="dato"><span>Google AI Pro</span><b>18 %</b><div class="tira"><i style="width:18%"></i></div><small>casi sin usar · vuelve el jueves 10:00</small></div>
  </div>
</div>`;

// ---------- El riel de proyectos: marcas de estado y cupos siempre a la vista ----------
const MARCA = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 4.5h6M2.5 8.5h6M11.5 11.5h6M11.5 15.5h6" stroke="var(--accent)"/><path d="M11.5 2.5v6M15.5 2.5v6M4.5 11.5v6M8.5 11.5v6" stroke="var(--text)"/></svg>`;
const monog = (g) => {
  const c = PROY[g.p];
  const fr = g.hay.fallo, es = g.hay.espera, m = marcha[g.p];
  const marca = fr ? `<span class="mk fallo">${I("x")}</span>` : es ? `<span class="mk decide">${I("preg")}</span>` : m ? `<span class="mk corre"><i></i></span>` : "";
  const tip = fr ? `${g.p}: un worker falló` : es ? `${g.p}: te espera algo` : m ? `${g.p}: ${m} en marcha` : g.p;
  return `<div class="mr" style="--p:${c.color}"><button class="mono-r" data-tip="${tip}" aria-label="${tip}">${c.sig}</button>${marca}</div>`;
};
// ---------- Cupos al pie del riel: tres ejecuciones del anillo (anillos, doble, arcos). Todo sale de CUPO y MODOS ----------
// Dónde deberías estar si gastaras parejo: 5 h pasaron 2 h 46 de 5; la semana, 3,8 de 7 días.
const ESP5 = Math.round(((5 * 60 - (2 * 60 + 14)) / (5 * 60)) * 100);
const ESPS = Math.round((CUPO.pasaron / CUPO.semana) * 100);
const ojoSem = (m) => m.seAcaba || CUPO.usado >= 80;
const textoSem = (m) => (m.seAcaba ? `se acaba ${corto(m.cuando)}` : `llegás con ${m.llega} %`);
// Estado: bien (turquesa), ojo (ámbar: desde 80 % o si no llega), mal (rojo: agotado). Siempre con ícono y palabra.
const estado = (pct, ojo) => (pct >= 100 ? "mal" : ojo || pct >= 80 ? "ojo" : "bien");
const ICE = { bien: "check", ojo: "alerta", mal: "x" };
const PALE = { bien: "Bien", ojo: "Se acaba", mal: "Agotado" };
const insig = (e) => `<span class="insig ${e}" aria-hidden="true">${I(ICE[e])}</span>`;
const punto = (cx, cy, r, f) => [(cx + r * Math.cos(2 * Math.PI * f - Math.PI / 2)).toFixed(2), (cy + r * Math.sin(2 * Math.PI * f - Math.PI / 2)).toFixed(2)];
// Anillo simple: 48 px, trazo de 5 con puntas redondas sobre la pista; la marca cruza la pista donde deberías ir.
const anillo = (pct, esp, e, rot, num = true) => {
  const r = 20, c = 2 * Math.PI * r;
  const marca = esp == null ? "" : (() => { const a = punto(24, 24, r - 4.5, esp / 100), b = punto(24, 24, r + 4.5, esp / 100); return `<line class="marca" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`; })();
  return `<span class="ani"><svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="${r}" class="pista"/><circle cx="24" cy="24" r="${r}" class="arco ${e}" stroke-dasharray="${((Math.min(pct, 100) / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 24 24)"/>${marca}</svg><b>${pct} %</b>${insig(e)}</span><span class="rot-r">${rot}</span>`;
};
// Doble: Semana afuera, 5 h adentro; el número es el del que está peor.
const doble = (m) => {
  const eS = estado(CUPO.usado, ojoSem(m)), e5 = estado(CUPO.cinco, false);
  const peorSem = eS !== "bien" || CUPO.usado >= CUPO.cinco;
  const e = peorSem ? eS : e5, num = peorSem ? CUPO.usado : CUPO.cinco, rot = peorSem ? "Semana" : "5 h";
  const arc = (r, pct, est) => { const c = 2 * Math.PI * r; return `<circle cx="26" cy="26" r="${r}" class="pista"/><circle cx="26" cy="26" r="${r}" class="arco ${est}" stroke-dasharray="${((pct / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 26 26)"/>`; };
  const a = punto(26, 26, 22.5 - 4.5, ESPS / 100), b = punto(26, 26, 22.5 + 4.5, ESPS / 100);
  return `<span class="ani dob"><svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">${arc(22.5, CUPO.usado, eS)}${arc(15.5, CUPO.cinco, e5)}<line class="marca" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/></svg><b>${num}%</b>${insig(e)}</span><span class="rot-r">${rot}</span>`;
};
// Arcos: medio círculo de 180° con el número abajo y la marca de ritmo como aguja corta.
const arco = (pct, esp, e, rot) => {
  const r = 24, L = Math.PI * r;
  const p = (f, rr) => [(30 - rr * Math.cos(Math.PI * f)).toFixed(2), (32 - rr * Math.sin(Math.PI * f)).toFixed(2)];
  const a = p(esp / 100, r - 6.5), b = p(esp / 100, r + 6.5);
  return `<span class="arc"><svg viewBox="0 0 60 36" width="60" height="36" aria-hidden="true"><path class="pista" d="M6 32A24 24 0 0 1 54 32"/><path class="arco ${e}" d="M6 32A24 24 0 0 1 54 32" stroke-dasharray="${((pct / 100) * L).toFixed(1)} ${L.toFixed(1)}"/><line class="marca" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/></svg>${insig(e)}</span><b class="num">${pct} %</b><span class="rot-r">${rot}</span>`;
};
const etiqueta = (rot, pct, e, extra) => `${rot} ${pct} %: ${PALE[e]}${extra ? ", " + extra : ""}`;
const e5 = estado(CUPO.cinco, false);
const botonesC = (cls, f5, fS) =>
  `<div class="ej e-${cls}">
    <button class="cb" data-abre="cupo" type="button" aria-label="${etiqueta("5 horas", CUPO.cinco, e5, "vuelve en 2 h 14 min")}. Abrir el detalle">${f5()}</button>
    ${MODOS.map((m) => `<button class="cb ${m.v}" data-abre="cupo" type="button" aria-label="${etiqueta("Semana", CUPO.usado, estado(CUPO.usado, ojoSem(m)), `a ritmo ${m.nombre} ${textoSem(m)}`)}. Abrir el detalle">${fS(m)}</button>`).join("")}
  </div>`;
const fila5 = `<div class="cc-f ${e5}">${I(ICE[e5])}<span><b>5 h</b> · ${CUPO.cinco} % · ${PALE[e5]} · vuelve en 2 h 14 min</span></div>`;
const filaS = MODOS.map((m) => { const e = estado(CUPO.usado, ojoSem(m)); return `<div class="cc-f ${e} ${m.v}">${I(ICE[e])}<span><b>Semana</b> · ${CUPO.usado} % · ${e === "bien" ? "Bien · " : ""}a ritmo ${m.nombre} ${textoSem(m)}</span></div>`; }).join("");
const cupos = `
  <div class="cupos" role="group" aria-label="Cupos de uso">
    ${botonesC("an", () => anillo(CUPO.cinco, null, e5, "5 h"), (m) => anillo(CUPO.usado, ESPS, estado(CUPO.usado, ojoSem(m)), "Semana"))}
    <div class="ej e-dob">${MODOS.map((m) => `<button class="cb ${m.v}" data-abre="cupo" type="button" aria-label="${etiqueta("Semana", CUPO.usado, estado(CUPO.usado, ojoSem(m)), `a ritmo ${m.nombre} ${textoSem(m)}`)}; 5 horas ${CUPO.cinco} %, vuelve en 2 h 14 min. Abrir el detalle">${doble(m)}</button>`).join("")}</div>
    ${botonesC("arc", () => arco(CUPO.cinco, ESP5, e5, "5 h"), (m) => arco(CUPO.usado, ESPS, estado(CUPO.usado, ojoSem(m)), "Semana"))}
    <div class="cc" role="group" aria-label="Detalle de los cupos">
      <div class="cc-t">${I("medidor")}Cupos</div>
      ${fila5}${filaS}
      <button class="btn" data-abre="cupo" type="button">${I("medidor")}Ver cupo</button>
    </div>
  </div>`;
const riel = `
<aside class="riel" aria-label="Proyectos">
  <div class="logo" title="Trama">${MARCA}</div>
  <button class="mono-r todo" aria-pressed="true" data-tip="Todos los proyectos" aria-label="Todos los proyectos">Todo</button>
  ${DATOS.filter((g) => g.p !== "inicio").map(monog).join("")}
  <button class="mono-r" style="--p:#8f8f99" data-tip="Inicio: tu carpeta personal" aria-label="Inicio">${I("casa")}</button>
  <div class="hueco"></div>
  ${cupos}
  <a class="ric" href="#" data-tip="Ramas: 9 sin integrar" aria-label="Ramas, 9 sin integrar">${I("rama")}<span>Ramas</span><em>9</em></a>
  <a class="ric" href="#" data-tip="Estadísticas" aria-label="Estadísticas">${I("barras")}<span>Estad.</span></a>
  <a class="ric" href="#" data-tip="Ajustes y apariencia" data-tema aria-label="Ajustes: apariencia y temas">${I("ajustes")}<span>Ajustes</span></a>
</aside>`;

// ---------- El chat (centro) ----------
const tocados = [["app/src/barra/Paneles.tsx", 212, 0, "ts"], ["app/src/barra/paneles.css", 96, 0, "css"], ["app/src/i18n/es.ts", 14, 2, "ts"], ["app/src/i18n/en.ts", 14, 2, "ts"]];
// Quién habla: el líder con su corona y su nombre arriba de cada mensaje suyo.
const quien = `<div class="quien"><span class="cr oro">${I("corona", "llena")}</span><b>Líder</b><span class="mod">${mfam("Opus")}Opus 5.5</span></div>`;
const hilo = `
<div class="dia">Hoy · miércoles 11 de noviembre</div>
<div class="el">
  ${quien}
  <p>Terminó el worker de la maqueta. Pasó los chequeos y no choca con main:</p>
  <div class="blq wk res">
    <div class="blq-c ok">${I("rama")}<b>Worker</b><span>Maqueta del chat nuevo</span><span class="der s ok">${I("check")}terminó en 14 min</span></div>
    ${tocados.map(([f, mas, menos, tipo]) => `<div class="fila">${I("archivo", "ar-" + tipo)}<span class="mono">${f}</span><span class="mas">+${mas}</span><span class="menos">${menos ? `−${menos}` : ""}</span></div>`).join("")}
    <div class="cheq"><span>${I("check")}tipos</span><span>${I("check")}build</span><span>${I("check")}431 tests</span><span>${I("check")}sin conflictos con main</span></div>
    <div class="acc"><button class="btn pri">${I("merge")}Integrar</button><button class="btn">${I("diff")}Ver los cambios</button><button class="btn liso">${I("fuera")}Descartar</button><small>${mfam("Sonnet")}Sonnet high · gastó 2 % del cupo</small></div>
  </div>
</div>
<div class="yo">Integralo.</div>
<div class="el">
  ${quien}
  <p>Integrado en main. Dejé la maqueta en esta carpeta:</p>
  <div class="blq">
    <div class="blq-c car">${I("carpeta")}<b>Carpeta</b><span>2 archivos · 212 KB · de hace 1 min</span></div>
    <div class="carp"><b>~/Proyectos/trama/maquetas/taller</b><small>creada hace 1 min</small><div class="acc"><button class="btn pri">${I("carpeta")}Abrir carpeta</button><button class="btn">${I("copiar")}Copiar ruta</button></div></div>
    <div class="arch">${I("archivo", "ar-html")}<span class="mono">e-taller.html</span><small>la maqueta con paneles que se arrastran</small><button class="btn">${I("abrir")}Abrir</button></div>
    <div class="arch">${I("archivo", "ar-md")}<span class="mono">LEEME.md</span><small>cómo abrirla</small><button class="btn">${I("abrir")}Abrir</button></div>
  </div>
  <p>Queda una sola cosa, y es tuya: probarla andando.</p>
  <div class="blq">
    <div class="blq-c pj" style="--p:${PROY.trama.color}">${I("lista")}<b>Pendientes</b><span class="mg">${PROY.trama.sig}</span><span class="pj-n">trama</span><span class="cuenta">2 tuyos · 1 cerrado</span><span class="der">el más viejo, de hace 14 días</span></div>
    <div class="pen"><span class="tipo probar">${I("prueba")}Probar</span><p>Arrastrá el panel Chats a la derecha y volvé a abrir la app: tiene que quedar donde lo dejaste.</p><div class="acc"><button class="btn si">${I("check")}Anduvo</button><button class="btn liso no">${I("x")}No anduvo</button></div></div>
    <div class="pen"><span class="tipo decide">${I("preg")}Decidir</span><p>Si aparecen tests rojos nuevos contra main, ¿freno la integración o sólo te aviso?</p><div class="acc"><button class="btn">${I("pausa")}Frená</button><button class="btn liso">${I("info")}Sólo avisá</button></div></div>
    <div class="pen hecho"><span class="tipo probar">${I("prueba")}Probar</span><p>Tocar «Release notes» en el aviso de Trama nueva y ver que abre GitHub.</p><span class="cerrada">${I("check")}Anduvo</span></div>
  </div>
</div>`;

// ---------- Temas: un tema es un juego de valores para los tokens. Todos oscuros y de fondo liso ----------
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbHex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const mezcla = (a, b, t) => { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); };
const lumRel = (h) => { const c = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contraste = (a, b) => { const x = lumRel(a), y = lumRel(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// Papeles: fondo (ground), hoja (sheet), bloque (block), elevado (raised), borde, control, texto, suave, apagado, acento,
// bien (ok), aviso (warn), falló (bad), Probar, carpeta (naranja) y las tres familias de modelo. hover y rule se derivan.
const TEMAS_BASE = [
  { id: "grafito", nombre: "Grafito", ground: "#08080a", sheet: "#17171a", block: "#1f1f23", raised: "#2a2a30", border: "#34343b", control: "#4a4a53", text: "#f5f5f6", soft: "#d2d2d7", muted: "#9c9ca6", accent: "#8fb5f0", ok: "#55d0c8", warn: "#e3b65a", bad: "#f07a7a", probar: "#b79cf0", naranja: "#ee9c74", opus: "#d98fb2", son: "#9cc58a", hai: "#cdb68a", gold: "#d8b25a", hover: "#141417", rule: "#28282e", ink: "#14110a" },
  { id: "tinta", nombre: "Tinta", ground: "#05070c", sheet: "#11151f", block: "#19202d", raised: "#252e40", border: "#2e384c", control: "#455066", text: "#f5f5f6", soft: "#d2d2d7", muted: "#9c9ca6", accent: "#8fb5f0", ok: "#55d0c8", warn: "#e3b65a", bad: "#f07a7a", probar: "#b79cf0", naranja: "#ee9c74", opus: "#d98fb2", son: "#9cc58a", hai: "#cdb68a", gold: "#d8b25a", hover: "#0e121a", rule: "#222a3a", ink: "#14110a" },
  { id: "carbon", nombre: "Carbón", ground: "#0a0908", sheet: "#1b1916", block: "#24211d", raised: "#312d27", border: "#3b362e", control: "#524c42", text: "#f5f5f6", soft: "#d2d2d7", muted: "#9c9ca6", accent: "#8fb5f0", ok: "#55d0c8", warn: "#e3b65a", bad: "#f07a7a", probar: "#b79cf0", naranja: "#ee9c74", opus: "#d98fb2", son: "#9cc58a", hai: "#cdb68a", gold: "#d8b25a", hover: "#15130f", rule: "#2d2924", ink: "#14110a" },
  { id: "shell", nombre: "Shell", ground: "#07080b", sheet: "#101217", block: "#161922", raised: "#1f232d", border: "#2a2f3a", control: "#434a58", text: "#f4f5f7", soft: "#cfd3da", muted: "#98a0ad", accent: "#d3d7de", ok: "#7ad69b", warn: "#f2c35a", bad: "#f26d6d", probar: "#b9a3f0", naranja: "#f0a08a", opus: "#eaa0c8", son: "#9ad48a", hai: "#f0c27a" },
  // Catppuccin Mocha (base #1e1e2e, mantle #181825, crust #11111b, surface0-2, text #cdd6f4)
  { id: "catppuccin", nombre: "Catppuccin Mocha", ground: "#11111b", sheet: "#181825", block: "#1e1e2e", raised: "#313244", border: "#45475a", control: "#585b70", text: "#cdd6f4", soft: "#bac2de", muted: "#a6adc8", accent: "#89b4fa", ok: "#a6e3a1", warn: "#f9e2af", bad: "#f38ba8", probar: "#cba6f7", naranja: "#fab387", opus: "#f5c2e7", son: "#94e2d5", hai: "#f5e0dc" },
  // Tokyo Night (bg #1a1b26, bg_dark #16161e, bg_highlight #292e42, fg #c0caf5)
  { id: "tokyo", nombre: "Tokyo Night", ground: "#16161e", sheet: "#1a1b26", block: "#1f2335", raised: "#292e42", border: "#3b4261", control: "#545c7e", text: "#c0caf5", soft: "#a9b1d6", muted: "#8a93bd", accent: "#7aa2f7", ok: "#9ece6a", warn: "#e0af68", bad: "#f7768e", probar: "#bb9af7", naranja: "#ff9e64", opus: "#f29bc0", son: "#73daca", hai: "#e6cf9a" },
  // Gruvbox oscuro (bg0_h #1d2021, bg0 #282828, bg1 #3c3836, fg #ebdbb2)
  { id: "gruvbox", nombre: "Gruvbox oscuro", ground: "#1d2021", sheet: "#282828", block: "#32302f", raised: "#3c3836", border: "#504945", control: "#665c54", text: "#ebdbb2", soft: "#d5c4a1", muted: "#a89984", accent: "#83a598", ok: "#b8bb26", warn: "#fabd2f", bad: "#fd6652", probar: "#d3869b", naranja: "#fe8019", opus: "#e0a0b0", son: "#8ec07c", hai: "#d5c4a1" },
  // Nord (nord0 #2e3440 … nord15); el rojo oficial #bf616a se aclara; en Gruvbox y Dracula el rojo también se aclara un poco para que el texto «falló» se lea
  { id: "nord", nombre: "Nord", ground: "#1e222a", sheet: "#262b35", block: "#2e3440", raised: "#3b4252", border: "#434c5e", control: "#5b6780", text: "#eceff4", soft: "#d8dee9", muted: "#aeb8cc", accent: "#88c0d0", ok: "#a3be8c", warn: "#ebcb8b", bad: "#e08a94", probar: "#c09bba", naranja: "#d98e78", opus: "#d9a3c4", son: "#8fbcbb", hai: "#e5d3a8" },
  // Rosé Pine (base #191724, surface #1f1d2e, overlay #26233a, text #e0def4)
  { id: "rosepine", nombre: "Rosé Pine", ground: "#14121f", sheet: "#191724", block: "#1f1d2e", raised: "#26233a", border: "#403d52", control: "#524f67", text: "#e0def4", soft: "#cdcae6", muted: "#908caa", accent: "#9ccfd8", ok: "#3e8fb0", warn: "#f6c177", bad: "#eb6f92", probar: "#c4a7e7", naranja: "#ebbcba", opus: "#e8a0bd", son: "#8fcf9f", hai: "#e0c9a0" },
  // Dracula (background #282a36, current line #44475a, foreground #f8f8f2)
  { id: "dracula", nombre: "Dracula", ground: "#21222c", sheet: "#282a36", block: "#2f3140", raised: "#3a3d4f", border: "#44475a", control: "#6272a4", text: "#f8f8f2", soft: "#e0e0da", muted: "#a9b0cf", accent: "#8be9fd", ok: "#50fa7b", warn: "#f1fa8c", bad: "#ff6b6b", probar: "#bd93f9", naranja: "#ffb86c", opus: "#ff79c6", son: "#69e0b5", hai: "#e8d8a0" },
].map((t) => ({
  ...t,
  hover: t.hover || mezcla(t.ground, t.sheet, 0.55),
  rule: t.rule || mezcla(t.sheet, t.border, 0.5),
  gold: t.gold || t.warn,
  ink: t.ink || t.ground,
}));
const TEMAS = TEMAS_BASE.map((t) => ({
  id: t.id,
  nombre: t.nombre,
  v: {
    "--ground": t.ground, "--sheet": t.sheet, "--block": t.block, "--raised": t.raised, "--hover": t.hover, "--border": t.border, "--rule": t.rule, "--control": t.control,
    "--text": t.text, "--soft": t.soft, "--muted": t.muted, "--accent": t.accent, "--ok": t.ok, "--warn": t.warn, "--bad": t.bad, "--probar": t.probar, "--naranja": t.naranja,
    "--m-opus": t.opus, "--m-son": t.son, "--m-hai": t.hai, "--gold": t.gold, "--ink": t.ink,
  },
}));
// Chequeo de contraste (4,5:1) de cada tema: se avisa por consola, no se corta.
for (const t of TEMAS_BASE) {
  const mal = [];
  for (const fondo of ["sheet", "block", "raised"]) {
    for (const k of ["text", "soft", "muted", "accent", "ok", "warn", "bad", "probar", "naranja", "opus", "son", "hai"]) if (contraste(t[k], t[fondo]) < 4.5) mal.push(`${k}/${fondo} ${contraste(t[k], t[fondo]).toFixed(1)}`);
  }
  for (const k of ["warn", "bad"]) if (contraste(t.ink, t[k]) < 4.5) mal.push(`ink/${k} ${contraste(t.ink, t[k]).toFixed(1)}`);
  if (mal.length) console.log("CONTRASTE", t.id, mal.join(" · "));
}

const css = `
:root{--ground:#08080a;--sheet:#17171a;--block:#1f1f23;--raised:#2a2a30;--hover:#141417;--border:#34343b;--rule:#28282e;--control:#4a4a53;
--text:#f5f5f6;--soft:#d2d2d7;--muted:#9c9ca6;--accent:#8fb5f0;--ok:#55d0c8;--warn:#e3b65a;--bad:#f07a7a;--gold:#d8b25a;--ink:#14110a;
--probar:#b79cf0;--naranja:#ee9c74;--m-opus:#d98fb2;--m-son:#9cc58a;--m-hai:#cdb68a;--on-accent:#0b1220}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%}
body{font:400 14px/1.45 "IBM Plex Sans",Inter,system-ui,sans-serif;color:var(--soft);background:var(--ground);overflow:hidden;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit;background:none;border:0}
button{cursor:pointer}
a{color:inherit;text-decoration:none}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
svg.i{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;flex:none}
svg.i.llena{fill:currentColor}
.mono,code,kbd,pre{font-family:"IBM Plex Mono","JetBrains Mono",ui-monospace,monospace;font-size:12.5px}
code{color:var(--text)}
kbd{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border:1px solid var(--control);border-radius:4px;color:var(--muted);font-size:12px;font-family:inherit}
.gris{color:var(--muted)}
.app{display:grid;grid-template-columns:76px minmax(0,1fr);height:calc(100vh - 34px)}

/* ---------- franja de la maqueta ---------- */
.salto{height:34px;display:flex;align-items:center;gap:2px;padding:0 18px;background:#000;border-bottom:1px solid #2a2a2e;font-size:12px;font-weight:500;line-height:1;position:relative}
.salto>span{color:#8f8f95;margin-right:8px;font-weight:400}
.salto>span.tit{color:#fff;font-weight:500}
.salto label,.salto button{padding:6px 10px;border-radius:6px;color:#c6c6c9;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.salto button:hover,.salto label:hover{color:#fff}
.salto i{width:1px;height:16px;background:#3a3a3e;margin:0 10px}
.salto input{position:absolute;opacity:0;pointer-events:none}
.salto input:checked+label{background:#34343a;color:#fff}
.salto input:focus-visible+label{outline:2px solid var(--accent)}
.salto .reset{border:1px solid #3a3a3e}
.salto .nota-s{margin-left:auto;margin-right:0;color:#a9a9af;display:inline-flex;align-items:center;gap:6px}
.salto svg.i{width:14px;height:14px}

/* ---------- riel de proyectos ---------- */
.riel{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 0 10px;min-height:0;position:relative;z-index:5}
.logo{width:40px;height:40px;display:grid;place-items:center;margin-bottom:2px}
.logo svg{width:22px;height:22px;fill:none;stroke-width:2.2;stroke-linecap:round}
.mono-r{position:relative;width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:14px;font-weight:600;color:var(--p);background:color-mix(in srgb,var(--p) 20%,var(--ground));border:1px solid color-mix(in srgb,var(--p) 34%,var(--ground))}
.mono-r:hover{border-color:var(--p)}
.mono-r.todo{font-size:12px;color:var(--text);background:var(--raised);border-color:var(--control)}
.mono-r[aria-pressed="true"]::before{content:"";position:absolute;left:-8px;top:10px;bottom:10px;width:3px;border-radius:2px;background:var(--text)}
.mono-r svg{width:18px;height:18px}
.mr{position:relative;width:40px;height:40px}
.mk{position:absolute;pointer-events:none;right:-5px;top:-5px;width:16px;height:16px;border-radius:8px;display:grid;place-items:center;border:2px solid var(--ground);color:var(--ink)}
.mk svg{width:10px;height:10px;stroke-width:3}
.mk.fallo{background:var(--bad)}.mk.decide{background:var(--warn)}
.mk.corre{background:var(--ground);width:14px;height:14px;right:-4px;top:-4px}
.mk.corre i{width:6px;height:6px;border-radius:3px;background:var(--accent);box-shadow:none;border:0}
.hueco{flex:1}
.ric{width:62px;height:46px;display:grid;justify-items:center;align-content:center;gap:2px;border-radius:10px;color:var(--muted);position:relative;font-size:11px}
.ric:hover{background:var(--hover);color:var(--text)}
.ric svg{width:17px;height:17px}
.ric em{position:absolute;top:2px;right:6px;font-style:normal;font-size:11px;font-weight:600;min-width:16px;height:16px;padding:0 4px;border-radius:8px;display:grid;place-items:center;background:var(--raised);color:var(--text);border:1px solid var(--control)}
/* tooltips del riel: con palabras, no sólo por el color */
[data-tip]:hover::after,[data-tip]:focus-visible::after{content:attr(data-tip);position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);z-index:60;white-space:nowrap;padding:6px 10px;border-radius:8px;background:var(--raised);border:1px solid var(--control);color:var(--text);font-size:12.5px;font-weight:400;pointer-events:none;box-shadow:0 6px 18px rgba(0,0,0,.5)}
/* ---------- «Cupos» al pie del riel: tres ejecuciones del anillo (se elige en la franja negra) ---------- */
.cupos{position:relative;display:grid;gap:2px;justify-items:center}
.ej{display:none}
body:has(#c1:checked) .ej.e-an,body:has(#c2:checked) .ej.e-dob,body:has(#c3:checked) .ej.e-arc{display:grid;gap:2px;justify-items:center}
.cb{width:68px;display:grid;justify-items:center;align-content:start;gap:2px;padding:6px 0 5px;border-radius:12px;position:relative}
.cb:hover,.cupos:focus-within .cb:focus-visible{background:var(--hover)}
.ani{position:relative;display:block;width:48px;height:48px}
.ani.dob{width:52px;height:52px}
.ani svg,.arc svg{display:block;overflow:visible}
.ani circle,.arc path{fill:none;stroke-width:5;stroke-linecap:round}
.ani.dob circle{stroke-width:4.5}
.pista{stroke:var(--rule)}
.arco.bien{stroke:var(--ok)}.arco.ojo{stroke:var(--warn)}.arco.mal{stroke:var(--bad)}
.marca{stroke:var(--text);stroke-width:2;stroke-linecap:butt}
.ani b{position:absolute;inset:0;display:grid;place-items:center;font-size:13px;font-weight:600;color:var(--text);white-space:nowrap}
.ani.dob b{font-size:12px}
.arc{position:relative;display:block;width:60px;height:36px}
.arc+.num{font-size:13px;font-weight:600;color:var(--text);line-height:1.1;margin-top:-2px}
.rot-r{font-size:11px;color:var(--muted);line-height:1.2;white-space:nowrap}
.insig{position:absolute;right:-6px;top:-4px;width:16px;height:16px;border-radius:8px;display:grid;place-items:center;border:2px solid var(--ground);color:var(--ink)}
.arc .insig{right:-4px;top:-6px}
.insig svg{width:10px;height:10px;stroke-width:3}
.insig.bien{background:var(--ok)}.insig.ojo{background:var(--warn)}.insig.mal{background:var(--bad)}
.cc{display:none;position:absolute;left:calc(100% + 6px);bottom:0;width:310px;z-index:60;padding:12px 14px 14px;border-radius:12px;background:var(--raised);border:1px solid var(--control);text-align:left;gap:10px}
.cc::before{content:"";position:absolute;left:-14px;top:0;bottom:0;width:14px}
.cupos:hover .cc,.cupos:focus-within .cc{display:grid}
.cc-t{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--text)}
.cc-t svg{width:15px;height:15px;color:var(--soft)}
.cc-f{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;font-size:13px;line-height:1.45;color:var(--soft)}
.cc-f svg{width:15px;height:15px;margin-top:2px;stroke-width:2.25}
.cc-f.bien svg{color:var(--ok)}.cc-f.ojo svg{color:var(--warn)}.cc-f.mal svg{color:var(--bad)}
.cc-f b{color:var(--text);font-weight:600}
.cc .btn{justify-self:start}
body:has(#r1:checked) :is(.v2,.v3),body:has(#r2:checked) :is(.v1,.v3),body:has(#r3:checked) :is(.v1,.v2){display:none}

@media (prefers-reduced-motion:no-preference){
@keyframes late{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.7)}}
.gl.corre i,.pt,.mk.corre i{animation:late 1.8s ease-in-out infinite}
.f,.btn,.ib,.cb,.ric,.mono-r,.ficha,.mu{transition:background-color .12s,border-color .12s,color .12s}
}

/* ---------- panel de temas ---------- */
.salto .tn{color:#8f8f95;font-weight:400}
.tema{position:fixed;top:44px;right:16px;width:420px;max-height:calc(100vh - 60px);overflow:auto;z-index:70;background:var(--raised);border:1px solid var(--control);border-radius:12px;padding-bottom:16px;scrollbar-width:thin;scrollbar-color:var(--control) transparent}
.tema[hidden]{display:none}
.tema header{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;height:48px;padding:0 8px 0 16px;background:var(--raised);border-bottom:1px solid var(--control)}
.tema header .pic svg{width:16px;height:16px;color:var(--soft)}
.tema h2{font-size:14px;font-weight:600;color:var(--text)}
.tema header .esp{flex:1}
.tema section{padding:14px 16px 0}
.tema h3{font-size:12.5px;font-weight:600;color:var(--muted);margin-bottom:8px}
.tema h3 .sin{font-weight:400;color:var(--warn)}
.fichas{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.ficha{display:grid;gap:6px;padding:5px 5px 7px;border-radius:10px;border:1px solid var(--border);text-align:left;font-size:12.5px;color:var(--soft);background:none;min-width:0}
.ficha:hover{border-color:var(--muted)}
.ficha[aria-checked="true"]{border-color:var(--accent);color:var(--text)}
.ficha .fn{display:flex;align-items:center;gap:4px;padding:0 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500}
.ficha .fn svg{width:13px;height:13px;color:var(--accent);stroke-width:2.25;flex:none}
.mini{position:relative;display:block;height:54px;border-radius:6px;background:var(--ground);border:1px solid var(--border);overflow:hidden}
.mini i{position:absolute;display:block}
.m-h{left:8px;right:8px;top:9px;bottom:-1px;border-radius:4px 4px 0 0;background:var(--sheet);border:1px solid var(--border);border-bottom:0}
.m-b{right:14px;top:15px;width:24px;height:22px;border-radius:3px;background:var(--block);border:1px solid var(--border)}
.m-a{left:14px;top:15px;width:26px;height:4px;border-radius:2px;background:var(--accent)}
.m-t{left:14px;top:24px;width:34px;height:3px;border-radius:2px;background:var(--muted)}
.m-p{position:absolute;left:14px;bottom:6px;display:flex;gap:4px}
.m-p i{position:static;width:7px;height:7px;border-radius:4px}
.m-p .o{background:var(--ok)}.m-p .w{background:var(--warn)}.m-p .x{background:var(--bad)}
.muestras{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.mu{width:24px;height:24px;border-radius:12px;background:var(--c);flex:none}
.mu[aria-pressed="true"]{outline:2px solid var(--text);outline-offset:2px}
.mu:hover{outline:2px solid var(--muted);outline-offset:2px}
.cp-uno,.cp{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--soft)}
input[type=color]{width:32px;height:26px;padding:0;border:1px solid var(--control);border-radius:8px;background:none;cursor:pointer;flex:none}
input[type=color]::-webkit-color-swatch-wrapper{padding:2px}
input[type=color]::-webkit-color-swatch{border:0;border-radius:6px}
.cps{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
.cp span{flex:1;min-width:0}
.cp code{font-size:11.5px;color:var(--muted)}
.aviso-c{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12.5px;color:var(--warn)}
.aviso-c[hidden]{display:none}
.aviso-c svg{width:15px;height:15px}
.acc2{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.btn[disabled]{opacity:.45;cursor:default}

/* ---------- el taller: tres zonas de acople alrededor del chat ---------- */
.taller{position:relative;display:flex;min-width:0;min-height:0;padding:8px 8px 8px 0}
.zona{display:flex;min-width:0;min-height:0;flex:none}
.zona.v{flex-direction:column}
.zona.h{flex-direction:row;align-items:stretch}
.zona[hidden],.dvz[hidden]{display:none}
.medio{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column}
.dvz{flex:none;position:relative;width:8px;cursor:col-resize;touch-action:none}
.dvz.h{width:auto;height:8px;cursor:row-resize}
.dvz::after{content:"";position:absolute;left:3px;right:3px;top:14px;bottom:14px;border-radius:2px;background:var(--accent);opacity:0}
.dvz.h::after{left:14px;right:14px;top:3px;bottom:3px}
.dvz:hover::after,.dvz:focus-visible::after,.dvz.activo::after{opacity:1}
.dvz.inerte{cursor:default;pointer-events:none}
body.tirando{user-select:none}
.panel,.conv{display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--sheet);border:1px solid var(--border);border-radius:12px;overflow:hidden}
.conv{flex:1}
.panel{position:relative}
.panel.origen{opacity:.38}
.ph{display:flex;align-items:center;gap:6px;height:44px;padding:0 6px 0 8px;flex:none;cursor:grab;touch-action:none;user-select:none}
.panel:not([data-plegado]) .ph{border-bottom:1px solid var(--border)}
.ph .grip{width:16px;height:16px;color:var(--control)}
.ph:hover .grip{color:var(--muted)}
.ph .pic{width:16px;height:16px;color:var(--soft);margin-left:2px}
.ph h2{font-size:13px;font-weight:600;color:var(--text);margin-left:2px}
.ph .sm{font-size:12.5px;color:var(--muted)}
.ph .esp{flex:1}
.ib{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;color:var(--muted);flex:none}
.ib:hover{background:var(--hover);color:var(--text)}
.ib svg{width:15px;height:15px}
.ib.plg svg{transition:none}
.panel[data-plegado] .ib.plg svg{transform:rotate(-90deg)}
.pr{display:none;padding:0 14px 12px 36px;font-size:12.5px;color:var(--muted);margin-top:-4px}
.panel[data-plegado] .pb{display:none}
.panel[data-plegado] .pr{display:block}
.pb{flex:1;min-height:0;overflow:auto;container-type:inline-size;scrollbar-width:thin;scrollbar-color:var(--control) transparent}
body.moviendo{cursor:grabbing;user-select:none}
body.moviendo *{cursor:grabbing!important}
#soltar{position:absolute;inset:0;z-index:30;pointer-events:none;display:none}
body.moviendo #soltar{display:block}
.sz{position:absolute;display:grid;place-items:center;border:2px dashed color-mix(in srgb,var(--accent) 55%,transparent);border-radius:12px;background:color-mix(in srgb,var(--ground) 50%,transparent)}
.sz span{padding:6px 14px;border-radius:999px;background:var(--raised);border:1px solid var(--control);color:var(--soft);font-weight:500;font-size:13px}
.sz.sobre{border:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 14%,transparent)}
.sz.sobre span{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.ins{position:absolute;display:none;background:var(--accent);border-radius:2px}
.fant{position:fixed;left:0;top:0;z-index:40;pointer-events:none;display:flex;align-items:center;gap:8px;height:34px;padding:0 14px 0 10px;background:var(--raised);border:1px solid var(--accent);border-radius:8px;color:var(--text);font-weight:600;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,.5)}
.fant svg{color:var(--muted)}
.menu{position:fixed;z-index:50;min-width:236px;padding:4px;background:var(--raised);border:1px solid var(--control);border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.55)}
.menu .mi{display:flex;align-items:center;gap:10px;width:100%;height:32px;padding:0 10px;border-radius:8px;text-align:left;color:var(--soft);font-size:13px}
.menu .mi:hover,.menu .mi:focus-visible{background:var(--block);color:var(--text);outline-offset:-2px}
.menu .mi[aria-disabled="true"]{color:var(--muted);cursor:default}
.menu .mi[aria-disabled="true"]:hover{background:none}
.menu .mi svg{width:15px;height:15px}
.menu .mi .estado{margin-left:auto;font-size:12px;color:var(--muted);display:inline-flex;align-items:center;gap:4px}
.menu .mi .estado svg{width:13px;height:13px;color:var(--ok);stroke-width:2.25}
.menu .msep{height:1px;background:var(--control);margin:4px 2px}
.menu .mh{padding:6px 10px 4px;font-size:12px;color:var(--muted)}
.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

/* ---------- el chat ---------- */
.cab{display:flex;align-items:center;gap:12px;height:56px;padding:0 20px 0 24px;border-bottom:1px solid var(--border);flex:none}
.cab .mg{width:26px;height:26px;font-size:12px;flex:none}
.cab .proy{display:inline-flex;align-items:center}
.cab h1{font-size:16px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.cab .proy{font-size:12.5px;color:var(--muted);white-space:nowrap}
.cab .der{margin-left:auto;display:flex;gap:8px;flex:none}
.hilo{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column-reverse;padding:8px 24px 16px;scrollbar-width:thin;scrollbar-color:var(--control) transparent}
.hilo-in{width:100%;max-width:720px;margin:0 auto;display:grid;gap:20px;padding-top:24px}
.dia{text-align:center;font-size:12px;color:var(--muted)}
.yo{justify-self:end;max-width:80%;background:var(--raised);color:var(--text);padding:10px 14px;border-radius:12px;font-size:15px;line-height:1.5}
.el{font-size:15px;line-height:1.6;color:var(--text)}
.el>p+p{margin-top:10px}
.quien{display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:12.5px;color:var(--muted);line-height:1}
.quien b{color:var(--text);font-weight:600}
.quien .cr{width:16px;height:16px}
.quien .cr svg{width:14px;height:14px}
.quien .mod{display:inline-flex;align-items:center}
.el>.blq{margin-top:12px}
.el>.blq+p{margin-top:16px}
.blq{border:1px solid var(--border);border-radius:12px;background:var(--block);font-size:14px;line-height:1.45;color:var(--soft);overflow:hidden}
.blq-c{display:flex;align-items:center;gap:8px;padding:10px 14px;font-size:12.5px;color:var(--muted);border-bottom:1px solid var(--border);background:var(--sheet)}
.blq-c b{color:var(--text);font-weight:500}
.blq-c .der{margin-left:auto}
.blq-c svg{width:16px;height:16px}
.blq-c.ok svg,.blq-c.ok>b{color:var(--ok)}
.blq-c.car svg,.blq-c.car>b{color:var(--naranja)}
.blq-c.pj svg,.blq-c.pj>b{color:var(--p)}
.blq-c.pj .mg{margin-left:6px;width:20px;height:20px;font-size:10.5px;border-radius:5px}
.blq-c.pj .pj-n{color:var(--p);margin-left:-2px}
.blq-c.pj .cuenta{margin-left:10px}
.blq-c>b{font-weight:600}
.btn{height:30px;padding:0 12px;border-radius:8px;display:inline-flex;align-items:center;gap:7px;font-weight:500;font-size:13px;white-space:nowrap;background:var(--raised);color:var(--text);border:1px solid var(--control)}
.btn:hover{border-color:var(--muted)}
.btn.pri{background:var(--accent);border-color:var(--accent);color:var(--on-accent);font-weight:600}
.btn.pri:hover{background:color-mix(in oklch,var(--accent),var(--text) 18%);border-color:color-mix(in oklch,var(--accent),var(--text) 18%)}
.btn.si svg{color:var(--ok);stroke-width:2.25}.btn.no svg{color:var(--bad);stroke-width:2.25}
.btn.liso{background:none;border-color:transparent;color:var(--muted)}
.btn.liso:hover{color:var(--text)}
.btn svg{width:14px;height:14px}
.pen{display:grid;grid-template-columns:76px minmax(0,1fr) auto;gap:4px 12px;align-items:center;padding:12px 14px}
.pen+.pen{border-top:1px solid var(--border)}
.pen .tipo{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--soft)}
.pen .tipo svg{width:15px;height:15px}
.pen .tipo.probar,.pen .tipo.probar svg{color:var(--probar)}
.pen .tipo.decide,.pen .tipo.decide svg{color:var(--warn)}
.pen.hecho .tipo{color:var(--muted)}
.pen p{color:var(--text)}
.pen .acc{display:flex;gap:6px}
.pen.hecho p{color:var(--muted);text-decoration:line-through}
.pen .cerrada{display:inline-flex;align-items:center;gap:5px;font-size:13px;color:var(--soft);padding-right:4px}
.pen .cerrada svg{width:14px;height:14px;stroke-width:2.25;color:var(--ok)}
.carp{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;align-items:center;padding:12px 14px}
.carp b{font-weight:500;color:var(--text);font-family:"IBM Plex Mono",monospace;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.carp small{grid-column:1;font-size:12px;color:var(--muted)}
.carp .acc{grid-column:2;grid-row:1/3;display:flex;gap:6px}
.arch{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:1px solid var(--border)}
.arch .mono{color:var(--text)}
.arch>svg{width:16px;height:16px}
.ar-html{color:var(--naranja)}.ar-css{color:var(--probar)}.ar-ts{color:var(--accent)}.ar-md{color:var(--muted)}
.arch small{font-size:12px;color:var(--muted)}
.arch .btn{margin-left:auto}
.wk .blq-c .s{display:inline-flex;align-items:center;gap:5px;color:var(--text)}
.wk .blq-c .s svg{width:14px;height:14px;stroke-width:2.25}
.wk .blq-c .s.ok svg{color:var(--ok)}
.res .fila{display:grid;grid-template-columns:16px minmax(0,1fr) 44px 44px;gap:8px;align-items:center;padding:7px 14px;font-size:13px}
.res .fila>svg{width:15px;height:15px}
.res .fila+.fila{border-top:1px solid var(--rule)}
.res .fila .mono{color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.res .fila span+span{text-align:right;color:var(--soft)}
.res .fila .mas{color:var(--ok);font-weight:500}.res .fila .menos{color:var(--bad);font-weight:500}
.res .cheq{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 14px;border-top:1px solid var(--border);font-size:13px;color:var(--soft)}
.res .cheq span{display:inline-flex;align-items:center;gap:5px}
.res .cheq svg{width:14px;height:14px;stroke-width:2.25;color:var(--ok)}
.res .acc{display:flex;align-items:center;gap:6px;padding:12px 14px;border-top:1px solid var(--border)}
.res .acc small{margin-left:auto;font-size:12px;color:var(--muted);display:inline-flex;align-items:center}
.compo{padding:0 24px 20px;flex:none}
.caja{max-width:720px;margin:0 auto;border:1px solid var(--control);border-radius:12px;background:var(--block);padding:12px 12px 10px 16px;display:grid;gap:8px}
.caja .campo{font-size:15px;color:var(--muted);min-height:26px}
.caja .ctl{display:flex;align-items:center;gap:6px}
.caja .ctl .esp{flex:1}
.enviar{width:32px;height:32px;border-radius:16px;background:var(--accent);color:var(--on-accent);display:grid;place-items:center}
.enviar:hover{background:color-mix(in oklch,var(--accent),var(--text) 18%)}

/* ---------- panel Chats (la barra de hoy) ---------- */
#p-chats .pb{display:flex;flex-direction:column;overflow:hidden}
.top{padding:10px 10px 6px;display:grid;gap:8px;flex:none}
.fila-b{display:flex;gap:6px}
.busca{flex:1;display:flex;align-items:center;gap:8px;height:34px;padding:0 10px;border:1px solid var(--border);border-radius:8px;color:var(--muted);background:var(--ground)}
.busca:hover{border-color:var(--control)}
.busca span{flex:1}
.nuevo{width:34px;height:34px;border-radius:8px;display:grid;place-items:center;background:var(--accent);color:var(--on-accent);flex:none}
.nuevo:hover{background:color-mix(in oklch,var(--accent),var(--text) 18%)}
.fila-c{display:flex;align-items:center;gap:6px}
.chp{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;border-radius:999px;font-size:12.5px;font-weight:500;border:1px solid var(--border);color:var(--soft);white-space:nowrap}
.chp svg{width:12px;height:12px;stroke-width:2.5}
.chp.espera{background:color-mix(in srgb,var(--warn) 14%,var(--sheet));border-color:color-mix(in srgb,var(--warn) 45%,var(--sheet));color:var(--warn)}
.chp.fallo{background:color-mix(in srgb,var(--bad) 14%,var(--sheet));border-color:color-mix(in srgb,var(--bad) 45%,var(--sheet));color:var(--bad)}
.chp[aria-pressed="true"]{border-color:currentColor}
.orden{margin-left:auto;display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 6px 0 8px;border-radius:8px;font-size:12.5px;color:var(--muted)}
.orden:hover{color:var(--text)}
.orden svg{width:13px;height:13px}
.lista{flex:1;min-height:0;overflow:auto;padding:0 6px 12px;scrollbar-width:thin;scrollbar-color:var(--control) transparent}
.gr{padding-top:6px}
.gh{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;height:32px;padding:0 2px 0 2px;background:var(--sheet);font-weight:600;color:var(--text);font-size:13px}
.gh .cv{width:20px;height:20px;display:grid;place-items:center;color:var(--muted);border-radius:6px}
.gh .cv:hover{color:var(--text);background:var(--hover)}
.gh .cv svg{width:12px;height:12px;stroke-width:2}
.gh .cv.ab svg{transform:rotate(90deg)}
.mg{width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:11px;font-weight:600;color:var(--p);background:color-mix(in srgb,var(--p) 20%,var(--sheet));border:1px solid color-mix(in srgb,var(--p) 34%,var(--sheet))}
.mg svg{width:12px;height:12px}
.gh .marcha{margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-weight:400;font-size:12px;color:var(--muted);white-space:nowrap}
.pt{width:7px;height:7px;border-radius:4px;background:var(--accent);flex:none;display:inline-block}
.gh .mas{width:24px;height:24px;border-radius:6px;display:grid;place-items:center;color:var(--muted)}
.gh .mas:hover{background:var(--hover);color:var(--text)}
.gh .mas svg{width:14px;height:14px}
.f{display:flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 8px;border-radius:8px;color:var(--soft);font-size:13px;border:1px solid transparent;position:relative}
.f:hover{background:var(--hover)}
.f[aria-current]{background:var(--block);border-color:var(--control)}
.f .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.f.lider .t{font-weight:600;color:var(--text)}
.f.lider.apagada .t,.f.lider.apagada .cr{color:var(--muted);font-weight:500}
.f.lider.ext .t{font-weight:400;color:var(--soft)}
.cuelga{margin-left:15px;border-left:2px solid var(--rule)}
.cuelga:empty{display:none}
.cuelga .f{border-radius:0 8px 8px 0;margin-left:0;padding-left:8px}
.cuelga .f.worker{border-left:0}
.cuelga .f.corre{box-shadow:none}
.cuelga:has(.f.corre){border-left-color:color-mix(in srgb,var(--accent) 60%,var(--sheet))}
.hilo-p{padding-left:0}
.f.worker.fallo{background:color-mix(in srgb,var(--bad) 10%,var(--sheet))}
.f.worker.decide{background:color-mix(in srgb,var(--warn) 9%,var(--sheet))}
.f.worker:hover{background:var(--hover)}
.f.worker .t{color:var(--soft)}
.f.worker.fallo .t,.f.worker.decide .t{color:var(--text)}
.cr{width:18px;height:18px;display:grid;place-items:center;flex:none;color:var(--muted)}
.cr svg{width:15px;height:15px}
.cr.oro{color:var(--gold)}
.cr.gris.frio{color:var(--control)}
.cr.espera{background:var(--warn);color:var(--ink);border-radius:9px}
.cr.espera svg{width:11px;height:11px}
.cr.murio{color:var(--bad)}
.gl{width:18px;height:18px;border-radius:9px;display:grid;place-items:center;flex:none}
.gl svg{width:11px;height:11px;stroke-width:3}
.gl.ok{color:var(--ok)}
.gl.ok svg{width:14px;height:14px;stroke-width:2.5}
.gl.fallo{background:var(--bad);color:var(--ink)}
.gl.decide{background:var(--warn);color:var(--ink)}
.gl.corre{border:1.5px solid color-mix(in srgb,var(--accent) 55%,var(--sheet))}
.gl.corre i{width:7px;height:7px;border-radius:4px;background:var(--accent)}
.gl.quieto{color:var(--muted)}.gl.quieto svg{width:14px;height:14px;stroke-width:2}
.gl.trabado{color:var(--warn)}.gl.trabado svg{width:16px;height:16px;stroke-width:2.25}
.gl.falta{color:var(--warn)}.gl.falta svg{width:15px;height:15px}
.chip{display:inline-flex;align-items:center;height:18px;padding:0 7px;border-radius:999px;background:var(--block);color:var(--muted);font-size:11.5px;white-space:nowrap;flex:none}
.chip .sh{display:none}
.mf{display:inline-block;width:8px;height:8px;margin-right:5px;flex:none;vertical-align:baseline;position:relative;top:0}
.mf.op{background:var(--m-opus);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);width:9px;height:9px}
.mf.so{background:var(--m-son);border-radius:50%}
.mf.ha{background:var(--m-hai);clip-path:polygon(50% 0,100% 100%,0 100%)}
.chip,.proy,.lid .der,.dato span,.mod,.btn,.res .acc small{align-items:center}
.rayo{display:inline-flex;align-items:center;gap:3px;height:18px;padding:0 6px;border-radius:999px;font-size:11.5px;color:var(--soft);border:1px solid var(--border);white-space:nowrap;flex:none}
.rayo svg{width:11px;height:11px;stroke-width:2}
.rayo.frio{color:var(--muted);padding:0 4px;border-color:transparent}
.rayo .pt{width:6px;height:6px}
.tiempo{font-size:12px;color:var(--muted);white-space:nowrap;flex:none;min-width:48px;text-align:right}
.tierna{display:none;font-size:12px;color:var(--muted);white-space:nowrap;font-style:normal}
.pal{display:inline-flex;align-items:center;gap:4px;height:18px;padding:0 8px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap;flex:none}
.pal svg{width:11px;height:11px;stroke-width:2.5}
.pal.espera,.pal.decide{background:var(--warn);color:var(--ink)}
.pal.fallo{background:var(--bad);color:var(--ink)}
.pal.suave{background:color-mix(in srgb,var(--warn) 14%,var(--sheet));color:var(--warn);border:1px solid color-mix(in srgb,var(--warn) 40%,var(--sheet))}
.nota{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);white-space:nowrap;flex:none}
.nota svg{width:12px;height:12px}
.nota.ambar{color:var(--warn)}
.acc{display:none}
.f:hover .acc{display:inline-flex;margin-left:2px}
.f:has(.acc):hover .tiempo{display:none}
.bm{height:20px;padding:0 8px;border-radius:8px;border:1px solid var(--control);background:var(--raised);color:var(--text);font-size:12px;font-weight:500}
.plg summary{list-style:none;display:flex;align-items:center;gap:4px;height:28px;padding:0 8px 0 10px;margin-left:15px;color:var(--muted);font-size:12.5px;cursor:pointer;border-radius:8px}
.plg summary::-webkit-details-marker{display:none}
.plg summary:hover{color:var(--text);background:var(--hover)}
.plg summary svg{width:12px;height:12px;stroke-width:2}
.plg[open]>summary svg{transform:rotate(90deg)}
.gr>.plg>summary{margin-left:0}
.cerrados{padding-top:8px;border-top:1px solid var(--rule);margin-top:8px}
.cerrados .plg summary{margin-left:0}
.raya{width:3px;height:14px;border-radius:2px;background:var(--p);flex:none;margin:0 7px}
.gr.plegada .gh .marcha{color:var(--muted)}
@container (max-width:340px){.chip .lg{display:none}.chip .sh{display:inline}.rayo .vh{display:none}}
@container (min-width:430px){.tierna{display:inline}}

/* ---------- panel Contexto ---------- */
.pestañas{display:grid;grid-template-columns:repeat(3,auto);gap:2px;padding:3px;margin:12px 14px 0;border:1px solid var(--border);border-radius:12px;background:var(--block);justify-content:stretch}
.pestañas button{height:30px;border-radius:8px;font-size:13px;font-weight:500;color:var(--muted);border:1px solid transparent;padding:0 8px;white-space:nowrap;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.pestañas button svg{width:14px;height:14px}
.pestañas button[aria-selected="true"] svg{color:var(--accent)}
.pestañas button:hover{color:var(--text)}
.pestañas button[aria-selected="true"]{background:var(--raised);color:var(--text);border-color:var(--control)}
.tp{padding:12px 14px 16px;display:block}
.tp[hidden]{display:none}
.nota-c{display:grid;grid-template-columns:auto minmax(0,1fr);gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--block);font-size:12.5px;line-height:1.45;color:var(--soft)}
.nota-c svg{margin-top:2px;color:var(--muted)}
.lid{display:flex;align-items:baseline;gap:8px;margin:14px 0 10px;font-size:13px}
.lid b{color:var(--text);font-weight:500;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lid .der{margin-left:auto;font-size:12.5px;white-space:nowrap}
.anillo-c{display:flex;align-items:center;gap:16px;padding:14px 16px;border:1px solid var(--border);border-radius:12px;background:var(--block)}
.anillo-c circle{fill:none;stroke-width:7}
.anillo-c .pista{stroke:var(--raised)}
.anillo-c .arco{stroke:var(--accent)}
.anillo-c b{display:block;font-size:26px;font-weight:500;color:var(--text);line-height:1.1}
.anillo-c span{font-size:12.5px;color:var(--muted)}
.medido{font-size:12.5px;color:var(--muted);margin:10px 2px 0;line-height:1.45}
.pila{display:flex;height:12px;border-radius:4px;background:var(--raised);overflow:hidden;margin-top:14px}
.pila .seg{display:block;height:100%;flex:none;border-right:1px solid var(--sheet);min-width:1px}
.esc{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:4px}
.t-a{background:var(--accent)}.t-b{background:var(--soft)}.t-c{background:var(--ok)}.t-d{background:var(--muted)}
.cats{margin-top:8px}
.cat{border-top:1px solid var(--rule)}
.cat summary{list-style:none;display:grid;grid-template-columns:auto minmax(0,1fr) 72px 56px 18px 24px;gap:10px;align-items:center;height:38px;cursor:pointer}
.cat summary::-webkit-details-marker{display:none}
.cat summary b{font-weight:500;color:var(--text)}
.cat .ci{display:grid;place-items:center;width:18px;height:18px}
.cat .ci svg{width:16px;height:16px}
.cat .ci.t-a{color:var(--accent);background:none}.cat .ci.t-b{color:var(--soft);background:none}.cat .ci.t-c{color:var(--ok);background:none}.cat .ci.t-d{color:var(--muted);background:none}
.cat .n{font-size:13px;color:var(--text);text-align:right}
.cat .pc{white-space:nowrap;font-size:12px;color:var(--soft);padding:0 7px;height:20px;line-height:20px;border-radius:999px;background:var(--block);min-width:52px;text-align:center}
.cat .cvr svg{width:14px;height:14px;color:var(--muted)}
.cat[open] .cvr svg{transform:rotate(180deg)}
.ay{width:24px;height:24px;display:grid;place-items:center;color:var(--muted);border-radius:8px}
.ay:hover{color:var(--text);background:var(--hover)}
.ay svg{width:15px;height:15px}
.sbs{padding:0 0 6px 20px}
.sb{display:grid;grid-template-columns:minmax(0,1fr) 72px 128px;font-size:12.5px;color:var(--muted);padding:3px 0}
.sb .n{grid-column:2;color:var(--soft);font-size:12.5px;text-align:right}
.cmp{display:flex;align-items:center;gap:12px;padding:6px 0 12px 20px;font-size:12.5px}
.arch2{display:grid;grid-template-columns:minmax(0,1fr) 72px 128px;gap:0;align-items:center;padding:8px 0 8px 20px}
.arch2 .sw{justify-self:end}
.arch2 .n{text-align:right}
.arch2 b{display:block;font-weight:500;color:var(--text);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arch2 b.mono{font-size:12.5px}
.arch2 small{display:block;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.arch2 .n{font-size:12.5px;color:var(--soft)}
.arch2.sk{padding-top:5px;padding-bottom:5px}
.arch2.cs{padding-left:0;grid-template-columns:minmax(0,1fr) auto;gap:12px;border-top:1px solid var(--rule)}
.arch2.cs:first-of-type{border-top:0}
.arch2.off b,.arch2.off .n{color:var(--muted)}
.sw{width:38px;height:22px;border-radius:11px;position:relative;background:var(--raised);border:1px solid var(--control);flex:none}
.sw i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:8px;background:var(--muted)}
.sw svg{position:absolute;top:5px;left:6px;width:10px;height:10px;stroke-width:3;color:var(--ink);z-index:1;opacity:0}
.sw[aria-checked="true"]{background:var(--accent);border-color:var(--accent)}
.sw[aria-checked="true"] i{left:18px;background:var(--text)}
.sw[aria-checked="true"] svg{opacity:1;left:6px}
.sw:focus-visible{outline-offset:2px}
pre.vp{margin-top:12px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--block);overflow:auto;line-height:1.7;color:var(--soft)}
@container (max-width:440px){.pestañas button svg{display:none}}
@container (max-width:340px){.pestañas .x{display:none}}
@container (max-width:340px){.pestañas button{padding:0 4px;gap:4px;font-size:12.5px}}
@container (max-width:300px){.cat .ay{display:none}.cat summary{grid-template-columns:auto minmax(0,1fr) 64px 52px 18px}.cat .pc{padding:0 4px;min-width:0;white-space:nowrap}.sb,.arch2{grid-template-columns:minmax(0,1fr) 64px 90px}}
@container (min-width:720px){.tp[data-tp="ses"]{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:0 28px;align-items:start}.tp[data-tp="ses"]>.nota-c,.tp[data-tp="ses"]>.lid{grid-column:1}.tp[data-tp="ses"]>.anillo-c,.tp[data-tp="ses"]>.medido,.tp[data-tp="ses"]>.pila,.tp[data-tp="ses"]>.esc{grid-column:1}.tp[data-tp="ses"]>.cats{grid-column:2;grid-row:1/7;margin-top:0}}

/* ---------- panel Cupo (el detalle de Charla) ---------- */
.c3{padding:6px 16px 16px;display:grid;gap:0}
.c3 .col>.sub:first-child{margin-top:12px}
.cifra{display:flex;align-items:baseline;gap:8px;padding-top:6px}
.cifra b{font-size:28px;font-weight:500;color:var(--text);line-height:1.1}
.cifra span{font-size:12.5px;color:var(--muted)}
.graf{display:block;width:100%;max-width:440px;height:auto;margin-top:12px}
.graf text{font:400 11px "IBM Plex Sans",sans-serif;fill:var(--muted)}
.aviso{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px;margin-top:10px;font-size:13px;line-height:1.45;color:var(--soft)}
.aviso svg{width:15px;height:15px;color:var(--warn);margin-top:2px}
.aviso svg.bien{color:var(--ok);stroke-width:2.25}
.aviso b{color:var(--text);font-weight:500}
.sub{font-size:12.5px;color:var(--muted);margin:18px 0 8px;font-weight:500}
.dato{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:baseline;font-size:13px;color:var(--soft);padding:5px 0}
.dato b{color:var(--text);font-weight:500}
.dato b.pasa{color:var(--warn)}
.dato small{grid-column:1/-1;font-size:12px;color:var(--muted)}
.dato .tira{grid-column:1/-1;height:6px;border-radius:4px;background:var(--raised);overflow:hidden}
.dato .tira i{display:block;height:100%;border-radius:4px;background:var(--soft)}
.dato .tira i.hoy{background:var(--ok)}
.dato .tira i.op{background:var(--m-opus)}.dato .tira i.so{background:var(--m-son)}.dato .tira i.ha{background:var(--m-hai)}
.dato>span{display:inline-flex;align-items:center}
.seg3{display:grid;grid-template-columns:repeat(3,1fr);gap:2px;padding:2px;border:1px solid var(--border);border-radius:12px;background:var(--block);position:relative}
.seg3 input{position:absolute;opacity:0;pointer-events:none}
.seg3 label{height:28px;display:grid;place-items:center;border-radius:8px;border:1px solid transparent;font-size:13px;font-weight:500;color:var(--muted);cursor:pointer}
.seg3 label:hover{color:var(--text)}
.seg3 input:checked+label{background:var(--raised);color:var(--text);border-color:var(--control)}
.seg3 input:focus-visible+label{outline:2px solid var(--accent);outline-offset:1px}
.modo{font-size:12.5px;color:var(--muted);margin:8px 0 6px}
.medidor{position:relative;margin:4px 0 38px}
.medidor .pista{height:8px;border-radius:4px;background:var(--raised);overflow:hidden}
.medidor .pista i{display:block;height:100%;border-radius:4px;background:var(--soft)}
.medidor .pista i.pasa{background:var(--warn)}
.medidor u{position:absolute;top:-4px;height:16px;width:2px;margin-left:-1px;background:var(--text);border-radius:2px}
.medidor .tope{position:absolute;top:16px;transform:translateX(-50%);font-size:12px;color:var(--muted);white-space:nowrap}
@container (min-width:760px){.c3{grid-template-columns:repeat(3,minmax(0,1fr));gap:0 32px}.c3 .col>.sub:first-child{margin-top:12px}}

@media (max-width:1440px){.salto .nota-s{display:none}.cab .cnt{display:none}}
@media (max-height:820px){.riel{gap:4px;padding-top:6px}.mono-r{width:36px;height:36px}.mr{width:36px;height:36px}.logo{width:34px;height:34px}.ric{height:42px}}
`;

const js = String.raw`
(function(){
"use strict";
var $=function(s,r){return (r||document).querySelector(s)};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var IDS=["chats","contexto","cupo"],ZONAS=["izq","der","abajo"];
var TIT={chats:"Chats",contexto:"Contexto",cupo:"Cupo"};
var DONDE={izq:"a la izquierda",der:"a la derecha",abajo:"abajo"};
var ICZ={izq:"p-izq",der:"p-der",abajo:"p-abajo"};
var ICP={chats:"chat",contexto:"capas",cupo:"medidor"};
var CLAVE="trama-taller-v1",CLAVE_C="trama-taller-cupos";
var CUPOS={anillos:"c1",doble:"c2",arcos:"c3"};
var taller=$("#taller"),medio=$("#medio"),conv=$("#conv"),anun=$("#anuncio");
var Z={izq:$("#z-izq"),der:$("#z-der"),abajo:$("#z-abajo")};
var DV={izq:$("#dv-izq"),der:$("#dv-der"),abajo:$("#dv-abajo")};
var P={};IDS.forEach(function(id){P[id]=$("#p-"+id)});
var E;

function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function ico(n,c){return '<svg class="i '+(c||"")+'" aria-hidden="true"><use href="#i-'+n+'"/></svg>'}
function anuncia(t){anun.textContent="";setTimeout(function(){anun.textContent=t},30)}

function porDefecto(){
  var W=innerWidth,g=W>=1700?[400,360]:W>=1400?[360,330]:[300,290];
  return {layout:{izq:["chats"],der:["contexto","cupo"],abajo:[]},ultima:{},ancho:{izq:g[0],der:g[1]},alto:340,peso:{},plegado:{cupo:true}};
}
function zonaDe(id){for(var i=0;i<3;i++)if(E.layout[ZONAS[i]].indexOf(id)>=0)return ZONAS[i];return null}
function abiertos(){return IDS.filter(function(id){return zonaDe(id)})}
function validoLS(e){
  if(!e||!e.layout)return false;var vistos={};
  for(var i=0;i<3;i++){var l=e.layout[ZONAS[i]];if(!Array.isArray(l))return false;for(var k=0;k<l.length;k++){if(IDS.indexOf(l[k])<0||vistos[l[k]])return false;vistos[l[k]]=1}}
  return true;
}
function alias(z){return {izq:"izq",izquierda:"izq",der:"der",derecha:"der",abajo:"abajo"}[z]}
function deHash(){
  var h=location.hash.replace(/^#/,"");if(!h)return null;
  var q=new URLSearchParams(h),e=porDefecto(),toco=false;
  var a=q.get("acomodo");
  if(a){
    var nuevo={izq:[],der:[],abajo:[]},dicho={};
    a.split(",").forEach(function(par){var s=par.split(":"),z=alias(s[1]);if(IDS.indexOf(s[0])>=0&&z){nuevo[z].push(s[0]);dicho[s[0]]=1}});
    ZONAS.forEach(function(z){e.layout[z].forEach(function(id){if(!dicho[id])nuevo[z].push(id)})});
    e.layout=nuevo;toco=true;
  }
  (q.get("abierto")||"").split(",").forEach(function(id){if(id){e.plegado[id]=false;toco=true}});
  (q.get("plegado")||"").split(",").forEach(function(id){if(id){e.plegado[id]=true;toco=true}});
  (q.get("cerrado")||"").split(",").forEach(function(id){if(id){ZONAS.forEach(function(z){var i=e.layout[z].indexOf(id);if(i>=0){e.layout[z].splice(i,1);e.ultima[id]=z}});toco=true}});
  
  var cu=CUPOS[q.get("cupos")];if(cu)$("#"+cu).checked=true;
  hashTema(q);
  if(q.get("menu"))setTimeout(function(){var m=q.get("menu");if(m==="paneles")menuPaneles($("#b-paneles"));else if(P[m])menuPanel(P[m].querySelector(".mp"),m)},200);
  return toco?e:null;
}
function carga(){
  var h=deHash();if(h)return h;
  try{var s=JSON.parse(localStorage.getItem(CLAVE));if(validoLS(s)){var d=porDefecto();s.ancho=s.ancho||d.ancho;s.alto=s.alto||d.alto;s.peso=s.peso||{};s.plegado=s.plegado||{};s.ultima=s.ultima||{};return s}}catch(x){}
  return porDefecto();
}
function guarda(){try{localStorage.setItem(CLAVE,JSON.stringify(E))}catch(x){}}

/* ---- estilo y tamaño ---- */
function estilo(id){
  var el=P[id],z=zonaDe(id);if(!z)return;
  var pleg=!!E.plegado[id],h=z==="abajo";
  el.dataset.zona=z;
  if(pleg)el.setAttribute("data-plegado","");else el.removeAttribute("data-plegado");
  var bp=el.querySelector(".plg");if(bp){bp.setAttribute("aria-expanded",pleg?"false":"true");bp.setAttribute("aria-label",(pleg?"Desplegar ":"Plegar ")+TIT[id]);bp.title=(pleg?"Desplegar ":"Plegar ")+TIT[id]}
  if(pleg){el.style.flex=h?"0 0 260px":"0 0 auto";el.style.alignSelf=h?"flex-start":"stretch"}
  else{el.style.flex=(E.peso[id]||1)+" 1 0px";el.style.alignSelf="stretch";el.style.minHeight=h?"0":"96px";el.style.minWidth=h?"240px":"0"}
}
function tamanos(){
  var W=taller.clientWidth-8,H=taller.clientHeight-16;
  var wi=E.layout.izq.length?E.ancho.izq:0,wd=E.layout.der.length?E.ancho.der:0;
  var gaps=(wi?8:0)+(wd?8:0),libre=W-gaps-420;
  if(wi+wd>libre&&wi+wd>0){var k=Math.max(0,libre)/(wi+wd);wi=Math.max(wi?200:0,wi*k);wd=Math.max(wd?200:0,wd*k)}
  Z.izq.style.width=wi+"px";Z.der.style.width=wd+"px";
  var ab=E.layout.abajo,todo=ab.length&&ab.every(function(id){return E.plegado[id]});
  var alto=clamp(E.alto,140,Math.max(140,H-260));
  Z.abajo.style.height=todo?"auto":alto+"px";
  DV.abajo.classList.toggle("inerte",!!todo);
}
function render(){
  ZONAS.forEach(function(z){
    var zn=Z[z],ids=E.layout[z];zn.replaceChildren();
    ids.forEach(function(id,i){if(i)zn.append(divisorPanel(z,ids[i-1],id));zn.append(P[id])});
    zn.hidden=!ids.length;DV[z].hidden=!ids.length;
  });
  IDS.forEach(estilo);tamanos();
  var bm=$("#b-paneles");if(bm)bm.querySelector(".cnt").textContent=abiertos().length+" de 3";
}

/* ---- seguir el puntero (con captura) ---- */
function seguir(ev,mueve,fin){
  var t=ev.currentTarget;try{t.setPointerCapture(ev.pointerId)}catch(x){}
  var x0=ev.clientX,y0=ev.clientY;document.body.classList.add("tirando");
  function m(e){mueve(e.clientX-x0,e.clientY-y0,e)}
  function u(e){t.removeEventListener("pointermove",m);t.removeEventListener("pointerup",u);t.removeEventListener("pointercancel",u);document.body.classList.remove("tirando");if(fin)fin(e)}
  t.addEventListener("pointermove",m);t.addEventListener("pointerup",u);t.addEventListener("pointercancel",u);
}

/* ---- divisores de zona (ancho y alto) ---- */
function activa(d,on){d.classList.toggle("activo",on)}
DV.izq.addEventListener("pointerdown",function(e){e.preventDefault();var w0=Z.izq.offsetWidth,d=DV.izq;activa(d,1);seguir(e,function(dx){E.ancho.izq=clamp(w0+dx,220,760);tamanos()},function(){activa(d,0);guarda()})});
DV.der.addEventListener("pointerdown",function(e){e.preventDefault();var w0=Z.der.offsetWidth,d=DV.der;activa(d,1);seguir(e,function(dx){E.ancho.der=clamp(w0-dx,220,760);tamanos()},function(){activa(d,0);guarda()})});
DV.abajo.addEventListener("pointerdown",function(e){e.preventDefault();var h0=Z.abajo.offsetHeight,d=DV.abajo;activa(d,1);seguir(e,function(dx,dy){E.alto=clamp(h0-dy,140,2000);tamanos()},function(){activa(d,0);guarda()})});
function teclaZona(d,fn){d.addEventListener("keydown",function(e){var p=0;if(e.key==="ArrowLeft"||e.key==="ArrowUp")p=-16;else if(e.key==="ArrowRight"||e.key==="ArrowDown")p=16;if(p){e.preventDefault();fn(p);tamanos();guarda()}})}
teclaZona(DV.izq,function(p){E.ancho.izq=clamp(Z.izq.offsetWidth+p,220,760)});
teclaZona(DV.der,function(p){E.ancho.der=clamp(Z.der.offsetWidth-p,220,760)});
teclaZona(DV.abajo,function(p){E.alto=clamp(Z.abajo.offsetHeight-p,140,2000)});

/* ---- divisor entre dos paneles apilados ---- */
function divisorPanel(z,a,b){
  var h=z==="abajo",d=document.createElement("div");
  d.className="dvz"+(h?"":" h");d.setAttribute("role","separator");d.setAttribute("aria-orientation",h?"vertical":"horizontal");
  d.setAttribute("aria-label",(h?"Ancho":"Alto")+" entre "+TIT[a]+" y "+TIT[b]);
  var inerte=E.plegado[a]||E.plegado[b];
  if(inerte){d.classList.add("inerte");return d}
  d.tabIndex=0;
  var tam=function(id){return h?P[id].offsetWidth:P[id].offsetHeight};
  function aplica(na,tot){E.peso[a]=na;E.peso[b]=tot-na;estilo(a);estilo(b)}
  d.addEventListener("pointerdown",function(e){
    e.preventDefault();
    E.layout[z].forEach(function(id){if(!E.plegado[id])E.peso[id]=tam(id)});
    var ha=tam(a),hb=tam(b),min=h?240:96;activa(d,1);
    seguir(e,function(dx,dy){var delta=h?dx:dy;aplica(clamp(ha+delta,min,ha+hb-min),ha+hb)},function(){activa(d,0);guarda()});
  });
  d.addEventListener("keydown",function(e){
    var p=0;if(e.key==="ArrowLeft"||e.key==="ArrowUp")p=-16;else if(e.key==="ArrowRight"||e.key==="ArrowDown")p=16;if(!p)return;
    e.preventDefault();E.layout[z].forEach(function(id){if(!E.plegado[id])E.peso[id]=tam(id)});
    var ha=tam(a),hb=tam(b),min=h?240:96;aplica(clamp(ha+p,min,ha+hb-min),ha+hb);guarda();
  });
  return d;
}

/* ---- mover un panel ---- */
function mueve(id,z,i){
  ZONAS.forEach(function(zz){var k=E.layout[zz].indexOf(id);if(k>=0){E.layout[zz].splice(k,1);E.layout[zz].forEach(function(o){delete E.peso[o]})}});
  E.layout[z].forEach(function(o){delete E.peso[o]});delete E.peso[id];
  E.layout[z].splice(clamp(i,0,E.layout[z].length),0,id);E.ultima[id]=z;
  render();guarda();anuncia(TIT[id]+" movido "+DONDE[z]);
}
function cierra(id){
  var z=zonaDe(id);if(!z)return;E.ultima[id]=z;var k=E.layout[z].indexOf(id);E.layout[z].splice(k,1);
  E.layout[z].forEach(function(o){delete E.peso[o]});render();guarda();anuncia(TIT[id]+" cerrado")
}
function abre(id,desplegar){
  if(!zonaDe(id)){var z=E.ultima[id]||"der";E.layout[z].push(id);E.layout[z].forEach(function(o){delete E.peso[o]})}
  if(desplegar!==false)E.plegado[id]=false;
  render();guarda();anuncia(TIT[id]+" abierto")
}
function pliega(id){E.plegado[id]=!E.plegado[id];render();guarda();anuncia(TIT[id]+(E.plegado[id]?" plegado":" desplegado"))}

/* ---- arrastrar un panel por su encabezado ---- */
function virtuales(){
  var T=taller.getBoundingClientRect(),L=T.left+8-8,R=T.right-8,Tp=T.top+8,B=T.bottom-8;
  L=T.left;
  var wi=E.layout.izq.length?Z.izq.offsetWidth:0,wd=E.layout.der.length?Z.der.offsetWidth:0;
  var izq={l:L,r:L+Math.max(wi,250),t:Tp,b:B};
  var der={l:R-Math.max(wd,250),r:R,t:Tp,b:B};
  var ha=E.layout.abajo.length?Z.abajo.offsetHeight:0,
      al=E.layout.izq.length?izq.r+8:L,ar=E.layout.der.length?der.l-8:R;
  var abajo={l:al,r:ar,t:B-Math.max(ha,200),b:B};
  return {izq:izq,der:der,abajo:abajo,T:T};
}
function enRect(r,x,y){return x>=r.l&&x<=r.r&&y>=r.t&&y<=r.b}
function calcula(x,y,id,V){
  var z=null;
  if(enRect(V.izq,x,y))z="izq";else if(enRect(V.der,x,y))z="der";else if(enRect(V.abajo,x,y))z="abajo";
  if(!z)return null;
  var ids=E.layout[z].filter(function(o){return o!==id}),i=ids.length,bar=null,h=z==="abajo";
  var zr=V[z];
  for(var k=0;k<ids.length;k++){
    var r=P[ids[k]].getBoundingClientRect();
    var mid=h?r.left+r.width/2:r.top+r.height/2,pos=h?x:y;
    if(pos<mid){i=k;break}
  }
  if(ids.length){
    if(i<ids.length){var r1=P[ids[i]].getBoundingClientRect();bar=h?{x:r1.left-5,y:r1.top,w:3,h:r1.height}:{x:r1.left,y:r1.top-5,w:r1.width,h:3}}
    else{var r2=P[ids[ids.length-1]].getBoundingClientRect();bar=h?{x:r2.right+2,y:r2.top,w:3,h:r2.height}:{x:r2.left,y:r2.bottom+2,w:r2.width,h:3}}
  }
  return {z:z,i:i,bar:bar};
}
function arrancaPanel(e,id){
  if(e.button!==0||e.target.closest("button"))return;
  var cab=e.currentTarget,x0=e.clientX,y0=e.clientY,activo=false,fant=null,dest=null,V=null,soltar=null,ins=null;
  try{cab.setPointerCapture(e.pointerId)}catch(x){}
  function inicia(){
    activo=true;document.body.classList.add("moviendo");P[id].classList.add("origen");
    V=virtuales();
    soltar=$("#soltar");soltar.querySelectorAll(".sz").forEach(function(s){var z=s.dataset.z,r=V[z];s.style.left=(r.l-V.T.left)+"px";s.style.top=(r.t-V.T.top)+"px";s.style.width=(r.r-r.l)+"px";s.style.height=(r.b-r.t)+"px";s.classList.remove("sobre")});
    ins=$(".ins",soltar);
    fant=document.createElement("div");fant.className="fant";fant.innerHTML=ico(ICP[id])+TIT[id];document.body.append(fant);
  }
  function muestra(){
    soltar.querySelectorAll(".sz").forEach(function(s){s.classList.toggle("sobre",!!dest&&s.dataset.z===dest.z)});
    if(dest&&dest.bar){var b=dest.bar;ins.style.display="block";ins.style.left=(b.x-V.T.left)+"px";ins.style.top=(b.y-V.T.top)+"px";ins.style.width=b.w+"px";ins.style.height=b.h+"px"}else ins.style.display="none";
  }
  function fin(){
    cab.removeEventListener("pointermove",m);cab.removeEventListener("pointerup",u);cab.removeEventListener("pointercancel",c);document.removeEventListener("keydown",k,true);
    document.body.classList.remove("moviendo");P[id].classList.remove("origen");
    if(fant)fant.remove();if(soltar)soltar.querySelectorAll(".sz").forEach(function(s){s.classList.remove("sobre")});if(ins)ins.style.display="none";
  }
  function m(ev){
    if(!activo){if(Math.hypot(ev.clientX-x0,ev.clientY-y0)<5)return;inicia()}
    fant.style.transform="translate("+(ev.clientX+14)+"px,"+(ev.clientY+10)+"px)";
    dest=calcula(ev.clientX,ev.clientY,id,V);muestra();
  }
  function u(ev){var d=dest,a=activo;fin();if(a&&d)mueve(id,d.z,d.i)}
  function c(){dest=null;fin()}
  function k(ev){if(ev.key==="Escape"){ev.stopPropagation();dest=null;fin();anuncia("Movimiento cancelado")}}
  cab.addEventListener("pointermove",m);cab.addEventListener("pointerup",u);cab.addEventListener("pointercancel",c);document.addEventListener("keydown",k,true);
}
IDS.forEach(function(id){
  var cab=P[id].querySelector(".ph");
  cab.addEventListener("pointerdown",function(e){arrancaPanel(e,id)});
  P[id].querySelector(".plg").addEventListener("click",function(){pliega(id)});
  P[id].querySelector(".mp").addEventListener("click",function(e){menuPanel(e.currentTarget,id)});
  P[id].querySelector(".cx").addEventListener("click",function(){cierra(id)});
  cab.addEventListener("dblclick",function(e){if(!e.target.closest("button"))pliega(id)});
});

/* ---- menús (⋯ de cada panel y «Paneles» de la cabecera): la alternativa sin arrastrar ---- */
var menuAbierto=null;
function cierraMenu(vuelve){if(!menuAbierto)return;var m=menuAbierto;menuAbierto=null;m.el.remove();document.removeEventListener("pointerdown",m.fuera,true);document.removeEventListener("keydown",m.tecla,true);if(vuelve&&m.btn)m.btn.focus();m.btn&&m.btn.setAttribute("aria-expanded","false")}
function abreMenu(btn,items,titulo){
  cierraMenu();
  var el=document.createElement("div");el.className="menu";el.setAttribute("role","menu");el.setAttribute("aria-label",titulo);
  if(titulo){var h=document.createElement("div");h.className="mh";h.textContent=titulo;el.append(h)}
  items.forEach(function(it){
    if(it==="-"){var s=document.createElement("div");s.className="msep";el.append(s);return}
    var b=document.createElement("button");b.className="mi";b.setAttribute("role","menuitem");b.type="button";
    b.innerHTML=(it.ic?ico(it.ic):"")+"<span>"+it.txt+"</span>"+(it.estado?'<span class="estado">'+it.estado+"</span>":"");
    if(it.dis)b.setAttribute("aria-disabled","true");
    b.addEventListener("click",function(){if(it.dis)return;cierraMenu(false);it.fn()});
    el.append(b);
  });
  document.body.append(el);
  var r=btn.getBoundingClientRect(),w=el.offsetWidth,hh=el.offsetHeight;
  el.style.left=clamp(r.right-w,8,innerWidth-w-8)+"px";el.style.top=clamp(r.bottom+6,8,innerHeight-hh-8)+"px";
  var m={el:el,btn:btn};
  m.fuera=function(e){if(!el.contains(e.target)&&!btn.contains(e.target))cierraMenu(false)};
  m.tecla=function(e){
    var its=$$(".mi",el);var i=its.indexOf(document.activeElement);
    if(e.key==="Escape"){e.preventDefault();cierraMenu(true)}
    else if(e.key==="ArrowDown"){e.preventDefault();its[(i+1)%its.length].focus()}
    else if(e.key==="ArrowUp"){e.preventDefault();its[(i-1+its.length)%its.length].focus()}
    else if(e.key==="Tab"){cierraMenu(false)}
  };
  document.addEventListener("pointerdown",m.fuera,true);document.addEventListener("keydown",m.tecla,true);
  menuAbierto=m;btn.setAttribute("aria-expanded","true");
  var p=$(".mi:not([aria-disabled])",el);if(p)p.focus();
}
function menuPanel(btn,id){
  var z=zonaDe(id),items=[];
  ZONAS.forEach(function(o){items.push({ic:ICZ[o],txt:"Mover "+(o==="abajo"?"abajo":DONDE[o]),estado:z===o?"ya está acá":"",dis:z===o,fn:function(){mueve(id,o,E.layout[o].length)}})});
  items.push("-");
  items.push({ic:"x",txt:"Cerrar panel",fn:function(){cierra(id)}});
  abreMenu(btn,items,TIT[id]);
}
function menuPaneles(btn){
  var items=IDS.map(function(id){var ab=!!zonaDe(id);return {ic:ICP[id],txt:TIT[id],estado:ab?ico("check")+"Abierto":"Cerrado",fn:function(){ab?cierra(id):abre(id)}}});
  items.push("-");items.push({ic:"resetea",txt:"Restablecer paneles",fn:restablece});
  abreMenu(btn,items,"Paneles");
}
$("#b-paneles").addEventListener("click",function(e){menuPaneles(e.currentTarget)});
function restablece(){try{localStorage.removeItem(CLAVE)}catch(x){}if(location.hash)history.replaceState(null,"",location.pathname+location.search);E=porDefecto();render();anuncia("Paneles restablecidos")}
$("#restablecer").addEventListener("click",restablece);
$$("[data-abre]").forEach(function(b){b.addEventListener("click",function(){var id=b.dataset.abre;abre(id,true);var cab=P[id].querySelector(".ph");cab.scrollIntoView({block:"nearest"})})});
window.addEventListener("resize",function(){tamanos()});

/* ---- panel Contexto: pestañas, interruptores, recálculo ---- */
var LIM=__LIMITE__;
function miles(n){return String(n).replace(/\B(?=(\d{3})+(?!\d))/g,".")}
function pct1(t){return (t/LIM*100).toFixed(1).replace(".",",")+" %"}
$$(".pestañas button").forEach(function(b){b.addEventListener("click",function(){
  $$(".pestañas button").forEach(function(o){o.setAttribute("aria-selected",o===b?"true":"false")});
  $$(".tp").forEach(function(t){t.hidden=t.dataset.tp!==b.dataset.t});
})});
var CIRC=__CIRC__;
function recalcula(){
  var tot=0,off=0;
  $$(".cat").forEach(function(c){
    var id=c.dataset.id,fijo=+c.dataset.fijo||0,items=$$(".arch2[data-tok]",c),s=0;
    if(items.length){items.forEach(function(it){var on=it.querySelector(".sw").getAttribute("aria-checked")==="true";var t=+it.dataset.tok;it.classList.toggle("off",!on);if(on)s+=t;else off+=t})}else s=fijo;
    c.querySelector(".tok").textContent=miles(s);c.querySelector(".pc").textContent=pct1(s);
    var sg=$('.pila .seg[data-cat="'+id+'"]');if(sg)sg.style.width=(s/LIM*100)+"%";
    tot+=s;
  });
  $("#ctx-tok").textContent=miles(tot)+" de "+miles(LIM)+" tokens";
  var pc=Math.round(tot/LIM*100);$("#ctx-pct").textContent=pc+" %";
  $("#ctx-arco").setAttribute("stroke-dasharray",(tot/LIM*CIRC).toFixed(1)+" "+CIRC);
  $("#ctx-med").textContent=miles(tot+off);$("#ctx-sin").textContent=miles(tot);
  var r=$("#p-contexto .pr");if(r)r.textContent=pc+" % · "+miles(tot)+" de "+miles(LIM)+" tokens";
}
$$(".sw").forEach(function(s){s.addEventListener("click",function(){s.setAttribute("aria-checked",s.getAttribute("aria-checked")==="true"?"false":"true");recalcula()})});
$$(".cat").forEach(function(c){var t=c.querySelector(".tok");if(!c.querySelector(".arch2[data-tok]"))c.dataset.fijo=t.textContent.replace(/\./g,"")});
$$(".ay").forEach(function(b){b.addEventListener("click",function(e){e.preventDefault();e.stopPropagation()})});

/* ---- Chats: plegar proyectos, filtros ---- */
$$(".gh .cv").forEach(function(b){b.addEventListener("click",function(){var g=b.closest(".gr");var ab=b.classList.contains("ab");$$(".f,.plg,.cuelga",g).forEach(function(x){x.style.display=ab?"none":""});b.classList.toggle("ab",!ab);b.setAttribute("aria-expanded",ab?"false":"true")})});
$$(".chp").forEach(function(b){b.addEventListener("click",function(){b.setAttribute("aria-pressed",b.getAttribute("aria-pressed")==="true"?"false":"true")})});

/* ---- Temas: un tema es un juego de valores para los tokens (variables CSS en :root) ---- */
var TEMAS=__TEMAS__;
var CLAVE_T="trama-taller-tema";
var TOK=["--ground","--sheet","--block","--raised","--hover","--border","--rule","--control","--text","--soft","--muted","--accent","--ok","--warn","--bad","--probar","--naranja","--m-opus","--m-son","--m-hai","--gold","--ink"];
var ACENTOS=["#d3d7de","#8fb5f0","#7fd1c7","#9ad48a","#f0c27a","#f0a08a","#eaa0c8","#b9a3f0"];
var ROLES=[["fondo","Fondo"],["texto","Texto"],["acento","Acento"],["ok","Bien"],["warn","Decidir / aviso"],["bad","Falló"],["probar","Probar"],["naranja","Carpeta"]];
var T={id:"grafito",acento:null,mio:null},ED=null,root=document.documentElement;
function hexRgb(h){return [1,3,5].map(function(i){return parseInt(h.slice(i,i+2),16)})}
function linC(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}
function lumRel(h){var c=hexRgb(h).map(linC);return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]}
function contrasteJs(a,b){var x=lumRel(a),y=lumRel(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05)}
function oklabL(h){var c=hexRgb(h).map(linC),l=Math.cbrt(0.4122214708*c[0]+0.5363325363*c[1]+0.0514459929*c[2]),m=Math.cbrt(0.2119034982*c[0]+0.6806995451*c[1]+0.1073969566*c[2]),s=Math.cbrt(0.0883024619*c[0]+0.2817188376*c[1]+0.6299787005*c[2]);return 0.2104542553*l+0.793617785*m-0.0040720468*s}
function esHex(h){return /^#[0-9a-f]{6}$/i.test(h||"")}
function mixs(p){return "color-mix(in oklch,var(--ground),var(--text) "+p+"%)"}
/* Con dos colores (Fondo y Texto) queda un tema entero: superficies, bordes y textos secundarios se derivan. */
function derivaV(r,m){return {"--ground":r.fondo,"--text":r.texto,"--sheet":mixs(7),"--block":mixs(11),"--raised":mixs(16),"--hover":mixs(4),"--border":mixs(20),"--rule":mixs(13),"--control":mixs(30),"--soft":mixs(84),"--muted":mixs(62),"--accent":r.acento,"--ok":r.ok,"--warn":r.warn,"--bad":r.bad,"--probar":r.probar,"--naranja":r.naranja,"--gold":r.warn,"--ink":r.fondo,"--m-opus":m[0],"--m-son":m[1],"--m-hai":m[2]}}
function modelosDe(v){return [v["--m-opus"],v["--m-son"],v["--m-hai"]]}
function rolesDe(v){return {fondo:v["--ground"],texto:v["--text"],acento:v["--accent"],ok:v["--ok"],warn:v["--warn"],bad:v["--bad"],probar:v["--probar"],naranja:v["--naranja"]}}
function porId(id){
  if(id==="mio"&&T.mio)return {id:"mio",nombre:"Mío",v:derivaV(T.mio.r,T.mio.m),r:T.mio.r,m:T.mio.m};
  for(var i=0;i<TEMAS.length;i++)if(TEMAS[i].id===id)return {id:id,nombre:TEMAS[i].nombre,v:TEMAS[i].v,r:rolesDe(TEMAS[i].v),m:modelosDe(TEMAS[i].v)};
  return null;
}
function temaActual(){return porId(T.id)||porId("grafito")}
/* roles efectivos: lo que se ve ahora (tema + acento elegido, o el personalizado en edición) */
function rolesAhora(){var th=temaActual(),r=ED?Object.assign({},ED.r):Object.assign({},th.r);if(!ED&&T.acento)r.acento=T.acento;return r}
function vAhora(){
  var th=temaActual(),v;
  if(ED)v=derivaV(ED.r,ED.m);else{v=Object.assign({},th.v);if(T.acento)v["--accent"]=T.acento}
  return v;
}
function aplica(){
  var v=vAhora(),th=temaActual();
  TOK.forEach(function(k){root.style.setProperty(k,v[k])});
  var ac=ED?ED.r.acento:(T.acento||v["--accent"]);
  /* texto sobre el acento: oscuro, o claro si la luminosidad (OKLab) del acento es menor a 0,45 */
  root.style.setProperty("--on-accent",oklabL(ac)<0.45?v["--text"]:(ED?ED.r.fondo:v["--ground"]));
  var tn=$("#b-tema .tn");if(tn)tn.textContent=ED?"Personalizado":th.nombre;
  pintaTema();
}
function guardaT(){try{localStorage.setItem(CLAVE_T,JSON.stringify({id:T.id,acento:T.acento,mio:T.mio}))}catch(x){}}
function cargaT(){try{var s=JSON.parse(localStorage.getItem(CLAVE_T));if(s){if(s.mio&&s.mio.r)T.mio=s.mio;if(s.id&&porId(s.id))T.id=s.id;if(esHex(s.acento))T.acento=s.acento}}catch(x){}}
function eligeTema(id){ED=null;T.id=id;T.acento=null;aplica();guardaT();anuncia("Tema "+porId(id).nombre)}
function eligeAcento(hex){T.acento=hex;if(ED)ED.r.acento=hex;aplica();guardaT()}
function cambiaRol(k,val){
  if(!ED){var th=temaActual();ED={base:T.id,r:rolesAhora(),m:th.m.slice()}}
  ED.r[k]=val;if(k==="acento")T.acento=val;aplica();
}
function guardaMio(){if(!ED)return;T.mio={r:Object.assign({},ED.r),m:ED.m.slice()};T.id="mio";T.acento=null;ED=null;aplica();guardaT();anuncia("Guardado como Mío")}
function vuelve(){if(!ED)return;ED=null;T.acento=null;aplica();guardaT()}
function fichaHtml(th,sel){
  var st=Object.keys(th.v).map(function(k){return k+":"+th.v[k]}).join(";");
  return '<button class="ficha" type="button" role="radio" aria-checked="'+(sel?"true":"false")+'" data-id="'+th.id+'"><span class="mini" aria-hidden="true" style="'+st+'"><i class="m-h"></i><i class="m-b"></i><i class="m-a"></i><i class="m-t"></i><span class="m-p"><i class="o"></i><i class="w"></i><i class="x"></i></span></span><span class="fn">'+th.nombre+(sel?ico("check"):"")+'</span></button>';
}
function pintaTema(){
  var fi=$("#fichas");if(!fi)return;
  var lista=TEMAS.map(function(t){return porId(t.id)});if(T.mio)lista.push(porId("mio"));
  var foco=document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.id:null,enFichas=fi.contains(document.activeElement);
  fi.innerHTML=lista.map(function(th){return fichaHtml(th,!ED&&th.id===T.id)}).join("");
  if(enFichas&&foco){var f=fi.querySelector('[data-id="'+foco+'"]');if(f)f.focus()}
  var r=rolesAhora(),ac=(ED?ED.r.acento:r.acento).toLowerCase();
  $("#muestras").innerHTML=ACENTOS.map(function(c){return '<button class="mu" type="button" style="--c:'+c+'" data-c="'+c+'" aria-label="Acento '+c+'" aria-pressed="'+(ac===c.toLowerCase()?"true":"false")+'"></button>'}).join("")+'<label class="cp-uno"><input type="color" id="acento-c" value="'+ac+'" aria-label="Acento propio"><span>Propio</span></label>';
  var cps=$("#cps");
  if(!cps.children.length){cps.innerHTML=ROLES.map(function(x){return '<label class="cp"><input type="color" data-r="'+x[0]+'" aria-label="'+x[1]+'"><span>'+x[1]+'</span><code></code></label>'}).join("")}
  $$("input[data-r]",cps).forEach(function(i){var val=r[i.dataset.r];if(document.activeElement!==i)i.value=val;i.nextElementSibling.nextElementSibling.textContent=val})
  var poco=contrasteJs(r.texto,r.fondo)<4.5;$("#aviso-c").hidden=!poco;
  $("#sin-guardar").hidden=!ED;$("#t-guardar").disabled=!ED;$("#t-volver").disabled=!ED;
  $("#t-volver-n").textContent="Volver a "+porId(ED?ED.base:T.id).nombre;
}
$("#fichas").addEventListener("click",function(e){var b=e.target.closest(".ficha");if(b)eligeTema(b.dataset.id)});
$("#muestras").addEventListener("click",function(e){var b=e.target.closest(".mu");if(b)eligeAcento(b.dataset.c)});
$("#muestras").addEventListener("input",function(e){if(e.target.id==="acento-c"){var ac=e.target.value;T.acento=ac;if(ED)ED.r.acento=ac;aplicaSinRepintarInput();guardaT()}});
function aplicaSinRepintarInput(){var v=vAhora();TOK.forEach(function(k){root.style.setProperty(k,v[k])});var ac=ED?ED.r.acento:(T.acento||v["--accent"]);root.style.setProperty("--on-accent",oklabL(ac)<0.45?v["--text"]:(ED?ED.r.fondo:v["--ground"]))}
$("#cps").addEventListener("input",function(e){var i=e.target;if(i.dataset&&i.dataset.r){cambiaRol(i.dataset.r,i.value)}});
$("#t-guardar").addEventListener("click",guardaMio);
$("#t-volver").addEventListener("click",vuelve);
/* abrir y cerrar: Escape y clic afuera cierran; el foco queda adentro mientras está abierto */
var panelT=$("#tema"),dispT=null;
function abreTema(desde){if(!panelT.hidden)return;dispT=desde||document.activeElement;panelT.hidden=false;$("#b-tema").setAttribute("aria-expanded","true");pintaTema();var f=panelT.querySelector('.ficha[aria-checked="true"]')||panelT.querySelector(".ficha");if(f)f.focus()}
function cierraTema(vuelveFoco){if(panelT.hidden)return;panelT.hidden=true;$("#b-tema").setAttribute("aria-expanded","false");if(vuelveFoco!==false&&dispT&&dispT.focus)dispT.focus()}
$("#b-tema").addEventListener("click",function(e){panelT.hidden?abreTema(e.currentTarget):cierraTema()});
$$("[data-tema]").forEach(function(a){a.addEventListener("click",function(e){e.preventDefault();panelT.hidden?abreTema(a):cierraTema()})});
$("#tema-x").addEventListener("click",function(){cierraTema()});
document.addEventListener("keydown",function(e){
  if(panelT.hidden)return;
  if(e.key==="Escape"){e.preventDefault();e.stopPropagation();cierraTema();return}
  if(e.key==="Tab"){
    var fs=$$("button:not([disabled]),input",panelT).filter(function(x){return x.offsetParent!==null});if(!fs.length)return;
    var a=fs[0],z=fs[fs.length-1];
    if(e.shiftKey&&(document.activeElement===a||!panelT.contains(document.activeElement))){e.preventDefault();z.focus()}
    else if(!e.shiftKey&&(document.activeElement===z||!panelT.contains(document.activeElement))){e.preventDefault();a.focus()}
  }
},true);
document.addEventListener("pointerdown",function(e){if(!panelT.hidden&&!panelT.contains(e.target)&&!e.target.closest("#b-tema,[data-tema]"))cierraTema(false)},true);
function hashTema(q){
  var t=q.get("tema");if(t){var th=porId(t);if(th){T.id=th.id;T.acento=null;ED=null}}
  var f={tinta:"tinta",carbon:"carbon",grafito:"grafito"}[q.get("fondo")];if(f&&!t){T.id=f}
  if(q.get("panelTema"))setTimeout(function(){abreTema($("#b-tema"))},250);
}
cargaT();

/* «Cupos»: anillos, doble o arcos; se acuerda de la última y el hash (#cupos=arcos) manda sin guardar */
try{var cg=CUPOS[localStorage.getItem(CLAVE_C)];if(cg)$("#"+cg).checked=true}catch(x){}
$$('input[name="c"]').forEach(function(r){r.addEventListener("change",function(){try{localStorage.setItem(CLAVE_C,Object.keys(CUPOS).filter(function(k){return CUPOS[k]===r.id})[0])}catch(x){}})});
E=carga();aplica();render();recalcula();
requestAnimationFrame(function(){tamanos()});
window.__taller={get estado(){return JSON.parse(JSON.stringify(E))},mueve:mueve};
})();
`
  .replace("__TEMAS__", () => JSON.stringify(TEMAS))
  .replace("__LIMITE__", String(LIMITE))
  .replace("__CIRC__", String(CIRC));

// ---------- Paneles: encabezado con agarre, título, plegar, ⋯ y cerrar ----------
const ICP = { chats: "chat", contexto: "capas", cupo: "medidor" };
const panel = (id, titulo, sm, resumen, cuerpo) => `
<section class="panel" id="p-${id}" role="region" aria-label="${titulo}">
  <header class="ph">${I("grip", "grip")}${I(ICP[id], "pic")}<h2>${titulo}</h2>${sm ? `<span class="sm">${sm}</span>` : ""}<span class="esp"></span>
    <button class="ib plg" aria-expanded="true" aria-label="Plegar ${titulo}" title="Plegar ${titulo}">${I("abajo")}</button>
    <button class="ib mp" aria-haspopup="menu" aria-expanded="false" aria-label="Más acciones de ${titulo}" title="Más acciones: mover y cerrar">${I("puntos")}</button>
    <button class="ib cx" aria-label="Cerrar ${titulo}" title="Cerrar ${titulo}">${I("x")}</button>
  </header>
  <div class="pr">${resumen}</div>
  <div class="pb">${cuerpo}</div>
</section>`;

const salto = `<nav class="salto" aria-label="Maqueta"><span class="tit">Maqueta E · Taller</span><i></i><button class="reset" id="b-tema" type="button" aria-haspopup="dialog" aria-expanded="false" aria-controls="tema">${I("paleta")}Tema <span class="tn">Grafito</span></button><i></i>
  <span>Cupos</span><input type="radio" name="c" id="c1" checked><label for="c1">Anillos</label><input type="radio" name="c" id="c2"><label for="c2">Doble</label><input type="radio" name="c" id="c3"><label for="c3">Arcos</label><i></i>
  <button class="reset" id="restablecer" type="button">${I("resetea")}Restablecer paneles</button>
  <span class="nota-s">${I("grip")}Arrastrá un panel desde su encabezado</span></nav>`;

const cab = `
<header class="cab">
  <span class="mg" style="--p:${PROY.trama.color}" title="Proyecto trama">${PROY.trama.sig}</span><h1>Rediseño de la interfaz</h1><span class="proy">trama · ${mfam("Opus")}Opus 5.5 high</span>
  <div class="der"><button class="btn" id="b-paneles" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Paneles">${I("paneles")}Paneles <span class="gris cnt">3 de 3</span>${I("abajo")}</button><button class="btn" type="button">${I("fuera")}Archivar</button></div>
</header>`;
const compo = `
<div class="compo"><div class="caja">
  <div class="campo">Escribí o dictá…</div>
  <div class="ctl"><button class="btn liso" type="button">${I("clip")}Adjuntar</button><button class="btn liso" type="button">${mfam("Opus")}Opus 5.5 · high ${I("abajo")}</button><span class="esp"></span><button class="btn liso" type="button" aria-label="Dictar">${I("micro")}Dictar</button><button class="enviar" aria-label="Enviar" type="button">${I("enviar")}</button></div>
</div></div>`;

const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trama · E · Taller</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${css}</style></head>
<body>${SPRITE}${EXTRA}${salto}
<div class="app">${riel}
  <main class="taller" id="taller">
    <section class="zona v" id="z-izq" aria-label="Zona izquierda" hidden></section>
    <div class="dvz" id="dv-izq" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Ancho de la zona izquierda" hidden></div>
    <div class="medio" id="medio">
      <section class="conv" id="conv" aria-label="Chat">${cab}<div class="hilo"><div class="hilo-in">${hilo}</div></div>${compo}</section>
      <div class="dvz h" id="dv-abajo" role="separator" aria-orientation="horizontal" tabindex="0" aria-label="Alto de la zona de abajo" hidden></div>
      <section class="zona h" id="z-abajo" aria-label="Zona de abajo" hidden></section>
    </div>
    <div class="dvz" id="dv-der" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Ancho de la zona derecha" hidden></div>
    <section class="zona v" id="z-der" aria-label="Zona derecha" hidden></section>
    <div id="soltar" aria-hidden="true"><div class="sz" data-z="izq"><span>Soltar a la izquierda</span></div><div class="sz" data-z="der"><span>Soltar a la derecha</span></div><div class="sz" data-z="abajo"><span>Soltar abajo</span></div><div class="ins"></div></div>
  </main>
</div>
<div class="tema" id="tema" role="dialog" aria-modal="true" aria-labelledby="tema-t" hidden>
  <header><span class="pic">${I("paleta")}</span><h2 id="tema-t">Tema</h2><span class="esp"></span><button class="ib" id="tema-x" type="button" aria-label="Cerrar el panel de temas" title="Cerrar · Esc">${I("x")}</button></header>
  <section><h3>Temas</h3><div class="fichas" id="fichas" role="radiogroup" aria-label="Temas de fábrica"></div></section>
  <section><h3>Acento</h3><div class="muestras" id="muestras" role="group" aria-label="Color de acento"></div></section>
  <section><h3>Personalizado <span class="sin" id="sin-guardar" hidden>· sin guardar</span></h3>
    <div class="cps" id="cps"></div>
    <p class="aviso-c" id="aviso-c" role="status" hidden>${I("alerta")}<span>Poco contraste: el texto se va a leer mal</span></p>
    <div class="acc2"><button class="btn pri" id="t-guardar" type="button" disabled>${I("check")}Guardar como mi tema</button><button class="btn" id="t-volver" type="button" disabled>${I("resetea")}<span id="t-volver-n">Volver a Grafito</span></button></div>
  </section>
</div>
<div id="almacen" hidden>
${panel("chats", "Chats", "", resumenChats, panelChats)}
${panel("contexto", "Contexto", "", resumenContexto, panelContexto)}
${panel("cupo", "Cupo", "Claude Max", resumenCupo, panelCupo)}
</div>
<div id="anuncio" class="vh" role="status" aria-live="polite"></div>
<script>${js}</script></body></html>`;

writeFileSync(SALIDA, html);
console.log("e-taller.html", html.length, "bytes");
console.log("contexto suma", miles(TOTAL), "medido", miles(TOTAL + APAGADO), "| esperan", cuenta.espera, "fallan", cuenta.fallo, "| marcha", JSON.stringify(marcha));
for (const m of MODOS) console.log(m.nombre, porDia(m.ritmo), m.seAcaba ? `se acaba ${m.cuando}, ${m.antes} h antes` : `llega con ${m.llega} %`);
