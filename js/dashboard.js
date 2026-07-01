"use strict";

/*
  AGV Dashboard
  Grid: 10 columns x 7 rows
  Physical scale: 1 cell = 0.30m x 0.30m
  Arena: 3.00m x 2.10m
*/

const COLS = 10;
const ROWS = 7;
const CELL = 60; // canvas pixels per visual cell
const CELL_SIZE_M = 0.3;
const ARENA_WIDTH_M = COLS * CELL_SIZE_M;
const ARENA_HEIGHT_M = ROWS * CELL_SIZE_M;
const FIRESTORE_CONTROL_DOC_PATH = ["agv_system", "robot_control"];
const FIRESTORE_TELEMETRY_DOC_PATH = ["agv_system", "robot_telemetry"];
const FIRESTORE_STATUS_DOC_PATH = ["agv_system", "robot_status"];

const state = {
  agv: { x: 0, y: 0, theta: 0, col: 0, row: 0 },
  goal: { x: 0, y: 0, theta: 0, col: 0, row: 0, timestamp: 0, command: "NAVIGATE" },
  home: { x: 0, y: 0, theta: 0, col: 0, row: 0 },
  prevPos: null,
  path: [],
  pathStep: 0,
  moving: false,
  estop: false,
  agvStatus: "idle",
  battery: 85,
  velocity: { v: 0, w: 0 },
  mqttTx: 0,
  mqttRx: 0,
  uptime: 0,
  moveInterval: null,
  animFrame: null,
  visitedCells: new Set(),
  lastCommandTimestamp: 0,
};

const firebaseSync = {
  ready: false,
  lastError: "",
  controlRef: null,
  telemetryRef: null,
  statusRef: null,
  setDoc: null,
  serverTimestamp: null,
  unsubscribes: [],
};

const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

let renderX = cellToCanvasCenter(state.agv.col, state.agv.row).x;
let renderY = cellToCanvasCenter(state.agv.col, state.agv.row).y;
let renderAngle = 0;
let axisBuilt = false;
let logCount = 0;
const startTime = Date.now();
const AGV_BODY_W = 50;
const AGV_BODY_H = 40;
const AGV_HALF_W = AGV_BODY_W / 2;
const AGV_HALF_H = AGV_BODY_H / 2;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, digits = 3) {
  const p = 10 ** digits;
  return Math.round(Number(value) * p) / p;
}

function normalizeTheta(theta) {
  const value = Number(theta);
  if (!Number.isFinite(value)) return 0;
  let t = value;
  while (t > Math.PI) t -= Math.PI * 2;
  while (t < -Math.PI) t += Math.PI * 2;
  return t;
}

function cellOriginToMeters(col, row) {
  return {
    x: round(clamp(col, 0, COLS - 1) * CELL_SIZE_M, 3),
    y: round(clamp(row, 0, ROWS - 1) * CELL_SIZE_M, 3),
  };
}

function metersToCell(x, y) {
  const safeX = clamp(Number(x) || 0, 0, ARENA_WIDTH_M - 0.001);
  const safeY = clamp(Number(y) || 0, 0, ARENA_HEIGHT_M - 0.001);
  return {
    col: clamp(Math.floor(safeX / CELL_SIZE_M), 0, COLS - 1),
    row: clamp(Math.floor(safeY / CELL_SIZE_M), 0, ROWS - 1),
  };
}

function poseToCanvasX(x) {
  const margin = CELL * 0.2;
  return clamp((clamp(Number(x) || 0, 0, ARENA_WIDTH_M) / ARENA_WIDTH_M) * canvas.width, margin, canvas.width - margin);
}

function poseToCanvasY(y) {
  const margin = CELL * 0.2;
  return clamp(canvas.height - (clamp(Number(y) || 0, 0, ARENA_HEIGHT_M) / ARENA_HEIGHT_M) * canvas.height, margin, canvas.height - margin);
}

function cellToCanvasCenter(col, row) {
  return {
    x: col * CELL + CELL / 2,
    y: (ROWS - 1 - row) * CELL + CELL / 2,
  };
}

function agvToCanvasCenter() {
  return cellToCanvasCenter(state.agv.col, state.agv.row);
}

function syncAgvCellFromMeters() {
  const cell = metersToCell(state.agv.x, state.agv.y);
  state.agv.col = cell.col;
  state.agv.row = cell.row;
}

function setAgvPoseMeters(x, y, theta = state.agv.theta) {
  state.agv.x = round(clamp(Number(x) || 0, 0, ARENA_WIDTH_M), 3);
  state.agv.y = round(clamp(Number(y) || 0, 0, ARENA_HEIGHT_M), 3);
  state.agv.theta = normalizeTheta(theta);
  syncAgvCellFromMeters();
}

function setAgvPoseCell(col, row, theta = state.agv.theta) {
  const safeCol = clamp(Math.round(Number(col) || 0), 0, COLS - 1);
  const safeRow = clamp(Math.round(Number(row) || 0), 0, ROWS - 1);
  const pose = cellOriginToMeters(safeCol, safeRow);
  state.agv.x = pose.x;
  state.agv.y = pose.y;
  state.agv.theta = normalizeTheta(theta);
  state.agv.col = safeCol;
  state.agv.row = safeRow;
}

function dijkstra(sc, sr, gc, gr) {
  if (sc === gc && sr === gr) return [];

  const key = (c, r) => `${c},${r}`;
  const dist = new Map();
  const parent = new Map();
  const pq = [{ c: sc, r: sr, cost: 0 }];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  dist.set(key(sc, sr), 0);
  parent.set(key(sc, sr), null);

  while (pq.length > 0) {
    pq.sort((a, b) => a.cost - b.cost);
    const curr = pq.shift();

    if (curr.c === gc && curr.r === gr) {
      const path = [];
      let curKey = key(gc, gr);
      while (curKey) {
        const [c, r] = curKey.split(",").map(Number);
        path.push({ col: c, row: r });
        curKey = parent.get(curKey);
      }
      return path.reverse();
    }

    for (const [dc, dr] of dirs) {
      const nc = curr.c + dc;
      const nr = curr.r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;

      const nk = key(nc, nr);
      const newCost = dist.get(key(curr.c, curr.r)) + 1;
      if (!dist.has(nk) || newCost < dist.get(nk)) {
        dist.set(nk, newCost);
        parent.set(nk, key(curr.c, curr.r));
        pq.push({ c: nc, r: nr, cost: newCost });
      }
    }
  }

  return null;
}

function roundRectPath(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + w - r, y);
  context.quadraticCurveTo(x + w, y, x + w, y + r);
  context.lineTo(x + w, y + h - r);
  context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  context.lineTo(x + r, y + h);
  context.quadraticCurveTo(x, y + h, x, y + h - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawMap() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0a1628";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const x = c * CELL;
      const y = (ROWS - 1 - r) * CELL;
      const key = `${c},${r}`;

      if (state.visitedCells.has(key)) {
        ctx.fillStyle = "rgba(167,139,250,0.08)";
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      }

      ctx.strokeStyle = "rgba(56,189,248,0.14)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, CELL, CELL);
      ctx.fillStyle = "rgba(56,189,248,0.22)";
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawCellMarker(state.home.col, state.home.row, "rgba(251,191,36,0.08)", "rgba(251,191,36,0.35)", "H");

  if (state.path.length > 1) {
    state.path.forEach((p, i) => {
      if (i === 0) return;
      const { x, y } = cellToCanvasCenter(p.col, p.row);
      const prog = i / (state.path.length - 1);
      ctx.fillStyle = `rgba(56,189,248,${0.06 + prog * 0.1})`;
      ctx.fillRect(x - CELL / 2 + 3, y - CELL / 2 + 3, CELL - 6, CELL - 6);
    });

    ctx.save();
    ctx.strokeStyle = "rgba(56,189,248,0.65)";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    state.path.forEach((p, i) => {
      const point = cellToCanvasCenter(p.col, p.row);
      i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.restore();
  }

  if (state.path.length > 0 || state.goal.timestamp > 0) {
    drawCellMarker(state.goal.col, state.goal.row, "rgba(74,222,128,0.16)", "rgba(74,222,128,0.85)", "G");
  }

  const agvCenter = agvToCanvasCenter();
  renderX = lerp(renderX, agvCenter.x, 0.18);
  renderY = lerp(renderY, agvCenter.y, 0.18);

  const targetAngle = -state.agv.theta;
  let da = targetAngle - renderAngle;
  if (da > Math.PI) da -= Math.PI * 2;
  if (da < -Math.PI) da += Math.PI * 2;
  renderAngle += da * 0.14;

  const agvGrad = ctx.createRadialGradient(renderX, renderY, 0, renderX, renderY, CELL * 0.9);
  agvGrad.addColorStop(0, "rgba(56,189,248,0.28)");
  agvGrad.addColorStop(1, "transparent");
  ctx.fillStyle = agvGrad;
  ctx.beginPath();
  ctx.arc(renderX, renderY, CELL * 0.9, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(renderX, renderY);
  ctx.rotate(renderAngle);
  ctx.fillStyle = "rgba(56,189,248,0.20)";
  ctx.strokeStyle = "rgba(56,189,248,0.95)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, -AGV_HALF_W, -AGV_HALF_H, AGV_BODY_W, AGV_BODY_H, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(56,189,248,0.65)";
  [[-21, -23], [21, -23], [-21, 23], [21, 23]].forEach(([wx, wy]) => {
    ctx.beginPath();
    ctx.arc(wx, wy, 4.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "rgba(56,189,248,0.95)";
  ctx.beginPath();
  ctx.moveTo(AGV_HALF_W + 2, 0);
  ctx.lineTo(AGV_HALF_W - 10, -10);
  ctx.lineTo(AGV_HALF_W - 10, 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  buildAxisLabels();
  state.animFrame = requestAnimationFrame(drawMap);
}

function drawCellMarker(col, row, fill, stroke, label) {
  const { x, y } = cellToCanvasCenter(col, row);
  const left = x - CELL / 2;
  const top = y - CELL / 2;

  ctx.fillStyle = fill;
  ctx.fillRect(left + 1, top + 1, CELL - 2, CELL - 2);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.setLineDash(label === "H" ? [4, 4] : []);
  ctx.strokeRect(left + 2, top + 2, CELL - 4, CELL - 4);
  ctx.setLineDash([]);
  ctx.fillStyle = stroke;
  ctx.font = "bold 15px 'Share Tech Mono'";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y + 5);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildAxisLabels() {
  if (axisBuilt) return;
  axisBuilt = true;

  const axY = document.getElementById("axisY");
  const axX = document.getElementById("axisX");
  axY.innerHTML = "";
  axX.innerHTML = "";

  for (let r = ROWS - 1; r >= 0; r--) {
    const el = document.createElement("span");
    el.className = "axis-label";
    el.textContent = r;
    el.style.height = CELL + "px";
    el.style.display = "flex";
    el.style.alignItems = "center";
    axY.appendChild(el);
  }

  for (let c = 0; c < COLS; c++) {
    const el = document.createElement("span");
    el.className = "axis-label";
    el.textContent = c;
    el.style.width = CELL + "px";
    axX.appendChild(el);
  }
}

canvas.addEventListener("click", (e) => {
  if (state.estop) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;

  const gc = Math.floor(mx / CELL);
  const gr = ROWS - 1 - Math.floor(my / CELL);
  if (gc < 0 || gr < 0 || gc >= COLS || gr >= ROWS) return;

  const target = cellOriginToMeters(gc, gr);
  setGoalMeters(target.x, target.y, state.agv.theta, {
    label: `cell (${gc},${gr}) -> ${target.x.toFixed(2)}m, ${target.y.toFixed(2)}m`,
    publish: true,
    command: "NAVIGATE",
  });
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;

  const gc = Math.floor(mx / CELL);
  const gr = ROWS - 1 - Math.floor(my / CELL);
  const tt = document.getElementById("goalTooltip");
  const ttText = document.getElementById("goalTooltipText");

  if (gc >= 0 && gr >= 0 && gc < COLS && gr < ROWS) {
    const target = cellOriginToMeters(gc, gr);
    tt.style.borderColor = "var(--border)";
    ttText.style.color = "var(--cyan)";
    ttText.textContent = `Goal (${target.x.toFixed(2)}m, ${target.y.toFixed(2)}m)`;
    tt.style.left = e.clientX - rect.left + 14 + "px";
    tt.style.top = e.clientY - rect.top - 10 + "px";
    tt.classList.add("show");
  } else {
    tt.classList.remove("show");
  }
});

canvas.addEventListener("mouseleave", () => {
  document.getElementById("goalTooltip").classList.remove("show");
});

function setGoalMeters(x, y, theta = 0, options = {}) {
  const command = (options.command || "NAVIGATE").toUpperCase();
  const targetCell = metersToCell(x, y);

  if (state.moving && !options.keepMoving) stopMovement();
  state.prevPos = { x: state.agv.x, y: state.agv.y, theta: state.agv.theta, col: state.agv.col, row: state.agv.row };

  state.goal = {
    x: round(clamp(Number(x) || 0, 0, ARENA_WIDTH_M), 3),
    y: round(clamp(Number(y) || 0, 0, ARENA_HEIGHT_M), 3),
    theta: normalizeTheta(theta),
    col: targetCell.col,
    row: targetCell.row,
    timestamp: options.timestamp || Date.now(),
    command,
  };
  state.lastCommandTimestamp = Math.max(state.lastCommandTimestamp, state.goal.timestamp);

  const path = dijkstra(state.agv.col, state.agv.row, state.goal.col, state.goal.row);
  if (!path) {
    addLog("err", "[DIJKSTRA]", "No valid path to goal.");
    return;
  }

  state.path = path;
  state.pathStep = 0;
  const label = options.label || `${state.goal.x.toFixed(2)}m, ${state.goal.y.toFixed(2)}m`;
  if (path.length === 0) {
    addLog("info", "[AGV]", `AGV is already at ${label}.`);
  } else {
    addLog("info", "[DIJKSTRA]", `Goal set -> ${label}. Press START to run.`);
  }

  if (options.publish !== false) {
    publishControlCommand(command);
    simulateMQTT(`/agv_system/robot_control/goal_pose -> ${JSON.stringify(state.goal)}`);
  }
}

function startMovement() {
  if (!state.path || state.path.length === 0) {
    addLog("warn", "[CMD]", "No goal selected.");
    return;
  }

  if (state.moveInterval) clearInterval(state.moveInterval);
  setState("moving");
  state.moving = true;

  state.moveInterval = setInterval(() => {
    if (state.estop) {
      stopMovement();
      return;
    }

    state.pathStep++;
    if (state.pathStep >= state.path.length) {
      stopMovement();
      setState("reached");
      addLog("ok", "[AGV]", `Reached goal (${state.goal.x.toFixed(2)}m, ${state.goal.y.toFixed(2)}m).`);
      publishTelemetryAndStatus("REACHED");
      simulateMQTT("/agv_system/robot_telemetry/status -> REACHED");
      return;
    }

    const next = state.path[state.pathStep];
    const nextMeters = cellOriginToMeters(next.col, next.row);
    const dx = next.col - state.agv.col;
    const dy = next.row - state.agv.row;
    const theta = dx !== 0 || dy !== 0 ? Math.atan2(dy, dx) : state.agv.theta;

    state.visitedCells.add(`${state.agv.col},${state.agv.row}`);
    setAgvPoseMeters(nextMeters.x, nextMeters.y, theta);

    state.velocity.v = round(0.18 + Math.random() * 0.1, 2);
    state.velocity.w = round(0.05 + Math.random() * 0.12, 2);
    updateTelemetry();
    publishTelemetryAndStatus("MOVING");
  }, 450);
}

function stopMovement() {
  clearInterval(state.moveInterval);
  state.moveInterval = null;
  state.moving = false;
  state.velocity.v = 0;
  state.velocity.w = 0;
  updateTelemetry();
}

function setState(nextState) {
  const normalized = String(nextState || "idle").toLowerCase();
  state.agvStatus = normalized;

  const configs = [
    { name: "idle", stateEl: "stateIdle", check: "checkIdle", css: "", dot: "dot-idle" },
    { name: "moving", stateEl: "stateMoving", check: "checkMoving", css: "moving-state", dot: "dot-moving" },
    { name: "reached", stateEl: "stateReached", check: "checkReached", css: "reached-state", dot: "dot-green" },
    { name: "error", stateEl: "stateError", check: "checkError", css: "error-state", dot: "dot-red" },
  ];

  configs.forEach((cfg) => {
    const el = document.getElementById(cfg.stateEl);
    if (!el) return;
    const chk = document.getElementById(cfg.check);
    el.className = "state-item";
    if (chk) chk.textContent = "-";
    if (cfg.name === normalized) {
      el.classList.add("active-state");
      if (cfg.css) el.classList.add(cfg.css);
      if (chk) chk.textContent = "OK";
    }
    const dotEl = el.querySelector(".state-dot");
    if (dotEl) dotEl.className = `state-dot ${cfg.dot}`.trim();
  });

  const fills = { idle: "20%", moving: "70%", reached: "100%", error: "100%", estop: "100%" };
  const colors = {
    idle: "linear-gradient(to right,#4a6080,#64748b)",
    moving: "linear-gradient(to right,#7dd3fc,#38bdf8)",
    reached: "linear-gradient(to right,#4ade80,#16a34a)",
    error: "linear-gradient(to right,#f87171,#dc2626)",
    estop: "linear-gradient(to right,#f87171,#dc2626)",
  };

  const fill = document.getElementById("statusBarFill");
  if (fill) {
    fill.style.width = fills[normalized] || "50%";
    fill.style.background = colors[normalized] || colors.idle;
  }

  const labels = {
    idle: ["SYSTEM IDLE", "dot-green", ""],
    moving: ["AGV MOVING", "dot-moving", "moving"],
    reached: ["GOAL REACHED", "dot-green", ""],
    error: ["SYSTEM ERROR", "dot-red", "estop"],
    estop: ["E-STOP ENGAGED", "dot-red", "estop"],
  };

  const [text, dotClass, textClass] = labels[normalized] || labels.idle;
  const stText = document.getElementById("statusText");
  const stDot = document.getElementById("sysStatus")?.querySelector(".status-dot");
  if (stText) {
    stText.textContent = text;
    stText.className = `status-text ${textClass}`.trim();
  }
  if (stDot) {
    stDot.className = `status-dot ${dotClass}`.trim();
  }
}

function updateTelemetry() {
  document.getElementById("dispX").textContent = state.agv.x.toFixed(2);
  document.getElementById("dispY").textContent = state.agv.y.toFixed(2);

  const mathDeg = Math.round(((state.agv.theta * 180) / Math.PI + 360) % 360);
  document.getElementById("dispTheta").textContent = mathDeg;
  document.getElementById("compassNeedle").style.transform = `rotate(${90 - mathDeg}deg)`;

  document.getElementById("velV").textContent = Number(state.velocity.v).toFixed(2);
  document.getElementById("velW").textContent = Number(state.velocity.w).toFixed(2);
  drawArc("arcV", Number(state.velocity.v), 0.4, "#38bdf8");
  drawArc("arcW", Number(state.velocity.w), 0.3, "#a78bfa");

  const batteryText = document.getElementById("batteryVal");
  const batteryFill = document.getElementById("batteryFill");
  if (batteryText) batteryText.textContent = `${Math.round(state.battery)}%`;
  if (batteryFill) batteryFill.style.width = `${clamp(state.battery, 0, 100)}%`;
}

function drawArc(id, val, max, color) {
  const c = document.getElementById(id);
  if (!c) return;
  const ct = c.getContext("2d");
  const W = c.width;
  const H = c.height;
  const cx = W / 2;
  const cy = H - 4;
  const r = Math.min(W, H * 2) / 2 - 4;
  const prog = Math.min(val / max, 1);

  ct.clearRect(0, 0, W, H);
  ct.beginPath();
  ct.arc(cx, cy, r, Math.PI, 0);
  ct.strokeStyle = "rgba(255,255,255,0.08)";
  ct.lineWidth = 5;
  ct.lineCap = "round";
  ct.stroke();

  ct.beginPath();
  ct.arc(cx, cy, r, Math.PI, Math.PI + prog * Math.PI);
  ct.strokeStyle = color;
  ct.lineWidth = 5;
  ct.lineCap = "round";
  ct.shadowColor = color;
  ct.shadowBlur = 6;
  ct.stroke();
  ct.shadowBlur = 0;
}

function addLog(type, tag, msg) {
  const feed = document.getElementById("logFeed");
  if (!feed) return;

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const ts = String(elapsed).padStart(5, "0") + "s";
  const el = document.createElement("div");
  el.className = "log-entry-item";
  el.innerHTML = `<span class="log-ts">${ts}</span><span class="log-tag ${type}">${tag}</span><span class="log-msg">${msg}</span>`;
  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;
  logCount++;
  while (feed.children.length > 80) feed.removeChild(feed.firstChild);
}

function clearLog() {
  const feed = document.getElementById("logFeed");
  if (feed) feed.innerHTML = "";
}

function mapAction(action) {
  if (action === "reset") {
    stopMovement();
    state.path = [];
    state.visitedCells.clear();
    setAgvPoseMeters(0, 0, 0);
    const resetCenter = agvToCanvasCenter();
    renderX = resetCenter.x;
    renderY = resetCenter.y;
    renderAngle = 0;
    setState("idle");
    addLog("info", "[SYS]", "AGV reset to origin (0.00m, 0.00m).");
    updateTelemetry();
    publishStatus("IDLE");
  }

  if (action === "home") {
    setGoalMeters(state.home.x, state.home.y, state.home.theta, {
      label: "Home Base",
      publish: true,
      command: "NAVIGATE",
    });
  }

  if (action === "return") {
    if (state.prevPos) {
      setGoalMeters(state.prevPos.x, state.prevPos.y, state.prevPos.theta, {
        label: "previous pose",
        publish: true,
        command: "RETURN",
      });
      startMovement();
    } else {
      addLog("warn", "[CMD]", "No previous pose available.");
    }
  }

  if (action === "clear") {
    stopMovement();
    state.path = [];
    state.visitedCells.clear();
    setState("idle");
    addLog("info", "[MAP]", "Path and visited cells cleared.");
  }

  if (action === "start") {
    startMovement();
  }
}

function toggleEmergency() {
  state.estop = !state.estop;
  const btn = document.getElementById("eStopBtn");

  if (state.estop) {
    stopMovement();
    state.path = [];
    setState("estop");
    btn.classList.add("active-estop");
    btn.textContent = "RESUME";
    state.goal.command = "STOP";
    state.goal.timestamp = Date.now();
    addLog("err", "[ESTOP]", "Emergency stop activated.");
    publishControlCommand("STOP");
    publishStatus("ERROR");
    simulateMQTT("/agv_system/robot_control/goal_pose -> STOP");
  } else {
    setState("idle");
    btn.classList.remove("active-estop");
    btn.textContent = "E-STOP";
    addLog("ok", "[ESTOP]", "Emergency stop cleared.");
    publishStatus("IDLE");
  }
}

function simulateMQTT(msg) {
  state.mqttTx++;
  state.mqttRx += Math.random() > 0.3 ? 1 : 0;
  addLog("info", "[MQTT]", msg);
}

function buildGoalPose(command = state.goal.command) {
  return {
    x: round(state.goal.x),
    y: round(state.goal.y),
    theta: round(state.goal.theta),
    unit: "m",
    cell_size_m: CELL_SIZE_M,
    timestamp: state.goal.timestamp || Date.now(),
    command: String(command || "NAVIGATE").toUpperCase(),
  };
}

function buildCurrentPose() {
  return {
    x: round(state.agv.x),
    y: round(state.agv.y),
    theta: round(state.agv.theta),
    unit: "m",
    cell_size_m: CELL_SIZE_M,
  };
}

function buildRobotStatus(statusState = statusForFirebase()) {
  return {
    state: String(statusState || "IDLE").toUpperCase(),
    battery: Math.round(clamp(state.battery, 0, 100)),
  };
}

function statusForFirebase() {
  if (state.estop) return "ERROR";
  if (state.agvStatus === "reached") return "REACHED";
  if (state.moving || state.agvStatus === "moving") return "MOVING";
  if (state.agvStatus === "error") return "ERROR";
  return "IDLE";
}

async function initFirebaseSync() {
  try {
    const [{ db }, firestore] = await Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js"),
    ]);

    firebaseSync.controlRef = firestore.doc(db, ...FIRESTORE_CONTROL_DOC_PATH);
    firebaseSync.telemetryRef = firestore.doc(db, ...FIRESTORE_TELEMETRY_DOC_PATH);
    firebaseSync.statusRef = firestore.doc(db, ...FIRESTORE_STATUS_DOC_PATH);
    firebaseSync.setDoc = firestore.setDoc;
    firebaseSync.serverTimestamp = firestore.serverTimestamp;
    firebaseSync.ready = true;

    firebaseSync.unsubscribes = [
      firestore.onSnapshot(firebaseSync.controlRef, (snapshot) => {
        if (snapshot.exists()) applyControlDoc(snapshot.data(), "firebase");
      }, handleFirebaseError),
      firestore.onSnapshot(firebaseSync.telemetryRef, (snapshot) => {
        if (snapshot.exists()) applyTelemetryDoc(snapshot.data());
      }, handleFirebaseError),
      firestore.onSnapshot(firebaseSync.statusRef, (snapshot) => {
        if (snapshot.exists()) applyStatusDoc(snapshot.data());
      }, handleFirebaseError),
    ];

    addLog("ok", "[FIREBASE]", "Sync ready: robot_control / robot_telemetry / robot_status");
    publishStatus("IDLE");
  } catch (err) {
    firebaseSync.lastError = err.message;
    addLog("err", "[FIREBASE]", `Firestore unavailable: ${err.message}`);
  }
}

function handleFirebaseError(err) {
  firebaseSync.lastError = err.message;
  addLog("err", "[FIREBASE]", `Realtime sync error: ${err.message}`);
}

async function writeFirebaseDoc(ref, payload, label) {
  if (!firebaseSync.ready || !firebaseSync.setDoc || !ref) return;

  try {
    await firebaseSync.setDoc(ref, {
      ...payload,
      updated_at: firebaseSync.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    firebaseSync.lastError = err.message;
    addLog("err", "[FIREBASE]", `${label} write failed: ${err.message}`);
  }
}

function publishControlCommand(command = state.goal.command) {
  return writeFirebaseDoc(firebaseSync.controlRef, {
    goal_pose: buildGoalPose(command),
  }, "robot_control");
}

function publishTelemetry() {
  return writeFirebaseDoc(firebaseSync.telemetryRef, {
    current_pose: buildCurrentPose(),
  }, "robot_telemetry");
}

function publishStatus(statusState = statusForFirebase()) {
  return writeFirebaseDoc(firebaseSync.statusRef, {
    status: buildRobotStatus(statusState),
  }, "robot_status");
}

function publishTelemetryAndStatus(statusState = statusForFirebase()) {
  publishTelemetry();
  publishStatus(statusState);
}

function applyControlDoc(raw, source = "firebase") {
  const goal = normalizeGoalPose(raw?.goal_pose || raw?.agv_system?.robot_control?.goal_pose);
  if (!goal) return;

  const timestamp = Number(goal.timestamp) || 0;
  if (timestamp <= state.lastCommandTimestamp) return;

  state.lastCommandTimestamp = timestamp;
  handleRemoteCommand(goal.command, goal, source);
}

function applyTelemetryDoc(raw) {
  const pose = normalizePose(raw?.current_pose || raw?.agv_system?.robot_telemetry?.current_pose);
  if (!pose) return;

  if (pose.unit === "cell" || pose.unit === "grid") {
    setAgvPoseCell(pose.x, pose.y, pose.theta);
  } else {
    setAgvPoseMeters(pose.x, pose.y, pose.theta);
  }
  updateTelemetry();
}

function applyStatusDoc(raw) {
  const status = normalizeStatus(raw?.status || raw?.agv_system?.robot_telemetry?.status);
  if (!status) return;

  if (Number.isFinite(status.battery)) state.battery = clamp(status.battery, 0, 100);
  const mappedState = mapRemoteState(status.state);
  if (mappedState) {
    if (mappedState !== "moving") stopMovement();
    setState(mappedState);
  }
  updateTelemetry();
}

function normalizePose(pose) {
  if (!pose || typeof pose !== "object") return null;
  const unit = String(pose.unit || pose.coord_unit || "").toLowerCase();
  const x = Number(Number.isFinite(Number(pose.col)) ? pose.col : pose.x);
  const y = Number(Number.isFinite(Number(pose.row)) ? pose.row : pose.y);
  const theta = Number(pose.theta);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    theta: Number.isFinite(theta) ? theta : 0,
    unit: Number.isFinite(Number(pose.col)) || Number.isFinite(Number(pose.row)) ? "cell" : unit,
  };
}

function normalizeGoalPose(goal) {
  if (!goal || typeof goal !== "object") return null;
  const pose = normalizePose(goal);
  if (!pose) return null;
  return {
    ...pose,
    timestamp: Number.isFinite(Number(goal.timestamp)) ? Number(goal.timestamp) : 0,
    command: String(goal.command || "NAVIGATE").toUpperCase(),
  };
}

function normalizeStatus(status) {
  if (!status || typeof status !== "object") return null;
  return {
    state: String(status.state || "IDLE").toUpperCase(),
    battery: Number(status.battery),
  };
}

function mapRemoteState(value) {
  const v = String(value || "").toUpperCase();
  if (v === "IDLE") return "idle";
  if (v === "MOVING") return "moving";
  if (v === "REACHED") return "reached";
  if (v === "ERROR") return "error";
  return null;
}

function handleRemoteCommand(command, goal, source) {
  if (command === "STOP") {
    if (!state.estop) state.estop = true;
    stopMovement();
    setState("estop");
    addLog("err", "[REMOTE]", `STOP command received from ${source}.`);
    return;
  }

  if (command === "RETURN") {
    setGoalMeters(state.home.x, state.home.y, state.home.theta, {
      label: "remote RETURN home",
      publish: false,
      timestamp: goal.timestamp,
      command,
    });
    return;
  }

  if (command === "NAVIGATE") {
    setGoalMeters(goal.x, goal.y, goal.theta, {
      label: `remote goal ${round(goal.x, 2)}m, ${round(goal.y, 2)}m`,
      publish: false,
      timestamp: goal.timestamp,
      command,
    });
  }
}

function openLogoutModal() {
  const modal = document.getElementById("logoutModal");
  const error = document.getElementById("logoutError");
  const confirmBtn = document.getElementById("logoutConfirmBtn");
  if (!modal) return;

  if (error) error.textContent = "";
  if (confirmBtn) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = "DANG XUAT";
  }

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  setTimeout(() => confirmBtn?.focus(), 80);
}

function closeLogoutModal() {
  const modal = document.getElementById("logoutModal");
  if (!modal) return;
  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

async function confirmDashboardLogout() {
  const logoutBtn = document.getElementById("logoutBtn");
  const confirmBtn = document.getElementById("logoutConfirmBtn");
  const cancelBtn = document.getElementById("logoutCancelBtn");
  const closeBtn = document.getElementById("logoutCancelX");
  const error = document.getElementById("logoutError");
  const oldNavText = logoutBtn ? logoutBtn.textContent : "DANG XUAT";

  if (error) error.textContent = "";
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = "DANG XU LY...";
  }
  if (cancelBtn) cancelBtn.disabled = true;
  if (closeBtn) closeBtn.disabled = true;
  if (logoutBtn) {
    logoutBtn.disabled = true;
    logoutBtn.classList.add("logging-out");
    logoutBtn.textContent = "DANG DANG XUAT...";
  }

  try {
    const [{ auth }, { signOut }] = await Promise.all([
      import("./firebase.js"),
      import("https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js"),
    ]);

    await signOut(auth);
    window.location.href = "auth.html";
  } catch (err) {
    console.error("Logout error:", err);
    if (error) error.textContent = "Khong the dang xuat luc nay. Vui long thu lai.";
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = "THU LAI";
    }
    if (cancelBtn) cancelBtn.disabled = false;
    if (closeBtn) closeBtn.disabled = false;
    if (logoutBtn) {
      logoutBtn.disabled = false;
      logoutBtn.classList.remove("logging-out");
      logoutBtn.textContent = oldNavText;
    }
  }
}

function initDashboardLogout() {
  const logoutBtn = document.getElementById("logoutBtn");
  const modal = document.getElementById("logoutModal");
  const cancelBtn = document.getElementById("logoutCancelBtn");
  const closeBtn = document.getElementById("logoutCancelX");
  const confirmBtn = document.getElementById("logoutConfirmBtn");
  if (!logoutBtn || !modal) return;

  logoutBtn.addEventListener("click", openLogoutModal);
  cancelBtn?.addEventListener("click", closeLogoutModal);
  closeBtn?.addEventListener("click", closeLogoutModal);
  confirmBtn?.addEventListener("click", confirmDashboardLogout);
  modal.addEventListener("click", (event) => {
    if (event.target.matches("[data-logout-close]")) closeLogoutModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("show")) closeLogoutModal();
  });
}

function updateNav() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("navTime").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  state.uptime++;
  const h = Math.floor(state.uptime / 3600);
  const m = Math.floor((state.uptime % 3600) / 60);
  const s = state.uptime % 60;
  document.getElementById("uptimeVal").textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;

  document.getElementById("latencyVal").textContent = 6 + Math.floor(Math.random() * 8) + "ms";
}

function init() {
  const mapInfo = document.querySelector(".map-info");
  if (mapInfo) {
    mapInfo.innerHTML = `
      <span class="map-badge">10 x 7 GRID</span>
      <span class="map-badge">3m x 2.1m ARENA</span>
      <span class="map-badge">30cm CELL</span>
    `;
  }

  drawArc("arcV", 0, 0.4, "#38bdf8");
  drawArc("arcW", 0, 0.3, "#a78bfa");
  updateTelemetry();
  setState("idle");
  const startCenter = agvToCanvasCenter();
  renderX = startCenter.x;
  renderY = startCenter.y;
  drawMap();
  setInterval(updateNav, 1000);
  initDashboardLogout();
  initFirebaseSync();

  addLog("ok", "[SYS]", "AGV Dashboard initialized.");
  addLog("info", "[MAP]", "Grid 10x7, cell 0.30m, arena 3.00m x 2.10m.");
  addLog("info", "[SYS]", "Click a cell to set goal, then press START.");
}

window.mapAction = mapAction;
window.toggleEmergency = toggleEmergency;
window.clearLog = clearLog;
window.publishControlCommand = publishControlCommand;
window.publishTelemetry = publishTelemetry;
window.publishStatus = publishStatus;

init();
