// Qwixx Solo PWA vs CPU (Option A: End Turn triggers CPU)
// - Play vs CPU toggle
// - End Turn button runs CPU move after your turn
// - Two boards rendered (You interactive, CPU read-only)
// - Hints toggle affects highlights on YOUR board only

const STORAGE_KEY = "qwixx_solo_cpu_state_v1";

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

document.getElementById("btnRoll").addEventListener("click", rollDice);
document.getElementById("btnEndTurn").addEventListener("click", endTurn);
document.getElementById("btnPenalty").addEventListener("click", addPenalty);
document.getElementById("btnUndo").addEventListener("click", undo);
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

    // Players[0] = You, Players[1] = CPU (if vsCpu)
    players: [
      { name: "You", isCpu: false, rows: emptyRowsState(), penalties: 0, lockedCount: 0 }
    ],

    rollCount: 0,
    lastRolledAt: null,

    // Turn gating
    phase: "idle" // "idle" | "awaiting_player" | "awaiting_cpu" | "ended"
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
    // solo mode: keep only You
    state.players = [state.players?.[0] ?? { name: "You", isCpu: false, rows: emptyRowsState(), penalties: 0, lockedCount: 0 }];
  }
}

function resetGame() {
  if (!confirm("Start a new game? This clears your boards.")) return;
  history = [];
  lastRoll = null;

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
  history.push(JSON.stringify({ state, lastRoll }));
  if (history.length > 80) history.shift();
}

function undo() {
  const snap = history.pop();
  if (!snap) return;
  const parsed = JSON.parse(snap);
  state = parsed.state;
  lastRoll = parsed.lastRoll;
  saveState();
  renderAll();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Backfill flags
    if (typeof parsed.hintsEnabled !== "boolean") parsed.hintsEnabled = true;
    if (typeof parsed.vsCpu !== "boolean") parsed.vsCpu = false;
    if (!parsed.players || !Array.isArray(parsed.players) || parsed.players.length === 0) {
      parsed.players = [{ name: "You", isCpu: false, rows: emptyRowsState(), penalties: 0, lockedCount: 0 }];
    }

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

/* ------------------ legal targets (per-player) ------------------ */

function getLegalTargetsForPlayer(p, chosenColorKey) {
  const targets = new Set();
  if (!lastRoll) return targets;

  const whiteSum = lastRoll.white1 + lastRoll.white2;

  // Action 1: any row, exact whiteSum
  for (const r of ROWS) {
    if (canMark(p, r.key, whiteSum)) targets.add(`${r.key}:${whiteSum}`);
  }

  // Action 2: chosen color row, using ONE white + color
  const c = chosenColorKey;
  if (c && lastRoll[c] !== null) {
    const a = lastRoll.white1 + lastRoll[c];
    const b = lastRoll.white2 + lastRoll[c];
    if (canMark(p, c, a)) targets.add(`${c}:${a}`);
    if (canMark(p, c, b)) targets.add(`${c}:${b}`);
  }

  return targets;
}

/* ------------------ marking (player vs cpu) ------------------ */

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

  if (canMark(you, rowKey, num)) {
    if (!lastRoll) return `Roll dice first.`;
    const legal = getLegalTargetsForPlayer(you, state.youChosenColor);
    if (!legal.has(`${rowKey}:${num}`)) {
      const whiteSum = lastRoll.white1 + lastRoll.white2;
      return `Not legal for this roll. (Action 1 = ${whiteSum})`;
    }
  }

  return `Not legal.`;
}

function markNumberYou(rowKey, num) {
  const you = state.players[0];

  // Must be during your phase
  if (state.phase !== "awaiting_player") {
    showToast("Roll first, then play your turn.");
    return false;
  }

  const legalNow = getLegalTargetsForPlayer(you, state.youChosenColor);
  const isLegalRollTarget = legalNow.has(`${rowKey}:${num}`);

  if (!canMark(you, rowKey, num) || (lastRoll && !isLegalRollTarget)) {
    showToast(explainIllegalTapYou(rowKey, num));
    return false;
  }

  snapshot();

  you.rows[rowKey].marked[num] = true;
  elChkDidMark.checked = true;

  // lock if end marked
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

function addPenalty() {
  const you = state.players[0];
  snapshot();
  you.penalties = Math.min(4, you.penalties + 1);
  saveState();
  renderAll();
}

/* ------------------ turn flow ------------------ */

function rollDice() {
  // Only roll when idle or after cpu finished, not mid-player/cpu step
  if (state.phase === "awaiting_player" || state.phase === "awaiting_cpu") {
    showToast("Finish the current turn first (End Turn).");
    return;
  }

  snapshot();

  // Locked dice per PLAYER, but dice are shared; in Qwixx, colored dice still roll even if your row is locked.
  // We’ll keep existing behavior: if a row is locked for a player, that player just can’t mark there.
  lastRoll = {
    white1: randDie(),
    white2: randDie(),
    red: randDie(),
    yellow: randDie(),
    green: randDie(),
    blue: randDie()
  };

  state.rollCount = (state.rollCount || 0) + 1;
  state.lastRolledAt = Date.now();

  // Your chosen color die for Action 2 (you select by tapping a die)
  state.youChosenColor = null;

  elChkDidMark.checked = false;

  // Start player phase
  state.phase = "awaiting_player";

  saveState();
  renderAll();
  flashDice();
}

function endTurn() {
  if (state.phase !== "awaiting_player") {
    showToast("Roll first, then End Turn.");
    return;
  }

  const you = state.players[0];

  // If user didn't mark anything, they should take penalty (we prompt rather than auto)
  if (!elChkDidMark.checked) {
    const ok = confirm("You said you did NOT mark a number. Take a penalty?");
    if (ok) {
      snapshot();
      you.penalties = Math.min(4, you.penalties + 1);
    }
  }

  if (!state.vsCpu) {
    // solo: just go back to idle
    state.phase = "idle";
    saveState();
    renderAll();
    return;
  }

  // CPU phase
  snapshot();
  state.phase = "awaiting_cpu";
  saveState();
  renderAll();

  cpuPlayTurn();

  // back to idle after cpu
  state.phase = "idle";
  saveState();
  renderAll();
}

function flashDice() {
  elDiceRow.classList.remove("rolled");
  void elDiceRow.offsetWidth;
  elDiceRow.classList.add("rolled");
}

/* ------------------ CPU strategy ------------------ */

function cpuPlayTurn() {
  const cpu = state.players[1];
  if (!cpu) return;
  if (!lastRoll) return;

  let didMark = false;

  // Action 1: try to mark white sum on best row (furthest progress)
  const whiteSum = lastRoll.white1 + lastRoll.white2;
  const a1Candidates = [];
  for (const r of ROWS) {
    if (canMark(cpu, r.key, whiteSum)) {
      const idx = r.nums.indexOf(whiteSum);
      a1Candidates.push({ rowKey: r.key, num: whiteSum, idx, lock: (whiteSum === r.end) });
    }
  }
  if (a1Candidates.length) {
    a1Candidates.sort((x,y) => (y.lock - x.lock) || (y.idx - x.idx));
    const pick = a1Candidates[0];
    applyCpuMark(cpu, pick.rowKey, pick.num);
    didMark = true;
  }

  // Action 2: choose best color + sum (try lock first, else furthest progress)
  const colorKeys = ["red","yellow","green","blue"];
  const a2Candidates = [];

  for (const c of colorKeys) {
    // two sums (white1+color, white2+color)
    const colorVal = lastRoll[c];
    const s1 = lastRoll.white1 + colorVal;
    const s2 = lastRoll.white2 + colorVal;

    for (const s of [s1, s2]) {
      if (canMark(cpu, c, s)) {
        const r = ROWS.find(x => x.key === c);
        const idx = r.nums.indexOf(s);
        a2Candidates.push({ rowKey: c, num: s, idx, lock: (s === r.end) });
      }
    }
  }

  if (a2Candidates.length) {
    a2Candidates.sort((x,y) => (y.lock - x.lock) || (y.idx - x.idx));
    const pick = a2Candidates[0];
    applyCpuMark(cpu, pick.rowKey, pick.num);
    didMark = true;
  }

  // If CPU can't mark anything, take a penalty
  if (!didMark) {
    cpu.penalties = Math.min(4, cpu.penalties + 1);
  }
}

function applyCpuMark(cpu, rowKey, num) {
  cpu.rows[rowKey].marked[num] = true;

  const r = ROWS.find(x => x.key === rowKey);
  if (num === r.end && !cpu.rows[rowKey].locked) {
    cpu.rows[rowKey].locked = true;
    cpu.lockedCount += 1;
  }
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

  for (const d of dice) {
    const wrap = document.createElement("div");
    wrap.className = "dieWrap";

    const die = document.createElement("div");
    die.className = `die ${d.cls}`;
    die.textContent = String(d.v);

    // Your Action 2 die selection
    if (["red","yellow","green","blue"].includes(d.k)) {
      die.style.cursor = "pointer";
      die.title = "Tap to select for your Action 2";
      if (state.youChosenColor === d.k) die.classList.add("selected");

      die.addEventListener("click", () => {
        if (state.phase !== "awaiting_player") {
          showToast("Select a color after you roll (during your turn).");
          return;
        }
        state.youChosenColor = (state.youChosenColor === d.k) ? null : d.k;
        saveState();
        renderAll();
      });
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
  if (state.phase === "awaiting_player") {
    elTurnHint.textContent = state.vsCpu
      ? "Your turn: mark any legal moves, then press End Turn for CPU."
      : "Your turn: mark any legal moves, then press End Turn to continue.";
  } else if (state.phase === "idle") {
    elTurnHint.textContent = "Tap Roll to start the next turn.";
  } else if (state.phase === "awaiting_cpu") {
    elTurnHint.textContent = "CPU is playing…";
  } else {
    elTurnHint.textContent = "";
  }
}

function renderScores() {
  const you = state.players[0];
  const ys = scoreForPlayer(you);

  if (!state.vsCpu) {
    elScoreLine.innerHTML = `
      <span class="scorepill">You: <strong>${ys.total}</strong> (Pen ${ys.pen})</span>
    `;
    return;
  }

  const cpu = state.players[1];
  const cs = scoreForPlayer(cpu);

  elScoreLine.innerHTML = `
    <span class="scorepill">You: <strong>${ys.total}</strong> (Pen ${ys.pen})</span>
    <span class="scorepill">CPU: <strong>${cs.total}</strong> (Pen ${cs.pen})</span>
  `;
}

function renderBoards() {
  elBoards.innerHTML = "";
  ensurePlayers();

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

  // highlights only for YOU and only if hints enabled
  const showHints = isYou && !!state.hintsEnabled && state.phase === "awaiting_player";
  const legal = showHints ? getLegalTargetsForPlayer(p, state.youChosenColor) : new Set();

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

    // Row reset only for YOU
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

  state.phase = "ended";

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

  saveState();
}

function renderAll() {
  ensurePlayers();

  // sync checkboxes
  if (elChkHints) elChkHints.checked = !!state.hintsEnabled;
  if (elChkVsCpu) elChkVsCpu.checked = !!state.vsCpu;

  renderRollMeta();
  renderDice();
  renderSums();
  renderTurnHint();
  renderScores();
  renderBoards();
  renderEndCheck();
}
