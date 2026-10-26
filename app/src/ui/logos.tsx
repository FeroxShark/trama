// Los logos de los proveedores de modelos para el estándar visual (docs/maquetas/lavado/ (dirección 1, "estándar pulido")): SVG locales de un
// solo color (`currentColor`), sin red. Claude y Google (Gemini) son los mismos de `src/hilo/Logos.tsx`; ChatGPT es el nudo de OpenAI
// simplificado. `Logo` de ahí sigue siendo el del selector de modelos (por empresa); éste es por proveedor.
import { Logo } from "../hilo/Logos";

export type Proveedor = "claude" | "google" | "chatgpt";

const NUDO =
  "M12 3.2c2 0 3.7 1.2 4.4 3 1.9.1 3.5 1.3 4.1 3.2.6 1.9-.1 3.8-1.6 4.9.2 1.8-.7 3.5-2.4 4.3-1.7.8-3.7.4-4.9-.9-1.3.7-3 .8-4.4-.1-1.4-.9-2.1-2.5-1.9-4.1-1.5-1-2.2-2.9-1.7-4.7.6-1.8 2.2-3 4.1-3.1.7-1.8 2.4-3 4.3-3Z";

const A = { viewBox: "0 0 24 24", width: 14, height: 14, "aria-hidden": true, focusable: false } as const;

/** El logo de un proveedor (Claude, Google o ChatGPT), a 14 px; el tamaño lo manda el contenedor (`.ui-logo svg`). */
export function LogoProveedor({ id }: { id: Proveedor }) {
  if (id === "claude") return <Logo empresa="anthropic" />;
  if (id === "google") return <Logo empresa="google" />;
  return (
    <svg {...A} className="logo">
      <path d={NUDO} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
      <path d="M12 8.2 15.3 10.1v3.8L12 15.8 8.7 13.9v-3.8Z" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" />
    </svg>
  );
}

/** El logo en su recuadro de 20 px (el de la cabecera de una tarjeta de cupo). */
export const LogoCaja = ({ id }: { id: Proveedor }) => (
  <span className="ui-logo" data-proveedor={id}>
    <LogoProveedor id={id} />
  </span>
);
