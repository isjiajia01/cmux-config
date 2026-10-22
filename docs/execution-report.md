# cmux redesign: execution report (phases 0-4)
cmux 0.65.2 (111). Window under test: the one hosting this agent (CG window 13508, 2738x1394 px). Evidence dir: ~/.pi/agent/tmp/cmux-redesign/ (shots/, perf-*.txt, preset-timing.txt).

## Final state (verified: `cmux config validate` OK, `cmux sidebar validate` OK)
Diff vs original (`~/.config/cmux/cmux.json.bak-p0-20261022-100153`):
- app.tabBarVisibility "multiple-tabs"; app.globalFontMagnification 100 (explicit, = default; written by preset switching)
- sidebar.hideAllDetails true; sidebar.showCloudDeviceIcons false (Phase 3)
- activePaneBorderColor "#007AFF" (system blue; only visible in split workspaces; not adaptive to dark)
- surfaceTabBar.fontSize 11
- ui.surfaceTabBar.buttons ["cmux.newTerminal","cmux.splitRight"] (Phase 3)
- settingPresets {focus, ops, present} (Phase 2). Current applied preset: `focus` (equals the base state).
- app.minimalMode stays false. terminal.sessionContentMaxWidth unset. worktrees-attention.js untouched (md5 4d05f358... before/after).

## Phase 0 (applied)
Applied the 4 keys via `cmux config set` (validated before write), reload OK.
- Screenshots: shots/00-baseline-13508.png → shots/01-phase0-after.png. Single-tab strip (≈42 pt) gone; terminal now starts directly under the titlebar (y≈40 of 1018 displayed vs ≈82). The top-right pane buttons live in that strip, so they also vanish at 1 tab (they return at ≥2 tabs).
- Check 1 (idle CPU, `top -pid 65768`, 10×2 s): baseline mean 8.53%, phase0 mean 15.04%, final 10.35%. NOT a valid regression signal: the host window runs a live agent TUI (spinner, streaming), so load varies run to run. Interleaved A/B (original vs phase0 config, A B A B, 8 samples each, perf-cpu-ab-p0.txt): A 12.35, B 8.91, A 8.40, B 7.34. Conclusion: no measurable CPU cost; cannot resolve ±0.5 pt. Memory RSS flat 506-520 MB throughout.
- Check 2 (cat of 100 MB generated ANSI text, run in a temp focused workspace, wall clock): baseline 1.073/1.054/1.057/1.026 s (mean 1.053), phase0 1.017/1.043/0.961 (1.007), final 1.048/1.125/1.052 (1.075 = +2.1% vs baseline, inside ±3%). Temp workspaces were closed, selection restored.
- Check 3: see Phase 2.

## Phase 1 (A/B, winner: tabBarVisibility "multiple-tabs", minimalMode false)
shots/02-phase1-minimalMode.png vs 01 / 04-phase1-final-tabBarVisibility.png.
- Single tab: both variants start the terminal at the same y (≈40/1018): no vertical difference. Traffic lights not clipped in either (22 of 1018 px, inside the 40 px band).
- minimalMode removes the sidebar header controls (sidebar toggle, notification bell + unread badge, "+", back/forward) and moves the tab name into the strip; the name still appears twice (tab + sidebar row), so no redundancy gain. I could not confirm hover reveal of the controls (hover probe inconclusive, screenshot discarded).
- Decision (plan default Q1): keep tabBarVisibility: native titlebar, unread badge and new-workspace button stay visible. minimalMode would save ≈42 pt only at ≥2 tabs (documented behaviour, not verified: the two-tab screenshots were blank frames, deleted).
- windowTitleTemplate "{activeWorkspace}" NOT added: the titlebar already shows the workspace name (default template is empty string); it would be a no-op.

## Phase 2 (presets, verified)
Keys cannot be set via `cmux config set` (settingPresets "isn't a setting"); edited cmux.json directly (JSONC comment kept). Each preset names the same 6 keys so switching fully replaces the previous one (merge semantics):
- focus: tabBarVisibility multiple-tabs, magnification 100, hideAllDetails true, showPullRequests/showPorts false, sidebar.fontSize 12
- ops: tabBarVisibility always, details shown (hideAllDetails false), showPullRequests/showPorts true, 12, mag 100
- present: multiple-tabs, magnification 120, sidebar.fontSize 14, details hidden
No ui/actions/packs keys. Verified visually: ops → tab strip + 4 buttons appear (shots/07-preset-ops.png); present → larger text (shots/08-preset-present.png); focus restores. Note: `cmux config preset X` WRITES the values into cmux.json (persistent, not an overlay). The custom sidebar ignores showPorts/showPullRequests, so ops changes only the strip + sidebar.hideAllDetails for native-state consumers.
Timing (preset-timing.txt): CLI round trip 58 ms. Time to a visible change in a window-region capture: 294-358 ms over 7 runs, but each screencapture itself takes ~145 ms, so the true apply latency is between ~0.15 and ~0.33 s. The < 150 ms budget is NOT proven; no relaunch needed; no flicker observed.

## Phase 3 (probes)
1. ui.surfaceTabBar.buttons: WORKS on 0.65.2. Default 4 buttons (terminal, browser, split right, split down) → with ["cmux.splitRight"] only split remains; with ["cmux.newTerminal","cmux.splitRight"] those two remain (shots/07 → 09 → 10). Kept the 2-button list (new tab has no strip button when only one tab; browser/split-down have shortcuts). Cannot be part of a preset (schema rejects ui). Legacy root key surfaceTabBarButtons exists; not used.
2. terminal.sessionContentMaxWidth: WORKS on a plain terminal (set 800 → centred 800 pt column, gutters filled with chrome colour; shots/11-phase3-maxwidth800.png). Reverted (unset): on this 1130 pt pane it narrows the TUI to ~100 columns and creates visible gutters. Opt-in: `cmux config set terminal.sessionContentMaxWidth 1000`.
3. Footer icons (avatar, help, cloud, feedback): no schema key. Found `sidebar.showCloudDeviceIcons` which removes the CLOUD icon (shots/12-phase3-footer-probe.png: avatar, ?, feedback remain). Applied (reversible). Avatar/help/feedback: unconfigurable → source change or upstream request. Settings UI was not clicked through; unverified there.
Remaining Needs-source-change: titlebar/tab-strip heights, corner radius, hairline colours, remaining 3 footer icons (as the plan predicted; no fork).

## Phase 4 (worktrees-attention.js: no edit, deliberate)
Audit vs budget: clock subscription is conditional (closeState reads closeSt() first and returns before nowMs(); visibleWorkspaces subscribes to clock only while an optimistic order override is live); tab sub-rows already capped at 3 with "+N more tabs" (line 522); model/flatEntries are memoised computed; no timers/polling. `surface:"glass"` (line 673) only drops the pane-host backdrop when the sidebar is opened as a pane (cmux docs), no effect on the docked sidebar: left. A hard cap on workspace rows was not added: flatEntries feeds drag-reorder index math (line 277) and capping would hide real workspaces and break reorders; only worthwhile beyond ~50 workspaces (docs say cap at 20-50). Per-row `data.workspaces().find` is O(n²) but trivial at current n. `cmux sidebar validate` OK, `cmux sidebar reload` OK, file md5 unchanged. Checks 4/5 (RSS delta vs native sidebar, 58 fps with 50 workspaces) NOT measured.

## Unverified / not run
- CPU ±0.5 pt (host load too noisy); preset latency <150 ms; two-tab minimalMode vs tabBarVisibility visuals; minimalMode hover controls; footer icon Settings UI; sidebar checks 4-5; activePaneBorderColor not seen (needs a split); dark-mode look of #007AFF border.
- cat benchmark ran in a temp workspace in the same window; the agent TUI in the other workspace was hidden at that time.
- Environment: the old `cmux.json.bak-20261021-165205` and the six sidebar .bak files are the user's; left alone. My p1/p2 baks were pruned.

## Backups and restore
- Pre-everything: `~/.config/cmux/cmux.json.bak-p0-20261022-100153`; pre-Phase-3 (presets only): `...bak-p3-20261022-100642`.
- Full restore: `cp -p ~/.config/cmux/cmux.json.bak-p0-20261022-100153 ~/.config/cmux/cmux.json && cmux config validate && cmux reload-config`
- Partial: `cmux config unset sidebar.showCloudDeviceIcons`; remove the `"ui"` block by editing; `cmux config preset ops` for the old full strip + details (note old state had tabBarVisibility "always" = default, so `cmux config unset app.tabBarVisibility` also works).
- Sidebar JS untouched; backups at ~/.config/cmux/sidebars/*.bak-*.
- Temp files: /tmp/cmuxexec (scripts, 100 MB test file; safe to delete).
