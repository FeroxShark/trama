// Los modos de permisos de un líder de la app (B13), como en Claude Code: el
// chip de la caja y el orden de Shift+Tab. Orden, símbolos y colores sacados del
// binario de Claude Code 2.1.287 (`_Ct`, `Ar` y su tema oscuro): default →
// acceptEdits → plan → bypassPermissions (si bypass está habilitado, que en los
// líderes de la app siempre lo está) → default. `auto` no entra: no está habilitado.
// Puro (sin imports): lo prueba tests/modos.test.ts.

export const MODOS = ["default", "acceptEdits", "plan", "bypassPermissions"] as const;
export type Modo = (typeof MODOS)[number];

/** El de siempre del usuario (`--dangerously-skip-permissions`). */
export const MODO_DEFAULT: Modo = "bypassPermissions";

export const esModo = (m: unknown): m is Modo => (MODOS as readonly unknown[]).includes(m);

/** El que sigue con Shift+Tab. */
export function siguienteModo(m: string | null | undefined): Modo {
  switch (m) {
    case "default":
      return "acceptEdits";
    case "acceptEdits":
      return "plan";
    case "plan":
      return "bypassPermissions";
    default:
      return "default";
  }
}

/**
 * Cómo se ve: la clave de i18n del texto, el ícono y el color del tema oscuro de Claude Code. El ícono es un nombre (no el
 * carácter): ⏸ y ⏵⏵ no están en la fuente de los celulares y se veían como cuadraditos. Lo dibuja Lider.tsx con lucide.
 */
export const ASPECTO: Record<Modo, { clave: "modo.default" | "modo.acceptEdits" | "modo.plan" | "modo.bypass"; icono: "pausa" | "avance"; color: string }> = {
  default: { clave: "modo.default", icono: "pausa", color: "rgb(153,153,153)" },
  acceptEdits: { clave: "modo.acceptEdits", icono: "avance", color: "rgb(175,135,255)" },
  plan: { clave: "modo.plan", icono: "pausa", color: "rgb(72,150,140)" },
  bypassPermissions: { clave: "modo.bypass", icono: "avance", color: "rgb(255,107,128)" },
};
