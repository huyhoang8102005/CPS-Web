"use strict";
/* ═══════════════════════════════════════════
   AGV DASHBOARD — dashboard.js
   Modules: Grid/BFS, Telemetry, Compass,
            Arc Gauges, Log, MQTT sim
═══════════════════════════════════════════ */

/* ── GRID CONFIG ─────────────────────────────── */
const COLS = 15,
  ROWS = 10;
const CELL = 55;

/* ── GLOBAL STATE ────────────────────────────── */
const state = {
  agv: { col: 0, row: 0, angle: 0 },
  goal: { col: 0, row: 0 },
  home: { col: 0, row: 0 },
  path: [],
  pathStep: 0,
  moving: false,
  estop: false,
  agvStatus: "idle",
  battery: 78,
  velocity: { v: 0, w: 0 },
  obstacles: new Set([
    "3,3",
    "3,4",
    "3,5",
    "8,1",
    "8,2",
    "11,6",
    "11,7",
    "11,8",
    "5,7",
    "6,7",
    "2,0",
    "2,1",
  ]),
  obstacleMode: false, // FLAG KIỂM SOÁT CHẾ ĐỘ VẬT CẢN
  mqttTx: 0,
  mqttRx: 0,
  uptime: 0,
  moveInterval: null,
  animFrame: null,
  visitedCells: new Set(),
};

/* ═══════════════════════════════════════════
   BFS PATHFINDING
═══════════════════════════════════════════ */
function bfs(sc, sr, gc, gr) {
  if (sc === gc && sr === gr) return [];
  const key = (c, r) => `${c},${r}`;
  const q = [[sc, sr]];
  const parent = new Map([[key(sc, sr), null]]);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (q.length) {
    const [cc, cr] = q.shift();
    if (cc === gc && cr === gr) {
      const path = [];
      let cur = key(gc, gr);
      while (cur) {
        const [c, r] = cur.split(",").map(Number);
        path.push({ col: c, row: r });
        cur = parent.get(cur);
      }
      return path.reverse();
    }
    for (const [dc, dr] of dirs) {
      const nc = cc + dc,
        nr = cr + dr;
      const nk = key(nc, nr);
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      if (state.obstacles.has(nk)) continue;
      if (parent.has(nk)) continue;
      parent.set(nk, key(cc, cr));
      q.push([nc, nr]);
    }
  }
  return null;
}

/* ═══════════════════════════════════════════
   CANVAS MAP RENDERER
═══════════════════════════════════════════ */
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

let renderX = state.agv.col * CELL + CELL / 2;
let renderY = state.agv.row * CELL + CELL / 2;
let renderAngle = 0;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function drawMap() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0a1628";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const x = c * CELL,
        y = r * CELL;
      const key = `${c},${r}`;

      if (state.obstacles.has(key)) {
        ctx.fillStyle = "#172035";
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        ctx.strokeStyle = "rgba(30,60,90,0.6)";
        ctx.lineWidth = 1;
        for (let i = -CELL; i < CELL * 2; i += 10) {
          ctx.beginPath();
          ctx.moveTo(x + i, y);
          ctx.lineTo(x + i + CELL, y + CELL);
          ctx.stroke();
        }
        ctx.strokeStyle = "rgba(40,70,100,0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      } else {
        if (state.visitedCells.has(key)) {
          ctx.fillStyle = "rgba(167,139,250,0.05)";
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        }
        ctx.strokeStyle = "rgba(56,189,248,0.1)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, CELL, CELL);
        ctx.fillStyle = "rgba(56,189,248,0.2)";
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const hx = state.home.col * CELL,
    hy = state.home.row * CELL;
  ctx.fillStyle = "rgba(251,191,36,0.08)";
  ctx.fillRect(hx + 1, hy + 1, CELL - 2, CELL - 2);
  ctx.strokeStyle = "rgba(251,191,36,0.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(hx + 1.5, hy + 1.5, CELL - 3, CELL - 3);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(251,191,36,0.8)";
  ctx.font = `bold 14px 'Share Tech Mono'`;
  ctx.textAlign = "center";
  ctx.fillText("⌂", hx + CELL / 2, hy + CELL / 2 + 5);

  if (state.path.length > 1) {
    state.path.forEach((p, i) => {
      if (i === 0) return;
      const px = p.col * CELL,
        py = p.row * CELL;
      const prog = i / (state.path.length - 1);
      ctx.fillStyle = `rgba(56,189,248,${0.06 + prog * 0.1})`;
      ctx.fillRect(px + 3, py + 3, CELL - 6, CELL - 6);
    });

    ctx.save();
    ctx.strokeStyle = "rgba(56,189,248,0.6)";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 6]);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    state.path.forEach((p, i) => {
      const px = p.col * CELL + CELL / 2,
        py = p.row * CELL + CELL / 2;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
  }

  if (state.path.length > 0 && !state.obstacleMode) {
    const g = state.goal;
    const gx = g.col * CELL,
      gy = g.row * CELL;
    const grad = ctx.createRadialGradient(
      gx + CELL / 2,
      gy + CELL / 2,
      0,
      gx + CELL / 2,
      gy + CELL / 2,
      CELL * 0.7,
    );
    grad.addColorStop(0, "rgba(74,222,128,0.3)");
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(gx, gy, CELL, CELL);
    ctx.strokeStyle = "rgba(74,222,128,0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(gx + 2, gy + 2, CELL - 4, CELL - 4);
    ctx.fillStyle = "rgba(74,222,128,0.9)";
    ctx.font = `bold 16px 'Share Tech Mono'`;
    ctx.textAlign = "center";
    ctx.fillText("✦", gx + CELL / 2, gy + CELL / 2 + 6);
  }

  const targetX = state.agv.col * CELL + CELL / 2;
  const targetY = state.agv.row * CELL + CELL / 2;
  renderX = lerp(renderX, targetX, 0.15);
  renderY = lerp(renderY, targetY, 0.15);

  let da = state.agv.angle - renderAngle;
  if (da > Math.PI) da -= Math.PI * 2;
  if (da < -Math.PI) da += Math.PI * 2;
  renderAngle += da * 0.12;

  const agvGrad = ctx.createRadialGradient(
    renderX,
    renderY,
    0,
    renderX,
    renderY,
    CELL * 0.8,
  );
  agvGrad.addColorStop(0, "rgba(56,189,248,0.25)");
  agvGrad.addColorStop(1, "transparent");
  ctx.fillStyle = agvGrad;
  ctx.beginPath();
  ctx.arc(renderX, renderY, CELL * 0.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(renderX, renderY);
  ctx.rotate(renderAngle);
  ctx.fillStyle = "rgba(56,189,248,0.18)";
  ctx.strokeStyle = "rgba(56,189,248,0.95)";
  ctx.lineWidth = 2;
  roundRectPath(ctx, -18, -12, 36, 24, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(56,189,248,0.6)";
  [
    [-15, -15],
    [15, -15],
    [-15, 15],
    [15, 15],
  ].forEach(([wx, wy]) => {
    ctx.beginPath();
    ctx.arc(wx, wy, 4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = "rgba(56,189,248,0.95)";
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(9, -7);
  ctx.lineTo(9, 7);
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

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

let axisBuilt = false;
function buildAxisLabels() {
  if (axisBuilt) return;
  axisBuilt = true;
  const axY = document.getElementById("axisY");
  const axX = document.getElementById("axisX");
  axY.innerHTML = "";
  axX.innerHTML = "";
  for (let r = 0; r < ROWS; r++) {
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

/* =========================================================
   XỬ LÝ CLICK CANVAS (HỢP NHẤT) - SỬA LỖI XUNG ĐỘT
========================================================= */
canvas.addEventListener("click", (e) => {
  if (state.estop) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;
  const gc = Math.floor(mx / CELL);
  const gr = Math.floor(my / CELL);

  if (gc < 0 || gr < 0 || gc >= COLS || gr >= ROWS) return;
  const key = `${gc},${gr}`;

  // ĐANG TRONG CHẾ ĐỘ VẬT CẢN (KHÓA TÍNH NĂNG CHỌN ĐƯỜNG)
  if (state.obstacleMode) {
    if (state.obstacles.has(key)) {
      state.obstacles.delete(key);
      addLog("ok", "[OBS]", `Xóa vật cản tại (${gc},${gr})`);
    } else {
      state.obstacles.add(key);
      addLog("warn", "[OBS]", `Thêm vật cản tại (${gc},${gr})`);
    }
    return; // Không chạy code tìm đường bên dưới
  }

  // ĐANG Ở CHẾ ĐỘ BÌNH THƯỜNG (CHỌN TỌA ĐỘ)
  if (state.obstacles.has(key)) {
    addLog("warn", "[MAP]", "Vị trí này đang là vật cản!");
    return;
  }
  setGoal(gc, gr, `(${gc},${gr})`);
});

/* Tooltip Cập nhật động theo chế độ */
canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;
  const gc = Math.floor(mx / CELL);
  const gr = Math.floor(my / CELL);
  const tt = document.getElementById("goalTooltip");
  const ttText = document.getElementById("goalTooltipText");

  if (gc >= 0 && gr >= 0 && gc < COLS && gr < ROWS) {
    const key = `${gc},${gr}`;

    // Đổi màu tooltip khi đang ở chế độ vẽ vật cản
    if (state.obstacleMode) {
      tt.style.borderColor = "rgba(251, 146, 60, 0.5)"; // Cam
      ttText.style.color = "var(--orange)";
      ttText.textContent = state.obstacles.has(key)
        ? `(${gc},${gr}) — Click để XÓA vật cản`
        : `(${gc},${gr}) — Click để THÊM vật cản`;
    } else {
      tt.style.borderColor = "var(--border)"; // Xanh biển
      ttText.style.color = "var(--cyan)";
      ttText.textContent = state.obstacles.has(key)
        ? `(${gc},${gr}) — Vật cản`
        : `Click → đặt mục tiêu (${gc},${gr})`;
    }

    tt.style.left = e.clientX - rect.left + 14 + "px";
    tt.style.top = e.clientY - rect.top - 10 + "px";
    tt.classList.add("show");
  } else {
    tt.classList.remove("show");
  }
});
canvas.addEventListener("mouseleave", () =>
  document.getElementById("goalTooltip").classList.remove("show"),
);

/* ═══════════════════════════════════════════
   PATHFINDING & MOVEMENT
═══════════════════════════════════════════ */
function setGoal(gc, gr, label) {
  if (state.moving) stopMovement();
  state.goal.col = gc;
  state.goal.row = gr;
  const path = bfs(state.agv.col, state.agv.row, gc, gr);

  if (!path) {
    addLog("err", "[BFS]", "Không tìm thấy đường đi!");
    return;
  }
  if (path.length === 0) {
    addLog("info", "[AGV]", "AGV đã ở tại vị trí này rồi!");
    return;
  }

  state.path = path;
  state.pathStep = 0;
  document.getElementById("pathBadge").textContent =
    `BFS: ${path.length - 1} steps`;
  addLog("info", "[BFS]", `Tìm thấy đường → ${label}. Nhấn START để chạy.`);
  simulateMQTT(`/agv/cmd/goal → {x:${gc}, y:${gr}}`);
}

function startMovement() {
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
      setState("idle");
      const { col, row } = state.goal;
      addLog("ok", "[AGV]", `Đã đến đích (${col},${row})!`);
      simulateMQTT(`/agv/status → ARRIVED`);
      return;
    }

    const next = state.path[state.pathStep];

    if (state.obstacles.has(`${next.col},${next.row}`)) {
      stopMovement();
      setState("obstacle");
      addLog(
        "warn",
        "[AGV]",
        `Phát hiện vật cản tại (${next.col},${next.row})!`,
      );
      simulateMQTT(`/agv/status → OBSTACLE_DETECTED`);
      return;
    }

    const dx = next.col - state.agv.col;
    const dy = next.row - state.agv.row;
    state.agv.angle = Math.atan2(dy, dx);

    state.visitedCells.add(`${state.agv.col},${state.agv.row}`);
    state.agv.col = next.col;
    state.agv.row = next.row;

    state.velocity.v = (0.18 + Math.random() * 0.1).toFixed(2);
    state.velocity.w = (0.05 + Math.random() * 0.12).toFixed(2);
    updateTelemetry();
  }, 400);
}

function stopMovement() {
  clearInterval(state.moveInterval);
  state.moveInterval = null;
  state.moving = false;
  state.velocity.v = 0;
  state.velocity.w = 0;
  updateTelemetry();
}

/* ═══════════════════════════════════════════
   STATE & TELEMETRY
═══════════════════════════════════════════ */
function setState(s) {
  state.agvStatus = s;
  const statuses = ["idle", "moving", "obstacle"];
  const ids = [
    { stateEl: "stateIdle", check: "checkIdle", css: "", dot: "dot-idle" },
    {
      stateEl: "stateMoving",
      check: "checkMoving",
      css: "moving-state",
      dot: "dot-moving",
    },
    {
      stateEl: "stateObstacle",
      check: "checkObs",
      css: "obs-state",
      dot: "dot-obs",
    },
  ];
  ids.forEach(({ stateEl, check, css, dot }, i) => {
    const el = document.getElementById(stateEl);
    const chk = document.getElementById(check);
    el.className = "state-item";
    chk.textContent = "—";
    if (statuses[i] === s) {
      el.classList.add("active-state");
      if (css) el.classList.add(css);
      chk.textContent = "✓";
    }
    const dotEl = el.querySelector(".state-dot");
    dotEl.className = ("state-dot " + dot).trim();
  });

  const fills = { idle: "20%", moving: "70%", obstacle: "50%" };
  const colors = {
    idle: "linear-gradient(to right,#4a6080,#64748b)",
    moving: "linear-gradient(to right,#7dd3fc,#38bdf8)",
    obstacle: "linear-gradient(to right,#f97316,#fb923c)",
  };
  const fill = document.getElementById("statusBarFill");
  fill.style.width = fills[s];
  fill.style.background = colors[s];

  const stText = document.getElementById("statusText");
  const stDot = document
    .getElementById("sysStatus")
    .querySelector(".status-dot");
  stDot.className = "status-dot";
  if (s === "idle") {
    stText.textContent = "SYSTEM IDLE";
    stText.className = "status-text";
    stDot.classList.add("dot-green");
  }
  if (s === "moving") {
    stText.textContent = "AGV MOVING";
    stText.className = "status-text moving";
    stDot.classList.add("dot-moving");
  }
  if (s === "obstacle") {
    stText.textContent = "OBSTACLE DETECTED";
    stText.className = "status-text obstacle";
    stDot.classList.add("dot-orange");
  }
  if (s === "estop") {
    stText.textContent = "E-STOP ENGAGED";
    stText.className = "status-text estop";
    stDot.classList.add("dot-red");
  }
}

function updateTelemetry() {
  document.getElementById("dispX").textContent = String(state.agv.col).padStart(
    2,
    "0",
  );
  document.getElementById("dispY").textContent = String(state.agv.row).padStart(
    2,
    "0",
  );
  const deg = Math.round(((state.agv.angle * 180) / Math.PI + 360) % 360);
  document.getElementById("dispTheta").textContent = deg;
  document.getElementById("velV").textContent = Number(
    state.velocity.v,
  ).toFixed(2);
  document.getElementById("velW").textContent = Number(
    state.velocity.w,
  ).toFixed(2);
  document.getElementById("compassNeedle").style.transform =
    `rotate(${deg}deg)`;
  drawArc("arcV", Number(state.velocity.v), 0.4, "#38bdf8");
  drawArc("arcW", Number(state.velocity.w), 0.3, "#a78bfa");
}

/* Arc gauge */
function drawArc(id, val, max, color) {
  const c = document.getElementById(id);
  if (!c) return;
  const ct = c.getContext("2d");
  const W = c.width,
    H = c.height;
  ct.clearRect(0, 0, W, H);
  const cx = W / 2,
    cy = H - 4;
  const r = Math.min(W, H * 2) / 2 - 4;
  const startA = Math.PI,
    endA = 0;
  const prog = Math.min(val / max, 1);

  ct.beginPath();
  ct.arc(cx, cy, r, startA, endA);
  ct.strokeStyle = "rgba(255,255,255,0.06)";
  ct.lineWidth = 5;
  ct.lineCap = "round";
  ct.stroke();

  ct.beginPath();
  ct.arc(cx, cy, r, startA, startA + prog * Math.PI);
  ct.strokeStyle = color;
  ct.lineWidth = 5;
  ct.lineCap = "round";
  ct.shadowColor = color;
  ct.shadowBlur = 6;
  ct.stroke();
  ct.shadowBlur = 0;

  for (let i = 0; i <= 4; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    const x1 = cx + (r - 5) * Math.cos(a),
      y1 = cy + (r - 5) * Math.sin(a);
    const x2 = cx + (r + 1) * Math.cos(a),
      y2 = cy + (r + 1) * Math.sin(a);
    ct.beginPath();
    ct.moveTo(x1, y1);
    ct.lineTo(x2, y2);
    ct.strokeStyle = "rgba(255,255,255,0.1)";
    ct.lineWidth = 1;
    ct.stroke();
  }
}

/* Battery cells */
function updateBattery() {
  const pct = state.battery;
  document.getElementById("batPct").textContent = pct + "%";
  document.getElementById("batPct2").textContent = pct + "%";
  document.getElementById("batFill").style.width = pct + "%";
  document.getElementById("batProg").style.width = pct + "%";
  document.getElementById("batVolt").textContent =
    (9 + pct * 0.026).toFixed(1) + "V";
  document.getElementById("batTime").textContent =
    `~${Math.round(pct * 0.54)} min`;

  const cells = document.querySelectorAll(".bat-cell");
  const lit = Math.round(pct / 20);
  cells.forEach((c, i) => {
    c.className = "bat-cell";
    if (i < lit) {
      if (pct <= 20) c.classList.add("lit-crit");
      else if (pct <= 40) c.classList.add("lit-warn");
      else c.classList.add("lit");
    }
  });

  const fill = document.getElementById("batFill");
  if (pct <= 20)
    fill.style.background = "linear-gradient(to right,#f87171,#fca5a5)";
  else if (pct <= 40)
    fill.style.background = "linear-gradient(to right,#f97316,#fb923c)";
  else fill.style.background = "linear-gradient(to right,#4ade80,#86efac)";
}

/* ═══════════════════════════════════════════
   SYSTEM LOG
═══════════════════════════════════════════ */
let logCount = 0;
const startTime = Date.now();

function addLog(type, tag, msg) {
  const feed = document.getElementById("logFeed");
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
  document.getElementById("logFeed").innerHTML = "";
}

/* ═══════════════════════════════════════════
   MAP CONTROLS
═══════════════════════════════════════════ */
function mapAction(action) {
  // NÚT RESET - Đưa xe về tức thời (0,0)
  if (action === "reset") {
    stopMovement();
    state.path = [];
    state.visitedCells.clear();

    // Đặt state gốc
    state.agv.col = 0;
    state.agv.row = 0;
    state.agv.angle = 0;

    // Đặt tọa độ vẽ tức thời tránh tình trạng xe trượt từ xa về
    renderX = 0 * CELL + CELL / 2;
    renderY = 0 * CELL + CELL / 2;
    renderAngle = 0;

    setState("idle");
    document.getElementById("pathBadge").textContent = "BFS: — steps";
    addLog("info", "[SYS]", "Đã reset AGV về tức thời vị trí (0,0)");
    updateTelemetry();
  }
  if (action === "home") {
    setGoal(state.home.col, state.home.row, "Home Base");
  }
  if (action === "clear") {
    stopMovement();
    state.path = [];
    state.visitedCells.clear();
    setState("idle");
    document.getElementById("pathBadge").textContent = "BFS: — steps";
    addLog("info", "[MAP]", "Đã xóa đường đi và lịch sử");
  }
  if (action === "start") {
    if (state.path && state.path.length > 0 && !state.moving) {
      addLog("info", "[CMD]", "Bắt đầu di chuyển...");
      startMovement();
    } else {
      addLog("warn", "[CMD]", "Chưa chọn điểm đến hoặc xe đang chạy!");
    }
  }

  // TÍNH NĂNG BẬT/TẮT VẬT CẢN (TOGGLE BẰNG TAY)
  if (action === "obstacle") {
    state.obstacleMode = !state.obstacleMode; // Đảo trạng thái
    const btn = document.getElementById("btnObstacle");

    if (state.obstacleMode) {
      btn.classList.add("mctrl-active"); // Sáng lên
      addLog(
        "info",
        "[MAP]",
        "ĐÃ BẬT chế độ vật cản. Tính năng chọn đường tạm khóa.",
      );
      state.path = []; // Xóa path cũ để nhìn map rõ hơn
    } else {
      btn.classList.remove("mctrl-active"); // Tắt đèn
      addLog("info", "[MAP]", "ĐÃ TẮT chế độ vật cản. Hoạt động bình thường.");
    }
  }
}

/* ═══════════════════════════════════════════
   EMERGENCY STOP
═══════════════════════════════════════════ */
function toggleEmergency() {
  state.estop = !state.estop;
  const btn = document.getElementById("eStopBtn");
  if (state.estop) {
    stopMovement();
    state.path = [];
    setState("estop");
    btn.classList.add("active-estop");
    btn.textContent = "▶ RESUME";
    addLog("err", "[ESTOP]", "E-STOP activated! AGV halted.");
    simulateMQTT(`/agv/cmd/estop → HALT`);
  } else {
    setState("idle");
    btn.classList.remove("active-estop");
    btn.textContent = "⬛ E-STOP";
    addLog("ok", "[ESTOP]", "E-STOP cleared. System resumed.");
    simulateMQTT(`/agv/cmd/estop → CLEAR`);
  }
}

/* ═══════════════════════════════════════════
   MQTT SIMULATION
═══════════════════════════════════════════ */
function simulateMQTT(msg) {
  mqttTxCount++;
  mqttRxCount += Math.random() > 0.3 ? 1 : 0;
  const el = document.getElementById("mqttPackets");
  if (el) el.textContent = `TX: ${mqttTxCount} · RX: ${mqttRxCount}`;
  addLog("info", "[MQTT]", msg);
}

/* ═══════════════════════════════════════════
   NAV: TIME & UPTIME
═══════════════════════════════════════════ */
function updateNav() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  document.getElementById("navTime").textContent =
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  state.uptime++;
  const h = Math.floor(state.uptime / 3600),
    m = Math.floor((state.uptime % 3600) / 60),
    s = state.uptime % 60;
  document.getElementById("uptimeVal").textContent =
    `${pad(h)}:${pad(m)}:${pad(s)}`;

  const lat = 6 + Math.floor(Math.random() * 8);
  document.getElementById("latencyVal").textContent = lat + "ms";

  if (state.moving && state.uptime % 30 === 0 && state.battery > 5) {
    state.battery -= 1;
    updateBattery();
  }
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
function init() {
  drawArc("arcV", 0, 0.4, "#38bdf8");
  drawArc("arcW", 0, 0.3, "#a78bfa");
  updateTelemetry();
  updateBattery();
  setState("idle");

  drawMap();
  setInterval(updateNav, 1000);

  addLog("ok", "[SYS]", "AGV Dashboard initialized");
  addLog("ok", "[ROS]", "ROS2 Humble node connected");
  addLog("info", "[AGV]", "Vị trí: (0,0) — Home Base");
  addLog(
    "info",
    "[SYS]",
    "Sẵn sàng nhận lệnh... Click lên Map rồi nhấn START.",
  );
}

init();
