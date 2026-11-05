// La instancia de la app del almacén de títulos mostrados (`titulo-estable.ts`): `titulos-fijos.json` en el estado de la app.
import path from "node:path";
import { ESTADO, escribirAtomico } from "./pa.ts";
import { almacenTitulos } from "./titulo-estable.ts";

export const titulosFijos = almacenTitulos(path.join(ESTADO, "titulos-fijos.json"), escribirAtomico);
