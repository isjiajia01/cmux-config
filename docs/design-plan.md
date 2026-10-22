# cmux panel redesign: design plan
Mode: direction (plan only; nothing in cmux config/app was modified). Evidence: cmux 0.65.2; schema fetched to /tmp/cmuxschema_dl/schema.json (https://raw.githubusercontent.com/manaflow-ai/cmux/main/web/data/cmux.schema.json); `cmux config validate --path /tmp/cmuxcand/cand.json` PASSED on a candidate (so key names/types below are real, but validation does not prove visual effect).

## 0. Findings that shape everything
- Screenshot (light, Catppuccin Latte): the string "zhangjiajia · On" appears 3x (titlebar, tab, sidebar row). Chrome = titlebar (~40px of 1018) + one-tab strip (~42px) + 3 hairlines + 17.5%-wide sidebar. Terminal content is the only thing that matters and starts ~100px down. Top-right pane buttons (terminal/browser/split) are ~14px, low contrast, duplicated by shortcuts (cmd+shift+l, cmd+d, cmd+shift+d).
- The "No Folder" group header and rows are almost certainly the user's OWN custom sidebar `~/.config/cmux/sidebars/worktrees-attention.js` (header comment: project-folder grouping, attention by text colour/weight only). So the sidebar is already fully user-controlled; do not redesign it with native keys.
- Existing cmux.json is minimal: sidebarAppearance tint, app.accentColor=system, sidebar.compactAgentStatus/fontSize=12, workspaceColors leftRail+subtle. Not set: minimalMode, tabBarVisibility, pane border colors, surfaceTabBar. Ghostty (~/.config/ghostty/config) already tuned: Google Sans Code 14, 10% cell height, padding 12/10 balanced, bar cursor, no blur/opacity (good for perf). Theme lives in `~/Library/Application Support/com.cmuxterm.app/config.ghostty` (`cmux themes`), Latte/Mocha adaptive.

## 1. Aesthetic stance: "quiet instrument"
The terminal is the product; chrome is a thin, mono-weight frame that only speaks when state changes. Why: a Pi/agent TUI already paints dense, colourful, bordered content (teal rules, orange section headings); chrome that competes with it reads as noise.
- Remove redundancy: one name per thing. Workspace name lives in sidebar only; window title = same, shown once. Single-tab panes draw no tab strip (appears only at ≥2 tabs). Net gain ≈ 40-80px vertical.
- Chrome weight: 0 decorative borders. Keep one 1px sidebar/terminal divider (encodes the boundary) and pane dividers only when split. No materials/blur/gradients; flat sidebar = terminal bg + 18-25% tint (already set).
- Type: UI text 12pt (sidebar) / 11pt (tab bar), single UI face (system SF) vs terminal mono 14pt; hierarchy by weight+colour, not size. Attention = colour/weight only (already the sidebar convention).
- Colour: terminal theme owns the palette; chrome takes ONE accent (system accent, already set) used for: selected workspace rail, focused pane border, unread. Everything else greys. Focused pane gets a 1px accent border; unfocused split dim 0.85 (already set).
- Density: sidebar 12pt rows, details hidden by default (hideAllDetails true; reveal via preset), width stays user-dragged; target sidebar ≤ 15% at 2738px wide.
- Pane buttons: keep but reduce to the actions actually used (see feasibility), or hide; shortcuts cover them.
- Strength to keep: generous terminal padding (12/10, extend) and bar cursor; don't touch.

## 2. Customization model (three layers, all plain data, read once)
1. Tokens (global defaults, file `cmux.json`): density, chrome, accent, type scale. Overrides only by editing/removing a key (`cmux config set/unset`); removing falls back to default.
2. Presets (named bundles via `settingPresets` + `cmux config preset <name>` or a shortcut action): `focus` (minimalMode on, tabBarVisibility multiple-tabs, hideAllDetails true, buttons []), `ops` (full tab bar, details shown, sidebar show PR/ports), `present` (globalFontMagnification 120, sidebar 14). Presets are partial JSON, merge key by key, so combining costs nothing at runtime beyond one config reload.
3. Custom sidebar JS (existing mechanism) for anything structural; Ghostty config for terminal (font, padding, theme, split-divider-color, unfocused-split-opacity).
Proposed key set (all verified in schema): `app.minimalMode`, `app.tabBarVisibility`, `app.hideTabCloseButton`, `app.globalFontMagnification` (50-200 step 10), `app.windowTitleTemplate`, `app.accentColor`, `sidebar.fontSize` (10-20), `sidebar.hideAllDetails`, `sidebar.activeTabIndicatorStyle` (leftRail/solidFill/border/wash/lift/typography…), `surfaceTabBar.fontSize` (8-14), `paneBorderColor`, `activePaneBorderColor`, `terminal.sessionContentMaxWidth/Alignment` (cap line length on ultrawide), `workspaceColors.*`, `canvas.paneGap`.

## 3. Performance budget & approach
Principle: customization = static values resolved at config load; zero per-frame or per-tick work added.
- Only static tokens (colours, sizes, booleans). No blur/vibrancy/`surface:"glass"`, no `background-opacity`/`background-blur`: Ghostty transparency forces compositing of the Metal layer every frame.
- Keep `terminal.rendererRealization` enabled (default) and `terminal.titleUpdates.coalescing` on (default 1000ms) so chrome isn't invalidated by title spam.
- Custom sidebar rule (cmux doc "Performance and lazy loading"): it re-evaluates ~1/s; cap lists (`prefix(20)`), no clocks/timers in chrome, render details only for selected row, shallow trees, JS not Swift for speed. Use `renderer: inProcess` (remote costs IPC; only use for untrusted).
- Presets applied on demand, not polled; no file watchers beyond cmux's own.
Measurable checks (before/after each phase, same workload: Pi TUI streaming + `yes | head -c 200M` + 4 splits):
1. Idle CPU of cmux (Activity Monitor/`top -pid`) ≤ baseline +0.5% points; idle GPU wakeups unchanged.
2. Sustained output throughput (`time cat 100MB file`) within ±3% of baseline.
3. Preset switch (`cmux config preset X` → visually applied) < 150 ms, no relaunch.
4. Resident memory delta ≤ +10 MB with custom sidebar vs native.
5. Sidebar per-tick eval: no dropped frames when scrolling 50 workspaces (Instruments Time Profiler / Core Animation FPS ≥ 58).
Any phase failing a check is reverted (backup `.bak` first, as the CLI requires).

## 4. Feasibility verdict
| Element | Verdict | Evidence |
|---|---|---|
| Hide single-tab strip | Achievable | `app.tabBarVisibility: "multiple-tabs"` (schema app.tabBarVisibility). Caveat: ignored if minimalMode on (strip doubles as titlebar). |
| Merge titlebar (drop duplicate title) | Achievable, with trade-off | `app.minimalMode` "Hide the workspace title bar and move controls into sidebar". Combining with tabBarVisibility is mutually limited: minimalMode forces tab bar on. Pick one; prototype decides. Unknown: how it looks with traffic lights over sidebar. |
| Title text | Achievable | `app.windowTitleTemplate` placeholders {activeWorkspace}, {activeDirectory}. Does not remove the titlebar. |
| Tab/sidebar type sizes, magnification | Achievable | `surfaceTabBar.fontSize`, `sidebar.fontSize`, `app.globalFontMagnification`; CLI `cmux config set`. |
| Pane-button set/icons | Unknown | `ui.surfaceTabBar.buttons` exists (docs: "replaces default list; leave out a built-in ID to hide it"; IDs cmux.newTerminal/newBrowser/splitRight/splitDown) but docs label the action registry a nightly feature; installed 0.65.2 may ignore it. Validation passes (additionalProperties true) so it proves nothing. Test live. |
| Pane borders / focus ring | Achievable | `paneBorderColor`, `activePaneBorderColor` (global scope). |
| Selected-row style | Achievable | `sidebar.activeTabIndicatorStyle`/`workspaceColors.indicatorStyle` (already leftRail). |
| Sidebar structure ("No Folder", grouping, row layout) | Achievable (already custom) | `~/.config/cmux/sidebars/worktrees-attention.js`; `cmux sidebar validate/reload/select`. |
| Hide sidebar footer icons (avatar/help/cloud/feedback) | Unknown / likely Needs-source-change | No schema key found; `cloud.beta`, `computerUse.showInMenuBar` unrelated. |
| Titlebar/traffic-light height, tab-strip height, corner radius, hairline colours | Needs-source-change (no key in schema) | Absent from all 40+ top-level schema sections. |
| Window translucency/blur | Achievable but REJECTED on perf | Ghostty `background-opacity`/`background-blur` (cmux docs). |
| Content width cap | Achievable | `terminal.sessionContentMaxWidth` (≥320, step 20), `sessionContentAlignment`. Unknown whether it applies to plain terminals vs agent-chat only ("terminal and built-in agent chat content" says both). |
| Theme/colours | Achievable | `cmux themes set`, Ghostty config; sidebar tint via `sidebarAppearance`. |
| Per-preset switching | Achievable | `settingPresets` + `cmux config preset` (schema settingPresets; rejects presets containing ui/actions/packs keys, so button changes cannot be part of a preset). |

## 5. Phased plan
Phase 0 (smallest, ~10 min, reversible): back up cmux.json; apply `app.tabBarVisibility:"multiple-tabs"`, `sidebar.hideAllDetails:true`, `activePaneBorderColor` = system-accent hex, `surfaceTabBar.fontSize` 11; `cmux reload-config`; screenshot same window; run perf checks 1-3. Expected: single-tab strip gone, ≈42px reclaimed, no dup tab/row title.
Phase 1 (A/B titlebar): same workspace with `minimalMode:true` instead of Phase 0's tabBarVisibility; screenshot; choose the variant with less chrome and no clipped traffic lights. Add `windowTitleTemplate:"{activeWorkspace}"`.
Phase 2 (presets): add `settingPresets.focus/ops/present`; bind to shortcuts via `cmux config preset`; verify check 3.
Phase 3 (probe unknowns, ≤30 min): test `ui.surfaceTabBar.buttons: ["cmux.splitRight"]` on 0.65.2; test `sessionContentMaxWidth` on a plain terminal; look for footer-icon hiding in Settings UI. Result decides whether the rest needs a source change; if so, file an upstream feature request (the sidebar doc explicitly invites it) rather than forking, since forking costs update/Sparkle compatibility.
Phase 4: refine worktrees-attention.js only against budget (row count cap, no tick-dependent work); re-run check 4-5.
Prototype to validate: a throwaway copy of cmux.json at /tmp used via `cmux config validate --path`, then live-apply Phase 0/1 on one window and compare full-window screenshots at the same size for chrome px and visual redundancy.

## Open questions (defaults apply unless vetoed)
1. Prefer titlebar-merge (minimalMode) or tab-strip-hide? Default: tab-strip-hide (keeps native titlebar/traffic lights, fewer unknowns).
2. Accept a cmux source fork if footer icons / chrome heights prove unconfigurable? Default: no; request upstream.
