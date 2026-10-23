// Los textos que arma el main y se ven en la UI (errores, sobre todo) no se
// escriben en ningún idioma: van como clave de src/i18n + variables, y el
// renderer los traduce al pintar (`textoMain` en src/i18n/index.ts). El main no
// puede importar los diccionarios (rootDir de tsconfig.electron.json) y así un
// cambio de idioma no tiene que avisarle a nadie. Lo que dice `pa` o `claude`
// va tal cual. tests/i18n.test.ts verifica que cada clave usada acá exista.

/** El separador: no aparece en texto normal y sobrevive al IPC. */
export const MARCA = "\u0001";

/** "clave" + variables → el texto codificado que entiende el renderer. */
export function textoT(clave: string, vars?: Record<string, string | number>): string {
  return `${MARCA}i18n:${clave}${MARCA}${vars ? JSON.stringify(vars) : ""}${MARCA}`;
}

export const errorT = (clave: string, vars?: Record<string, string | number>) => new Error(textoT(clave, vars));
