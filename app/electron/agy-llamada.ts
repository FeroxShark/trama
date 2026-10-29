// Cómo se le pasa un turno a `agy`: el prompt (con el resumen de la conversación delante) NUNCA va en el argv. En Windows la línea
// de comandos tiene tope (~32 767 caracteres; 8191 por cmd.exe) y un relevo de decenas de miles de caracteres hacía fallar
// el spawn con ENAMETOOLONG. `agy --input-format stream-json` lee por stdin un mensaje NDJSON por línea, sin tope.

export type LlamadaAgy = {
  args: string[];
  /** Lo que se escribe en el stdin del proceso (y después se lo cierra). */
  stdin: string;
};

export function llamadaAgy(o: { prompt: string; modelo: string; conversacion: string | null; timeout: string }): LlamadaAgy {
  const args = ["--input-format", "stream-json", "--model", o.modelo, "--output-format", "stream-json", "--dangerously-skip-permissions", "--print-timeout", o.timeout];
  if (o.conversacion) args.push("--conversation", o.conversacion);
  const mensaje = { event: "user", message: { content: [{ type: "text", text: o.prompt }] } };
  return { args, stdin: JSON.stringify(mensaje) + "\n" };
}
