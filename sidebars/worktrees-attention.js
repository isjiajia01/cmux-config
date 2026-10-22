// Worktrees + Attention (v3): project-folder grouping like the built-in
// "Project Worktrees", with attention shown ONLY through text colour and
// font weight. No tints, no pills, no rails.
//
// Drag: grab a project HEADER to move the whole project (header + its
// workspaces) among the other projects. Workspace rows are not draggable (a
// project is derived from the directory, so a row can only ever live in its own
// project). The drop rewrites the real cmux workspace order, so it survives
// reload, collapse and regrouping.
//
//   needs input  status == "needs-attention" OR any agent.status == "needs_input"
//                -> bold burnt-orange title, trailing "!" (same colour)
//   unread       unread > 0
//                -> semibold blue title, trailing count (same blue)
//   otherwise    regular primary title. working / review / done are not cues.
//
// Close controls: hovering a workspace row shows a small "xmark" at its trailing
// edge (workspace.close); hovering a tab sub-row shows one that closes that tab
// (surface.close). Both live in constant-size slots (36 x 18), so hover never
// moves anything. Closing is a plain-text two-step, because cmux refuses to
// close anything with a running process (confirmation_required) unless the call
// carries force:true, and Pi is always running:
//   1st click on "x"  -> that slot (only) becomes red "Close?" text and the row
//                        title turns red. Reverts by itself after ~3s; the text
//                        is only drawn while the row is hovered, so leaving the
//                        row shows the normal cue again.
//   2nd click         -> workspace.close / surface.close with force:true.
//                        (Ignored within 350ms of the 1st, so a double-click
//                        can't close.)
//   still there ~2s later (cmux refused) -> title reads "Couldn't close", slot
//                        reads "Retry?" for ~3s. Never a silent no-op.
// Only one row can be pending at a time. The menu's Close also forces.
// There is no left-click "..." menu: this runtime's only standalone Menu is the
// default macOS pop-up button, so the other actions stay on right-click.
//
// Everything is derived live from cmux state; the sidebar stores nothing, so a
// cue clears exactly when cmux clears its source (viewing a workspace clears
// its unread; the agent resuming clears needs_input).
//
// Colour notes: "blue" is the adaptive system blue (3.9:1 on white, 4.5:1 on
// dark). A hex cannot adapt to appearance, so the orange is one mid-luminance
// value that holds >= 3:1 on both light and dark sidebars, and weight (bold)
// is the redundant non-colour channel.

const NEEDS = "#C46200";
const UNREAD = "blue";
const SELECTED_BG = "#7f7f7f3d"; // neutral selection wash, same as built-in rows
const HOVER_BG = "#7f7f7f24";
const ICON_HOVER_BG = "#7f7f7f4a";
const DRAG_BG = "#7f7f7f55"; // header wash while its project is lifted
const DRAG_DIM = 0.45; // the lifted project's workspaces fade back so the header reads as the handle

// --- optimistic selection --------------------------------------------------------
let selectOverride = null;
const [selectTick, setSelectTick] = signal(0);
function isSelected(w) {
  selectTick();
  if (!w) return false;
  if (selectOverride) {
    if (data.selectedId() === selectOverride) selectOverride = null;
    else return w.id === selectOverride;
  }
  return !!w.selected;
}
function selectWorkspace(id) {
  if (!id) return;
  selectOverride = id;
  setSelectTick(selectTick() + 1);
  cmux("workspace.select", { workspace_id: id });
}

// --- optimistic order (a drop echoes ~1s later) -----------------------------------
// The override paints the dropped order the same frame, so nothing snaps back,
// and clears itself once cmux reports the same order. If cmux never agrees
// (e.g. it clamped a pinned workspace) it expires after ~6s and the real order
// wins, so the sidebar can never show an order cmux does not have.
let orderOverride = null;
let orderSetAt = 0;
const [orderTick, setOrderTick] = signal(0);
const clockNow = () => {
  const c = data.clock();
  return c && typeof c.epoch === "number" ? c.epoch : 0;
};
function setOrderOverride(ids) {
  orderOverride = ids;
  orderSetAt = clockNow();
  setOrderTick(orderTick() + 1);
}
function visibleWorkspaces() {
  orderTick();
  let ws = data.workspaces() ?? [];
  if (orderOverride) {
    const now = clockNow(); // subscribes to the 1s clock only while an override is live
    const limit = now > 1e11 ? 6000 : 6; // epoch in ms or s
    const actual = ws.map((w) => w.id).join(",");
    const wanted = orderOverride.filter((id) => ws.some((w) => w.id === id)).join(",");
    if (actual === wanted || (orderSetAt > 0 && now - orderSetAt > limit)) {
      orderOverride = null; // host caught up, or gave up
    } else {
      const rank = new Map(orderOverride.map((id, i) => [id, i]));
      ws = [...ws].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
    }
  }
  return ws;
}

// --- collapse state (in-memory only: this runtime has no storage) -----------------
const collapsed = new Set();
const [collapseTick, setCollapseTick] = signal(0);
function isCollapsed(key) {
  collapseTick();
  return collapsed.has(key);
}
function toggleCollapse(key) {
  if (collapsed.has(key)) collapsed.delete(key);
  else collapsed.add(key);
  setCollapseTick(collapseTick() + 1);
}

// --- attention model ---------------------------------------------------------------
function attention(w) {
  if (!w) return { level: "none", needs: false, unread: 0, tabs: [] };
  const agents = w.agents ?? [];
  const needAgents = agents.filter((a) => a.status === "needs_input");
  const needs = w.status === "needs-attention" || needAgents.length > 0;
  const unread = w.unread ?? 0;
  const tabs = w.tabs ?? [];
  const rows = [];
  if (tabs.length > 1) {
    for (const t of tabs) {
      const tNeeds = needAgents.some((a) => (a.panelId && a.panelId === t.id) || (a.surfaceId && a.surfaceId === t.surfaceId));
      if (tNeeds || t.hasUnread) {
        rows.push({ key: t.id, title: t.title || "Untitled", level: tNeeds ? "needs" : "unread", surfaceId: t.surfaceId });
      }
    }
  }
  rows.sort((a, b) => (a.level === b.level ? 0 : a.level === "needs" ? -1 : 1));
  return { level: needs ? "needs" : unread > 0 ? "unread" : "none", needs, unread, tabs: rows };
}
const levelColor = (l) => (l === "needs" ? NEEDS : l === "unread" ? UNREAD : "primary");
const levelWeight = (l) => (l === "needs" ? "medium" : l === "unread" ? "medium" : "regular");

function summarize(list) {
  let needs = 0, unread = 0, withUnread = 0;
  for (const w of list) {
    const a = attention(w);
    if (a.needs) needs += 1;
    if (a.unread > 0) { unread += a.unread; withUnread += 1; }
  }
  return { needs, unread, withUnread, level: needs > 0 ? "needs" : unread > 0 ? "unread" : "none" };
}

// --- grouping: project folder / worktree root ---------------------------------------
// cmux exposes no repo-root field, so the project key is inferred from paths and
// the git `branch` field (present for anything inside a repo):
//  1. `.worktrees/x`, `worktrees/x` etc. fold into their parent repo.
//  2. Sticky: once a workspace has a key, a `cd` into a subfolder (or back up)
//     keeps it; only a move to an unrelated directory regroups it.
//  3. A tab of the same workspace sitting at an ancestor (<= 3 levels up) is
//     taken as the root, but only when that tab is in a repo on the same branch,
//     so a tab parked in a parent-of-projects folder never swallows the project.
//  4. A first sighting inside another workspace's folder (<= 4 levels up) adopts
//     that folder when both are in a repo on the same branch.
const WORKTREE_RE = /^(.*?)\/(?:\.worktrees|\.claude\/worktrees|\.git\/worktrees|worktrees)\/[^/]+/;
const HOME_RE = /^\/(?:Users|home)\/[^/]+\/?$/;
const norm = (d) => (d || "").replace(/\/+$/, "");
const isHomeish = (d) => !d || d === "~" || d === "/" || HOME_RE.test(d);
function fold(d) {
  d = norm(d);
  const m = WORKTREE_RE.exec(d);
  return m && m[1] ? m[1] : d;
}
const within = (child, root) => child === root || child.startsWith(root + "/");
const depth = (d) => d.split("/").filter((s) => s.length > 0).length;

const sticky = new Map(); // workspace id -> project key
function candidateKey(w) {
  const base = fold(w.directory);
  if (isHomeish(base)) return "";
  let best = base;
  if (w.branch) {
    const hints = [];
    for (const t of w.tabs ?? []) if (t.directory && t.branch && t.branch === w.branch) hints.push(fold(t.directory));
    for (const h of hints) {
      if (!isHomeish(h) && within(base, h) && depth(base) - depth(h) <= 3 && depth(h) < depth(best)) best = h;
    }
  }
  return best;
}

const model = computed(() => {
  const ws = visibleWorkspaces();
  const live = new Set(ws.map((w) => w.id));
  for (const id of Array.from(sticky.keys())) if (!live.has(id)) sticky.delete(id);
  const keyOf = new Map();
  const cand = new Map(ws.map((w) => [w.id, candidateKey(w)]));
  // Pass 1: where the workspace is, but keep a sticky key that still relates.
  const pre = new Map();
  for (const w of ws) {
    const c = cand.get(w.id);
    const s = sticky.get(w.id);
    pre.set(w.id, c === "" ? "" : s !== undefined && s !== "" && (within(c, s) || within(s, c)) ? s : c);
  }
  // Pass 2: lift into a same-repo folder that contains it (re-evaluated every
  // tick, so git info that arrives late still merges a subfolder workspace).
  const pool = ws.filter((x) => x.branch && pre.get(x.id) !== "").map((x) => ({ key: pre.get(x.id), branch: x.branch }));
  for (const w of ws) {
    const k = pre.get(w.id);
    let best = k;
    if (k !== "" && w.branch) {
      for (const p of pool) {
        if (p.branch === w.branch && within(k, p.key) && depth(k) - depth(p.key) <= 4 && depth(p.key) < depth(best)) best = p.key;
      }
    }
    keyOf.set(w.id, best);
  }
  for (const w of ws) sticky.set(w.id, keyOf.get(w.id));
  const order = [];
  const byKey = new Map();
  for (const w of ws) {
    const key = keyOf.get(w.id);
    if (!byKey.has(key)) {
      const name = key === "" ? "No Folder" : key.split("/").filter((s) => s.length > 0).pop() || key;
      byKey.set(key, { id: "h:" + key, key, name, members: [] });
      order.push(byKey.get(key));
    }
    byKey.get(key).members.push(w);
  }
  return { groups: order, byKey, keyOf };
});
const groupByKey = (key) => model().byKey.get(key);
const membersOf = (key) => groupByKey(key)?.members ?? [];

const flatEntries = computed(() => {
  const out = [];
  for (const g of model().groups) {
    out.push({ kind: "header", id: g.id, groupKey: g.key });
    if (!isCollapsed(g.key)) {
      for (const m of g.members) out.push({ kind: "ws", id: "w:" + m.id, wsId: m.id, groupKey: g.key });
    }
  }
  return out;
});

// Conditional view helper: renders build() only while cond() is true.
function when(cond, build) {
  return ForEach({ items: () => (cond() ? [1] : []), key: (x) => "w" + x }, () => build());
}

// --- drag-reorder of whole projects ------------------------------------------------
// A project header carries `.block("h:<key>")` and so do its workspace rows, so
// dragging the header lifts the project as one block (extra.block). Workspace
// rows are `.fixed()`: they shift to open the gap but cannot be grabbed.
//
// A drop can only land BETWEEN projects. A slot inside another project resolves
// to its nearer boundary (upper half -> before it, lower half -> after it), so
// a project never splits another and the result always matches the indicator.
// The new order is every project's workspaces, contiguous, in project order,
// sent to cmux in one workspace.reorder_many.
const blockId = (key) => "h:" + key;
const [drag, setDrag] = signal(null);

// Project key being dragged, or null (a plain row drag is never a project drag).
function dragGroupKey(d) {
  if (!d || typeof d.id !== "string") return null;
  if (d.id.startsWith("h:")) return d.id.slice(2);
  if (d.block && d.id.startsWith("w:")) {
    const k = model().keyOf.get(d.id.slice(2));
    return k === undefined ? null : k;
  }
  return null;
}

// Flat drop index -> slot among the OTHER projects (0 = first, n = last).
function slotFromIndex(key, index) {
  const keys = model().groups.map((g) => g.key).filter((k) => k !== key);
  const entries = flatEntries().filter((e) => e.groupKey !== key);
  const i = Math.max(0, Math.min(Number.isFinite(index) ? index : entries.length, entries.length));
  if (i >= entries.length) return keys.length;
  const e = entries[i];
  if (e.kind === "header") return keys.indexOf(e.groupKey);
  const headerAt = entries.findIndex((x) => x.kind === "header" && x.groupKey === e.groupKey);
  const rows = entries.filter((x) => x.kind === "ws" && x.groupKey === e.groupKey).length;
  const above = i - headerAt - 1; // rows of that project above the slot
  return keys.indexOf(e.groupKey) + (above * 2 >= rows ? 1 : 0);
}

// Pure plan: where would `key` land at `slot`? null when nothing would change.
function planGroupMove(key, slot) {
  const groups = model().groups;
  if (!groups.some((g) => g.key === key)) return null;
  const keys = groups.map((g) => g.key).filter((k) => k !== key);
  const s = Math.max(0, Math.min(slot, keys.length));
  const next = [...keys.slice(0, s), key, ...keys.slice(s)];
  if (next.join("\u0000") === groups.map((g) => g.key).join("\u0000")) return null;
  let full = [];
  for (const k of next) for (const w of membersOf(k)) full.push(w.id);
  // cmux keeps pinned workspaces at the top whatever order is sent; mirror that
  // so the optimistic order is the order cmux will really report.
  const pinned = new Set(visibleWorkspaces().filter((w) => w.pinned).map((w) => w.id));
  if (pinned.size > 0) full = [...full.filter((id) => pinned.has(id)), ...full.filter((id) => !pinned.has(id))];
  if (full.join(",") === visibleWorkspaces().map((w) => w.id).join(",")) return null;
  return { keys: next, full, beforeKey: next.length > s + 1 ? next[s + 1] : null };
}

function applyPlan(plan) {
  if (!plan) return;
  setOrderOverride(plan.full); // paint now; cmux echoes behind it
  cmux("workspace.reorder_many", { order: plan.full.join(",") });
}

function handleMove(id, index, extra) {
  const key = dragGroupKey({ id, block: !!(extra && extra.block) });
  if (key === null) return; // a row drop is ignored: rows are not draggable
  applyPlan(planGroupMove(key, slotFromIndex(key, index)));
}

// Menu alternatives to dragging.
function moveGroup(key, where) {
  const cur = model().groups.findIndex((g) => g.key === key);
  if (cur < 0) return;
  const last = model().groups.length - 1;
  const slot = where === "up" ? cur - 1 : where === "down" ? cur + 1 : where === "top" ? 0 : last;
  applyPlan(planGroupMove(key, slot));
}

// Drop indicator: "b:<key>" = line above that project, "end" = below the last,
// "" = none (not dragging a project, or the drop would change nothing).
const dropTarget = computed(() => {
  const d = drag();
  const key = dragGroupKey(d);
  if (key === null) return "";
  const plan = planGroupMove(key, slotFromIndex(key, d.index));
  if (!plan) return "";
  return plan.beforeKey === null ? "end" : "b:" + plan.beforeKey;
});

// --- menus ---------------------------------------------------------------------------
function workspaceMenu(w) {
  const act = (action) => () => cmux("workspace.action", { action, workspace_id: w().id });
  return [
    Button(() => ((w()?.unread ?? 0) > 0 ? "Mark as Read" : "Mark as Unread"), () =>
      cmux("workspace.action", { action: (w()?.unread ?? 0) > 0 ? "mark_read" : "mark_unread", workspace_id: w().id })),
    Button(() => (w()?.pinned ? "Unpin" : "Pin"), () =>
      cmux("workspace.action", { action: w()?.pinned ? "unpin" : "pin", workspace_id: w().id })),
    Button("Clear Pinned Status", () => cmux("workspace.status.set", { workspace_id: w().id, status: "auto" })),
    Divider(),
    Button("Move Up", act("move_up")),
    Button("Move Down", act("move_down")),
    Button("Move to Top", act("move_top")),
    Divider(),
    Button("Close", () => { unpinThenClose(w().id); cmux("workspace.close", { workspace_id: w().id, force: true }); }).destructive(),
  ];
}

// --- rows ------------------------------------------------------------------------------
// --- two-step close ------------------------------------------------------------------
// One pending close at a time: { key, at (ms), phase: "confirm" | "wait" }.
// There are no timers in this runtime, so expiry is evaluated by bindings that
// subscribe to the 1s clock (only the pending row does), i.e. it lands within
// ~1s of the deadline.
const CLOSE_RED = "red";
const CONFIRM_SECS = 3; // "Close?" reverts after this
const REFUSED_AFTER = 2; // row still present this long after a forced close = cmux refused
const REFUSED_SECS = 5; // ...and the "Couldn't close" notice is gone at this age
const DOUBLE_CLICK_MS = 350;
const [closeSt, setCloseSt] = signal(null);
function nowMs() {
  const c = data.clock(); // subscribes the caller to the 1s tick
  if (typeof Date !== "undefined" && Date.now) return Date.now();
  const e = c && typeof c.epoch === "number" ? c.epoch : 0;
  return e > 1e11 ? e : e * 1000;
}
// "idle" | "confirm" | "wait" | "fail" for one row key.
function closeState(key) {
  const s = closeSt();
  if (!s || s.key !== key) return "idle";
  const el = (nowMs() - s.at) / 1000;
  if (s.phase === "confirm") return el < CONFIRM_SECS ? "confirm" : "idle";
  return el < REFUSED_AFTER ? "wait" : el < REFUSED_SECS ? "fail" : "idle";
}
function closeTap(key, method, params) {
  const st = closeState(key);
  const at = nowMs();
  if (st === "idle") {
    setCloseSt({ key, at, phase: "confirm" });
    return;
  }
  if (st === "wait") return;
  if (st === "confirm" && at - closeSt().at < DOUBLE_CLICK_MS) return;
  setCloseSt({ key, at, phase: "wait" });
  let refused = false;
  try {
    // cmux refuses to close a pinned workspace ("protected"), so unpin first.
    if (method === "workspace.close") unpinThenClose(params.workspace_id);
    const res = cmux(method, { ...params, force: true });
    refused = !!res && typeof res === "object" && (!!res.error || res.ok === false);
  } catch (e) {
    refused = true;
  }
  if (refused) setCloseSt({ key, at: at - REFUSED_AFTER * 1000, phase: "wait" }); // straight to the notice
}

// Quiet "x": same recipe as the header "+" (tertiary-weight glyph, uniform
// padding around it, round neutral wash only while the glyph itself is hovered).
// Visible only while the enclosing row is hovered.
function closeGlyph(size, pad, tip, onTap) {
  return Image("xmark")
    .font(size).weight("semibold").color("secondary")
    .padding(pad)
    .cornerRadius(9)
    .hoverBackground(ICON_HOVER_BG)
    .help(tip)
    .showOnHover()
    .onTap(onTap);
}

// The whole hover slot: "x" while idle; red text (no fill) while confirming /
// waiting / refused. Same 36 x 18 box in every state, so nothing moves.
function unpinThenClose(id) {
  const ws = (data.workspaces() ?? []).find((x) => x.id === id);
  if (ws && ws.pinned) {
    try { cmux("workspace.action", { action: "unpin", workspace_id: id }); } catch (e) {}
  }
}

function closeSlot(keyFn, size, pad, tip, onClose, lead) {
  const key = typeof keyFn === "function" ? keyFn : () => keyFn;
  const st = () => closeState(key());
  return ZStack({ alignment: "trailing" }, [
    ...(lead ? [lead] : []),
    when(() => st() === "idle", () => closeGlyph(size, pad, tip, () => closeTap(key(), ...onClose()))),
    when(() => st() !== "idle", () =>
      Text(() => (st() === "confirm" ? "Close?" : st() === "fail" ? "Retry?" : "…"))
        .font(10).weight("semibold").color(CLOSE_RED).lineLimit(1).fixedSize()
        .frame({ width: 36, height: 18 })
        .cursor("pointer")
        .help("Click to close now, even if a process is running")
        .showOnHover()
        .onTap(() => closeTap(key(), ...onClose()))),
  ]).frame({ width: 36, height: 18 }).layoutPriority(2);
}

function tabRow(t, w) {
  const row = () => t();
  const key = () => "tab:" + (row().surfaceId ?? row().key);
  const st = () => closeState(key());
  return HStack({ spacing: 5, alignment: "center" }, [
    Text(() => (row().level === "needs" ? "!" : "•"))
      .font(11).weight("semibold").color(() => levelColor(row().level)).frame({ width: 8 }),
    Text(() => (st() === "fail" ? "Couldn't close" : row().title))
      .font(11).weight(() => (row().level === "needs" ? "semibold" : "medium"))
      .color(() => (st() === "idle" ? levelColor(row().level) : CLOSE_RED))
      .lineLimit(1).truncation("tail"),
    Spacer({ minLength: 0 }),
    // Close slot: always laid out (36 x 18), "x" only on hover. HStack centres
    // it vertically on the row's text line.
    closeSlot(key, 8, 3, "Close this tab", () => {
      const ws = w();
      return ["surface.close", { surface_id: row().surfaceId, workspace_id: ws ? ws.id : undefined }];
    }),
  ])
    .paddingLeading(38)
    .paddingTrailing(8)
    .paddingVertical(2)
    .cornerRadius(6)
    .hoverBackground(HOVER_BG)
    .frame({ maxWidth: "infinity" })
    .onTap(() => {
      const ws = w();
      if (!ws) return;
      selectWorkspace(ws.id);
      if (row().surfaceId) cmux("surface.focus", { surface_id: row().surfaceId, workspace_id: ws.id });
    });
}

function workspaceRow(w, gkey) {
  const att = () => attention(w());
  const lvl = () => att().level;
  const sel = () => isSelected(w());
  const subtitle = () => w()?.branch ?? "";

  const main = HStack({ spacing: 6, alignment: "center" }, [
    VStack({ alignment: "leading", spacing: 1 }, [
      Text(() => (closeState("ws:" + w()?.id) === "fail" ? "Couldn't close" : w()?.title ?? ""))
        .font(13)
        .weight(() => levelWeight(lvl()))
        .color(() => (closeState("ws:" + w()?.id) === "idle" ? levelColor(lvl()) : CLOSE_RED))
        .lineLimit(1).truncation("tail"),
      when(() => subtitle() !== "", () =>
        Text(() => subtitle()).font(11).color("tertiary").lineLimit(1).truncation("tail")),
    ]).layoutPriority(1),
    Spacer({ minLength: 0 }),
    // Trailing slot: cue glyph/count at rest, close "x" on hover (red text while
    // confirming). Fixed size so a long title can never push it around; as a
    // direct child of the centre-aligned HStack it is vertically centred on the
    // whole row.
    closeSlot(() => "ws:" + w()?.id, 10, 4, "Close workspace", () => ["workspace.close", { workspace_id: w()?.id }],
      HStack({ spacing: 4 }, [
        Text(() => (att().needs ? "!" : ""))
          .font(12).weight("semibold").color(NEEDS).fixedSize(),
        Text(() => (att().unread > 0 ? String(att().unread) : ""))
          .font(11).weight("semibold").color(UNREAD).fixedSize(),
        Image("pin.fill").font(8).color("tertiary")
          .opacity(() => (w()?.pinned && lvl() === "none" ? 1 : 0))
          .frame({ width: () => (w()?.pinned && lvl() === "none" ? 10 : 0) }),
      ]).hideOnHover()),
  ])
    .paddingLeading(26)
    .paddingTrailing(8)
    .paddingVertical(5)
    .cornerRadius(8)
    .background(() => (sel() ? SELECTED_BG : null))
    .hoverBackground(() => (sel() ? SELECTED_BG : HOVER_BG))
    .frame({ maxWidth: "infinity" })
    .onTap(() => selectWorkspace(w()?.id))
    .contextMenu(workspaceMenu(w));

  const more = () => Math.max(0, att().tabs.length - 3);
  return VStack({ alignment: "leading", spacing: 1 }, [
    main,
    ForEach({ items: () => att().tabs.slice(0, 3), key: (r) => r.key }, (t) => tabRow(t, w)),
    when(() => more() > 0, () =>
      Text(() => "+" + more() + " more tabs").font(10).color("tertiary").paddingLeading(51).paddingVertical(1)),
  ])
    .frame({ maxWidth: "infinity" })
    .opacity(() => (dragGroupKey(drag()) === gkey ? DRAG_DIM : 1))
    .fixed() // not grabbable: only the project header drags
    .block(blockId(gkey));
}

function groupHeader(key) {
  const g = () => groupByKey(key) ?? { key, name: "", members: [] };
  const closed = () => isCollapsed(key);
  const sum = () => summarize(g().members);
  const rolled = () => (closed() ? sum() : { needs: 0, unread: 0 });
  const hasSelected = () => closed() && g().members.some((w) => isSelected(w));
  const lifted = () => dragGroupKey(drag()) === key;
  const allPinned = () => g().members.length > 0 && g().members.every((w) => w.pinned);
  const togglePin = () => {
    const act = allPinned() ? "unpin" : "pin";
    for (const w of g().members) if (!!w.pinned !== (act === "pin")) cmux("workspace.action", { action: act, workspace_id: w.id });
  };
  const create = () => {
    const params = { focus: true };
    if (key) params.cwd = key;
    cmux("workspace.create", params);
  };
  // Constant 2pt slot above the header, so the drop line appears without
  // moving anything.
  const dropLine = Rectangle()
    .fill(() => (dropTarget() === "b:" + key ? "accent" : "clear"))
    .cornerRadius(1)
    .frame({ maxWidth: "infinity", height: 2 })
    .paddingHorizontal(8);
  const content = HStack({ spacing: 6 }, [
    Image("chevron.right")
      .font(10).weight("semibold").color("tertiary")
      .rotation(() => (closed() ? 0 : 90))
      .frame({ width: 14, height: 16 }),
    Text(() => g().name)
      .font(12).weight("semibold")
      .color(() => (rolled().needs > 0 ? NEEDS : rolled().unread > 0 ? UNREAD : "secondary"))
      .lineLimit(1).truncation("tail")
      .layoutPriority(1),
    Image("pin.fill").font(8).color("tertiary")
      .opacity(() => (allPinned() ? 1 : 0))
      .frame({ width: () => (allPinned() ? 10 : 0) }),
    Spacer({ minLength: 0 }),
    // Trailing slot: rollup cue at rest; grip (drag affordance) + "+" on hover.
    // Both states share one box, so hovering never changes the layout.
    ZStack({ alignment: "trailing" }, [
      HStack({ spacing: 6 }, [
        Text(() => (rolled().needs > 0 ? "!" : "")).font(12).weight("semibold").color(NEEDS).fixedSize(),
        Text(() => (rolled().unread > 0 ? String(rolled().unread) : "")).font(11).weight("semibold").color(UNREAD).fixedSize(),
      ]).hideOnHover(),
      HStack({ spacing: 2 }, [
        Image("line.3.horizontal")
          .font(10).weight("semibold").color("tertiary")
          .frame({ width: 16, height: 16 })
          .help("Drag this header to reorder projects"),
        Image("plus")
          .font(10).weight("semibold").color("secondary")
          .padding(4)
          .cornerRadius(9)
          .hoverBackground(ICON_HOVER_BG)
          .help("New workspace in this project")
          .onTap(create),
      ]).showOnHover(),
    ]).layoutPriority(2),
  ])
    .paddingLeading(8)
    .paddingTrailing(8)
    .paddingVertical(4)
    .cornerRadius(8)
    .background(() => (lifted() ? DRAG_BG : hasSelected() ? SELECTED_BG : null))
    .borderColor(() => (lifted() ? "accent" : "clear"))
    .borderWidth(1)
    .hoverBackground(() => (lifted() ? DRAG_BG : hasSelected() ? SELECTED_BG : HOVER_BG))
    .frame({ maxWidth: "infinity" })
    .onTap(() => toggleCollapse(key))
    .contextMenu([
      Button(() => (closed() ? "Expand" : "Collapse"), () => toggleCollapse(key)),
      Button("New Workspace Here", create),
      Button(() => (allPinned() ? "Unpin Project" : "Pin Project to Top"), togglePin),
      Button("Mark All Read", () => {
        for (const w of g().members) if ((w.unread ?? 0) > 0) cmux("workspace.action", { action: "mark_read", workspace_id: w.id });
      }),
      Divider(),
      Button("Move Project Up", () => moveGroup(key, "up")),
      Button("Move Project Down", () => moveGroup(key, "down")),
      Button("Move Project to Top", () => moveGroup(key, "top")),
      Button("Move Project to Bottom", () => moveGroup(key, "bottom")),
    ]);
  // The project's drag handle is this whole root: .block makes the host lift
  // the header together with its workspace rows; .fixed keeps it from being
  // dropped "into" another project as a plain row.
  return VStack({ alignment: "leading", spacing: 0 }, [dropLine, content])
    .frame({ maxWidth: "infinity" })
    .dragBackground(DRAG_BG)
    .fixed()
    .block(blockId(key));
}

// --- summary line (plain text, only while something needs you) --------------------------
function summaryLine() {
  const sum = () => summarize(data.workspaces() ?? []);
  const jump = () => {
    const ws = data.workspaces() ?? [];
    const target = ws.find((w) => attention(w).needs) ?? ws.find((w) => (w.unread ?? 0) > 0);
    if (target) selectWorkspace(target.id);
  };
  return when(() => sum().level !== "none", () =>
    HStack({ spacing: 8 }, [
      Text(() => (sum().needs > 0 ? "! " + sum().needs + " need input" : ""))
        .font(11).weight("semibold").color(NEEDS).fixedSize(),
      Text(() => (sum().withUnread > 0 ? sum().withUnread + " unread" : ""))
        .font(11).weight("semibold").color(UNREAD).fixedSize(),
      Spacer({ minLength: 0 }),
    ])
      .paddingLeading(8)
      .paddingTrailing(8)
      .paddingVertical(2)
      .cornerRadius(6)
      .hoverBackground(HOVER_BG)
      .frame({ maxWidth: "infinity" })
      .help("Jump to the first one")
      .onTap(jump)
  );
}

// --- root ---------------------------------------------------------------------------------
sidebar(() =>
  VStack({ alignment: "leading", spacing: 4 }, [
    summaryLine(),
    Reorderable(
      { items: flatEntries, key: (e) => e.id, spacing: 2, onMove: handleMove, onDragChange: setDrag },
      (e) => {
        const entry = e(); // kind and ids are stable per key
        if (entry.kind === "header") return groupHeader(entry.groupKey);
        const w = () => (data.workspaces() ?? []).find((x) => x.id === entry.wsId);
        return workspaceRow(w, entry.groupKey);
      }
    ),
    // Drop line for "after the last project" (constant 2pt, no layout change).
    Rectangle()
      .fill(() => (dropTarget() === "end" ? "accent" : "clear"))
      .cornerRadius(1)
      .frame({ maxWidth: "infinity", height: 2 })
      .paddingHorizontal(8),
  ]),
  { surface: "glass" }
)
