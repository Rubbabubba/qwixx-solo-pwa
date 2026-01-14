// Qwixx vs CPU (Correct rule flow + CPU roll visible on End Turn)
// Flow:
// idle -> Roll (YOU roll) -> you_roll
// you_roll -> End Turn -> CPU roll happens NOW (dice change), CPU plays -> cpu_roll_response
// cpu_roll_response -> Done -> idle
//
// Fix in this version:
// - End Turn ALWAYS generates a fresh CPU roll and re-renders so dice visibly change.
// - Adds toast "CPU rolled" + dice flash to make it obvious.

const STORAGE_KEY = "qwixx_cpu_rules_state_v3";

const SCORE_TABLE = {
  0: 0, 1: 1, 2: 3, 3: 6, 4: 10, 5: 15, 6: 21,
  7: 28, 8: 36, 9: 45, 10: 55, 11: 66, 12: 78
};

const ROWS = [
  { key: "red",    label: "Red",    color: "red",    nums: [2,3,4,5,6,7,8,9,10,11,12], end: 12 },
  { key: "yellow", label: "Yellow", color: "yellow", nums: [2,3,4,5,6,7,8,9,10,11,12], end: 12 },
  { key: "green",  label: "Green",  color: "green",  nums: [12,11,10,9,8,7,6,5,4,3,2], end: 2  },
  { key: "blue",   label: "Blue",   color: "blue",   nums: [12,11,10,9,8,7,6,5,4,3,2], end: 2  }
];

let state = loadState() ?? newGameState();
let history = [];
let lastRoll = null;
let rollOwner = null; // "YOU" | "CPU"

const elDiceRow = document.getElementById("diceRow");
const elBoards  = document.getElementById("boards");
const elSumWhite = document.getElementById("sumWhite");
const elSumColor = document.getElementById("sumColor");
const elChkDidMark = document.getElementById("chkDidMark");
const elChkHints = document.getElementById("chkHints");
const elChkVsCpu = document.getElementById("chkVsCpu");
const elGameEnd = document.getElementById("gameEnd");
const elToast = document.getElementById("toast");
const elRollBadge = document.getElementById("rollBadge");
const elRollTime = document.getElementById("rollTime");
const elTurnHint = document.getElementById("turnHint");
const elScoreLine = document.getElementById("scoreLine");
const elCpuLogWrap = document.getElementById("cpuLogWrap");
const elCpuLog = document.getElementById("cpuLog");

const btnRoll = document.getElementById("btnRoll");
const btnEndTurn = document.getElementById("btnEndTurn");
const btnDone = document.getElementById("btnDone");
const btnPenalty = document.getElementById("btnPenalty");

btnRoll.addEventListener("click", rollDice);
btnEndTurn.addEventListener("click", endTurn);
btnDone.addEventListener("click", doneAfterCpu);
document.getElementById("btnUndo").addEventListener("click", undo);
btnPenalty.addEventListener("click", addPenalty);
document.getElementById("btnNew").addEventListener("click", resetGame);

if (elChkHints) {
  elChkHints.checked = !!state.hintsEnabled;
  elChkHints.addEventListener("change", () => {
    state.hintsEnabled = !!elChkHints.checked;
    saveState();
    renderAll();
  });
}

if (elChkVsCpu) {
  elChkVsCpu.checked = !!state.vsCpu;
  elChkVsCpu.addEventListener("change", () => {
    snapshot();
    state.vsCpu = !!elChkVsCpu.checked;
    ensurePlayers();
    // reset cycle cleanly
    state.phase = "idle";
    lastRoll = null;
    rollOwner = null;
    state.youChosenColor = null;
    state.youRespondedToCpu = false;
    state.youMarkedThisRoll = false;
    saveState();
    renderAll();
  });
}

renderAll();

/* ------------------ state model ------------------ */

function emptyRowsState() {
  const rows = {};
  for (const r of ROWS) rows[r.key] = { marked: {}, locked: false };
  return rows;
}

function newGameState() {
  return {
    vsCpu: false,
    hintsEnabled: true,
    players: [
      { name: "You", isCpu: false, rows: emptyRowsState(), penalties: 0, lockedCount: 0 }
    ],
    rollCount: 0,
    lastRolledAt: null,

    youChosenColor: null,

    // Phases: idle | you_roll | cpu_roll_response | ended
    phase: "idle",

    youMarkedThisRoll: false,
    youRespondedToCpu: false,

    cpuLog: []
  };
}

function ensurePlayers() {
  if (state.vsCpu) {
    if (!state.players || state.players.length < 2) {
      const you = state.players?.[0] ?? { name: "You", isCpu: false, rows: emptyRowsState(), penalties: 0, lockedCount: 0 };
      state.players = [
        you,
        { name: "CPU", isCpu: true, rows: emptyRowsState(), penalties: 0, lockedCount: 0 }
      ];
    }
  } else {
    state.players = [state.players?.[0] ?? { name: "You", isCpu: false, rows: emptyRowsState(), penalties: 0, lockedCount: 0 }];
  }
}

function resetGame() {
  if (!confirm("Start a new game? This clears your boards.")) return;
  history = [];
  lastRoll = null;
  rollOwner = null;

  const keepHints = !!state.hintsEnabled;
  const keepVsCpu = !!state.vsCpu;

  state = newGameState();
  state.hintsEnabled = keepHints;
  state.vsCpu = keepVsCpu;
  ensurePlayers();

  saveState();
  renderAll();
}

/* ------------------ persistence & undo ------------------ */

function snapshot() {
  history.push(JSON.stringify({ state, lastRoll, rollOwner }));
  if (history.length > 140) history.shift();
}

function undo() {
  const snap = history.pop();
  if (!snap) return;
  const parsed = JSON.parse(snap);
  state = parsed.state;
  lastRoll = parsed.lastRoll;
  rollOwner = parsed.rollOwner;
  saveState();
  renderAll();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    if (typeof parsed.hintsEnabled !== "boolean") parsed.hintsEnabled = true;
    if (typeof parsed.vsCpu !== "boolean") parsed.vsCpu = false;
    if (!parsed.players || !Array.isArray(parsed.players) || parsed.players.length === 0) {
      parsed.players = [{ name: "You", isCpu: false, rows: emptyRowsState(), penalties: 0, lockedCount: 0 }];
    }
    if (!Array.isArray(parsed.cpuLog)) parsed.cpuLog = [];
    if (!parsed.phase) parsed.phase = "idle";
    if (typeof parsed.youMarkedThisRoll !== "boolean") parsed.youMarkedThisRoll = false;
    if (typeof parsed.youRespondedToCpu !== "boolean") parsed.youRespondedToCpu = false;
    if (typeof parsed.youChosenColor !== "string" && parsed.youChosenColor !== null) parsed.youChosenColor = null;

    state = parsed;
    ensurePlayers();
    return state;
  } catch { return null; }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function randDie() {
  return 1 + Math.floor(Math.random() * 6);
}

function makeRoll() {
  return {
    white1: randDie(),
    white2: randDie(),
    red: randDie(),
    yellow: randDie(),
    green: randDie(),
    blue: randDie()
  };
}

/* ------------------ toast ------------------ */

let toastTimer = null;
function showToast(msg) {
  if (!elToast) return;
  elToast.textContent = msg;
  elToast.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elToast.classList.add("hidden"), 1400);
}

/* ------------------ rules helpers (per-player) ------------------ */

function countMarks(p, rowKey) {
  return Object.keys(p.rows[rowKey].marked).length;
}

function getRowAllowedIndex(p, rowKey) {
  const r = ROWS.find(x => x.key === rowKey);
  const marked = p.rows[rowKey].marked;
  let lastIndex = -1;
  for (let i = 0; i < r.nums.length; i++) {
    if (marked[r.nums[i]]) lastIndex = i;
  }
  return lastIndex + 1;
}

function canMark(p, rowKey, num) {
  const r = ROWS.find(x => x.key === rowKey);
  const rowState = p.rows[rowKey];
  if (rowState.locked) return false;
  if (rowState.marked[num]) return false;

  const idx = r.nums.indexOf(num);
  if (idx === -1) return false;

  const allowedFrom = getRowAllowedIndex(p, rowKey);
  if (idx < allowedFrom) return false;

  if (num === r.end) {
    if (countMarks(p, rowKey) < 5) return false;
  }
  return true;
}

/* ------------------ legal targets by context ------------------ */

function legalTargetsYourRoll(p) {
  const targets = new Set();
  if (!lastRoll) return targets;

  const whiteSum = lastRoll.white1 + lastRoll.white2;
  for (const r of ROWS) {
    if (canMark(p, r.key, whiteSum)) targets.add(`${r.key}:${whiteSum}`);
  }

  const c = state.youChosenColor;
  if (c) {
    const a = lastRoll.white1 + lastRoll[c];
    const b = lastRoll.white2 + lastRoll[c];
    if (canMark(p, c, a)) targets.add(`${c}:${a}`);
    if (canMark(p, c, b)) targets.add(`${c}:${b}`);
  }
  return targets;
}

function legalTargetsCpuResponse(p) {
  const targets = new Set();
  if (!lastRoll) return targets;

  const whiteSum = lastRoll.white1 + lastRoll.white2;
  for (const r of ROWS) {
    if (canMark(p, r.key, whiteSum)) targets.add(`${r.key}:${whiteSum}`);
  }
  return targets;
}

/* ------------------ marking (YOU) ------------------ */

function explainIllegalTapYou(rowKey, num) {
  const you = state.players[0];
  const r = ROWS.find(x => x.key === rowKey);
  const rowState = you.rows[rowKey];

  if (rowState.locked) return `${r.label} is locked.`;
  if (rowState.marked[num]) return `${num} is already marked.`;

  const idx = r.nums.indexOf(num);
  if (idx === -1) return `Not a valid number for ${r.label}.`;

  const allowedFrom = getRowAllowedIndex(you, rowKey);
  if (idx < allowedFrom) return `Must go left → right in ${r.label}.`;

  if (num === r.end && countMarks(you, rowKey) < 5) return `Need 5 marks in ${r.label} before you can lock.`;

  if (!lastRoll) return `Roll dice first.`;

  if (state.phase === "you_roll") {
    const legal = legalTargetsYourRoll(you);
    if (!legal.has(`${rowKey}:${num}`)) {
      const whiteSum = lastRoll.white1 + lastRoll.white2;
      return `Not legal for this roll. (White sum = ${whiteSum})`;
    }
  } else if (state.phase === "cpu_roll_response") {
    const legal = legalTargetsCpuResponse(you);
    if (!legal.has(`${rowKey}:${num}`)) {
      const whiteSum = lastRoll.white1 + lastRoll.white2;
      return `CPU turn response: you may only use White sum = ${whiteSum}.`;
    }
  } else {
    return "Roll first.";
  }

  return `Not legal.`;
}

function markNumberYou(rowKey, num) {
  const you = state.players[0];

  if (state.phase !== "you_roll" && state.phase !== "cpu_roll_response") {
    showToast("Roll first.");
    return false;
  }

  if (!canMark(you, rowKey, num)) {
    showToast(explainIllegalTapYou(rowKey, num));
    return false;
  }

  if (state.phase === "you_roll") {
    const legal = legalTargetsYourRoll(you);
    if (!legal.has(`${rowKey}:${num}`)) {
      showToast(explainIllegalTapYou(rowKey, num));
      return false;
    }
  }

  if (state.phase === "cpu_roll_response") {
    if (state.youRespondedToCpu) {
      showToast("You already responded to this CPU roll.");
      return false;
    }
    const legal = legalTargetsCpuResponse(you);
    if (!legal.has(`${rowKey}:${num}`)) {
      showToast(explainIllegalTapYou(rowKey, num));
      return false;
    }
  }

  snapshot();

  you.rows[rowKey].marked[num] = true;

  if (state.phase === "you_roll") {
    state.youMarkedThisRoll = true;
    elChkDidMark.checked = true;
  } else {
    state.youRespondedToCpu = true;
  }

  const r = ROWS.find(x => x.key === rowKey);
  if (num === r.end && !you.rows[rowKey].locked) {
    you.rows[rowKey].locked = true;
    you.lockedCount += 1;
    if (state.youChosenColor === rowKey) state.youChosenColor = null;
  }

  saveState();
  renderAll();
  return true;
}

/* ------------------ penalty (YOU) ------------------ */

function addPenalty() {
  const you = state.players[0];

  snapshot();
  you.penalties = Math.min(4, you.penalties + 1);

  // If you took a penalty on your roll, treat it as "acted"
  if (state.phase === "you_roll") {
    state.youMarkedThisRoll = true;
    elChkDidMark.checked = true;
  }

  saveState();
  renderAll();
}

/* ------------------ CPU strategy + logging ------------------ */

function cpuPlayTurn() {
  const cpu = state.players[1];
  if (!cpu || !lastRoll) return { marks: [], tookPenalty: false };

  const marks = [];
  let didMark = false;

  // Action 1
  const whiteSum = lastRoll.white1 + lastRoll.white2;
  const a1 = [];
  for (const r of ROWS) {
    if (canMark(cpu, r.key, whiteSum)) {
      const idx = r.nums.indexOf(whiteSum);
      a1.push({ rowKey: r.key, num: whiteSum, idx, lock: (whiteSum === r.end) });
    }
  }
  if (a1.length) {
    a1.sort((x,y) => (y.lock - x.lock) || (y.idx - x.idx));
    applyCpuMark(cpu, a1[0].rowKey, a1[0].num);
    marks.push(`${cap(a1[0].rowKey)} ${a1[0].num}`);
    didMark = true;
  }

  // Action 2
  const a2 = [];
  for (const c of ["red","yellow","green","blue"]) {
    const colorVal = lastRoll[c];
    const s1 = lastRoll.white1 + colorVal;
    const s2 = lastRoll.white2 + colorVal;
    const r = ROWS.find(x => x.key === c);

    for (const s of [s1, s2]) {
      if (canMark(cpu, c, s)) {
        const idx = r.nums.indexOf(s);
        a2.push({ rowKey: c, num: s, idx, lock: (s === r.end) });
      }
    }
  }
  if (a2.length) {
    a2.sort((x,y) => (y.lock - x.lock) || (y.idx - x.idx));
    applyCpuMark(cpu, a2[0].rowKey, a2[0].num);
    marks.push(`${cap(a2[0].rowKey)} ${a2[0].num}`);
    didMark = true;
  }

  let tookPenalty = false;
  if (!didMark) {
    cpu.penalties = Math.min(4, cpu.penalties + 1);
    tookPenalty = true;
  }

  return { marks, tookPenalty };
}

function applyCpuMark(cpu, rowKey, num) {
  cpu.rows[rowKey].marked[num] = true;
  const r = ROWS.find(x => x.key === rowKey);
  if (num === r.end && !cpu.rows[rowKey].locked) {
    cpu.rows[rowKey].locked = true;
    cpu.lockedCount += 1;
  }
}

function pushCpuLog(move) {
  const whiteSum = lastRoll.white1 + lastRoll.white2;
  const diceStr = `W:${lastRoll.white1}+${lastRoll.white2}=${whiteSum} | R:${lastRoll.red} Y:${lastRoll.yellow} G:${lastRoll.green} B:${lastRoll.blue}`;

  let msg = `CPU rolled (${diceStr}) → `;
  if (move.tookPenalty) msg += `took a penalty.`;
  else if (move.marks.length) msg += `marked: ${move.marks.join(", ")}.`;
  else msg += `did nothing.`;

  state.cpuLog.unshift({ t: Date.now(), text: msg });
  state.cpuLog = state.cpuLog.slice(0, 12);
}

/* ------------------ turn flow (FIXED) ------------------ */

function rollDice() {
  if (state.phase !== "idle") {
    showToast("Finish the current cycle first.");
    return;
  }
  snapshot();

  lastRoll = makeRoll();
  rollOwner = "YOU";

  state.rollCount = (state.rollCount || 0) + 1;
  state.lastRolledAt = Date.now();

  state.youChosenColor = null;
  state.youMarkedThisRoll = false;
  state.youRespondedToCpu = false;

  elChkDidMark.checked = false;

  state.phase = "you_roll";

  saveState();
  renderAll();
  flashDice();
}

function endTurn() {
  if (state.phase !== "you_roll") {
    showToast("End Turn is only after your roll.");
    return;
  }

  const you = state.players[0];

  // penalty reminder if you did nothing
  if (!state.youMarkedThisRoll && !elChkDidMark.checked) {
    const ok = confirm("You marked nothing on your roll. Take a penalty?");
    if (ok) {
      snapshot();
      you.penalties = Math.min(4, you.penalties + 1);
    }
  }

  if (!state.vsCpu) {
    // Solo: go back idle and clear roll context
    state.phase = "idle";
    saveState();
    renderAll();
    return;
  }

  // ***** CPU ROLL MUST HAPPEN HERE *****
  snapshot();

  lastRoll = makeRoll();         // <-- NEW dice values
  rollOwner = "CPU";

  state.rollCount = (state.rollCount || 0) + 1;
  state.lastRolledAt = Date.now();

  // CPU plays immediately on its roll
  const cpuMoves = cpuPlayTurn();
  pushCpuLog(cpuMoves);

  // Now you may optionally respond with white sum only
  state.phase = "cpu_roll_response";
  state.youChosenColor = null;
  state.youRespondedToCpu = false;

  saveState();

  // Render IMMEDIATELY so the dice visibly change
  renderAll();
  flashDice();
  showToast("CPU rolled — you may respond with White sum or press Done.");
}

function doneAfterCpu() {
  if (state.phase !== "cpu_roll_response") {
    showToast("Done is only after CPU roll.");
    return;
  }
  state.phase = "idle";
  saveState();
  renderAll();
}

function flashDice() {
  elDiceRow.classList.remove("rolled");
  void elDiceRow.offsetWidth;
  elDiceRow.classList.add("rolled");
}

/* ------------------ scoring & end ------------------ */

function scoreForPlayer(p) {
  const red = SCORE_TABLE[countMarks(p, "red")] ?? 0;
  const yellow = SCORE_TABLE[countMarks(p, "yellow")] ?? 0;
  const green = SCORE_TABLE[countMarks(p, "green")] ?? 0;
  const blue = SCORE_TABLE[countMarks(p, "blue")] ?? 0;
  const pen = p.penalties * -5;
  const total = red + yellow + green + blue + pen;
  return { red, yellow, green, blue, pen, total };
}

function checkEndedForPlayer(p) {
  return (p.penalties >= 4) || (p.lockedCount >= 2);
}

/* ------------------ render ------------------ */

function renderRollMeta() {
  const n = state.rollCount || 0;
  elRollBadge.textContent = n ? `ROLL #${n}` : "—";
  if (!state.lastRolledAt) {
    elRollTime.textContent = "";
    return;
  }
  const d = new Date(state.lastRolledAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  elRollTime.textContent = `${hh}:${mm}:${ss}`;
}

function renderDice() {
  elDiceRow.innerHTML = "";
  if (!lastRoll) {
    elDiceRow.innerHTML = `<div class="muted">Tap “Roll” to start.</div>`;
    return;
  }

  const dice = [
    { k: "white1", v: lastRoll.white1, cls: "white", label: "W1" },
    { k: "white2", v: lastRoll.white2, cls: "white", label: "W2" },
    { k: "red", v: lastRoll.red, cls: "red", label: "R" },
    { k: "yellow", v: lastRoll.yellow, cls: "yellow", label: "Y" },
    { k: "green", v: lastRoll.green, cls: "green", label: "G" },
    { k: "blue", v: lastRoll.blue, cls: "blue", label: "B" }
  ];

  const colorSelectionEnabled = (state.phase === "you_roll" && rollOwner === "YOU");

  for (const d of dice) {
    const wrap = document.createElement("div");
    wrap.className = "dieWrap";

    const die = document.createElement("div");
    die.className = `die ${d.cls}`;
    die.textContent = String(d.v);

    if (["red","yellow","green","blue"].includes(d.k)) {
      if (!colorSelectionEnabled) {
        die.classList.add("disabled");
      } else {
        die.style.cursor = "pointer";
        die.title = "Tap to select for Action 2 (your roll)";
        if (state.youChosenColor === d.k) die.classList.add("selected");
        die.addEventListener("click", () => {
          state.youChosenColor = (state.youChosenColor === d.k) ? null : d.k;
          saveState();
          renderAll();
        });
      }
    }

    const lab = document.createElement("div");
    lab.className = "dieLabel";
    lab.textContent = d.label;

    wrap.appendChild(die);
    wrap.appendChild(lab);
    elDiceRow.appendChild(wrap);
  }
}

function renderSums() {
  if (!lastRoll) {
    elSumWhite.textContent = "—";
    elSumColor.textContent = "—";
    return;
  }

  const whiteSum = lastRoll.white1 + lastRoll.white2;
  elSumWhite.textContent = String(whiteSum);

  if (state.phase !== "you_roll" || rollOwner !== "YOU") {
    elSumColor.textContent = "Only on your roll";
    return;
  }

  const c = state.youChosenColor;
  if (!c) {
    elSumColor.textContent = "Tap a color die";
    return;
  }

  const a = lastRoll.white1 + lastRoll[c];
  const b = lastRoll.white2 + lastRoll[c];
  elSumColor.textContent = `${c.toUpperCase()}: ${a} (W1) / ${b} (W2)`;
}

function renderTurnHint() {
  if (state.phase === "idle") {
    elTurnHint.textContent = "Tap Roll to start your turn.";
  } else if (state.phase === "you_roll") {
    elTurnHint.textContent = state.vsCpu
      ? "Your roll: optionally use White sum and/or White+Color. Then End Turn to trigger CPU roll."
      : "Your roll: optionally use White sum and/or White+Color. End Turn when done.";
  } else if (state.phase === "cpu_roll_response") {
    const whiteSum = lastRoll ? (lastRoll.white1 + lastRoll.white2) : "—";
    elTurnHint.textContent = `CPU rolled. You may optionally mark ONE White-sum (${whiteSum}) on your board, then press Done.`;
  } else {
    elTurnHint.textContent = "";
  }
}

function renderButtons() {
  btnRoll.disabled = (state.phase !== "idle");
  btnEndTurn.disabled = (state.phase !== "you_roll");
  btnDone.disabled = (state.phase !== "cpu_roll_response");
  btnPenalty.disabled = false;
}

function renderScores() {
  ensurePlayers();
  const you = state.players[0];
  const ys = scoreForPlayer(you);

  if (!state.vsCpu) {
    elScoreLine.innerHTML = `<span class="scorepill">You: <strong>${ys.total}</strong> (Pen ${ys.pen})</span>`;
    return;
  }

  const cpu = state.players[1];
  const cs = scoreForPlayer(cpu);

  elScoreLine.innerHTML = `
    <span class="scorepill">You: <strong>${ys.total}</strong> (Pen ${ys.pen})</span>
    <span class="scorepill">CPU: <strong>${cs.total}</strong> (Pen ${cs.pen})</span>
  `;
}

function renderCpuLog() {
  if (!state.vsCpu || !state.cpuLog.length) {
    elCpuLogWrap.classList.add("hidden");
    elCpuLog.innerHTML = "";
    return;
  }

  elCpuLogWrap.classList.remove("hidden");
  elCpuLog.innerHTML = "";

  for (const item of state.cpuLog) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `<strong>${fmtTime(item.t)}</strong> — ${escapeHtml(item.text)}`;
    elCpuLog.appendChild(div);
  }
}

function renderBoards() {
  ensurePlayers();
  elBoards.innerHTML = "";

  const grid = document.createElement("div");
  grid.className = "boards-grid";
  grid.appendChild(renderBoard(0));
  if (state.vsCpu) grid.appendChild(renderBoard(1));
  elBoards.appendChild(grid);
}

function renderBoard(playerIndex) {
  const p = state.players[playerIndex];
  const isYou = (playerIndex === 0);

  const boardWrap = document.createElement("div");

  const header = document.createElement("div");
  header.className = "board-header";

  const title = document.createElement("div");
  title.className = "board-title";
  title.innerHTML = `<strong>${p.name}</strong><small>${isYou ? "Tap tiles to mark" : "Auto-play"}</small>`;

  const badge = document.createElement("span");
  badge.className = "badge2" + (p.isCpu ? " cpu" : "");
  badge.textContent = p.isCpu ? "CPU" : "Player";

  header.appendChild(title);
  header.appendChild(badge);
  boardWrap.appendChild(header);

  const showHints = isYou && !!state.hintsEnabled && (state.phase === "you_roll" || state.phase === "cpu_roll_response");
  let legal = new Set();

  if (showHints && lastRoll) {
    if (state.phase === "you_roll") legal = legalTargetsYourRoll(p);
    if (state.phase === "cpu_roll_response") legal = legalTargetsCpuResponse(p);
  }

  for (const r of ROWS) {
    const rowState = p.rows[r.key];

    const wrap = document.createElement("div");
    wrap.className = "sheet-row";

    const t = document.createElement("div");
    t.className = "title";

    const left = document.createElement("div");
    left.className = "titleLeft";
    left.innerHTML = `<strong>${r.label}</strong>`;

    const marksBadge = document.createElement("span");
    marksBadge.className = "badge" + (rowState.locked ? " locked" : "");
    marksBadge.textContent = rowState.locked ? "LOCKED" : `Marks: ${countMarks(p, r.key)}`;
    left.appendChild(marksBadge);

    t.appendChild(left);

    if (isYou) {
      const resetBtn = document.createElement("button");
      resetBtn.className = "btnReset";
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", () => resetRowYou(r.key));
      t.appendChild(resetBtn);
    } else {
      const spacer = document.createElement("div");
      spacer.style.width = "64px";
      t.appendChild(spacer);
    }

    const cells = document.createElement("div");
    cells.className = "cells";

    r.nums.forEach((num) => {
      const cell = document.createElement("div");
      cell.className = `cell ${r.color}` + (num === r.end ? " end" : "");

      const marked = !!rowState.marked[num];
      if (marked) cell.classList.add("marked");

      const disabled = !canMark(p, r.key, num) && !marked;
      if (disabled) cell.classList.add("disabled");

      if (showHints && legal.has(`${r.key}:${num}`) && !marked) cell.classList.add("legal");

      cell.textContent = String(num);

      if (isYou) {
        cell.addEventListener("click", () => {
          const ok = markNumberYou(r.key, num);
          if (!ok) {
            cell.classList.add("illegal");
            setTimeout(() => cell.classList.remove("illegal"), 200);
          }
        });
      }

      cells.appendChild(cell);
    });

    wrap.appendChild(t);
    wrap.appendChild(cells);
    boardWrap.appendChild(wrap);
  }

  return boardWrap;
}

function resetRowYou(rowKey) {
  const you = state.players[0];
  const label = ROWS.find(r => r.key === rowKey)?.label ?? rowKey;
  if (!confirm(`Reset ${label} row?`)) return;

  snapshot();

  const wasLocked = you.rows[rowKey].locked;
  you.rows[rowKey].marked = {};
  you.rows[rowKey].locked = false;
  if (wasLocked) you.lockedCount = Math.max(0, you.lockedCount - 1);

  if (state.youChosenColor === rowKey) state.youChosenColor = null;

  saveState();
  renderAll();
}

function renderEndCheck() {
  const you = state.players[0];
  const endedYou = checkEndedForPlayer(you);

  let endedCpu = false;
  let cpu = null;
  if (state.vsCpu) {
    cpu = state.players[1];
    endedCpu = checkEndedForPlayer(cpu);
  }

  const ended = endedYou || endedCpu;
  if (!ended) {
    elGameEnd.classList.add("hidden");
    elGameEnd.textContent = "";
    return;
  }

  const ys = scoreForPlayer(you);
  let msg = `Game Over. You: ${ys.total}.`;

  if (state.vsCpu && cpu) {
    const cs = scoreForPlayer(cpu);
    msg += ` CPU: ${cs.total}. `;
    if (ys.total > cs.total) msg += "You win!";
    else if (ys.total < cs.total) msg += "CPU wins!";
    else msg += "Tie game!";
  }

  elGameEnd.classList.remove("hidden");
  elGameEnd.textContent = msg;

  state.phase = "ended";
  saveState();
}

function renderAll() {
  ensurePlayers();

  if (elChkHints) elChkHints.checked = !!state.hintsEnabled;
  if (elChkVsCpu) elChkVsCpu.checked = !!state.vsCpu;

  renderRollMeta();
  renderDice();
  renderSums();
  renderTurnHint();
  renderButtons();
  renderCpuLog();
  renderScores();
  renderBoards();
  renderEndCheck();
}

/* ------------------ utils ------------------ */

function fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
