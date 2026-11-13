// Piezas compartidas de las maquetas: tokens (leídos de app/src/tokens.css, sin tocarlos), íconos, estilos y la barra nueva.
import { readFileSync } from "node:fs";

export const TOKENS = readFileSync("/home/ferox/Proyectos/trama/app/src/tokens.css", "utf8");

const TRAZOS = {
  busca: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  mas: '<path d="M12 5v14M5 12h14"/>',
  corona: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  preg: '<path d="M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.4M12 18v.5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  rama: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-12 3-12 8"/>',
  tablero: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 8v6M12 8v3M15 8v8"/>',
  barras: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  ajustes:
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  rayo: '<path d="M13 2L4 14h8l-1 8 9-12h-8l1-8z"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>',
  enviar: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  abajo: '<path d="M6 9l6 6 6-6"/>',
  volver: '<path d="M15 6l-6 6 6 6"/>',
  copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  prueba: '<path d="M9 3h6M10 3v6L5 19a1.5 1.5 0 0 0 1.4 2h11.2A1.5 1.5 0 0 0 19 19L14 9V3"/>',
  escudo: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  alerta: '<path d="M12 4l9 16H3zM12 10v4M12 17v.5"/>',
  clip: '<path d="M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.5 17a1.7 1.7 0 0 1-2.4-2.4L15 6.7"/>',
  casa: '<path d="M4 11l8-7 8 7v9H4z"/>',
  lista: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  columnas: '<rect x="4" y="4" width="6" height="16" rx="1"/><rect x="14" y="4" width="6" height="10" rx="1"/>',
  choque: '<path d="M7 4v6l5 4 5-4V4M12 14v6"/>',
  modelo: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
  medidor: '<path d="M4 16a8 8 0 1 1 16 0M12 16l4-5"/>',
  enchufe: '<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5"/>',
  carpeta: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  ventana: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
};

export const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(TRAZOS)
  .map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`)
  .join("")}</svg>`;

/** Un ícono del sprite; decorativo (la palabra va siempre al lado). */
export const I = (nombre, clase = "") => `<svg class="i ${clase}" aria-hidden="true"><use href="#i-${nombre}"/></svg>`;

/** El glifo de estado, siempre con forma propia: ? decisión, ✕ fallo, ✓ terminó, punto corre. */
export const G = (tipo) =>
  `<span class="gl ${tipo}" aria-hidden="true">${tipo === "decide" ? I("preg") : tipo === "fallo" ? I("x") : tipo === "ok" ? I("check") : ""}</span>`;

/** La palabra de estado en píldora: nunca el color solo. */
export const P = (tipo, texto, icono) => `<span class="pal ${tipo}">${icono ? I(icono) : ""}${texto}</span>`;

const PROY = { atlas: "at", cauce: "ca", brote: "br", casa: "cs", eco: "ec" };
export const M = (p) => `<i class="m" style="--p:var(--p-${p})">${PROY[p]}</i>`;

const anillo = (pct, rotulo) => `
  <div class="anillo" title="${rotulo}: ${pct} % usado">
    <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" class="pista"/><circle cx="18" cy="18" r="15" class="uso" stroke-dasharray="${(pct * 0.942).toFixed(1)} 94.2" transform="rotate(-90 18 18)"/></svg>
    <b>${pct}</b><span>${rotulo}</span>
  </div>`;

const fila = ({ tipo = "worker", p, t, chip, rayo, estado, tiempo, actual, vivo }) => `
  <a class="fila ${tipo}${vivo ? " vivo" : ""}" href="#" style="--p:var(--p-${p})"${actual ? ' aria-current="page"' : ""}>
    ${tipo === "lider" ? I("corona", "corona" + (vivo ? " viva" : "")) : estado === "decide" ? G("decide") : estado === "fallo" ? G("fallo") : estado === "ok" ? G("ok") : G("corre")}
    <span class="t">${t}</span>
    ${chip ? `<span class="chip">${chip}</span>` : ""}
    ${rayo ? `<span class="chip">${I("rayo")}${rayo}</span>` : ""}
    ${estado === "decide" ? P("decide", "decidir") : estado === "fallo" ? P("fallo", "falló") : ""}
    ${tiempo ? `<span class="tiempo">${tiempo}</span>` : ""}
  </a>`;

const grupo = (p, nombre, marcha, cuerpo) => `
  <section class="proy" style="--p:var(--p-${p})">
    <header>${I("abajo", "pleg")}${M(p)}<span>${nombre}</span>${marcha ? `<span class="marcha"><span class="punto"></span>${marcha} en marcha</span>` : '<span class="marcha"></span>'}<button class="masp" aria-label="Chat nuevo en ${nombre}">${I("mas")}</button></header>
    ${cuerpo}
  </section>`;

/** La barra nueva. `activo`: ahora | tablero | ramas | hilo; `hilo`: qué fila está abierta. */
export const barra = (activo, hilo = "") => `
<aside class="barra vidrio" aria-label="Barra">
  <div class="riel">
    <div class="logo" title="Ocultar la barra">${I("mas")}</div>
    <button class="mono todo" aria-pressed="true">Todo</button>
    <button class="mono" style="--p:var(--p-atlas)" title="atlas: espera tu respuesta">at<span class="marca decide">${I("preg")}</span></button>
    <button class="mono" style="--p:var(--p-cauce)" title="cauce: algo falló">ca<span class="marca fallo">${I("x")}</span></button>
    <button class="mono" style="--p:var(--p-brote)" title="brote: hay algo corriendo">br</button>
    <button class="mono" style="--p:var(--p-casa)" title="casa">cs</button>
    <button class="mono" style="--p:var(--p-eco)" title="eco">ec</button>
    <div class="hueco"></div>
    ${anillo(34, "5 h")}${anillo(61, "sem")}
    <a class="ric" href="#" title="Estadísticas">${I("barras")}<span>Estad.</span></a>
    <a class="ric" href="5-ajustes.html" title="Ajustes">${I("ajustes")}<span>Ajustes</span></a>
  </div>
  <div class="lista">
    <div class="cab">
      <label class="busca">${I("busca")}<span>Buscar hilos</span><kbd>Ctrl K</kbd></label>
      <button class="nuevo" aria-label="Nuevo líder">${I("mas")}</button>
    </div>
    <nav class="secc" aria-label="Secciones">
      <a href="1-barra-y-ahora.html"${activo === "ahora" ? ' aria-current="page"' : ""}>Ahora <span class="cuenta tuya" title="3 cosas te tocan">3</span></a>
      <a href="3-tablero.html"${activo === "tablero" ? ' aria-current="page"' : ""}>${I("tablero")}Tablero <span class="cuenta" title="12 te esperan">12</span></a>
      <a href="4-ramas.html"${activo === "ramas" ? ' aria-current="page"' : ""}>${I("rama")}Ramas <span class="cuenta" title="9 sin integrar">9</span></a>
    </nav>
    <div class="scroll">
      <div class="rot"><span>Te toca · 3</span><span>lo más viejo primero</span></div>
      <div class="toca">
        <a href="#" class="${hilo === "migrar" ? "abierta" : ""}">${G("decide")}<b>Migrar la config de YAML a TOML</b>${P("decide", "decidir")}<small>${M("atlas")} ¿Hasta cuándo se sigue leyendo el YAML viejo?</small></a>
        <a href="#">${G("decide")}<b>Rediseñar la pantalla de conciliación</b>${P("decide", "decidir")}<small>${M("cauce")} ¿El resumen va arriba de la tabla o al costado?</small></a>
        <a href="#" class="fallo">${G("fallo")}<b>Encontrar por qué falla el índice</b>${P("fallo", "falló")}<small>${M("cauce")} Salió con error: 2 tests de indice.test.ts siguen sin pasar</small></a>
      </div>
      <div class="rot"><span>Proyectos</span><button class="orden">Recientes ${I("abajo")}</button></div>
      ${grupo(
        "atlas",
        "atlas",
        2,
        fila({ tipo: "lider", p: "atlas", t: "ana-c7", chip: "Opus high", rayo: "8m", tiempo: "hace 12 m", vivo: true, actual: hilo === "ana-c7" }) +
          fila({ p: "atlas", t: "Medir el arranque en frío", chip: "Opus medium", tiempo: "corre hace 1 m", vivo: true }) +
          fila({ p: "atlas", t: "Auditar los índices de envíos", chip: "Sonnet max", tiempo: "corre hace 4 m", vivo: true }) +
          `<a class="pliegue" href="#">1 terminado ${I("chev")}</a>` +
          fila({ tipo: "lider", p: "atlas", t: "ana-a3", chip: "Opus high", rayo: "43m", tiempo: "hace 3 m" }) +
          `<a class="pliegue" href="#">3 terminados ${I("chev")}</a>`,
      )}
      ${grupo(
        "cauce",
        "cauce",
        1,
        fila({ tipo: "lider", p: "cauce", t: "cauce-cierre", chip: "Sonnet high", rayo: "21m", tiempo: "hace 25 m", vivo: true }) +
          fila({ p: "cauce", t: "Probar el cierre de caja", chip: "Sonnet high", tiempo: "corre hace 9 m", vivo: true }) +
          `<a class="pliegue" href="#">1 terminado ${I("chev")}</a>`,
      )}
      ${grupo(
        "brote",
        "brote",
        1,
        fila({ tipo: "lider", p: "brote", t: "ana-d2", tiempo: "Cerrado · hace 22 m" }) +
          fila({ p: "brote", t: "Exportar el calendario a ICS", chip: "Fable high", tiempo: "corre hace 40 s", vivo: true }) +
          `<a class="pliegue" href="#">3 terminados ${I("chev")}</a>`,
      )}
      ${grupo("casa", "Inicio", 0, fila({ tipo: "lider", p: "casa", t: "ana-b5", chip: "Opus high", tiempo: "ayer" }))}
      ${grupo("eco", "eco", 0, `<a class="pliegue" href="#">1 terminada ${I("chev")}</a>`)}
      <a class="pliegue suelto" href="#">De Claude Code · 13 conversaciones ${I("chev")}</a>
    </div>
  </div>
</aside>`;

export const CSS = `
:root{--p-atlas:var(--paso-pensar);--p-cauce:var(--sint-var);--p-brote:var(--rosa);--p-casa:var(--sint-str);--p-eco:var(--texto-5)}
*{box-sizing:border-box;margin:0;padding:0}
html{font-size:16px}
body{font:400 var(--letra-5)/1.45 Inter,system-ui,sans-serif;color:var(--texto-2);background:var(--fondo-ventana);background-attachment:fixed;height:100vh;overflow:hidden;font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit;background:none;border:0}
button{cursor:pointer}
a{color:inherit;text-decoration:none}
:focus-visible{outline:2px solid var(--acento);outline-offset:2px}
svg.i{width:1rem;height:1rem;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;flex:none}
kbd{font:500 var(--letra-3)/1 Inter,system-ui,sans-serif;color:var(--texto-4);padding:.1875rem .375rem;border-radius:var(--r-xs);background:var(--capa-card);box-shadow:inset 0 0 0 1px var(--borde-4);white-space:nowrap}
code,.mono-t{font:400 var(--letra-4)/1.4 ui-monospace,"JetBrains Mono","Fira Code",monospace}
.ventana{display:grid;grid-template-columns:clamp(20rem,26vw,27.5rem) minmax(0,1fr);gap:var(--gap-paneles);padding:var(--gap-paneles);height:100vh}
.vidrio{background:var(--vidrio-a);box-shadow:var(--vidrio-borde),var(--sombra-vidrio);border-radius:var(--r-xl);min-height:0}

/* --- barra --- */
.barra{display:grid;grid-template-columns:3.5rem minmax(0,1fr);overflow:hidden}
.riel{display:flex;flex-direction:column;align-items:center;gap:var(--esp-2);padding:var(--esp-3) 0;border-right:1px solid var(--capa-div);min-height:0}
.riel .logo{height:var(--alto-boton);display:grid;place-items:center;color:var(--texto-1)}
.mono{position:relative;width:2.25rem;height:2.25rem;border-radius:var(--r-sm);background:var(--capa-card);display:grid;place-items:center;font-weight:600;font-size:var(--letra-4);color:var(--p,var(--texto-3))}
.mono.todo{color:var(--texto-1);font-size:var(--letra-3)}
.mono[aria-pressed=true]{background:var(--capa-tile);box-shadow:inset 0 0 0 1px var(--borde-5)}
.marca{position:absolute;top:-.3125rem;right:-.3125rem;width:1rem;height:1rem;border-radius:var(--r-cap);display:grid;place-items:center;box-shadow:0 0 0 2px var(--sup-0)}
.marca.decide{background:var(--decision-relleno);color:var(--decision-sobre)}
.marca.fallo{background:var(--fallo-relleno);color:var(--fallo-sobre)}
.marca svg{width:.625rem;height:.625rem;stroke-width:3}
.hueco{flex:1}
.anillo{position:relative;width:2.25rem;display:grid;justify-items:center;color:var(--texto-4);font-size:var(--letra-3)}
.anillo svg{width:2.25rem;height:2.25rem;fill:none;stroke-width:3}
.anillo .pista{stroke:var(--capa-track)}
.anillo .uso{stroke:var(--acento);stroke-linecap:round}
.anillo b{position:absolute;top:.5625rem;font-size:var(--letra-4);font-weight:600;color:var(--texto-1)}
.ric{display:grid;justify-items:center;gap:.125rem;width:3rem;padding:var(--esp-1) 0;border-radius:var(--r-sm);color:var(--texto-4);font-size:var(--letra-3)}
.ric:hover,.ric[aria-current]{background:var(--capa-hover);color:var(--texto-1)}
.lista{display:flex;flex-direction:column;min-width:0;min-height:0}
.cab{display:flex;gap:var(--esp-2);padding:var(--esp-3) var(--esp-3) var(--esp-2)}
.busca{flex:1;display:flex;align-items:center;gap:var(--esp-2);height:var(--alto-boton);padding:0 var(--esp-3);border-radius:var(--r-cap);background:var(--capa-input);color:var(--texto-5);min-width:0}
.busca span{flex:1}
.nuevo{width:var(--alto-boton);height:var(--alto-boton);border-radius:var(--r-cap);background:var(--acento);color:var(--acento-texto);display:grid;place-items:center;flex:none}
.secc{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--esp-1);margin:0 var(--esp-3) var(--esp-2);padding:.1875rem;border-radius:var(--r-md);background:var(--capa-card)}
.secc a{display:flex;align-items:center;justify-content:center;gap:var(--esp-1-5);height:1.875rem;border-radius:var(--r-sm);color:var(--texto-4);font-weight:500}
.secc a:hover{color:var(--texto-1)}
.secc a[aria-current]{background:var(--capa-tile);color:var(--texto-1);box-shadow:inset 0 0 0 1px var(--borde-5)}
.cuenta{font-size:var(--letra-3);font-weight:600;min-width:1.25rem;height:1.125rem;padding:0 .3125rem;border-radius:var(--r-cap);display:inline-grid;place-items:center;background:var(--capa-tile);color:var(--texto-3)}
.cuenta.tuya{background:var(--decision-relleno);color:var(--decision-sobre)}
.scroll{overflow:auto;min-height:0;flex:1;padding:0 var(--esp-2) var(--esp-3);scrollbar-width:thin;scrollbar-color:var(--borde-4) transparent}
.rot{display:flex;align-items:center;justify-content:space-between;padding:var(--esp-3) var(--esp-2) var(--esp-1);color:var(--texto-5);font-size:var(--letra-4);font-weight:500}
.rot .orden{display:inline-flex;align-items:center;gap:var(--esp-1);color:var(--texto-4)}
.toca{display:grid;gap:var(--esp-1)}
.toca a{display:grid;grid-template-columns:1.125rem minmax(0,1fr) auto;gap:.125rem var(--esp-2);align-items:center;padding:var(--esp-2);border-radius:var(--r-sm);background:var(--decision-fondo);box-shadow:inset 0 0 0 1px var(--decision-borde)}
.toca a.fallo{background:var(--fallo-fondo);box-shadow:inset 0 0 0 1px var(--fallo-borde)}
.toca a.abierta{box-shadow:inset 0 0 0 2px var(--decision-luz)}
.toca b{font-weight:600;color:var(--texto-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.toca small{grid-column:2/-1;display:flex;align-items:center;gap:var(--esp-1-5);color:var(--texto-3);font-size:var(--letra-4);white-space:nowrap;overflow:hidden}
.m{width:1.125rem;height:1.125rem;border-radius:var(--r-xs);background:var(--capa-tile);color:var(--p);display:inline-grid;place-items:center;font-size:var(--letra-3);font-weight:700;font-style:normal;flex:none;line-height:1}
.gl{width:1.125rem;height:1.125rem;border-radius:var(--r-cap);display:inline-grid;place-items:center;flex:none}
.gl svg{width:.6875rem;height:.6875rem;stroke-width:3}
.gl.decide{background:var(--decision-relleno);color:var(--decision-sobre)}
.gl.fallo{background:var(--fallo-relleno);color:var(--fallo-sobre)}
.gl.ok{background:var(--ok-tinte);color:var(--ok)}
.gl.corre{box-shadow:inset 0 0 0 1.5px var(--borde-6)}
.gl.corre::after{content:"";width:.4375rem;height:.4375rem;border-radius:var(--r-cap);background:var(--p,var(--acento))}
.pal{font-size:var(--letra-3);font-weight:600;padding:0 .4375rem;height:1.125rem;border-radius:var(--r-cap);display:inline-flex;align-items:center;gap:.25rem;white-space:nowrap;flex:none}
.pal svg{width:.6875rem;height:.6875rem;stroke-width:2.5}
.pal.decide{background:var(--decision-relleno);color:var(--decision-sobre)}
.pal.fallo{background:var(--fallo-relleno);color:var(--fallo-sobre)}
.pal.ok{background:var(--ok-tinte);color:var(--verde-palido)}
.pal.neutro{background:var(--capa-tile);color:var(--texto-3)}
.pal.aviso{background:var(--aviso-tinte);color:var(--decision-texto)}
.pal.critico{background:var(--critico-tinte);color:var(--fallo-texto)}
.proy{margin-top:var(--esp-1)}
.proy>header{display:flex;align-items:center;gap:var(--esp-2);height:1.875rem;padding:0 var(--esp-1) 0 var(--esp-2);color:var(--texto-1);font-weight:600}
.proy .pleg{color:var(--texto-5);width:.75rem;height:.75rem}
.marcha{margin-left:auto;font-weight:400;font-size:var(--letra-4);color:var(--texto-4);display:flex;align-items:center;gap:var(--esp-1-5)}
.punto{width:.4375rem;height:.4375rem;border-radius:var(--r-cap);background:var(--p,var(--acento));flex:none}
.masp{width:1.5rem;height:1.5rem;border-radius:var(--r-cap);display:grid;place-items:center;color:var(--texto-4)}
.masp:hover{background:var(--capa-hover);color:var(--texto-1)}
.fila{display:flex;align-items:center;gap:var(--esp-2);height:1.75rem;padding:0 var(--esp-2);border-radius:var(--r-sm);color:var(--texto-2)}
.fila:hover{background:var(--capa-hover)}
.fila[aria-current]{background:var(--acento-tinte);box-shadow:inset 0 0 0 1px var(--ajustes-acento-borde)}
.fila .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fila.lider .t{font-weight:600;color:var(--texto-1)}
.fila.worker{margin-left:.9375rem;padding-left:var(--esp-2);border-left:2px solid var(--borde-4);border-radius:0 var(--r-sm) var(--r-sm) 0}
.fila.worker.vivo{border-left-color:var(--p)}
.chip{font-size:var(--letra-3);color:var(--texto-4);background:var(--capa-card);height:1.125rem;padding:0 .4375rem;border-radius:var(--r-cap);display:inline-flex;align-items:center;gap:.1875rem;white-space:nowrap;flex:none}
.chip svg{width:.6875rem;height:.6875rem}
.tiempo{color:var(--texto-5);font-size:var(--letra-4);white-space:nowrap;flex:none}
.corona{color:var(--texto-6)}
.corona.viva{color:var(--oro)}
.pliegue{display:flex;align-items:center;gap:var(--esp-1);height:1.5rem;padding:0 var(--esp-2) 0 1.875rem;color:var(--texto-5);font-size:var(--letra-4)}
.pliegue svg{width:.75rem;height:.75rem}
.pliegue.suelto{margin-top:var(--esp-3);padding-left:var(--esp-2)}

/* --- panel principal --- */
.panel{display:flex;flex-direction:column;overflow:hidden}
.panel>header{display:flex;align-items:center;gap:var(--esp-3);padding:var(--esp-5) var(--esp-6) var(--esp-4)}
.panel>header .der{margin-left:auto;display:flex;align-items:center;gap:var(--esp-2)}
h1{font-size:var(--ajustes-titulo);font-weight:600;color:var(--texto-1);letter-spacing:-.01em;line-height:1.2}
.hallazgo{color:var(--texto-3);font-size:var(--letra-6);margin-top:.125rem}
.hallazgo b{color:var(--texto-1);font-weight:600}
.cuerpo{flex:1;min-height:0;overflow:auto;padding:0 var(--esp-6) var(--esp-6);scrollbar-width:thin;scrollbar-color:var(--borde-4) transparent}
.btn{height:var(--alto-boton);padding:0 var(--esp-4);border-radius:var(--r-cap);background:var(--capa-tile);color:var(--texto-1);font-weight:500;display:inline-flex;align-items:center;gap:var(--esp-2);white-space:nowrap;flex:none}
.btn:hover{background:var(--capa-track)}
.btn.pri{background:var(--acento);color:var(--acento-texto);font-weight:600}
.btn.pri:hover{background:var(--azul-palido)}
.btn.chico{height:1.75rem;padding:0 var(--esp-3);font-size:var(--letra-4)}
.btn.fant{background:none;color:var(--texto-3)}
.btn.fant:hover{background:var(--capa-hover);color:var(--texto-1)}
.tarj{background:var(--capa-card);border-radius:var(--r-lg);box-shadow:inset 0 0 0 1px var(--borde-3)}
h2{font-size:var(--letra-6);font-weight:600;color:var(--texto-1);display:flex;align-items:center;gap:var(--esp-2)}
h2 .n{font-weight:400;color:var(--texto-5)}
.apag{color:var(--texto-5)}
.nota-maqueta{position:fixed;right:var(--esp-4);bottom:var(--esp-4);z-index:9;display:flex;gap:var(--esp-1);padding:var(--esp-1);border-radius:var(--r-cap);background:var(--vidrio-opaco);box-shadow:var(--vidrio-borde),var(--sombra-vidrio);font-size:var(--letra-3)}
.nota-maqueta a{padding:.25rem .625rem;border-radius:var(--r-cap);color:var(--texto-4)}
.nota-maqueta a[aria-current]{background:var(--capa-tile);color:var(--texto-1)}
`;

const PAGINAS = [
  ["1-barra-y-ahora.html", "Barra + Ahora"],
  ["2-chat-lider.html", "Chat del líder"],
  ["3-tablero.html", "Tablero"],
  ["4-ramas.html", "Ramas"],
  ["5-ajustes.html", "Ajustes"],
];

export const documento = ({ archivo, titulo, css = "", cuerpo }) => `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trama · maqueta · ${titulo}</title>
<style>
/* Los tokens son una copia literal de app/src/tokens.css: la maqueta no define ningún color propio. */
${TOKENS}
${CSS}
${css}
</style>
</head>
<body>
${SPRITE}
${cuerpo}
<nav class="nota-maqueta" aria-label="Maquetas">${PAGINAS.map(([a, n]) => `<a href="${a}"${a === archivo ? ' aria-current="page"' : ""}>${n}</a>`).join("")}</nav>
</body>
</html>
`;
