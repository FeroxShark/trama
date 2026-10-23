// `npm run dev`: Vite (HMR) + Electron apuntando a Vite. Si sale uno, sale el otro.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";

execFileSync("npx", ["tsc", "-p", "tsconfig.electron.json"], { stdio: "inherit" });

const vite = await createServer();
await vite.listen();
const url = vite.resolvedUrls.local[0];

// `electron` exporta la ruta del binario real (no el cli.js que lo envuelve).
const app = spawn(electron, ["."], {
  stdio: "inherit",
  env: { ...process.env, HILOS_DEV_URL: url },
});

const cerrar = async (codigo) => {
  await vite.close();
  process.exit(codigo ?? 0);
};
app.on("exit", cerrar);
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => app.kill(s));
