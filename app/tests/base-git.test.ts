// cli/base/git.ts: config fija por entorno, parseo porcelain (\r\n, rutas de Windows) y worktrees contra un repo real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { argvWorktreeAdd, entornoGit, git, gitOk, parsearWorktrees, worktreeAdd, worktreeList, worktreeRemove } from "../electron/cli/base/git.ts";

test("entornoGit: agrega core.longpaths y core.autocrlf por GIT_CONFIG_COUNT, y respeta lo que ya hubiera", () => {
  const e = entornoGit({ PATH: "/bin" });
  assert.equal(e.GIT_CONFIG_COUNT, "2");
  assert.deepEqual([e.GIT_CONFIG_KEY_0, e.GIT_CONFIG_VALUE_0, e.GIT_CONFIG_KEY_1, e.GIT_CONFIG_VALUE_1], ["core.longpaths", "true", "core.autocrlf", "false"]);
  const previo = entornoGit({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name", GIT_CONFIG_VALUE_0: "x" });
  assert.equal(previo.GIT_CONFIG_COUNT, "3");
  assert.equal(previo.GIT_CONFIG_KEY_0, "user.name");
  assert.equal(previo.GIT_CONFIG_KEY_1, "core.longpaths");
  assert.equal(previo.GIT_CONFIG_KEY_2, "core.autocrlf");
});

const PORCELAIN = "worktree /r/main\nHEAD aaa111\nbranch refs/heads/main\n\nworktree /r/wt/1\nHEAD bbb222\ndetached\nlocked razón\n\nworktree /r/wt/2\nHEAD ccc333\nbranch refs/heads/pa/x\nprunable gitdir roto\n";

test("parsearWorktrees: bloques, detached, locked, prunable; igual con \\r\\n", () => {
  const w = parsearWorktrees(PORCELAIN, "linux");
  assert.equal(w.length, 3);
  assert.deepEqual(w[0], { ruta: "/r/main", head: "aaa111", rama: "refs/heads/main", detached: false, bare: false, locked: false, prunable: false });
  assert.deepEqual([w[1].detached, w[1].locked, w[1].rama], [true, true, undefined]);
  assert.equal(w[2].prunable, true);
  assert.deepEqual(parsearWorktrees(PORCELAIN.replace(/\n/g, "\r\n"), "linux"), w);
  assert.deepEqual(parsearWorktrees("worktree /r/b\r\nbare\r\n", "linux"), [{ ruta: "/r/b", bare: true, detached: false, locked: false, prunable: false }]);
});

test("parsearWorktrees en win32: C:/x/y pasa a C:\\x\\y", () => {
  const w = parsearWorktrees("worktree C:/Users/Ana/AppData/Local/trama/wt/proy/1\r\nHEAD abc\r\nbranch refs/heads/pa/t\r\n\r\n", "win32");
  assert.equal(w[0].ruta, "C:\\Users\\Ana\\AppData\\Local\\trama\\wt\\proy\\1");
});

test("argvWorktreeAdd: rama nueva, rama existente, detach", () => {
  assert.deepEqual(argvWorktreeAdd("/w", { rama: "pa/x", nueva: true, desde: "main" }), ["worktree", "add", "-b", "pa/x", "/w", "main"]);
  assert.deepEqual(argvWorktreeAdd("/w", { rama: "pa/x" }), ["worktree", "add", "/w", "pa/x"]);
  assert.deepEqual(argvWorktreeAdd("/w", { detach: true, desde: "abc" }), ["worktree", "add", "--detach", "/w", "abc"]);
});

test("repo real: worktreeAdd / list / remove, y la config fija llega a git", async () => {
  const base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "base-git-")));
  const repo = path.join(base, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
  writeFileSync(path.join(repo, "a.txt"), "a\n");
  await gitOk(["add", "."], { cwd: repo, env });
  await gitOk(["commit", "-qm", "uno"], { cwd: repo, env });
  assert.equal(await gitOk(["config", "--get", "core.longpaths"], { cwd: repo, env }), "true");
  assert.equal(await gitOk(["config", "--get", "core.autocrlf"], { cwd: repo, env }), "false");

  const wt = path.join(base, "wt", "1");
  await worktreeAdd(repo, wt, { rama: "pa/x", nueva: true, env });
  const lista = await worktreeList(repo, { env });
  assert.deepEqual(lista.map((w) => [w.ruta, w.rama]), [[repo, "refs/heads/main"], [wt, "refs/heads/pa/x"]]);
  await worktreeRemove(repo, wt, { force: true, env });
  assert.equal((await worktreeList(repo, { env })).length, 1);
  const malo = await git(["worktree", "remove", wt], { cwd: repo, env });
  assert.notEqual(malo.codigo, 0);
  await assert.rejects(gitOk(["nada-raro"], { cwd: repo, env }), /falló/);
});
