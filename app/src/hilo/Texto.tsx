// Lo que escribe un worker o un líder, pintado sin librería de markdown: el
// parseo es de markdown.ts (párrafos, listas, bloques ```, títulos, citas, tablas
// y lo de adentro de un renglón) y el resaltado de los bloques, de resaltar.ts;
// los saltos de línea se respetan por CSS.
import { Fragment, memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { copiarConAviso } from "../copiar";
import { t } from "../i18n";
import { useIdioma } from "../i18n/react";
import { rutaImagen } from "../../electron/imagen-ruta";
import { ImagenInsertada, ImagenLocal, VerImagenLocal } from "./Imagenes";
import { bloques, esRuta, sueltas, trozos, type Bloque, type Lista, type Trozo } from "./markdown";
import { resaltar } from "./resaltar";

// Un enlace sale de la app: en la ventana lo abre el navegador del sistema (el main, que sólo
// deja pasar http(s) y mailto: `electron/enlace.ts`); en el celular, una pestaña nueva. Mientras
// llega (`url` vacía) ya se ve como enlace, sin destino.
function Enlace({ x, children }: { x: Extract<Trozo, { tipo: "link" }>; children: ReactNode }) {
  return x.url ? (
    <a href={x.url} target="_blank" rel="noopener noreferrer" data-tip={x.url}>
      {children}
    </a>
  ) : (
    <a>{children}</a>
  );
}

/** `![alt](src)`: un data: de imagen trae los bytes; una URL de la red no se baja (sale como enlace); lo demás es un archivo de esta máquina. */
const DATA_IMAGEN = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
function Imagen({ x }: { x: Extract<Trozo, { tipo: "img" }> }) {
  const d = DATA_IMAGEN.exec(x.url);
  if (d) return <ImagenInsertada img={{ tipo: d[1], datos: d[2] }} alt={x.texto} />;
  if (/^https?:\/\//i.test(x.url))
    return (
      <Enlace x={{ tipo: "link", texto: x.texto || x.url, url: x.url }}>{x.texto || x.url}</Enlace>
    );
  // Lo que no apunta a una imagen (`vec![0](x)`) es texto, como antes.
  if (!/\.(?:png|jpe?g|gif|webp|bmp)$/i.test(x.url)) return <>{`![${x.texto}](${x.url})`}</>;
  return <ImagenLocal ruta={x.url} alt={x.texto} />;
}

function enLinea(texto: string, op: { vivo?: boolean; enlaces?: boolean } = {}): ReactNode[] {
  const adentro = (s: string) => enLinea(s, { enlaces: op.enlaces });
  return trozos(texto, op).map((x, i) =>
    x.tipo === "code" ? (
      <Fragment key={i}>
        <code data-ruta={esRuta(x.texto) ? "" : undefined}>{x.texto}</code>
        {rutaImagen(x.texto) ? <VerImagenLocal ruta={x.texto} /> : null}
      </Fragment>
    ) : x.tipo === "img" ? (
      <Imagen key={i} x={x} />
    ) : x.tipo === "b" ? (
      <b key={i}>{adentro(x.texto)}</b>
    ) : x.tipo === "i" ? (
      <em key={i}>{adentro(x.texto)}</em>
    ) : x.tipo === "s" ? (
      <s key={i}>{adentro(x.texto)}</s>
    ) : x.tipo === "link" ? (
      <Enlace key={i} x={x}>
        {x.texto === x.url ? x.texto : enLinea(x.texto, { enlaces: false })}
      </Enlace>
    ) : (
      x.texto
    ),
  );
}

/** Copiar un bloque: el ícono pasa a un tilde un momento (un solo timeout, nada que quede corriendo). */
function Copiar({ texto }: { texto: string }) {
  useIdioma();
  const [hecho, setHecho] = useState(false);
  const reloj = useRef(0);
  useEffect(() => () => clearTimeout(reloj.current), []);
  const alCopiar = () =>
    void copiarConAviso(texto).then((ok) => {
      if (!ok) return;
      setHecho(true);
      clearTimeout(reloj.current);
      reloj.current = window.setTimeout(() => setHecho(false), 1500);
    });
  const dice = t(hecho ? "codigo.copiado" : "codigo.copiar");
  return (
    <button type="button" className="codigo-c" data-hecho={hecho ? "" : undefined} aria-label={dice} data-tip={dice} onClick={alCopiar}>
      {hecho ? <Check size={12} strokeWidth={2.2} /> : <Copy size={12} strokeWidth={2} />}
    </button>
  );
}

/** Un bloque ```: resaltado según su lenguaje, con scroll de costado propio y su botón de copiar. */
const Codigo = memo(function Codigo({ texto, lang }: { texto: string; lang: string }) {
  const toks = useMemo(() => resaltar(texto, lang), [texto, lang]);
  return (
    <div className="codigo">
      <div className="codigo-h">
        <span>{lang}</span>
        <Copiar texto={texto} />
      </div>
      <pre>
        {toks.map((x, i) =>
          x.c ? (
            <span key={i} data-c={x.c}>
              {x.t}
            </span>
          ) : (
            x.t
          ),
        )}
      </pre>
    </div>
  );
});

function Items({ l, vivo }: { l: Lista; vivo: boolean }) {
  const L = l.tipo;
  return (
    <L start={l.desde}>
      {l.items.map((x, k) => {
        const ultimo = vivo && k === l.items.length - 1;
        return (
          <li key={k} data-casilla={x.hecho === undefined ? undefined : x.hecho ? "x" : ""}>
            {enLinea(x.texto, { vivo: ultimo && !x.sub && !x.bloques })}
            {x.bloques?.map((b, j) => (
              <Pieza key={j} b={b} vivo={ultimo && !x.sub && j === x.bloques!.length - 1} />
            ))}
            {x.sub ? <Items l={x.sub} vivo={ultimo} /> : null}
          </li>
        );
      })}
    </L>
  );
}

type PropsBloque = { b: Bloque; vivo: boolean };

/**
 * `bloques()` arma objetos nuevos en cada pasada (con el stream, una cada 50 ms): se compara lo
 * que se pinta, así mientras llega el texto sólo se repinta el último bloque.
 */
const igual = (a: PropsBloque, b: PropsBloque) => a.vivo === b.vivo && a.b.tipo === b.b.tipo && JSON.stringify(a.b) === JSON.stringify(b.b);

const Pieza = memo(function Pieza({ b, vivo }: PropsBloque) {
  if (b.tipo === "p") return <p>{enLinea(b.texto, { vivo })}</p>;
  if (b.tipo === "pre") return <Codigo texto={b.texto} lang={b.lang} />;
  if (b.tipo === "h") return <h4 data-n={Math.min(b.nivel, 4)}>{enLinea(b.texto, { vivo })}</h4>;
  if (b.tipo === "hr") return <hr />;
  if (b.tipo === "cita")
    return (
      <blockquote>
        {b.bloques.map((x, i) => (
          <Pieza key={i} b={x} vivo={vivo && i === b.bloques.length - 1} />
        ))}
      </blockquote>
    );
  if (b.tipo === "term")
    return (
      <div className="term">
        {b.lineas.map((r, k) => (
          <Fragment key={k}>
            {k ? "\n" : null}
            {r.prompt ? (
              <span className="term-c">
                <span className="term-p">{r.prompt}</span>
                {r.texto ? ` ${r.texto}` : null}
              </span>
            ) : (
              sueltas(r.texto).map((x, i) =>
                x.tipo === "link" ? (
                  <Enlace key={i} x={x}>
                    {x.texto}
                  </Enlace>
                ) : (
                  x.texto
                ),
              )
            )}
          </Fragment>
        ))}
      </div>
    );
  if (b.tipo === "tabla") {
    const al = (k: number) => b.alinea[k] ?? undefined;
    return (
      <div className="tabla">
        <table>
          <thead>
            <tr>
              {b.cabeza.map((c, k) => (
                <th key={k} data-al={al(k)}>
                  {enLinea(c, { vivo: vivo && !b.filas.length && k === b.cabeza.length - 1 })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.filas.map((f, j) => (
              <tr key={j}>
                {f.map((c, k) => (
                  <td key={k} data-al={al(k)}>
                    {enLinea(c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <Items l={b} vivo={vivo} />;
}, igual);

type Props = {
  texto: string;
  /** Está llegando (el stream de un líder): lo que quedó a medias no cambia de forma al completarse. */
  vivo?: boolean;
  /** Lo escribió el usuario: lo que pegó de una terminal se ve como terminal. */
  propio?: boolean;
};

/** Memo: mientras un líder escribe, sólo se repinta el último texto (un render por frame) y, de él, el último bloque. */
export const Texto = memo(function Texto({ texto, vivo = false, propio = false }: Props) {
  const bs = useMemo(() => bloques(texto, { vivo, terminal: propio }), [texto, vivo, propio]);
  return (
    <>
      {bs.map((b, i) => (
        <Pieza key={i} b={b} vivo={vivo && i === bs.length - 1} />
      ))}
    </>
  );
});
