// Paneles acoplables (src/barra/acople-logica.ts + acople-paneles.css): tres zonas (izq, der, abajo) alrededor del centro.
// Cada panel tiene encabezado con agarradera, ícono, título, plegar, menú "…" y cerrar; se arrastra con puntero o se mueve por teclado.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronDown, Ellipsis, GripVertical, PanelBottom, PanelLeft, PanelRight, X } from "lucide-react";
import { useIdioma } from "../i18n/react";
import { t } from "../i18n";
import {
  ZONAS,
  barraInsercion,
  cajasSoltar,
  destino,
  divisorPanelInerte,
  panelesEnZona,
  renglonesMenuPanel,
  zonaTodoPlegado,
  type CajaRelativa,
  type Destino,
  type GeoDestino,
  type PanelId,
  type Rect,
  type Zona,
} from "./acople-logica";
import { useAcople, type UseAcople } from "./useAcople";
import "./acople-paneles.css";

export type PanelDef = {
  titulo: string;
  icono: ReactNode;
  contenido: ReactNode;
};

export type AcopleProps = {
  paneles: Partial<Record<PanelId, PanelDef>>;
  vivos: readonly PanelId[];
  centro: ReactNode;
  control?: UseAcople;
};

type EstadoArrastre = {
  id: PanelId;
  x: number;
  y: number;
  cajas: Record<Zona, CajaRelativa>;
  insercion: CajaRelativa | null;
  destino: Destino | null;
};

type EstadoMenu = {
  id: PanelId;
  boton: HTMLButtonElement;
  x: number;
  y: number;
};

const ANCHO_MIN_PANEL_AB = 240;
const ALTO_MIN_PANEL = 120;
const UMBRAL_ARRASTRE_PX = 6;
const PASO_TECLA_PX = 16;

const rectDe = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
};

const escalaInv = (): number => {
  const fs = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const esc = (Number.isFinite(fs) && fs > 0 ? fs : 16) * 0.0625;
  return esc ** -1;
};

const acotar = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));

const iconoZona = (z: Zona) =>
  z === "izq" ? <PanelLeft size={15} strokeWidth={1.8} aria-hidden /> : z === "der" ? <PanelRight size={15} strokeWidth={1.8} aria-hidden /> : <PanelBottom size={15} strokeWidth={1.8} aria-hidden />;

const textoMover = (z: Zona): string =>
  z === "izq" ? t("acople.moverIzq") : z === "der" ? t("acople.moverDer") : t("acople.moverAbajo");

const textoSoltar = (z: Zona): string =>
  z === "izq" ? t("acople.soltarIzq") : z === "der" ? t("acople.soltarDer") : t("acople.soltarAbajo");

export function Acople({ paneles, vivos, centro, control }: AcopleProps) {
  useIdioma();
  const interno = useAcople(undefined, { desactivar: Boolean(control) });
  const ctrl = control ?? interno;
  const { acople, mover, cerrar, plegar, redimensionar, repartir, restablecerZona, restablecerPartes } = ctrl;

  const raizRef = useRef<HTMLDivElement>(null);
  const zonaRefs = useRef<Record<Zona, HTMLElement | null>>({ izq: null, der: null, abajo: null });
  const panelRefs = useRef<Partial<Record<PanelId, HTMLElement | null>>>({});
  const limpiarArrastreRef = useRef<(() => void) | null>(null);
  const limpiarDivisorRef = useRef<(() => void) | null>(null);

  const [arrastre, setArrastre] = useState<EstadoArrastre | null>(null);
  const [divisorActivo, setDivisorActivo] = useState<string | null>(null);
  const [menu, setMenu] = useState<EstadoMenu | null>(null);
  const [anuncio, setAnuncio] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const anunciar = (texto: string) => {
    setAnuncio("");
    queueMicrotask(() => setAnuncio(texto));
  };

  const vivosVisibles = useMemo(() => vivos.filter((id) => Boolean(paneles[id])), [vivos, paneles]);

  const zonasVisibles = useMemo<Record<Zona, PanelId[]>>(
    () => ({
      izq: panelesEnZona(acople, "izq", vivosVisibles),
      der: panelesEnZona(acople, "der", vivosVisibles),
      abajo: panelesEnZona(acople, "abajo", vivosVisibles),
    }),
    [acople, vivosVisibles],
  );

  const abajoTodoPlegado = useMemo(() => zonaTodoPlegado(acople, "abajo", vivosVisibles), [acople, vivosVisibles]);

  useEffect(() => {
    return () => {
      limpiarArrastreRef.current?.();
      limpiarDivisorRef.current?.();
    };
  }, []);

  // Menú "…" del panel: foco inicial, teclado (Esc, flechas, Home, End, Tab) y clic afuera.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const r = menu.boton.getBoundingClientRect();
    const x = acotar(r.right - w, 8, Math.max(8, window.innerWidth - w - 8));
    const y = acotar(r.bottom + 6, 8, Math.max(8, window.innerHeight - h - 8));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    const primero = el.querySelector<HTMLButtonElement>("[role=menuitem]:not([aria-disabled=true])");
    primero?.focus();
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const alAfuera = (ev: PointerEvent) => {
      const tEl = ev.target as Node | null;
      if (menuRef.current?.contains(tEl) || menu.boton.contains(tEl)) return;
      setMenu(null);
    };
    const alTeclado = (ev: globalThis.KeyboardEvent) => {
      const el = menuRef.current;
      if (!el) return;
      const items = Array.from(el.querySelectorAll<HTMLButtonElement>("[role=menuitem]"));
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      if (ev.key === "Escape") {
        ev.preventDefault();
        const btn = menu.boton;
        setMenu(null);
        btn.focus();
      } else if (ev.key === "ArrowDown" && items.length > 0) {
        ev.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (ev.key === "ArrowUp" && items.length > 0) {
        ev.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      } else if (ev.key === "Home" && items.length > 0) {
        ev.preventDefault();
        items[0].focus();
      } else if (ev.key === "End" && items.length > 0) {
        ev.preventDefault();
        items[items.length - 1].focus();
      } else if (ev.key === "Tab") {
        setMenu(null);
      }
    };
    document.addEventListener("pointerdown", alAfuera, true);
    document.addEventListener("keydown", alTeclado, true);
    return () => {
      document.removeEventListener("pointerdown", alAfuera, true);
      document.removeEventListener("keydown", alTeclado, true);
    };
  }, [menu]);

  const iniciarArrastrePanel = (e: ReactPointerEvent<HTMLElement>, id: PanelId) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const cab = e.currentTarget;
    const def = paneles[id];
    const raiz = raizRef.current;
    if (!def || !raiz) return;

    limpiarArrastreRef.current?.();
    const pointerId = e.pointerId;
    try {
      cab.setPointerCapture(pointerId);
    } catch {
      // algunos entornos sintéticos no soportan setPointerCapture
    }

    const x0 = e.clientX;
    const y0 = e.clientY;
    let activo = false;
    let geo: GeoDestino | null = null;
    let cajas: Record<Zona, CajaRelativa> | null = null;
    let destActual: Destino | null = null;

    const medirGeo = (): GeoDestino => {
      const zonasRect: Record<Zona, Rect | null> = { izq: null, der: null, abajo: null };
      const panelesRect: Record<Zona, Rect[]> = { izq: [], der: [], abajo: [] };
      for (const z of ZONAS) {
        const lista = zonasVisibles[z];
        const zEl = zonaRefs.current[z];
        zonasRect[z] = lista.length > 0 && zEl ? rectDe(zEl) : null;
        for (const p of lista) {
          if (p === id) continue;
          const pEl = panelRefs.current[p];
          if (pEl) panelesRect[z].push(rectDe(pEl));
        }
      }
      return { ventana: rectDe(raiz), zonas: zonasRect, paneles: panelesRect };
    };

    const soltarCaptura = () => {
      try {
        if (cab.hasPointerCapture(pointerId)) cab.releasePointerCapture(pointerId);
      } catch {
        // ignorar si ya se liberó
      }
    };

    const alMover = (ev: PointerEvent) => {
      if (!activo) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < UMBRAL_ARRASTRE_PX) return;
        activo = true;
        setMenu(null);
        geo = medirGeo();
        cajas = cajasSoltar(geo);
      }
      if (!geo || !cajas) return;
      destActual = destino(geo, ev.clientX, ev.clientY);
      setArrastre({
        id,
        x: ev.clientX,
        y: ev.clientY,
        cajas,
        insercion: destActual ? barraInsercion(geo, destActual) : null,
        destino: destActual,
      });
    };

    const limpiar = () => {
      cab.removeEventListener("pointermove", alMover);
      cab.removeEventListener("pointerup", alSoltar);
      cab.removeEventListener("pointercancel", alCancelar);
      document.removeEventListener("keydown", alEsc, true);
      soltarCaptura();
      setArrastre(null);
      if (limpiarArrastreRef.current === limpiar) limpiarArrastreRef.current = null;
    };

    const alSoltar = () => {
      const fueActivo = activo;
      const dest = destActual;
      limpiar();
      if (fueActivo && dest) {
        mover(id, dest.zona, dest.indice);
        anunciar(t("acople.movido", { panel: def.titulo }));
      }
    };

    const alCancelar = () => {
      limpiar();
    };

    const alEsc = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      ev.preventDefault();
      limpiar();
      anunciar(t("acople.movimientoCancelado"));
    };

    limpiarArrastreRef.current = limpiar;
    cab.addEventListener("pointermove", alMover);
    cab.addEventListener("pointerup", alSoltar);
    cab.addEventListener("pointercancel", alCancelar);
    document.addEventListener("keydown", alEsc, true);
  };

  const iniciarDivisorZona = (e: ReactPointerEvent<HTMLDivElement>, zona: Zona) => {
    if (e.button !== 0) return;
    if (zona === "abajo" && abajoTodoPlegado) return;
    const div = e.currentTarget;
    const zonaEl = zonaRefs.current[zona];
    const raiz = raizRef.current;
    if (!zonaEl || !raiz) return;
    e.preventDefault();
    limpiarDivisorRef.current?.();

    const pointerId = e.pointerId;
    try {
      div.setPointerCapture(pointerId);
    } catch {
      // ignorar si no hay soporte
    }

    const inv = escalaInv();
    const tam0 = (zona === "abajo" ? zonaEl.offsetHeight : zonaEl.offsetWidth) * inv;
    const limite = zona === "abajo" ? Math.max(160, raiz.clientHeight * inv - 224) : undefined;
    const x0 = e.clientX;
    const y0 = e.clientY;
    setDivisorActivo(`zona:${zona}`);

    const alMover = (ev: PointerEvent) => {
      const delta =
        (zona === "izq" ? ev.clientX - x0 : zona === "der" ? x0 - ev.clientX : y0 - ev.clientY) * inv;
      redimensionar(zona, Math.round(tam0 + delta), limite);
    };

    const limpiar = () => {
      div.removeEventListener("pointermove", alMover);
      div.removeEventListener("pointerup", alFin);
      div.removeEventListener("pointercancel", alFin);
      try {
        if (div.hasPointerCapture(pointerId)) div.releasePointerCapture(pointerId);
      } catch {
        // ignorar
      }
      setDivisorActivo(null);
      if (limpiarDivisorRef.current === limpiar) limpiarDivisorRef.current = null;
    };

    const alFin = () => limpiar();

    limpiarDivisorRef.current = limpiar;
    div.addEventListener("pointermove", alMover);
    div.addEventListener("pointerup", alFin);
    div.addEventListener("pointercancel", alFin);
  };

  const teclaDivisorZona = (e: ReactKeyboardEvent<HTMLDivElement>, zona: Zona) => {
    if (zona === "abajo" && abajoTodoPlegado) return;
    let p = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") p = -PASO_TECLA_PX;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") p = PASO_TECLA_PX;
    if (!p) return;
    e.preventDefault();
    const inv = escalaInv();
    const raiz = raizRef.current;
    const limite = zona === "abajo" && raiz ? Math.max(160, raiz.clientHeight * inv - 224) : undefined;
    const delta = zona === "izq" ? p : -p;
    redimensionar(zona, acople.tam[zona] + delta, limite);
  };

  const medirLargoZona = (zona: Zona): number => {
    const inv = escalaInv();
    const horizontal = zona === "abajo";
    let total = 0;
    for (const p of zonasVisibles[zona]) {
      if (acople.plegados.includes(p)) continue;
      const el = panelRefs.current[p];
      if (el) total += (horizontal ? el.offsetWidth : el.offsetHeight) * inv;
    }
    return total;
  };

  const iniciarDivisorPanel = (e: ReactPointerEvent<HTMLDivElement>, zona: Zona, panelA: PanelId, panelB: PanelId) => {
    if (e.button !== 0 || divisorPanelInerte(acople, panelA, panelB)) return;
    const div = e.currentTarget;
    const elA = panelRefs.current[panelA];
    const elB = panelRefs.current[panelB];
    if (!elA || !elB) return;
    e.preventDefault();
    limpiarDivisorRef.current?.();

    const pointerId = e.pointerId;
    try {
      div.setPointerCapture(pointerId);
    } catch {
      // ignorar
    }

    const inv = escalaInv();
    const horizontal = zona === "abajo";
    const largo = medirLargoZona(zona);
    const tamA0 = (horizontal ? elA.offsetWidth : elA.offsetHeight) * inv;
    const tamB0 = (horizontal ? elB.offsetWidth : elB.offsetHeight) * inv;
    const min = horizontal ? ANCHO_MIN_PANEL_AB : ALTO_MIN_PANEL;
    const maxMas = Math.max(0, tamB0 - min);
    const maxMenos = Math.max(0, tamA0 - min);
    const x0 = e.clientX;
    const y0 = e.clientY;
    let ultimoAcotado = 0;
    setDivisorActivo(`panel:${zona}:${panelA}`);

    const alMover = (ev: PointerEvent) => {
      const deltaTotal = (horizontal ? ev.clientX - x0 : ev.clientY - y0) * inv;
      const acotado = acotar(deltaTotal, -maxMenos, maxMas);
      const paso = acotado - ultimoAcotado;
      if (Math.abs(paso) >= 0.5) {
        ultimoAcotado = acotado;
        repartir(zona, panelA, paso, largo);
      }
    };

    const limpiar = () => {
      div.removeEventListener("pointermove", alMover);
      div.removeEventListener("pointerup", alFin);
      div.removeEventListener("pointercancel", alFin);
      try {
        if (div.hasPointerCapture(pointerId)) div.releasePointerCapture(pointerId);
      } catch {
        // ignorar
      }
      setDivisorActivo(null);
      if (limpiarDivisorRef.current === limpiar) limpiarDivisorRef.current = null;
    };

    const alFin = () => limpiar();

    limpiarDivisorRef.current = limpiar;
    div.addEventListener("pointermove", alMover);
    div.addEventListener("pointerup", alFin);
    div.addEventListener("pointercancel", alFin);
  };

  const teclaDivisorPanel = (e: ReactKeyboardEvent<HTMLDivElement>, zona: Zona, panelA: PanelId, panelB: PanelId) => {
    if (divisorPanelInerte(acople, panelA, panelB)) return;
    let p = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") p = -PASO_TECLA_PX;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") p = PASO_TECLA_PX;
    if (!p) return;
    e.preventDefault();
    const largo = medirLargoZona(zona);
    if (largo > 0) repartir(zona, panelA, p, largo);
  };

  const renderPanel = (id: PanelId, zona: Zona) => {
    const def = paneles[id];
    if (!def) return null;
    const plegado = acople.plegados.includes(id);
    const horizontal = zona === "abajo";
    const peso = acople.partes[id] ?? 1;
    const estiloPanel = plegado
      ? horizontal
        ? { flex: "0 0 16.25rem", alignSelf: "flex-start" as const }
        : { flex: "0 0 auto", alignSelf: "stretch" as const }
      : {
          flex: `${peso} 1 0%`,
          alignSelf: "stretch" as const,
          minHeight: horizontal ? undefined : `${ALTO_MIN_PANEL * 0.0625}rem`,
          minWidth: horizontal ? `${ANCHO_MIN_PANEL_AB * 0.0625}rem` : undefined,
        };
    const menuAbiertoAqui = menu?.id === id;

    return (
      <section
        key={id}
        ref={(el) => {
          panelRefs.current[id] = el;
        }}
        className="acople-panel"
        data-panel={id}
        data-zona={zona}
        data-plegado={plegado ? "" : undefined}
        data-origen={arrastre?.id === id ? "" : undefined}
        aria-label={def.titulo}
        style={estiloPanel}
      >
        <header
          className="acople-panel-cab"
          onPointerDown={(e) => iniciarArrastrePanel(e, id)}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest("button")) plegar(id);
          }}
        >
          <span className="acople-agarradera" aria-hidden>
            <GripVertical size={16} strokeWidth={1.8} />
          </span>
          <span className="acople-panel-ico" aria-hidden>
            {def.icono}
          </span>
          <h2 className="acople-panel-tit">{def.titulo}</h2>
          <span className="acople-esp" />
          <button
            type="button"
            className="acople-cab-btn acople-panel-plegar"
            aria-expanded={!plegado}
            aria-label={plegado ? t("acople.desplegar", { panel: def.titulo }) : t("acople.plegar", { panel: def.titulo })}
            title={plegado ? t("acople.desplegar", { panel: def.titulo }) : t("acople.plegar", { panel: def.titulo })}
            onClick={() => plegar(id)}
          >
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            className="acople-cab-btn"
            aria-haspopup="menu"
            aria-expanded={menuAbiertoAqui}
            aria-label={t("acople.masAcciones", { panel: def.titulo })}
            title={t("acople.masAccionesTitulo")}
            onClick={(e) => {
              const btn = e.currentTarget;
              if (menuAbiertoAqui) {
                setMenu(null);
              } else {
                const r = btn.getBoundingClientRect();
                setMenu({ id, boton: btn, x: r.right, y: r.bottom });
              }
            }}
          >
            <Ellipsis size={15} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            className="acople-cab-btn"
            aria-label={t("acople.cerrar", { panel: def.titulo })}
            title={t("acople.cerrar", { panel: def.titulo })}
            onClick={() => {
              if (menuAbiertoAqui) setMenu(null);
              cerrar(id);
            }}
          >
            <X size={15} strokeWidth={1.8} aria-hidden />
          </button>
        </header>
        <div className="acople-panel-cuerpo" hidden={plegado}>
          {def.contenido}
        </div>
      </section>
    );
  };

  const renderListaZona = (zona: Zona) => {
    const ids = zonasVisibles[zona];
    const horizontal = zona === "abajo";
    return ids.map((id, i) => {
      if (i === 0) return renderPanel(id, zona);
      const prevId = ids[i - 1];
      const inerte = divisorPanelInerte(acople, prevId, id);
      const titA = paneles[prevId]?.titulo ?? prevId;
      const titB = paneles[id]?.titulo ?? id;
      const claveDiv = `panel:${zona}:${prevId}`;
      return (
        <div key={`${prevId}-${id}`} style={{ display: "contents" }}>
          <div
            className="acople-divisor"
            role="separator"
            aria-orientation={horizontal ? "vertical" : "horizontal"}
            aria-label={t(horizontal ? "acople.divisorEntreAncho" : "acople.divisorEntreAlto", { a: titA, b: titB })}
            aria-disabled={inerte || undefined}
            data-inerte={inerte ? "" : undefined}
            data-activo={divisorActivo === claveDiv ? "" : undefined}
            tabIndex={inerte ? -1 : 0}
            onPointerDown={(e) => iniciarDivisorPanel(e, zona, prevId, id)}
            onKeyDown={(e) => teclaDivisorPanel(e, zona, prevId, id)}
            onDoubleClick={() => {
              if (!inerte) restablecerPartes(zona);
            }}
          />
          {renderPanel(id, zona)}
        </div>
      );
    });
  };

  const defMenu = menu ? paneles[menu.id] : undefined;

  return (
    <div
      ref={raizRef}
      className="acople"
      data-moviendo={arrastre ? "" : undefined}
      data-tirando={divisorActivo ? "" : undefined}
    >
      {zonasVisibles.izq.length > 0 ? (
        <>
          <section
            ref={(el) => {
              zonaRefs.current.izq = el;
            }}
            className="acople-zona"
            data-zona="izq"
            aria-label={t("acople.zonaIzq")}
            style={{ width: `${acople.tam.izq * 0.0625}rem` }}
          >
            {renderListaZona("izq")}
          </section>
          <div
            className="acople-divisor"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("acople.divisorIzq")}
            data-activo={divisorActivo === "zona:izq" ? "" : undefined}
            tabIndex={0}
            onPointerDown={(e) => iniciarDivisorZona(e, "izq")}
            onKeyDown={(e) => teclaDivisorZona(e, "izq")}
            onDoubleClick={() => restablecerZona("izq")}
          />
        </>
      ) : null}

      <div className="acople-medio">
        <div className="acople-centro">{centro}</div>
        {zonasVisibles.abajo.length > 0 ? (
          <>
            <div
              className="acople-divisor"
              role="separator"
              aria-orientation="horizontal"
              aria-label={t("acople.divisorAbajo")}
              aria-disabled={abajoTodoPlegado || undefined}
              data-inerte={abajoTodoPlegado ? "" : undefined}
              data-activo={divisorActivo === "zona:abajo" ? "" : undefined}
              tabIndex={abajoTodoPlegado ? -1 : 0}
              onPointerDown={(e) => iniciarDivisorZona(e, "abajo")}
              onKeyDown={(e) => teclaDivisorZona(e, "abajo")}
              onDoubleClick={() => {
                if (!abajoTodoPlegado) restablecerZona("abajo");
              }}
            />
            <section
              ref={(el) => {
                zonaRefs.current.abajo = el;
              }}
              className="acople-zona"
              data-zona="abajo"
              data-todo-plegado={abajoTodoPlegado ? "" : undefined}
              aria-label={t("acople.zonaAbajo")}
              style={{ height: abajoTodoPlegado ? "auto" : `${acople.tam.abajo * 0.0625}rem` }}
            >
              {renderListaZona("abajo")}
            </section>
          </>
        ) : null}
      </div>

      {zonasVisibles.der.length > 0 ? (
        <>
          <div
            className="acople-divisor"
            role="separator"
            aria-orientation="vertical"
            aria-label={t("acople.divisorDer")}
            data-activo={divisorActivo === "zona:der" ? "" : undefined}
            tabIndex={0}
            onPointerDown={(e) => iniciarDivisorZona(e, "der")}
            onKeyDown={(e) => teclaDivisorZona(e, "der")}
            onDoubleClick={() => restablecerZona("der")}
          />
          <section
            ref={(el) => {
              zonaRefs.current.der = el;
            }}
            className="acople-zona"
            data-zona="der"
            aria-label={t("acople.zonaDer")}
            style={{ width: `${acople.tam.der * 0.0625}rem` }}
          >
            {renderListaZona("der")}
          </section>
        </>
      ) : null}

      {arrastre ? (
        <>
          <div className="acople-soltar" aria-hidden="true">
            {ZONAS.map((z) => {
              const c = arrastre.cajas[z];
              return (
                <div
                  key={z}
                  className="acople-soltar-zona"
                  data-zona={z}
                  data-sobre={arrastre.destino?.zona === z ? "" : undefined}
                  style={{ left: c.left, top: c.top, width: c.width, height: c.height }}
                >
                  <span>{textoSoltar(z)}</span>
                </div>
              );
            })}
            {arrastre.insercion ? (
              <div
                className="acople-insercion"
                style={{
                  left: arrastre.insercion.left,
                  top: arrastre.insercion.top,
                  width: arrastre.insercion.width,
                  height: arrastre.insercion.height,
                }}
              />
            ) : null}
          </div>
          <div
            className="acople-fantasma"
            style={{ transform: `translate3d(${arrastre.x + 14}px, ${arrastre.y + 10}px, 0)` }}
          >
            <span className="acople-fantasma-ico" aria-hidden>
              {paneles[arrastre.id]?.icono}
            </span>
            <span>{paneles[arrastre.id]?.titulo}</span>
          </div>
        </>
      ) : null}

      {menu && defMenu ? (
        <div
          ref={menuRef}
          className="acople-menu"
          role="menu"
          aria-label={defMenu.titulo}
          style={{ left: menu.x, top: menu.y }}
        >
          <div className="acople-menu-tit">{defMenu.titulo}</div>
          {renglonesMenuPanel(acople, menu.id).map((r) => (
            <button
              key={r.zona}
              type="button"
              role="menuitem"
              className="acople-menu-op"
              aria-disabled={r.deshabilitada || undefined}
              onClick={() => {
                if (r.deshabilitada) return;
                const id = menu.id;
                setMenu(null);
                mover(id, r.zona);
                anunciar(t("acople.movido", { panel: defMenu.titulo }));
              }}
            >
              {iconoZona(r.zona)}
              <span>{textoMover(r.zona)}</span>
              {r.deshabilitada ? <span className="acople-menu-estado">{t("acople.yaEstaAca")}</span> : null}
            </button>
          ))}
          <div className="acople-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="acople-menu-op"
            onClick={() => {
              const id = menu.id;
              setMenu(null);
              cerrar(id);
            }}
          >
            <X size={15} strokeWidth={1.8} aria-hidden />
            <span>{t("acople.cerrarPanel")}</span>
          </button>
        </div>
      ) : null}

      <div className="acople-anuncio" role="status" aria-live="polite">
        {anuncio}
      </div>
    </div>
  );
}
