# Changes

## 0.3.30

- Workers: if a worker replies again after finishing (woken by a background task), its verified result and its turn and duration count are no longer lost.
- Workers: a «nothing» DECISION followed by a sentence that only says there is nothing («No changes…») no longer reaches the board as a question for you.
- Workers: the contract tells them which deletions the guard lets through, so they don't waste turns retrying.
- `pa --limpiar` also closes runs left hanging or that died in the queue more than a day ago. A `pa --async` with a usage error no longer shows as «died in queue».
- `pa` warns when a run ends and leaves processes running (with the exact `kill`), and `pa --estado` lists them as «QUEDÓ VIVO». It never kills anything on its own. Linux only.
- `pa` warns if you ask by hand for the most expensive model for frontend or multi-part code, where it performs poorly.
- Model picker: failed runs count in the history, and a free model with a bad history in reads or mechanical tasks is no longer chosen.
- `tablero ficha` is short (one line per item and tests grouped), so it fits whole at session start.
- Chat: the model selector no longer flips back and forth endlessly when compacting with a cheap model and continuing with another.

## 0.3.29

- Context panel > Preview: «Review with AI». A cheap model reads what the project loads on every message (CLAUDE.md, AGENTS.md, GEMINI.md and memory) and flags what is repeated, contradictory, outdated or long, with the before and after and how many tokens it saves per message. Nothing changes until you press «Apply» (one, a file's, or all), and a copy is saved before writing. If the file changed since the review, that finding is not applied.
- Shared memory: Gemini, ChatGPT, DeepSeek and OpenCode chats no longer receive memory lines that look like a key, an email or a phone number either. Until now only workers removed them.

## 0.3.28

- Context panel: every piece that is always loaded (system, tools, MCP, skills, memory) says «Worth it», «Doubtful» or «Spare», with an icon and the reason in one line («never used in 30 days», «duplicate of workers (user)»). At the top, «Fixed: N k per message · recoverable: M k», and each list starts with what costs the most and gets used the least.
- Context panel for Gemini, ChatGPT, DeepSeek, OpenCode and local models: it used to say «no breakdown». Now it lists what Trama sends that engine at launch, part by part (its instructions, your rules, memory, the board card), with what was trimmed marked; the rest is the messages.
- The context window of ChatGPT, DeepSeek, OpenCode and Ollama is no longer taken as 1 M: the ring's percentage uses each engine's own (ChatGPT's comes from the Codex catalog).

## 0.3.27

- Windows: Claude workers also start with Claude installed through npm (`claude.cmd`). Before, none started and `pa` said the install was broken. The same goes for Codex, Gemini and OpenCode installed through npm.

## 0.3.26

- Windows: OpenCode workers installed with npm use `opencode.cmd`. Before, `pa` picked the extensionless script npm leaves next to it, which Windows cannot run.

## 0.3.25

- `pa --seguir` on a Codex, Gemini, DeepSeek or OpenCode worker no longer opens it with Claude and without the conversation: it says that engine does not resume sessions and gives the command to continue with the same model.

## 0.3.24

- Windows: a worker that moves on to the next model (`-m a,b,c`) or retries (goal mode) no longer opens a console window. This may be the CMD that showed up for an instant while using tools; still to be confirmed on a Windows PC.

## 0.3.23

- Every engine knows the same: Gemini, ChatGPT, DeepSeek, OpenCode and local model chats and workers get your memory, and chats also get the board summary. DeepSeek and OpenCode workers also get your CLAUDE.md. Settings > Models > "Shared memory" has a switch per engine; what you share reaches that engine's provider. Any memory line that looks like a key, an email or a phone number is left out.
- When you switch engines mid-chat, the new model also gets the summary left by the quota close and the latest note before compacting. Before, that summary was deleted.
- The notice for a worker that finished fine no longer says "did not finish well".

## 0.3.22

- Two settings changes in a row (models, NVIDIA NIM or the OpenCode plan) are saved in the order you made them. Before, mostly on Windows, the first one could overwrite the second.

## 0.3.21

- Fewer tokens per message in Claude chats: unused tools are turned off, what changes every message is out of the fixed part, and everything goes in a single settings file. Before, Claude Code read only the last one and what you turned off in the Context panel did not reach it.
- The ring and the Context panel read the same count. In Codex the meter comes from the last request, not the sum of the turn.
- Side rings: they show the tightest limits across all your subscriptions, with their name; the panel has one row per window and each model's weekly limits. In Settings > Plan and quotas you choose automatic or 1 to 3 fixed rings.
- Reparto does not pick a Claude model whose own weekly limit is used up, and the quota close checks it too. Without a Claude session, Claude is not offered, and chats on other engines do not assume a subscription.
- Windows: the installer registers the compaction notices, the model summary and the note before compacting, without bash. Command guards cover PowerShell. OpenCode is found and launched even when installed with npm. Paths with a drive (`C:\…`) can be clicked in the chat and in the plan review. Codex, DeepSeek and OpenCode workers have the same git and cargo guards as on Linux, and the installer ships the programs that run the DeepSeek and OpenCode ones.
- Debate and review: the model with the most free quota speaks first, cancelling does not add false failures, each section is read in order and a reviewer that does not answer is cut off after a few seconds.
- Workers (`pa`): 15 fixes in slots, integration, quota waits and Codex. The summary handed to another model is checked for secrets first.
- Reparto and quotas: 9 fixes in window resets, local midnight and which reading counts.
- Window and bridges: 6 fixes. On Windows it waits for the bridge to close and the recycle bin confirms before deleting; the connector catalog says when it was left incomplete.
- Limit of workers at once per subscription: 3 by default, across all projects. The extra ones wait in the queue instead of spending the same window all together. Change it or turn it off in Settings > Plan and quotas > Advanced.
- Sidebar: a worker that delivered but failed says "Didn't finish", with its icon, and is not folded among the finished ones. If it failed less than 24 h ago it asks for attention.
- A worker requested with `-m` on Gemini, Codex, DeepSeek or OpenCode whose request has something that cannot leave (a secret, a URL or a path outside the project) no longer moves to Claude on its own: it stops and says what triggered it. If reparto picked the model, it still goes on with Claude, but only if Claude has a session.
- Two projects with the same final folder name no longer share their state: the second one does not start and says which folder to rename. The automatic add does not add a folder with a repeated name either.
- Reparto: the official Claude's 5 h window always counts, also when there is Claude through Google. It also recognizes the other ways into Claude as a session: token, Bedrock, Vertex, Foundry and `apiKeyHelper`.
- In English, percentages are attached to the number ("85%").

## 0.3.20

- The chip of a ChatGPT model says which one it is and at what effort ("Sol 6.2 high"), not just "Gpt".
- Codex workers: what they leave done is saved in their branch. Before, their environment did not let them commit and the work was left loose.
- Picking the effort right after switching models is no longer lost.
- Sidebar: reordering chats does not move the projects around, and the return notice is requested again if the first query failed.
- Gemini, Codex, DeepSeek and OpenCode: 15 fixes in how their turns, steps, errors and cut-offs are read.
- Routing and quotas: 6 fixes in model choice and quota reading.
- Command guards: a credential with escaped quotes no longer slips past the redaction of the notice, and a Compose file that cannot be fully reviewed is blocked.
- Gemini workers on Windows: the write permission inside the working folder works again.
- Note before compacting: a cut-off record is not taken as the model's reply, and the note is not lost if two processes save it at once.
- System and window: 17 internal fixes (startup, channels, updating and service).

## 0.3.19

- Compacting with a note from the model: before compacting, the model writes itself a note with what it does not want to lose (goal, requests, decisions, what comes next) and gets it back afterwards. In the chat it shows as a folded card «Note to carry past compaction», and the compaction divider says «with note» and has «View note». It applies to Claude leaders and workers and to Gemini leaders; Codex, DeepSeek and OpenCode do not compact and the interface says so.
- In Settings > Models: the «Compact with model note» switch, at what percentage the note is requested and from what percentage the end of a task is used to compact. With no limit of its own, the one from the Claude Code settings is used.
- With an expired cache in a large chat, the notice adds «Compact with» a cheaper model and continue with the chosen one, and says how many tokens each option rereads.
- The notice after compacting counts the tokens from after, not from before.
- Switching models in the middle of a turn switches right away, even if the advisor is not stronger than the new model.
- Turning Fast off really turns it off: a chat that had started with Fast kept requesting in fast mode and showing «Fast mode disabled · Out of usage credits». It now relaunches without Fast on the next message.
- ChatGPT models come from what your Codex offers, with no fixed list: new ones show up without updating Trama.
- Google quota: running out of one of its three windows (Gemini, Argon, or Claude and GPT through Google) no longer stops the workers of the other two.
- Codex: the context meter no longer starts at zero every turn, and «Send now» goes first in the next turn. On Windows, Codex gets the chosen effort again.
- Gemini: if a turn is cut short, the text it managed to write stays and the open steps close with their error instead of spinning forever.
- On Windows, resuming a worker's session from another folder no longer loses it.

## 0.3.18

- The model switch notice («Switching to X rereads the whole conversation») has two buttons: «Back to» the previous model and «Compact and switch», which compacts with the current model and only then switches. If compaction fails or doesn't start, it says so and doesn't switch on its own. «Compact and switch» shows on Claude and Gemini.
- On Windows, Gemini workers are no longer stopped by `C:\…` paths that are inside their work folder.

## 0.3.17

- Gemini workers can read, write and edit files in their work folder again: the new agy renamed those tools and Trama was blocking them. A command is no longer stopped just because the code it writes has a slash or a `~`.

## 0.3.16

- On the phone, the back gesture or button closes the open photo or file and returns to the chat, instead of leaving Trama.
- On Windows, the model picker and OpenCode read the app's `modelos.json` and `claves.env`: what you exclude in Settings is now respected. Fix by Gonza.

## 0.3.15

- «Board» panel next to the chat, along with Quota and Context: it shows the questions, waits and to-dos of the open chat's project. Questions with options are answered with one tap and each item can be closed from there; the header says how many are waiting for you. It starts collapsed: open it from its title.

## 0.3.14

- Effort is picked with a slider: a thick track that changes color with the level, with sparkles in the fill and the level written on top. It opens from the effort chip; the mouse wheel over the chip raises or lowers it without opening. The model menu now lists only models.
- Ultracode and Fast for Claude leaders: turn them on from the effort panel and they apply live, without reopening the chat. If Claude Code does not allow Ultracode, the panel says why. With Ultracode on, the chip and the panel fill with moving purple, pink and red squares.
- Gemini workers (and OpenCode, Codex and dsh ones) look like Claude's: steps, color strip, card with a clock and each command's output.
- The image viewer fits phones: the toolbar no longer overlaps, the image takes the width and the arrows sit at the bottom.

## 0.3.13

- Gemini models show up again in the model picker when agy offers them under a name Trama does not know yet (it happened on Windows: only Claude and GPT-OSS appeared).

## 0.3.12

- Long chats open and take typing quickly again: the animation for new messages was being applied to the whole conversation and every keystroke stuttered.
- The «Running» card was redesigned: a circle with the icon and an arc that spins while it works, what it is doing with a single verb, the detail below, and the time and model on the right. With several tools at once, the circle shows how many there are and each one has its status in words.
- Changing the model or effort while a chat is working applies right away, from the next step of the turn, without waiting for the next message. If the new model's advisor does not fit the running turn, it stays marked «next» as before.

## 0.3.11

- New icons for chat tools, each with its soft color: terminal for commands, page for reading, pencil for editing, magnifier for searching, globe for the web and people for agents (bye robot). The «Running» card takes a single line.
- The model selector is a narrow single-column list: the provider as a header and one row per model, with the effort next to the chosen one.
- The debate between models is shown in columns, one per model, with its stance and what it's writing. Before running, «What was agreed» sums up the agreement, who said what and what stayed open.
- Smoother animations: panels, new messages, buttons and lists come in with a short spring. With the system's «reduce motion», only fades.
- Images pasted in the chat box are no longer lost if the window relaunches.
- If the same batch of questions arrives twice, the one you're answering no longer moves.

## 0.3.10

- Under each quota ring in the rail you can see how long until it comes back («2h 14m», «3d 4h»), without opening anything. With no usage, it still says «5 h» or «wk».
- A chat that was answering when you opened or reloaded the window (or that you continued from your phone) no longer hides the earlier conversation: you can scroll up as usual.

## 0.3.9

- Chat history: a window with archived and closed chats, with search, filters and grouped by project or by date. Open it with the clock button next to «Recent» or with Ctrl+H. Each one can be opened or deleted; deleted ones go to the system trash.
- Images shown inside the chat also open the new viewer, with its bar and the arrows to move to the others.
- Finished subagents no longer fill the sidebar with «N done»: they show up when searching, like workers. While searching, finished ones can also be reached with the keyboard.
- A Claude worker that `pa` moves to agy no longer dies at launch when an effort was requested.

## 0.3.8

- The image viewer has a bar on top: name, size and «N of M», zoom (−, %, +, Fit, 100 %), rotate, copy the image or the path, «Save as…», show in folder, open with the system app and close. With several images in the chat, side arrows and ← → move between them.
- If a lead names a folder and lists only the file names below it (audio, images), those names can be clicked and open the viewer (#7).
- «Review with another model» can use ChatGPT as the reviewer, read-only and with your ChatGPT session.
- Dragging a lead onto another folder in the sidebar moves it there. «Move to project…» makes clear it doesn't change its working folder.
- The sidebar no longer shows «no lead» or «N done»: you see what's alive, and finished ones show up when searching.
- Chats launched by Trama no longer appear in «From Claude Code», even if their lead is closed or archived.

## 0.3.7

- Workers no longer pick Fable for small tasks: if a cheaper model with quota is enough (Neon, Sonnet, Haiku), that one goes. With weekly quota to spare, it's spent on the cheapest one that's enough.
- Gemini 4 Argon is used when it has weekly quota to spare, more so near the reset, instead of sitting unused. Settings > Models no longer shows «Not worth it» for it just because its quota is separate.
- Every file in the chat has a button to show it in its folder.
- In «Recent», using a lead moves its folder up, even if it hasn't launched workers.
- A worker that is rejected at launch no longer stays in the sidebar as «No task / Died».

## 0.3.6

- When the plan comes back corrected after «Review with another model», it says «Reviewed plan ready», with an icon and in the plan mode color.
- The «Review delivered» notice takes a single row and goes away on its own when the new plan arrives. The plan box is shorter and lets you see the chat.
- If `claude` is slow to answer, the selector no longer marks Claude «Not connected».

## 0.3.5

- «Review with another model» no longer breaks the chat with «Something went wrong» when you open it.
- «Not worth it» in Settings > Models now measures cost with your subscription (what each plan gives), not with API prices. Your Claude plan is detected automatically and the data updates in the background.
- The model selector always shows every provider, OpenAI (ChatGPT) included. The ones you haven't connected say «Not connected», and picking one shows «Connect», which takes you to Settings.
- Every path in the chat has a button to copy it.
- Artificial Analysis stays up to date on its own, without opening Settings.
- The tick on the weekly ring explains what it is: the even pace for the week.
- If Gemini has no Google session, it says so instead of «plugin not loaded».
- The low-quota notice answers in the chat's language.
- Narrow sidebar: the pending chips no longer overlap, and «Archive» and «Close lead» stay inside the row.

## 0.3.4

- «Report a bug» now has «Send anonymously»: only the developer gets the report, without your name, account or IP, and nothing is posted on GitHub. The screenshot is regenerated before it is stored. «Open on GitHub» is still there as a second option.
- The «Quota is back» card goes away on its own once you have kept writing in that chat.

## 0.3.3

- Gemini 4 Neon is now in the model selector and available to workers: it goes first for frontend, multi-part code, design and debugging when it has quota. It is also the default reviewer for «Review with another model».
- Low quota: if your quota comes back early (for example after a reset), the notice clears in seconds and workers can launch again, without waiting for the original time.
- Plan: after tapping «Keep planning», «Approve» and «Back» stay within reach, so you never get stuck.
- Tall screenshots now show in full when you open them, with nothing cut off.
- Debate: the card and the plan no longer get cut off when they are taller than the window.
- Chat images no longer leave an empty strip, and on the phone you can pick the effort while a turn is running.
- Switching languages no longer shifts the interface boxes.

## 0.3.2

- «Review with another model»: you can now also pick the reviewer's effort, only among the ones that model supports and you have enabled in Settings > Models.
- Debate mode: with the «Debate» switch, 2 or 3 models discuss the plan in turns (1 to 3 rounds) to improve it. You follow it live in a chat card; if a model asks you something, you answer with a button. You can wrap up early or cancel, and the conclusion goes to your lead.
- «See the card» (in «Review delivered to your lead») now scrolls to the reviewer's card in the chat and highlights it, even if it's further up; if the review hasn't arrived yet, it says it's on its way.

## 0.3.1

- Model pickers (like the one in «New lead») now always match Settings > Models: new models (for example Fable 5.2) and enabled providers (Google, OpenCode, DeepSeek) show up without restarting Trama, and a new lead starts with the current model.

## 0.3.0

- Orderly shutdown on low quota, now visible: when a subscription is nearly out (5 % by default), every chat on that subscription that was working shows the card "Quota running low: wrapped up at this point" ("Wrapping up…" first, then how much was left, when the quota comes back and a link to the summary), and the chat says "Quota running low on …: I closed the jobs with a summary; it comes back at HH:MM". You can keep chatting.
- "Resume on my own when the quota is back": a per-chat switch on the card. When the quota returns, the chat carries on by itself from its summary and the workers that were cut off; if you wrote in that chat after the shutdown it does not resume, and if Trama was off at that time it resumes when opened.
- Settings > Plan and quotas > "Orderly shutdown": turn it on or off, the threshold (2 to 20 %) and "Always resume on my own".
- Quota shutdown, notices: when a subscription is at or below the threshold, every live leader and worker on that subscription is told to wrap up in an orderly way (leave what works committed, a summary to resume, a single message to the owner). Gemini, dsh and opencode leaders get it through their queue if they are responding. `pa` and the dispatcher stop picking that subscription: if no other has quota, the task waits with “no quota: back at HH:MM”, and a forced `-m` is stopped with the same message. Chatting works as usual.

## 0.2.99

- "Review with another model" no longer loses the review: it is delivered to your lead through its queue even while it is answering, kept on disk until it goes in and, if it fails, "Retry delivery" appears.
- The review is visible live: elapsed time, what the reviewer reads or searches, and the text as it comes out. It can really be cancelled, and if you close the modal it stays in the chat as "Reviewing with…".
- When picking a reviewer, models from a subscription with no session (for example Google AI Pro without `agy`) show dimmed, with the reason, and cannot be picked. Reviewer errors are worded in plain language.

## 0.2.98

- A lead's plan: new «Review with another model» button. You pick the model (Gemini Argon by default; only those turned on in Settings and with quota), it reads the plan and returns what is good, risks, improvements and an improved plan. It shows in the chat as a reviewer card and your lead integrates it and presents the plan again.
- Claude Code advisor: in Settings > Models, each Anthropic model can use a stronger advisor (for example Sonnet with Opus or Fable, or Opus with Fable). A smaller model with a stronger advisor performs close to the advisor and costs much less. Leaders Trama opens with that model start with `--advisor`. If a variable (like `DISABLE_TELEMETRY`) or the provider turns it off, the switch is disabled and shows why.
- Fable is just another model: the allocator can pick it for workers by quality and quota, unless you exclude it in Settings. Only `max` effort still asks for your OK.
- Picking a model for a worker no longer takes 15 s when Google AI Pro does not answer: it waits at most 5 s and uses the last known quota.

## 0.2.97

- Sharp window on Wayland: Trama picks native Wayland even when the process that relaunches it lacks `WAYLAND_DISPLAY` (it used to fall back to XWayland and look blurry at fractional scaling). If it is missing, it uses the session's socket.

## 0.2.96

- Several machines: Trama installs on the laptop and also drives the PC; when you open a new chat on the other machine, the folder picker shows that machine's projects. Update both machines to this version so they keep seeing each other with write access.

## 0.2.95

- Google signed out: agy quota checks no longer open "sign in" tabs in the browser. If the Google session expired, Trama stops asking for 10 minutes and warns once on the board.
- Models: the table and quota are read in parallel and use the latest recent data if agy doesn't answer, so the lists load fast.
- Workers without internet (Gemini): a task that needs the network or files outside its folder goes to Claude.
- Protection: the guard also blocks closing the graphical session through the bar (caelestia/quickshell), stopping the session or audio with systemctl, and `kill -9 -1`.

## 0.2.94

- Lead questions: the question shows with formatting and the paths it mentions open with a click (for example, the mockup it asks you to look at).

## 0.2.93

- Chat: folders and files a message mentions open by clicking them right where they're written, with or without backticks; they no longer repeat as cards at the end of the message. Only images stay at the bottom, large.

## 0.2.92

- Narrow window: shrinking the window no longer opens the context panel on its own; what was open stays in view. And the window can't be made narrower than a phone, where the panel ended up one word per line.

## 0.2.91

- Chat: leaders know how to show an image right where they mention it in the message, instead of leaving it at the end. Applies to chats opened or resumed after updating.

## 0.2.90

- Plan and quotas: you can pick the plan (Pro or Max) of an added Claude account again. It was saved, but the screen kept saying it used the main account's plan.
- With several accounts, ChatGPT (Codex) models show up and get assigned when Codex is installed and signed in, even if no ChatGPT account was added.

## 0.2.89

- Windows: Trama finds Codex installed with OpenAI's desktop app and Antigravity CLI (`agy`) installed with its new installer. It used to say «not installed» or show no ChatGPT models.

## 0.2.88

- On Windows, if Trama can't update itself, Settings > Updates says why and writes it to `carcasa.log`.

## 0.2.87

- «Report a bug», with the bug icon at the bottom of the sidebar: takes a screenshot of the screen as it was and asks what happened. It saves the screenshot and Trama's log (without keys, emails or your home folder) in a folder in Downloads and opens a new GitHub issue with everything filled in; you only drag the two files in.

## 0.2.86

- Plans and limits: «Use a limit reset», on the Claude card, opens Claude Code with `/limit-reset` in a terminal, where you see the resets claude.ai gave you (Full, Fable), pick one and confirm it. Next to it, a link to the claude.ai usage page. When the terminal closes, the limits are read again.

## 0.2.85

- The image viewer opens with the whole image, even a very tall one. A click toggles between «Fit» and actual size, the bar has Fit, 100%, − and +, you can drag whenever the image does not fit, and right-click offers Copy image, Copy path, Show in folder and Open with the system app.
- Images named in a message show up large inside the chat; tapping one opens the viewer.
- Links and tappable paths are blue and always underlined, and a code block without a language gets colors if it is bash, JSON or a diff.
- A chat that continues with a summary (or comes from a branch) stays in the same sidebar folder as the original, not in home.
- On Windows, the model picker finds Codex installed with npm, as Accounts already did; the ChatGPT card explains the quota shows up after Codex's first task.

## 0.2.84

- In Settings > Models, «Context before compacting» splits workers and leaders: turning off «Leaders: same as workers» gives leaders their own limit per family (Haiku, Sonnet, Opus).

## 0.2.83

- In the chat, when the assistant names a file by its path (an image, a PDF, a markdown or a text file), a card shows up to see it without leaving Trama. Images come with a thumbnail and open in Trama's own viewer: the whole image on a dark backdrop, with zoom, drag and Esc to close.
- With a narrow window, the chat in the middle is no longer covered: the side panels shrink and, if that is not enough, turn into a strip; tapping it opens the panel over the chat, and Esc or a tap outside closes it.
- The chat you are looking at is marked with its folder's color, with a bar and an outline, so it is easy to find in a long list.
- The expired-cache prompt always puts "Continue the same session" first and focused, and each option has its icon; when starting with a summary opens another conversation, it says so in bold.
- In Plan and quotas, while the quota is being read it says "Reading quota…" instead of "No data yet".

## 0.2.82

- In the chat, the card of an `.html` file opens it in the browser; it used to show the folder that holds it.
- Shorter Settings: the sidebar groups the categories under three headings, and the long explanations in Models, Plan and quotas, Projects and Connectors sit in a folded "How it works". In Plan and quotas, each limit is a plain bar and "Advanced" starts folded (the search opens it on its own). In Models, "Today it would pick" is a table with type, model and effort.
- Branches: each branch shows the same title as the sidebar instead of the raw request, and the whole request shows when you unfold it with "Show the whole request".
- Project monograms no longer repeat: the one that clashes takes the next consonant of its name, the same in the rail and in the folder header.
- A worker's title starts with a capital letter.

## 0.2.81

- Gemini 3.8 Flash is gone from the worker allocation and from the pickers: Gemini 4 Hydrogen replaces it. An old configuration that names it keeps working; asking for it by hand with `-m` gives the same error as any model that does not exist.

## 0.2.80

- In the workers notice, the row of a worker that finished with a branch ready has an "Integrate" button next to "Open": no need to open the worker to integrate it. If it fails, the error shows below the row.
- The rail is slightly wider so the quota rings have room; they used to touch the edges.

## 0.2.79

- New skin: flat background, IBM Plex type and ten dark themes (Grafito by default, Tinta, Carbón, Shell, Catppuccin Mocha, Tokyo Night, Gruvbox, Nord, Rosé Pine and Dracula), plus Light and High contrast. Settings > General lets you pick the accent color (eight swatches or your own) and build a "Mío" theme from four colors, with a warning when contrast is low.
- Chats, Context and Quota are panels you can drag to the left, the right or the bottom, fold, close, and they remember where you left them. The rail stays fixed on the left. Narrow windows and the phone keep the previous layout.
- The 5 h and weekly quotas are two rings always visible on the rail, with a badge (check, alert or cross), a mark for the expected pace and the detail on hover. The Quota panel adds the weekly pace in words, the detail per subscription and "Worker pace" (Save, Normal, Spend), which changes the plan for the day without opening a terminal.
- In the chat, things to test are violet with a flask and things to decide are amber; the workers notice shows each row with its icon and word (done, failed, waiting, running).
- A folder or an `.html` file named in a reply shows up below it as a card with a button to open the folder.
- The model chip on each row carries a mark per family: diamond for Opus, circle for Sonnet and triangle for Haiku.
- The Context panel adapts to its width: tabs are no longer cut off and at the bottom it lays out in two columns.

## 0.2.78

- The «Context before compacting» setting now also applies to leaders: an Opus leader set to 300,000 compacts at that size on start and on resume, and the context panel shows that cap as its limit instead of 1,000,000.
- Settings > Models: the «Context before compacting» chips look like chips again and the «Unstick» list sits under its title.

## 0.2.77

- The split uses Gemini 4 Hydrogen (with the Gemini quota and the quality measured by Artificial Analysis) and goes back to using Claude and GPT through Google while agy serves them.

## 0.2.76

- When Trama updates, the window catches up only once: if it already reloaded itself with the new version, the notice to restart it no longer shows.

## 0.2.75

- A worker that stops because it lacks information no longer leaves you a decision on the board: it goes to the leader that launched it, with how to answer and continue the same worker (or give it Chrome and the other MCPs with `--mcp`). It only reaches you if the leader adds it because it is truly your decision. `lanzar_worker` accepts `id` (continue that worker) and `mcp`.

## 0.2.74

- In the chat, a folder named without its full path (`prompts/ficticios/`, `./fotos`) is also a button that opens it in the file manager, from that chat's folder. Before it only worked with the full path or `~`.

## 0.2.73

- Local model context: "More context options" (MTP, KV precision, KV in RAM, GPU layers) and the "Maximum context" button, up to 262144 tokens, with the RAM it uses.

## 0.2.72

- "Update" in the new Trama notice also works from another machine over the tailnet (before it said it could only be done from the computer). That machine needs to already have this version.

## 0.2.71

- Claude chats with an expired cache: even if "Start with a summary" is selected, Trama no longer opens another conversation on its own; it asks every time and the highlighted button is "Continue the same session". If you choose the summary, the new chat keeps the original's account.
- Sidebar in "Recent": inside each project, visible chats go by date, quiet ones too.
- The app opens faster: Settings, the board, the chat and each language load only when needed.
- When a chat closes, Trama sweeps the processes it left hanging.

## 0.2.70

- Board: the "Probar …" list opens with a checkbox per line ("1 of 4 tested"); ticking all closes it. Old items look as before.
- The "I left this on the board" card finds each worker's test inside that list and can tick it there; the classic board panel also shows the lines.

## 0.2.69

- Measurement: each model has a single name when read (`sonnet` and `claude-sonnet-5-5` are the same row; effort glued to agy, codex and dsh names goes to its column). `pa --rinde` went from 107 to 91 rows and routing gathers its 10 runs sooner.
- Reads: a `--leer` run counts for routing according to `pa --bien <id> si|no|parcial`, and its notice to the leader ends asking for it.
- Smaller tasks: frontend, multi-part code and design have a 50-turn cap (90 with `--indivisible "<reason>"`, which gets logged); if context gets compacted, the worker closes the piece, commits and says what's next. `pa` warns if a big request names more than 3 files or has more than one goal.
- When done, a worker can leave `HALLAZGO:` (something the leader needs to know) and `FALTA:` (it stopped for lack of information). With `FALTA`, the sidebar shows "needs info" and the leader's notice starts with "Stopped: missing information".
- Routing without an Artificial Analysis key: it uses a snapshot of the data (from 11/10) with its per-effort curve; Settings > Models says how old the data is.
- Fable 5.2 shows in the model table (still not picked without the owner's OK), and models with estimated quality say "estimated".
- Settings > Models: each "Would pick today" row explains why, on hover or with the keyboard.
- Board: worker "Probar" items no longer each create an entry: they gather into "Probar <project> (Linux/Windows)", renamed "Probar vX.Y.Z" when the version ships; each line is ticked on its own (`tablero tildar`) and ticking all closes it.
- The number at the bottom of the sidebar counts only questions waiting for your decision (not tests) and no longer shows "99+".

## 0.2.68

- Updating is visible: the new-Trama notice and Settings > Updates show the real install step ("Compiling · step 2 of 4"), how long it's been going and, if a step takes over 3 minutes, "Taking longer than usual" with a button to see the log. With reduced motion the bar stays still.
- Faster restart: if the new build only changed the interface, the window reloads the page instead of relaunching Electron; on quit, a leader with no turn in progress is stopped after 2 s (not 8), and pending writes have a cap.
- "Restart window" shows the "Updating Trama…" card like an update does.
- Restart timing counts each stage from the start of its own run and keeps the last 30.
- Trama health: a collapsed block in Settings > Updates with the last 30 days (version rollbacks, slow restarts, leaders cut off on quit and dropped notices), or "All good".
- Settings > Updates: the "Version" row is no longer clipped.
- Windows: the shell shows "Downloading N %" and "Installing" with the same bar, and logs version rollbacks in health.

## 0.2.67

- Safe start: Trama no longer rolls back to the previous version on its own when an install closes it from outside. A signal (SIGTERM, SIGINT, SIGHUP) counts as an intentional exit, a start cut short during an install doesn't count as a failure, and `arranque.json` is written under a lock. Every start and exit is logged in `trama.log` with version, failures and how long ago the previous one started.
- `trama-estado` and the installer check the engine socket first and the local port second: they no longer say "engine not responding" while it's running, and they say which way it answered.
- Routing: a preferred model with no quota left no longer drags the pick toward a pricier one; if it isn't available, the pick follows the profile as usual.
- Spell checker in Spanish and English at once, with a toggle in Settings > General (on by default).
- Claude is always found and launched through the same resolver (on Windows too, with `.exe` or `.cmd` from the npm prefix); a test prevents launching it bare again.
- Windows: closing with leaders still answering asks first, as on Linux.
- Plan & quotas: the out-of-quota notice is a single, separated sentence, without repeating itself.
- Tests: the base tests no longer leave folders in `/tmp`, and `pa` help passes parity again.

## 0.2.66

- Workers: the ones that write turn off 13 Claude Code tools they never use (scheduling tasks, worktrees, notebooks, todo list, among others). Each run's startup drops from 20.5k to 9.7k tokens.

## 0.2.65

- Leader skill: the orchestration guide got much smaller (from 20 KB to 7 KB) and gained a decision table per case, to spend less: parallel workers are launched in a single call and collected in one, and the effort comes from the allowed ones in Settings.
- Measurement: "retrabajo" (rework) no longer counts the stomping of another run that was already running in parallel. It is 1 only if someone resumed the run with `--seguir` after it was integrated, if it was reverted, or if another run that started after the integration (or whose task names it) rewrote its lines; when the run that stomped it was already running in parallel, the run gets rework 0 and the new `pisado` column. `pa --rinde` adds the "% pisado".
- Integrate: `--integrar` no longer competes with the workers for a slot: if all N slots are busy it still integrates (it rebases in a separate reserved slot, with its own lock so two integrations don't collide).
- Pushing `main`: the tool that pushes `main` to the remote is now also looked up in the PATH (not only in the engine), so `main` gets pushed again even though the tool is not part of the repo.
- Sidebar: each folder has a "+" button in its header that opens a new chat in that project.
- Windows: attached files and the leader's folder are now recognized with Windows paths (the ones starting with "C:\" or with "\\server"). Before they were not shown, neither as files nor as a project.
- Model picking: each model's cost now comes from what the runs actually measured (medicion.tsv) instead of fixed weights; the aggressive profile orders by "US$ per success" (the cost of every run that was integrated without rework). `pa --rinde` adds the "US$/success" column.
- Workers: they start lighter and spend less. Writers no longer load connectors (MCP) or slash commands (except frontend and design), don't launch subagents, and their fixed text is the same on every run so the cache is reused. Each task type has a turn cap.
- Splitter: in the saving profile, a free model with no history of its own only reads or does mechanical tasks until it proves itself in that type; design starts on Sonnet, and Opus doesn't start from scratch on frontend or multi-part code.
- Out of quota: when Claude runs out of quota and the splitter offers Gemini, Codex or dsh, `pa` continues the run with that engine instead of marking it failed.
- `pa --seguir` with an expired cache starts with a summary of what the run did, not just the new request.
- Goal mode: `--integrar-si-pasa` merges the branch on its own when the verifier passes.
- Trama's notice to the lead: it carries the worker's result (summarized) and says whether the branch merged on its own or what it's waiting for.
- Merge: uncommitted leftovers from another run are no longer committed on top of the work: they go to a patch in `rescates/`.
- Settings > Models: Claude models your account has that a rule leaves out (like Fable 5.2) show in their group, turned off.
- Update on Linux: with gnome-terminal or konsole, the update window is no longer treated as closed right away.
- Queued messages: if their file can't be read, a copy is saved before going on. Some errors that only came out in Spanish now use the app's language.

## 0.2.64

- Plan and quotas: removed the "original account plan" row at the top (it didn't save); each account's plan is chosen on its own card, and the card title follows the choice.
- Install: Trama's launcher no longer crashes at startup when the desktop hands it a Wayland display that doesn't exist; it uses whichever is there. That crash was what rolled the update back to the old version.

## 0.2.63

- Plan and quotas: each Claude account has its own plan, Pro or Max, with a selector under its row (the original account too). Workers use the plan of the account in use; if an account hasn't chosen one, the original account's plan applies.

## 0.2.62

- Update: updating no longer rolls back to the previous version when everything went fine (it happened with 0.2.61). Brings Fable 5.2 and the Claude models your account offers.

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
