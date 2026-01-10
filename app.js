// Qwixx Solo PWA (client-only). State is saved to localStorage.
// Adds:
// - Hint toggle: show/hide legal move highlights (still enforces legality either way)
// - Toast on illegal tap explaining why (and small shake)
// - Roll feedback (roll counter, timestamp, dice flash)

const STORAGE_KEY = "qwixx_solo_state_v4";

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
const elSheet   = document.getElementById("sheet");
const elSumWhite = document.getElementById("sumWhite");
const elSumColor = document.getElementById("sumColor");
const elChkDidMark = document.getElementById("chkDidMark");
const elChkHints = document.getElementById("chkHints");
const elGameEnd = document.getElementById("gameEnd");
const elToast = document.getElementById("toast");
const elRollBadge = document.getElementById("rollBadge");
const elRollTime = document.getElementById("rollTime");

document.getElementById("btnRoll").addEventListener("click", rollDice);
document.getElementById("btnPenalty").addEventListener("click", addPenalty);
document.getElementById("btnUndo").addEventListener("click", undo);
document.getElementById("btnNew").addEventListener("click", resetGame);

// Init hint checkbox from state
if (elChkHints) {
  elChkHints.checked = !!state.hintsEnabled;
  elChkHints.addEventListener("change", () => {
    state.hintsEnabled = !!elChkHints.checked;
    saveState();
    renderAll();
  });
}

renderAll();

/* ------------------ state helpers ------------------ */

function newGameState() {
  const rows = {};
  for (const r of ROWS) rows[r.key] = { marked: {}, locked: false };

  return {
    rows,
    penalties: 0,
    lockedCount: 0,
    rollCount: 0,
    lastRolledAt: null,
    hintsEnabled: true
  };
}

function resetGame() {
  if (!confirm("Start a new game? This clears your sheet.")) return;
  history = [];
  lastRoll = null;
  const keepHints = !!state.hintsEnabled;
  state = newGameState();
  state.hintsEnabled = keepHints;
  saveState();
  renderAll();
}

function snapshot() {
  history.push(JSON.stringify({ state, lastRoll }));
  if (history.length > 60) history.shift();
}

function undo() {
  const snap = history.pop();
  if (!snap) return;
  const parsed = JSON.parse(snap);
  state = parsed.state;
  lastRoll = parsed.lastRoll;

  // keep checkbox in sync
  if (elChkHints) elChkHints.checked = !!state.hintsEnabled;

  saveState();
  renderAll();
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    // Backfill hintsEnabled for older saves
    if (typeof parsed.hintsEnabled !== "boolean") parsed.hintsEnabled = true;

    return parsed;
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

/* ------------------ game logic ------------------ */

function rollDice() {
  snapshot();

  const locked = {
    red: state.rows.red.locked,
    yellow: state.rows.yellow.locked,
    green: state.rows.green.locked,
    blue: state.rows.blue.locked
  };

  lastRoll = {
    white1: randDie(),
    white2: randDie(),
    red: locked.red ? null : randDie(),
    yellow: locked.yellow ? null : randDie(),
    green: locked.green ? null : randDie(),
    blue: locked.blue ? null : randDie(),
    chosenColor: null
  };

  state.rollCount = (state.rollCount || 0) + 1;
  state.lastRolledAt = Date.now();

  elChkDidMark.checked = false;

  saveState();
  renderAll();
  flashDice();
}

function flashDice() {
  elDiceRow.classList.remove("rolled");
  void elDiceRow.offsetWidth; // reflow to restart animation
  elDiceRow.classList.add("rolled");
}

function addPenalty() {
  snapshot();
  state.penalties = Math.min(4, state.penalties + 1);
  saveState();
  renderAll();
}

function countMarks(rowKey) {
  return Object.keys(state.rows[rowKey].marked).length;
}

function getRowAllowedIndex(rowKey) {
  const r = ROWS.find(x => x.key === rowKey);
  const marked = state.rows[rowKey].marked;
  let lastIndex = -1;
  for (let i = 0; i < r.nums.length; i++) {
    if (marked[r.nums[i]]) lastIndex = i;
  }
  return lastIndex + 1;
}

function canMark(rowKey, num) {
  const r = ROWS.find(x => x.key === rowKey);
  const rowState = state.rows[rowKey];
  if (rowState.locked) return false;
  if (rowState.marked[num]) return false;

  const idx = r.nums.indexOf(num);
  if (idx === -1) return false;

  const allowedFrom = getRowAllowedIndex(rowKey);
  if (idx < allowedFrom) return false;

  if (num === r.end) {
    const count = countMarks(rowKey);
    if (count < 5) return false;
  }

  return true;
}

function explainIllegalTap(rowKey, num) {
  const r = ROWS.find(x => x.key === rowKey);
  const rowState = state.rows[rowKey];

  if (rowState.locked) return `${r.label} is locked.`;
  if (rowState.marked[num]) return `${num} is already marked.`;

  const idx = r.nums.indexOf(num);
  if (idx === -1) return `Not a valid number for ${r.label}.`;

  const allowedFrom = getRowAllowedIndex(rowKey);
  if (idx < allowedFrom) return `Must go left → right in ${r.label}.`;

  if (num === r.end && countMarks(rowKey) < 5) {
    return `Need 5 marks in ${r.label} before you can lock.`;
  }

  if (canMark(rowKey, num)) {
    if (!lastRoll) return `Roll dice first.`;
    const legal = getLegalTargets();
    if (!legal.has(`${rowKey}:${num}`)) {
      const whiteSum = lastRoll.white1 + lastRoll.white2;
      return `Not legal for this roll. (Action 1 = ${whiteSum})`;
    }
  }

  return `Not legal.`;
}

function markNumber(rowKey, num) {
  const legalNow = getLegalTargets();
  const isLegalRollTarget = legalNow.has(`${rowKey}:${num}`);

  if (!canMark(rowKey, num) || (lastRoll && !isLegalRollTarget)) {
    showToast(explainIllegalTap(rowKey, num));
    return false;
  }

  snapshot();

  state.rows[rowKey].marked[num] = true;
  elChkDidMark.checked = true;

  const r = ROWS.find(x => x.key === rowKey);
  if (num === r.end && !state.rows[rowKey].locked) {
    state.rows[rowKey].locked = true;
    state.lockedCount += 1;
    if (lastRoll && lastRoll.chosenColor === rowKey) lastRoll.chosenColor = null;
  }

  saveState();
  renderAll();
  return true;
}

function resetRow(rowKey) {
  const label = ROWS.find(r => r.key === rowKey)?.label ?? rowKey;
  if (!confirm(`Reset ${label} row?`)) return;

  snapshot();

  const wasLocked = state.rows[rowKey].locked;
  state.rows[rowKey].marked = {};
  state.rows[rowKey].locked = false;

  if (wasLocked) {
    state.lockedCount = Math.max(0, state.lockedCount - 1);
    if (lastRoll && lastRoll.chosenColor === rowKey) lastRoll.chosenColor = null;
  }

  saveState();
  renderAll();
}

/* ------------------ scoring ------------------ */

function computeScoreRow(rowKey) {
  const n = countMarks(rowKey);
  return SCORE_TABLE[Math.max(0, Math.min(12, n))];
}

function computeTotals() {
  const red = computeScoreRow("red");
  const yellow = computeScoreRow("yellow");
  const green = computeScoreRow("green");
  const blue = computeScoreRow("blue");
  const pen = state.penalties * -5;
  const total = red + yellow + green + blue + pen;
  return { red, yellow, green, blue, pen, total };
}

/* ------------------ legal highlight targets ------------------ */

function getLegalTargets() {
  const targets = new Set();
  if (!lastRoll) return targets;

  const whiteSum = lastRoll.white1 + lastRoll.white2;

  for (const r of ROWS) {
    if (canMark(r.key, whiteSum)) targets.add(`${r.key}:${whiteSum}`);
  }

  const c = lastRoll.chosenColor;
  if (c && lastRoll[c] !== null) {
    const a = lastRoll.white1 + lastRoll[c];
    const b = lastRoll.white2 + lastRoll[c];
    if (canMark(c, a)) targets.add(`${c}:${a}`);
    if (canMark(c, b)) targets.add(`${c}:${b}`);
  }

  return targets;
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
    die.textContent = d.v === null ? "—" : String(d.v);
    if (d.v === null) die.style.opacity = "0.35";

    if (["red","yellow","green","blue"].includes(d.k) && d.v !== null) {
      die.style.cursor = "pointer";
      die.title = "Tap to select for Action 2";
      if (lastRoll.chosenColor === d.k) die.classList.add("selected");

      die.addEventListener("click", () => {
        lastRoll.chosenColor = (lastRoll.chosenColor === d.k) ? null : d.k;
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

  const c = lastRoll.chosenColor;
  if (!c || lastRoll[c] === null) {
    elSumColor.textContent = "Tap a color die";
    return;
  }

  const a = lastRoll.white1 + lastRoll[c];
  const b = lastRoll.white2 + lastRoll[c];
  elSumColor.textContent = `${c.toUpperCase()}: ${a} (W1) / ${b} (W2)`;
}

function renderSheet() {
  elSheet.innerHTML = "";

  // Only compute/use highlights if hints are enabled
  const showHints = !!state.hintsEnabled;
  const legal = showHints ? getLegalTargets() : new Set();

  for (const r of ROWS) {
    const rowState = state.rows[r.key];

    const wrap = document.createElement("div");
    wrap.className = "sheet-row";

    const title = document.createElement("div");
    title.className = "title";

    const left = document.createElement("div");
    left.className = "titleLeft";
    left.innerHTML = `<strong>${r.label}</strong>`;

    const badge = document.createElement("span");
    badge.className = "badge" + (rowState.locked ? " locked" : "");
    badge.textContent = rowState.locked ? "LOCKED" : `Marks: ${countMarks(r.key)}`;
    left.appendChild(badge);

    const resetBtn = document.createElement("button");
    resetBtn.className = "btnReset";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => resetRow(r.key));

    title.appendChild(left);
    title.appendChild(resetBtn);

    const cells = document.createElement("div");
    cells.className = "cells";

    r.nums.forEach((num) => {
      const cell = document.createElement("div");
      cell.className = `cell ${r.color}` + (num === r.end ? " end" : "");

      const marked = !!rowState.marked[num];
      if (marked) cell.classList.add("marked");

      const disabled = !canMark(r.key, num) && !marked;
      if (disabled) cell.classList.add("disabled");

      if (showHints && legal.has(`${r.key}:${num}`) && !marked) cell.classList.add("legal");

      cell.textContent = String(num);

      cell.addEventListener("click", () => {
        const ok = markNumber(r.key, num);
        if (!ok) {
          cell.classList.add("illegal");
          setTimeout(() => cell.classList.remove("illegal"), 200);
        }
      });

      cells.appendChild(cell);
    });

    wrap.appendChild(title);
    wrap.appendChild(cells);
    elSheet.appendChild(wrap);
  }
}

function renderScores() {
  const t = computeTotals();
  document.getElementById("scoreRed").textContent = t.red;
  document.getElementById("scoreYellow").textContent = t.yellow;
  document.getElementById("scoreGreen").textContent = t.green;
  document.getElementById("scoreBlue").textContent = t.blue;
  document.getElementById("scorePen").textContent = t.pen;
  document.getElementById("scoreTotal").textContent = t.total;
}

function renderEndCheck() {
  const ended = (state.penalties >= 4) || (state.lockedCount >= 2);
  if (!ended) {
    elGameEnd.classList.add("hidden");
    elGameEnd.textContent = "";
    return;
  }
  elGameEnd.classList.remove("hidden");
  elGameEnd.textContent =
    `Game Over: ${state.penalties >= 4 ? "4 penalties" : "2 rows locked"}. Final total: ${computeTotals().total}`;
}

function renderAll() {
  renderRollMeta();
  renderDice();
  renderSums();
  renderSheet();
  renderScores();
  renderEndCheck();

  // keep checkbox in sync
  if (elChkHints) elChkHints.checked = !!state.hintsEnabled;
}
