// Esfuerzos con puntaje propio en la tabla de reparto. Sin dependencias de Node: lo importa también la vista.
export const EFFORTS_CALIDAD = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortCalidad = (typeof EFFORTS_CALIDAD)[number];
