# Changes

## 0.2.61

- Model picker: Fable 5.2, if your Claude account has it. The Claude model list now comes from your account's catalog: a new model shows up on its own, without waiting for a Trama release; Fable 5.1 moves to "Previous".

## 0.2.60

- Lead folder picker: each project shows its logo.
- Model picker: Opus 4.1, Opus 4 and Sonnet 4 removed. Tested one by one: the first two are served by Opus 5.5 and the third returns an error.

## 0.2.59

- What's new follows the interface language: with Trama in English, the notice and Settings > What's new are in English.

## 0.2.58

- What's new: after updating, a notice with what the new version brought (and intermediate ones if you skipped several). In Settings, the full version history.

## 0.2.57

- Connectors store: Skills, Connectors, Plugins and Hooks tabs; «Yours | Discover»; search, category, sort and «Add»; cards with what each does, where it comes from and its usage or installs, plus details. In Plugins, Discover brings For you, New, Most installed and Categories.
- Model picker: previous versions from Anthropic and Google as well, under «Previous» and with valid effort.
- Sidebar: each project folder shows its small logo next to the name.

## 0.2.56

- Lead questions: the panel no longer covers the chat. Has max height with its own scroll and folds to «N pending questions».
- A chat starting in the home folder moves automatically to the project it works on (runs `pa <proyecto>` or edits there), unless you moved it manually.
- File paths in a message (for example `/usr/bin/agy`): open revealing the file in its folder.
- Saving profiles sorted from most savings to best quality, with a one-line explanation.

## 0.2.55

- Update: window restarts if the build changed, even without hearing the engine signal. Previously it could keep the old process with the new page.
- Open a folder from a message: if it fails because the app could not request it, it explains that Trama needs to restart, not that «it's not a folder».
- Background pill: closes when the task finishes mid-turn, and output mentioning a background process no longer counts as a task.

## 0.2.54

- Savings: `agresivo` profile in `reparto` (cheapest model that clears each type's floor). Active profile is shown and changed from the quota bar.
- Delete project: in folder menu. Removes it from Trama, moves folder to trash with safety checks and can be undone; refuses to delete with active work.
- Board: bulk «Clean up» with filters and suggested outdated items; closes without deleting and can be undone.
- Chat: «I left this on the board» card when a lead or its worker leaves a question or test.
- Context panel: stops showing previous content after compacting.
- Connectors: sort by usage, plus «Discover»: catalog of skills and MCP connectors, always confirming before install.
- Plugin store: filter by category and sort by recent and most installed.
- Clean up old branches and worktrees from the Branches panel; clearer text in connectors and guides updated with what's new.
- Gemini `--leer` workers: can search and browse the web.
- Windows: `pa`, `orquesta`, `lanzar`, `reparto`, `trama-estado` and Accounts find `agy` and `claude` consistently, also outside PATH and as npm `.cmd`.
- Trama waits for pending writes when closing; more stable tests and CI green on Linux and Windows.

## 0.2.53

- Workers: `pa` finds `reparto`, `tablero`, `cuentas` and their hooks in every install again. Previously all silently fell back to Sonnet; now they pick by quality and quota, showing if a piece is missing.
- A worker no longer stays «working» (nor accumulating hours) if its process died: orphan `.running` only counts if its pid really matches that run (not a recycled pid or unrelated thread). Row becomes «died» and `Stop` cleans the trace instead of claiming the run does not exist.
- `--leer` workers can search the web.
- A lead in bypass switching to plan mode no longer asks permission for every command (only for `ExitPlanMode`, questions and edits), and Shift+Tab spells out which mode it entered.
- Sidebar: chat activity is its last real turn, restart only revives recent chats, and Clean chats is available.
- New chat: Auto folder by default. Chat folder and an already displayed title do not change on their own; manual choices take precedence.
- Accounts: «Use for new» clarifies it applies to new chats, chat offers switching to another account if its own is maxed out, and each account shows 5 h and week together.
- Background pill shows live trailing output lines for each task.
- Context usage panel takes no space in Settings, Board, Branches or Stats.
- Windows: `agy` and `claude` outside PATH or as `.cmd` count as installed, Accounts does not name Ubuntu, Trama no longer runs `ollama`, and engine hides its consoles.

## 0.2.52

- Pill above the box showing what the lead left running in the background and how long ago. Tap to view the list.
- Turn summary says «launched» a background task while still running, not «finished».

## 0.2.51

- Right-click on a project icon (rail and list): Rename, Change logo and Reset to auto.
- Search in Settings > Projects to find one without scrolling through the list.
- A long command or tool producing no output no longer shows as paused or «No updates»: card stays as working and shows how long since last output.
- A finished run no longer appears «queued» weeks later: `.pid` only counts if it really matches that run (a process, not an unrelated thread, started before the file). `Stop` and «Close and stop all» can no longer signal unrelated programs that recycled that pid.

## 0.2.50

- Folders mentioned in a message open with a click in file explorer.

## 0.2.49

- Windows: CMD window no longer flashes briefly when updating usage or running other background tasks.

## 0.2.48

- Worker died notices: no longer accumulate or stay stuck. A gray banner groups multiple («3 workers died»), dismisses itself after 7 s and does not reappear. State remains in each worker's row.
- Thread work pills show icons by action: command, read, edit, search, web, skill, MCP, delegate and wait, among others.

## 0.2.47

- agy, codex, opencode and dsh workers no longer look empty: thread displays prompt, commands and response, updating live as they run.
- `pa --hilo` also reads streams from those engines, with the same format as Claude.

## 0.2.46

- Restarting Trama no longer marks leads as died: they remain resumable. A lead only appears as died after 7 days without activity. Real failures are still shown.
- Lead working card: new Phrase design, shorter. Describes what it is doing in words, single status, amber warning at 2 minutes without updates, and folds when done.
- Worker view: new Thread design. Steps in words, grouped duplicates, timeline by type, «Only changes» filter and clickable paths.
- Queued messages: Tray tab above the box, with Edit, Delete, reorder and «Send now». Fixed four cases where a message could be lost.
- Sidebar: model and effort chip, real worker titles, «running for 4 m» and «Uncached» in tooltip.
- Quotas: grouped by subscription, «% used», amber from 80%, red only with no quota left, and notice if updates failed.
- Smaller worker notices: one row per worker, decision-requesting ones first.
- «Show context» moved to top right.
- Paths with * or ? are no longer treated as images and do not show «Image unavailable».

## 0.2.45

- Sidebar: traditional signals return. ⚡ with elapsed time on visible active chat, relative time in words («2 m ago», «yesterday», «3 d ago»), warm phrases, «2 sub.» and tooltips. Running items pulse and stalled items spin. Checkmark appears only on finished workers, never on a lead.

## 0.2.44

- Free OpenCode out of quota: lead no longer stays «Thinking» forever; cuts turn short, explains in words and offers changing model. Picker marks it out of quota.
- Windows: fixed project folder path in per-turn checkpoints.
- GitHub CI green on Linux and Windows, including UI test.

## 0.2.43

- Polished sidebar: lead crowns return with workers nested underneath; finished ones fold into «N finished». Each project has its color, running items show «N in progress», and attention items highlight with icon and text. Removed «leads only» filter.

## 0.2.42

- New sidebar («Rail»): one line per chat, grouped by project, with project rail on the left and search; fits many more chats in view. Quotas move to two small rings that open on tap.
- New Settings > Plan and quotas («weave»): one line per account with 5 h and week together, status in words, «In use» and «Use» (you switch accounts yourself).

## 0.2.41

- Trama MCP: leads and workers of any engine can launch workers, check their status, search threads and message another lead. Registers automatically in each engine.

## 0.2.40

- Per-turn checkpoints: below each lead turn that touched files, diff and «Revert to before this turn» with confirmation.
- Scheduled tasks: send a message to a lead later («in 30 min», «18:30», «tomorrow 9:00») and snooze a conversation; survive restarts.
- `pantalla` command for workers to test the UI in an offscreen Trama instance (tested on Linux).

## 0.2.39

- Objective mode: a worker relaunches itself until the verification command passes (`pa --objetivo --verificar`), and Update branch has an optional «Verification command» field.
- Loose colors converted to theme tokens, and color check runs with tests.

## 0.2.38

- Complete glass redesign: context panel, thread header and composer, worker view, Settings, Board, Stats, Branches, Welcome, popovers and menus.
- «Continue with another model»: from thread menu or quota limit notice, conversation continues with another model from a summary.
- «N failed» chip and lead red state count only unresolved failures.
- Each quota card displays when its window resets (Gemini no longer says «week»).
- Settings > Quotas: keyless NVIDIA NIM card has «Enter key» button.
- Accessibility: muted text with AA contrast across all themes, visible focus and labels on icon buttons.

## 0.2.37

- Redesign (glass): quota cards feature large numbers (Claude 5 h and week, Google in three small cards, OpenCode in a capsule); quota-depleted items are tinted with «out of quota» and reset time.
- Attention items visible at a glance: failed worker in coral with glowing border and filled «Relaunch»; pending decision in amber; running or finished stays calm.
- Leads list: «N failed» and «N waiting» chips at the top (jump to first), highlighting only rows needing your input.

## 0.2.36

- Reparto: when free OpenCode cuts off due to usage limits, that route is marked exhausted (previously kept showing «100% quota» and worker died).
- `tablero` finds its compiled version in installs as well (previously fell back to python).
- Continue with another model (foundation): handoff summary from transcript and `pa <proyecto> --seguir-con <modelo> --id <id>`. Thread action arrives in next release.
- Tests without clock sleeps: check runs before `npm test`.

## 0.2.35

- Model picker: out-of-quota models appear dimmed with «out of quota until <date>» (amber dot when running low), with a line showing what each engine brings (skills, MCP, subagents, images).
- New lead: if prompt names a project, folder is selected automatically; folder picker includes search (name and path, arrow keys, Enter, Esc).
- Worker notice card: each row in color (green finished, amber needs decision, red failed); a worker with commits but no summary shows «finished without a summary», not failure.
- Claude skills link automatically for agy, codex and opencode workers (honoring disabled ones).
- Reparto: «Route today» no longer lists disabled models.

## 0.2.34

- Context panel: a `?` on each category, Tools list, actual system prompt text, Preview tab (what a new lead or worker would load), and auto-refresh every 3 s.
- Lead subagents in panel: spending per subagent and breakdown.
- Worker notices wake idle lead (around 20 s, grouped), without waiting for your next message.
- Quota-based dispatch: a `claude-*` worker automatically switches to agy if it has more free quota (`--exacto` prevents this); if agy hits quota limit, relaunches with Claude. Stats shows substitutions.
- Workers inherit user MCPs in deferred mode, honoring disabled ones.
- Frontend and design workers load installed design skills.
- Worker view: middle column no longer clips with long paths.

## 0.2.33

- Windows: installer touches only its own files. Unrelated files left in Trama folder (e.g. MCP server logs) no longer block updates, and if an own file is locked it reports which file it is.
- Windows: Trama never launches engine, leads, agy or MCP with installation folder as working directory.

## 0.2.32

- Context panel: MCP and skills measured by what is actually loaded (deferred MCPs barely count), total matches items and stays stable on refresh.
- Context panel: «System» split into components (base prompt, each CLAUDE.md, memory, startup hooks, skills) with tokens and text.
- Skills catalog: counts usage across all sessions, including those loaded by a hook (e.g. caveman).
- Context panel: disabled items appear gray and add nothing; Compact button (and right-click) in Messages.
- Short lead titles: tool text like `<invoke_tool …>` can no longer remain; such titles fix themselves automatically.
- Windows: update no longer fails if a Trama `node.exe` is in use, Trama's node goes at the end of child process PATH, and rollback backup preserves `app.asar` properly.

## 0.2.31

- Worker notices to lead: no longer lost if lead or Trama restarts while worker runs. They stay in a persistent queue and count as delivered only when received; resuming a lead delivers a summary of workers finished while away.

## 0.2.30

- New right-hand context panel: only selected lead and its workers, with stacked bar, block map and list by category (messages, tools, MCP, skills, memory, system). Each skill, connector, tool or memory file shows tokens, usage count («never used») and toggle to disable across Trama.
- Skills catalog with search and filters (disabled, never used, by plugin).
- Inactive chat notice: shows only tokens, without estimated quota % (was unreliable).

## 0.2.29

- Settings: «API Prices» table appears only in Settings > Models (used to show on top of all tabs).

## 0.2.28

- Windows: loose CMD windows no longer open (leads, agy, MCP and checks run with hidden console).
- agy lead (Gemini/Flash): workers no longer die upon turn completion; on Windows they run outside the job.
- agy quota in header: checked every 10 min (previously 3 min, which spun up all MCPs on each read).
- Resuming a Claude lead uses the chosen primary account.
- Expired cache: when resuming a long conversation, Trama asks whether to continue same session or start with a summary, with estimated cost; choice can be remembered (Settings).
- More compact handoff: fewer tokens when transferring to a new lead.
- Short titles: chats titled with ≤6 words about the topic (not full first message) and workers by brief's Objective; manually set titles are preserved.
- Activity: each file read, written or edited by agent, worker or subagent opens in viewer (image preview, PDF, text, markdown, audio, video; otherwise system app).
- Worker notices: text no longer cramped; two-line title, reason below and relaunch button on its row.
- agy: input token count no longer returns negative values.

## 0.2.27

- Safe updates: Trama keeps previous version; if new one fails to open or closes twice unexpectedly, it rolls back automatically and alerts. «Revert to previous version» button in Settings > General.
- New lead starts in selected or last used project (not home folder), with project selector visible.
- Worker conversations group under their project instead of showing as separate projects.
- Switch account in conversation: Claude notice is translated, single line, with «Back to <account>»; confirms before switching.
- Workers: share node_modules only if lockfile matches; otherwise install their own.
- `npm run check:changed`: quick check for changed files only.

## 0.2.26

- Trama notices (worker finished/failed) display as system row, not user message; id opens worker thread.
- Redesigned Connectors panel (/mcp): grouped, with icon and status in words; disabled in project toggle on, and those needing login link to claude.ai.
- Quota bar: «2 d 17 h» instead of «2 d», with exact reset date and time on hover.
- Stats: equivalent cost in USD per model (editable prices in Settings > Models) and worker queue time.
- Clean up merged worktrees and old branches (Settings > Projects, with list and confirmation; automatic disabled).
- pa: each worker leaves a FRENÓ line and `pa --rinde` aggregates the most frequent; recompiles automatically if code changed.
- Windows: wrapper streamlined into thin adapter with no WSL traces.

## 0.2.25

- Clean up old pa worktrees and branches: `pa --limpiar [--ver|--si] [--dias N] [--json]` removes free unchanged checkouts, branches of runs already merged to main, and unused build, older than N days (7 by default); never an unmerged branch or work in progress. In Settings > Projects: list of what would be deleted, confirmation and automatic pass (disabled by default).
- Gemini (agy): models depend on account, region and agy version. `reparto` selects only among models offered by that agy (unknown ones enter with estimated quality marked approximately), model picker displays them, and if agy rejects a model `pa` marks it unavailable and relaunches with next candidate instead of aborting.
- Sidebar: projects and leads sorted by last used, with «Recent | A-Z» control that persists.
- Workers with local models (dsh): compact before filling context, which comes from model's actual `-c`.
- Tests: no longer create leads in real state nor depend on free memory or specific machine.

## 0.2.24

- Windows: routing a lead to Claude via Google no longer errors with «spawn ENAMETOOLONG» (message travels via stdin).
- Windows: agy pa-worker plugin installs automatically; if a model cannot be used, pa falls back to next with quota instead of aborting.
- Claude Code subagents: display model and effort, with their origin.
- Subagents: «View full report» displays their text.

## 0.2.23

- Projects: every folder where a lead works registers automatically in Settings > Projects (including existing leads).
- Quota bar: with multiple accounts for a provider, each shows «In use» or «Use first» button.
- Settings: Save bar appears only when changes exist.
- Combined model and effort picker: panel allows selecting effort level too.

## 0.2.22

- Windows: added Claude accounts share chats, plugins, skills and settings with primary (as on Linux). Existing ones merge automatically without deleting anything. Resuming chat with another account no longer errors with «No conversation found».
- Windows: agents use PowerShell instead of Git Bash (Settings > General > Agent terminal).
- Images sent by lead (local paths or tool outputs) display in chat; missing ones state so.
- Single channel list for Linux and Windows.
- Linux: AppImage on every release.

## 0.2.21

- Accounts: «Use first» button on each account and account selector in lead. Trama never switches accounts on its own.
- Settings > Phone: enable, add or remove devices applies instantly; link and QR appear automatically.
- Lead and workers: every text written by model while working remains in conversation, in order.
- Phone: copy, back and branch bar no longer covers text; mode icons visible everywhere.
- Windows CI green.

## 0.2.20

- NVIDIA NIM: key, help, models and quota in app; NVIDIA rate limit cools down only that model.
- Settings > Local: full screen for local models.
- Live lead thinking while working.
- Fallen lead: «This lead stopped» with Resume button.
- Right panel: for each active worker, duration, latest step and button to open it.
- Claude Code chats in each project («From Claude Code»), to resume them in Trama.
- Settings > Connectors: plugin catalog (anthropics/skills, official or custom repo) and synced plugins from claude.ai.
- Windows: connecting second account no longer shows «main.cuentasFallo».
- Windows: DeepSeek Harness detected in `%USERPROFILE%\.local\dsh.cmd`.

## 0.2.19

- New versions almost instantly (Linux and Windows): Trama checks every 2 minutes, on window focus and on network reconnect; notice always displays latest.

## 0.2.18

- Settings > Connectors: skills, plugins, MCP servers and hooks in one place, showing origin, description, search and toggle.
- Message sent while lead is working: shows «queued» until lead receives it.
- Edit message: box expands with text and allows removing, adding or pasting screenshots.
- Welcome: «Connect another account» even if Claude is already connected; local model status.
- Branches: «View analysis» returns to conversation of lead that analyzed the branch.
- Notices to lead: single notice upon batch completion (or per worker, in Settings > General); quota and hangs reported immediately.
- Artificial Analysis: updating from laptop or phone no longer gives connection errors.

## 0.2.17

- Phone access with Trama installed (Linux and Windows): enabled from Settings, without touching system service; listens only on Tailscale and admits only listed devices.
- Windows: Claude quotas (primary and added accounts) read correctly.
- Settings > OpenCode and Models: text no longer overlaps or overflows screen.

## 0.2.16

- Native Windows: pick folder (add projects, lead folder), clipboard, exit and other window requests work (previously «unknown channel»).
- Settings > Updates on Linux as well; notice no longer gets stuck on «Updating…» from old install.
- Project logos: Trama uses project icon (favicon, logo, app icon) or initial; configurable in Settings > Projects.
- Windows smoke test (`windows/humo/humo-gonza.ps1`).

## 0.2.15

- Native Windows: TypeScript `pa` supports all modes (conversations, archive, rename, projects, benchmark, models, workers with all engines, relaunch on quota). Fixed «not yet in TypeScript pa» error.
- Native Windows: title bar returns, transparent, and Windows buttons no longer obscure content.

## 0.2.14

- Native Windows: `pa`, `reparto`, `tablero` and `cuentas` launch properly (previously unsaved conversations, Plan and quotas missing data).
- Native Windows: no title bar; content fills full window with buttons floating top right.
- Native Windows: version reflects app (no longer 0.1.3), named Trama instead of Electron, each release includes required files for «Check for updates».
- Native Windows: Handy detected where its installer places it; updating Antigravity uses `agy update`.

## 0.2.13

- Native Windows (beta, without WSL): .exe installer in this release. Automatically imports Claude accounts from previous Trama install (copies logins, preserves originals).
- TypeScript `pa` connected end-to-end (testable with `TRAMA_PA=ts`; unimplemented features fall back to standard).
- Tests: timed-out test file terminates cleanly without leaving hanging processes.
- Docs: Windows port status and test checklist for physical Windows environment.

## 0.2.12

- Worker notices: no longer report «aborted without message» for a still running worker.
- CI green (Linux, Windows and native .exe build); engine smoke test on Windows.
- Windows (in progress): all `pa` components ported to TypeScript (options, launch, engines, `reparto`); wiring pending.

## 0.2.11

- Windows (in progress, unreleased): app can open terminal, terminate processes and launch programs on Windows; TypeScript `pa` progresses (slots, worktrees, wait/stop/kill, integrate and lessons); `tablero` and `cuentas` ported; native shell and .exe packaging ready for CI testing.
- CI: host-dependent tests no longer break Linux job and each file has timeout.

## 0.2.10

- Worker notices: when one finishes, fails or hangs, launching lead is notified automatically; desktop notification for failures and batch completion (configurable in Settings > General). Quota failure states provider, reset time and offers relaunch with another model.
- Settings > Plan and quotas > Advanced: editable thresholds where pa stops using a provider, for Claude and Google, with reset to defaults button.
- OpenCode Go caps read from OpenCode (with offline cache showing timestamp).
- Interrupted subagent no longer remains «Running» indefinitely.
- `gate --espejo` runs hidden test; `gate --plan` computes size, risk and hot files from plan.

## Sin publicar

- Worker notices: when one finishes, fails (due to quota, with provider and reset time) or hangs (15 min without activity), launching lead receives short queued message and owner gets notification (PC and phone) for failures and when batch completes; normal completions increment inbox count. Configurable in Settings > General; quota failure offers «Relaunch with another model».

## 0.2.9

- OpenCode Go caps (requests per 5 h and USD per month, Go and Go Plus) read from opencode.ai/go at startup and daily, saved with fetch date; offline displays copy bundled with Trama («Data from <date>»). `reparto` and workers share the same data.
- `pa --tarea` records each run in `estado.tsv` (`--subtarea`); `gate` logs result there and runs check with project dependencies (previously reported false red).
- `pa --async` with multiple models (`-m a,b`) relaunches automatically with next on OpenCode disconnection; `--auditar --decisiones` passes deliberate decisions to auditor.
- New `clasificar`: advises how to handle failed attempts (rephrase brief, retry, bump model or ask owner).

## 0.2.8

- Update no longer hangs on «Updating…» if previous installer finished after new engine started.

## 0.2.7

- «Release notes» button in new Trama notice opens release in browser (previously did nothing).

## 0.2.6

- OpenCode 2.x: workers can no longer write outside their directory (each run uses own server and config blocks external access; prompts in lead).
- OpenCode 2.x: successful runs no longer marked as failed (2.x does not close final step).
- `pa`: rejects disabled models and efforts in Settings; phases, tasks and rubric for performance benchmark; `gate` to review worker output before merging.
- Settings > Models: context before compacting, by family (Haiku 300k).

## 0.2.5

- New Trama notice appears within 30 min at most (previously 6 h).
- Settings > General: Trama version and «Check for updates» button.

## 0.2.4

- Lead chooses model and effort for each worker based on request. `reparto --resumen` provides brief model summary at startup (level by effort, cost, quota, use case); `reparto` only warns if chosen model is out of quota.
- Haiku by default for precisely describable tasks, with guide on how to write the request. Sonnet for ambiguous tasks or after Haiku failure; Opus only for foundations, clueless bugs or following failures.

## 0.2.3

- Update from app without interrupting work: with active leads or workers, offers «Update when finished» or «Update now» (with confirmation). On completion alerts «Trama X installed» with button to restart window.
- Installer run from checkout `motor/scripts` builds app and records update source (previously stayed on old version reporting «done»).
- Settings > Projects: «Merge with AI» button on split instructions notice.
- Reparto: frontend and multi-part code request Sonnet tier, not Argon (out of Argon quota previously fell back to Opus).

## 0.2.2

- Queued messages: all queued items reach lead together, in a single message between tools, without interruption.
- Quota bar: logos always visible, Google with rows for Gemini, Claude/GPT and Argon (5 h and week), remaining time until reset visible and short tooltip. No duplicate «primary» rows.
- OpenCode: multiple accounts (isolated), Free/Go/Go Plus plan detected automatically with dedicated bar row.
- Subagents: finished ones fold and archive.
- Model chip: displays effort across all engines (text and gauge, max filled).
- Projects: readable instructions status, «Shorten with an agent» and merge with an agent.
- Short transition between views and new Settings sections.
- Foundation to detect local llama.cpp, LM Studio and vLLM models (UI arrives in next release).

## 0.2.1

- «New Trama available» notice: checks latest release and offers in-app update (no GitHub or terminal needed).
- Change model or effort while lead works: applies to next message, queued message dispatches with chosen settings. Picker shows «next» when change is pending.
- Subagents in expanded view: tapping card reveals steps, live or with final report.

## 0.2.0

### Models and engines
- OpenCode and DeepSeek Harness as engines for leads and workers, with free models (OpenCode) and Ollama.
- Continue conversation with another engine (Claude, Gemini, OpenCode, DeepSeek Harness): transfers history with a separator «Continued with…». Confirms before switching.
- OpenCode Go (paid OpenCode plan, off by default): Settings > OpenCode offers Free / Go / Go Plus. With Go, models are offered to leads and workers as «Go Plan», with dedicated per-model quota (429 exhausts only that model, 5 h) and nearly 0 marginal cost in reparto. Per-model caps live in `motor/opencode/go-topes.json` and display in Plan and quotas. Without Go, opencode uses free model for session titles (previously could attempt paid model resulting in 402).
- Compact model picker: providers on left, search across all, «Free» / «Paid» tags.
- Model intelligence from Artificial Analysis, updated daily and by effort (low, medium, high, xhigh, max). `reparto --aa-diag` shows paired AA entry for each model.
- Permission mode remains fixed and explained in Gemini, OpenCode and DeepSeek Harness leads.
- Revert, Edit and Branch across all engines (not just Claude) and in multi-engine conversations.
- Cache lightning bolt only on Claude, with actual request duration (1 h with subscription, 5 min with API or credits).

### Worker dispatch and quotas
- Weekly pace: if weekly usage outpaces quota, workers switch to free or Google models; unused quota near reset is utilized.
- Savings / Balanced / Performance profiles and Claude weekly reserve for lead.
- `pa --plan ausente|gastar-hoy|ahorrar-hoy|ver|borrar`: notify agents of absence tomorrow or to spend/save today.
- Minimum quality per type measured at equal effort (scoped code tasks return to Sonnet, not Opus).
- Select which models workers can use.

### Orchestration
- Templated tasks (Listo cuando / Cómo verificar), detail scaled to model intelligence, mandatory verification («unverified»), project lessons with pruning, and `pa --auditar` for cross-model branch review.
- `AGENTS.md` as single source of instructions across all engines: `pa --unificar-md` and «Unify in AGENTS.md» in Settings > Projects.

### App
- Sidebar: «Active» section at top with hot sessions; custom named projects (Settings > Projects); row opens on click anywhere.
- Redesigned usage by provider and group, including in narrow sidebar.
- Color themes (System, Dark, Light, Forest, Sunset, Graphite, Contrast), tested for contrast and deuteranopia.
- Branches: cards with filters, «Apply all verdicts», Audit; «Reanalyze» with any model.
- Onscreen guides for new users and version novelties («don't show again», «later» or disable in Settings > Guides).
- Redesigned Stats and Board; Guide in Settings; configurable compact threshold.
- Text composer stays single row at any width and reflects lead's actual model.

### Installation
- Single command updates engine and desktop app: `git pull; bash motor/scripts/instalar-producto.sh`.
