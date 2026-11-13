// Pantalla de demostración para los paneles acoplables (captura=acople-demo y captura=acople-demo-movido).
// No se conecta todavía a la barra real: muestra Chats, Contexto y Cupo con datos fijos de ejemplo.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Columns3, Gauge, Layers, MessageSquare, RotateCcw } from "lucide-react";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { BarraCupo } from "../ui/BarraCupo";
import { Acople, type PanelDef } from "./Acople";
import {
  acopleDeFabrica,
  alternarPlegado,
  mover,
  renglonesMenuPaneles,
  type Acople as AcopleEstado,
  type PanelId,
} from "./acople-logica";
import { useAcople } from "./useAcople";

const VIVOS: readonly PanelId[] = ["chats", "contexto", "cupo"];
const AHORA = new Date(2026, 10, 11, 15, 0).getTime() * 0.001;
const H = 3600;

const acomodoMovido = (): AcopleEstado => {
  let a = acopleDeFabrica();
  a = mover(a, "contexto", "izq");
  a = mover(a, "chats", "der");
  a = mover(a, "cupo", "abajo");
  a = alternarPlegado(a, "cupo");
  return a;
};

const iconoPanel = (id: PanelId) =>
  id === "chats" ? (
    <MessageSquare size={16} strokeWidth={1.8} aria-hidden />
  ) : id === "contexto" ? (
    <Layers size={16} strokeWidth={1.8} aria-hidden />
  ) : (
    <Gauge size={16} strokeWidth={1.8} aria-hidden />
  );

const tituloPanel = (id: PanelId): string =>
  id === "chats" ? t("acople.demo.chats") : id === "contexto" ? t("acople.demo.contexto") : t("acople.demo.cupo");

export function AcopleDemo({ movido = false }: { movido?: boolean }) {
  useIdioma();
  const inicial = useMemo(() => (movido ? acomodoMovido() : acopleDeFabrica()), [movido]);
  const ctrl = useAcople(inicial);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const btnPanelesRef = useRef<HTMLButtonElement>(null);
  const menuPanelesRef = useRef<HTMLDivElement>(null);

  const renglones = useMemo(() => renglonesMenuPaneles(ctrl.acople, VIVOS), [ctrl.acople]);
  const abiertos = renglones.filter((r) => r.abierto).length;

  useLayoutEffect(() => {
    const el = menuPanelesRef.current;
    const btn = btnPanelesRef.current;
    if (!menuAbierto || !el || !btn) return;
    const r = btn.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const y = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - h - 8));
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [menuAbierto]);

  useEffect(() => {
    if (!menuAbierto) return;
    const alAfuera = (ev: PointerEvent) => {
      const n = ev.target as Node | null;
      if (menuPanelesRef.current?.contains(n) || btnPanelesRef.current?.contains(n)) return;
      setMenuAbierto(false);
    };
    const alEsc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      setMenuAbierto(false);
      btnPanelesRef.current?.focus();
    };
    document.addEventListener("pointerdown", alAfuera, true);
    document.addEventListener("keydown", alEsc, true);
    return () => {
      document.removeEventListener("pointerdown", alAfuera, true);
      document.removeEventListener("keydown", alEsc, true);
    };
  }, [menuAbierto]);

  const paneles: Record<PanelId, PanelDef> = {
    chats: {
      titulo: t("acople.demo.chats"),
      icono: iconoPanel("chats"),
      contenido: (
        <div className="acople-demo-lista">
          <div className="acople-demo-fila" data-activo="">
            <span>{t("acople.demo.hilo1")}</span>
            <span>2m</span>
          </div>
          <div className="acople-demo-fila">
            <span>{t("acople.demo.hilo2")}</span>
            <span>18m</span>
          </div>
          <div className="acople-demo-fila">
            <span>{t("acople.demo.hilo3")}</span>
            <span>1h</span>
          </div>
        </div>
      ),
    },
    contexto: {
      titulo: t("acople.demo.contexto"),
      icono: iconoPanel("contexto"),
      contenido: (
        <div className="acople-demo-bloque">
          <div className="acople-demo-dato">
            <span>{t("acople.demo.ctxLimite")}</span>
            <strong>42 %</strong>
          </div>
          <div className="acople-demo-barra" aria-hidden>
            <span />
          </div>
          <div className="acople-demo-dato">
            <span>{t("acople.demo.ctxUso")}</span>
          </div>
        </div>
      ),
    },
    cupo: {
      titulo: t("acople.demo.cupo"),
      icono: iconoPanel("cupo"),
      contenido: (
        <div className="acople-demo-cupos">
          <BarraCupo nombre={t("acople.demo.cupoCinco")} pct={28} vuelve={AHORA + 2 * H + 40 * 60} ahora={AHORA} />
          <BarraCupo nombre={t("acople.demo.cupoSemana")} pct={46} vuelve={AHORA + 42 * H} ahora={AHORA} />
        </div>
      ),
    },
  };

  const centro = (
    <>
      <header className="acople-demo-cab">
        <div className="acople-demo-cab-txt">
          <h1>{t("acople.demo.chatTitulo")}</h1>
          <p>{t("acople.demo.chatSubtitulo")}</p>
        </div>
        <div className="acople-demo-acciones">
          <button
            ref={btnPanelesRef}
            type="button"
            className="acople-demo-btn"
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            onClick={() => setMenuAbierto((v) => !v)}
          >
            <Columns3 size={15} strokeWidth={1.8} aria-hidden />
            <span>{t("acople.paneles")}</span>
            <span className="acople-demo-cnt">{t("acople.panelesCuenta", { n: abiertos, total: renglones.length })}</span>
            <ChevronDown size={14} strokeWidth={1.8} aria-hidden />
          </button>
          <button type="button" className="acople-demo-btn" onClick={ctrl.restablecer}>
            <RotateCcw size={14} strokeWidth={1.8} aria-hidden />
            <span>{t("acople.restablecer")}</span>
          </button>
        </div>
      </header>
      <div className="acople-demo-hilo">
        <div className="acople-demo-msg" data-rol="usuario">
          {t("acople.demo.mensajeUsuario")}
        </div>
        <div className="acople-demo-msg">
          {t("acople.demo.mensajeAsistente")}
        </div>
      </div>
      <div className="acople-demo-compo">
        <div className="acople-demo-caja">{t("acople.demo.compositor")}</div>
      </div>
      {menuAbierto ? (
        <div ref={menuPanelesRef} className="acople-menu" role="menu" aria-label={t("acople.paneles")}>
          <div className="acople-menu-tit">{t("acople.paneles")}</div>
          {renglones.map((r) => (
            <button
              key={r.panel}
              type="button"
              role="menuitem"
              className="acople-menu-op"
              onClick={() => {
                setMenuAbierto(false);
                if (r.abierto) ctrl.cerrar(r.panel);
                else ctrl.abrir(r.panel, true);
              }}
            >
              {iconoPanel(r.panel)}
              <span>{tituloPanel(r.panel)}</span>
              <span className="acople-menu-estado">
                {r.abierto ? (
                  <>
                    <Check size={13} strokeWidth={2.2} aria-hidden />
                    {t("acople.abierto")}
                  </>
                ) : (
                  t("acople.cerrado")
                )}
              </span>
            </button>
          ))}
          <div className="acople-menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="acople-menu-op"
            onClick={() => {
              setMenuAbierto(false);
              ctrl.restablecer();
            }}
          >
            <RotateCcw size={15} strokeWidth={1.8} aria-hidden />
            <span>{t("acople.restablecer")}</span>
          </button>
        </div>
      ) : null}
    </>
  );

  return <Acople paneles={paneles} vivos={VIVOS} centro={centro} control={ctrl} />;
}
