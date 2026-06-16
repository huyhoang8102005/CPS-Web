"use strict";
/* ═══════════════════════════════════════════
   AGV DASHBOARD — dashboard.js
   Modules: Grid/Dijkstra, Telemetry, Compass,
            Arc Gauges, Log, MQTT sim
═══════════════════════════════════════════ */

/* ── GRID CONFIG ─────────────────────────────── */
const COLS = 10,
  ROWS = 15;
const CELL = 55;

/* ── GLOBAL STATE ────────────────────────────── */
const state = {
  agv: { col: 0, row: 0, angle: 0 },  // Đặt xe mặc định ở (0,0) - Góc dưới trái
  goal: { col: 0, row: 0 },
  home: { col: 0, row: 0 },
  prevPos: null,                      // Lưu vị trí cũ trước khi di chuyển
  path: [],
  pathStep: 0,
  moving: false,
  estop: false,
  agvStatus: "idle",
  velocity: { v: 0, w: 0 },
  mqttTx: 0,
  mqttRx: 0,
  uptime: 0,
  moveInterval: null,
  animFrame: null,
  visitedCells: new Set(),
};

/* ═══════════════════════════════════════════
   DIJKSTRA PATHFINDING ALGORITHM
═══════════════════════════════════════════ */
function dijkstra(sc, sr, gc, gr) {
  if (sc === gc && sr === gr) return [];
  
  const key = (c, r) => `${c},${r}`;
  const dist = new Map();     // Lưu chi phí nhỏ nhất để đến từng node
  const parent = new Map();   // Lưu dấu đường đi
  const pq = [];              // Priority Queue (Hàng đợi ưu tiên)

  // Khởi tạo điểm xuất phát
  dist.set(key(sc, sr), 0);
  parent.set(key(sc, sr), null);
  pq.push({ c: sc, r: sr, cost: 0 });

  const dirs = [
    [1, 0],   // Phải
    [-1, 0],  // Trái
    [0, 1],   // Lên
    [0, -1],  // Xuống
  ];

  while (pq.length > 0) {
    // Sắp xếp lại Queue để lấy Node có cost thấp nhất (Dijkstra cốt lõi)
    pq.sort((a, b) => a.cost - b.cost);
    const curr = pq.shift();
    const cc = curr.c;
    const cr = curr.r;

    // Nếu đã tới đích, truy xuất ngược mảng parent để lấy đường đi
    if (cc === gc && cr === gr) {
      const path = [];
      let curKey = key(gc, gr);
      while (curKey) {
        const [c, r] = curKey.split(",").map(Number);
        path.push({ col: c, row: r });
        curKey = parent.get(curKey);
      }
      return path.reverse();
    }

    // Duyệt qua 4 hướng
    for (const [dc, dr] of dirs) {
      const nc = cc + dc;
      const nr = cr + dr;
      
      // Kiểm tra viền sa bàn
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;

      const nk = key(nc, nr);
      // Chi phí bước đi (Ở đây đồng nhất là 1, bạn có thể chỉnh sửa nếu ô có trọng số)
      const newCost = dist.get(key(cc, cr)) + 1;

      // Nếu ô chưa được tính toán hoặc tìm được đường mới ngắn hơn đường cũ
      if (!dist.has(nk) || newCost < dist.get(nk)) {
        dist.set(nk, newCost);
        parent.set(nk, key(cc, cr));
        pq.push({ c: nc, r: nr, cost: newCost });
      }
    }
  }
  return null; // Không tìm được đường
}

/* ═══════════════════════════════════════════
   CANVAS MAP RENDERER (Y=0 ở dưới cùng)
═══════════════════════════════════════════ */
const canvas = document.getElementById("mapCanvas");
const ctx = canvas.getContext("2d");
canvas.width = COLS * CELL;
canvas.height = ROWS * CELL;

// Khởi tạo tọa độ render ban đầu
let renderX = state.agv.col * CELL + CELL / 2;
let renderY = (ROWS - 1 - state.agv.row) * CELL + CELL / 2;
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
      const x = c * CELL;
      const y = (ROWS - 1 - r) * CELL; // Lật ngược trục Y: r=0 nằm ở dưới đáy
      const key = `${c},${r}`;

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

  // Draw Home
  const hx = state.home.col * CELL;
  const hy = (ROWS - 1 - state.home.row) * CELL;
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

  // Draw Path
  if (state.path.length > 1) {
    state.path.forEach((p, i) => {
      if (i === 0) return;
      const px = p.col * CELL;
      const py = (ROWS - 1 - p.row) * CELL;
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
      const px = p.col * CELL + CELL / 2;
      const py = (ROWS - 1 - p.row) * CELL + CELL / 2;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
  }

  // Draw Goal
  if (state.path.length > 0) {
    const g = state.goal;
    const gx = g.col * CELL;
    const gy = (ROWS - 1 - g.row) * CELL;
    const grad = ctx.createRadialGradient(
      gx + CELL / 2, gy + CELL / 2, 0,
      gx + CELL / 2, gy + CELL / 2, CELL * 0.7
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

  // Cập nhật vị trí render của AGV (lerp mượt mà)
  const targetX = state.agv.col * CELL + CELL / 2;
  const targetY = (ROWS - 1 - state.agv.row) * CELL + CELL / 2;
  renderX = lerp(renderX, targetX, 0.15);
  renderY = lerp(renderY, targetY, 0.15);

  // Xử lý góc xoay đảo ngược do Y của canvas vẽ từ trên xuống
  let targetAngle = -state.agv.angle; 
  let da = targetAngle - renderAngle;
  if (da > Math.PI) da -= Math.PI * 2;
  if (da < -Math.PI) da += Math.PI * 2;
  renderAngle += da * 0.12;

  const agvGrad = ctx.createRadialGradient(renderX, renderY, 0, renderX, renderY, CELL * 0.8);
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
  [[-15, -15], [15, -15], [-15, 15], [15, 15]].forEach(([wx, wy]) => {
    ctx.beginPath(); ctx.arc(wx, wy, 4, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = "rgba(56,189,248,0.95)";
  ctx.beginPath();
  ctx.moveTo(18, 0); ctx.lineTo(9, -7); ctx.lineTo(9, 7);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#38bdf8";
  ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  buildAxisLabels();
  state.animFrame = requestAnimationFrame(drawMap);
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
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
  // Xây dựng trục Y từ trên xuống dưới (đỉnh canvas là ROWS - 1, đáy là 0)
  for (let r = ROWS - 1; r >= 0; r--) {
    const el = document.createElement("span");
    el.className = "axis-label";
    el.textContent = r;
    el.style.height = CELL + "px";
    el.style.display = "flex";
    el.style.alignItems = "center";
    axY.appendChild(el);
  }
  // Trục X bình thường từ 0 -> COLS - 1
  for (let c = 0; c < COLS; c++) {
    const el = document.createElement("span");
    el.className = "axis-label";
    el.textContent = c;
    el.style.width = CELL + "px";
    axX.appendChild(el);
  }
}

/* =========================================================
   XỬ LÝ CLICK CANVAS ĐÃ QUY ĐỔI HỆ TỌA ĐỘ
========================================================= */
canvas.addEventListener("click", (e) => {
  if (state.estop) return;

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;
  
  const gc = Math.floor(mx / CELL);
  const visual_r = Math.floor(my / CELL);
  const gr = ROWS - 1 - visual_r; // Chuyển đổi tọa độ Y thực tế

  if (gc < 0 || gr < 0 || gc >= COLS || gr >= ROWS) return;
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
  const visual_r = Math.floor(my / CELL);
  const gr = ROWS - 1 - visual_r;

  const tt = document.getElementById("goalTooltip");
  const ttText = document.getElementById("goalTooltipText");

  if (gc >= 0 && gr >= 0 && gc < COLS && gr < ROWS) {
    tt.style.borderColor = "var(--border)";
    ttText.style.color = "var(--cyan)";
    ttText.textContent = `Click → đặt mục tiêu (${gc},${gr})`;

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
  
  // Lưu lại vị trí hiện tại thành "vị trí cũ" trước khi đi điểm mới
  state.prevPos = { col: state.agv.col, row: state.agv.row };

  state.goal.col = gc;
  state.goal.row = gr;
  
  // Thay đổi hàm tìm đường sang Dijkstra
  const path = dijkstra(state.agv.col, state.agv.row, gc, gr);

  if (!path) {
    addLog("err", "[DIJKSTRA]", "Không tìm thấy đường đi!");
    return;
  }
  if (path.length === 0) {
    addLog("info", "[AGV]", "AGV đã ở tại vị trí này rồi!");
    return;
  }

  state.path = path;
  state.pathStep = 0;
  
  // Update UI & Log
  document.getElementById("pathBadge").textContent = `Dijkstra: ${path.length - 1} steps`;
  addLog("info", "[DIJKSTRA]", `Tìm thấy đường → ${label}. Nhấn START để chạy.`);
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
    const dx = next.col - state.agv.col;
    const dy = next.row - state.agv.row;
    
    state.agv.angle = Math.atan2(dy, dx); // Tính góc Toán học chuẩn
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
  const statuses = ["idle", "moving"];
  const ids = [
    { stateEl: "stateIdle", check: "checkIdle", css: "", dot: "dot-idle" },
    { stateEl: "stateMoving", check: "checkMoving", css: "moving-state", dot: "dot-moving" },
  ];
  ids.forEach(({ stateEl, check, css, dot }, i) => {
    const el = document.getElementById(stateEl);
    if(!el) return;
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

  const fills = { idle: "20%", moving: "70%" };
  const colors = {
    idle: "linear-gradient(to right,#4a6080,#64748b)",
    moving: "linear-gradient(to right,#7dd3fc,#38bdf8)",
  };
  const fill = document.getElementById("statusBarFill");
  if(fill) {
    fill.style.width = fills[s] || "50%";
    fill.style.background = colors[s] || "red";
  }

  const stText = document.getElementById("statusText");
  const stDot = document.getElementById("sysStatus").querySelector(".status-dot");
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
  if (s === "estop") {
    stText.textContent = "E-STOP ENGAGED";
    stText.className = "status-text estop";
    stDot.classList.add("dot-red");
  }
}

function updateTelemetry() {
  document.getElementById("dispX").textContent = String(state.agv.col).padStart(2, "0");
  document.getElementById("dispY").textContent = String(state.agv.row).padStart(2, "0");
  
  // Tính toán góc hiển thị La bàn (0 độ = Hướng Bắc/UP trên UI)
  const math_deg = Math.round(((state.agv.angle * 180) / Math.PI + 360) % 360);
  document.getElementById("dispTheta").textContent = math_deg;
  
  // CSS kim la bàn mặc định chỉa lên. Chuyển đổi góc toán học sang góc CSS
  const css_deg = 90 - math_deg; 
  document.getElementById("compassNeedle").style.transform = `rotate(${css_deg}deg)`;

  document.getElementById("velV").textContent = Number(state.velocity.v).toFixed(2);
  document.getElementById("velW").textContent = Number(state.velocity.w).toFixed(2);
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
  if (action === "reset") {
    stopMovement();
    state.path = [];
    state.visitedCells.clear();
    state.agv.col = 0;
    state.agv.row = 0;
    state.agv.angle = 0;
    
    // Reset ngay lập tức tọa độ render về gốc dưới trái
    renderX = 0 * CELL + CELL / 2;
    renderY = (ROWS - 1 - 0) * CELL + CELL / 2;
    renderAngle = 0;

    setState("idle");
    document.getElementById("pathBadge").textContent = "Dijkstra: — steps";
    addLog("info", "[SYS]", "Đã reset AGV về tọa độ (0,0)");
    updateTelemetry();
  }
  if (action === "home") {
    setGoal(state.home.col, state.home.row, "Home Base");
  }
  // LOGIC NÚT "VỀ VỊ TRÍ CŨ"
  if (action === "return") {
    if (state.prevPos) {
      addLog("info", "[CMD]", "Đang tính toán trở về vị trí trước đó...");
      setGoal(state.prevPos.col, state.prevPos.row, "Vị trí cũ");
      startMovement(); // Tự động kích hoạt chạy luôn cho tiện
    } else {
      addLog("warn", "[CMD]", "Chưa có dữ liệu vị trí xuất phát để quay lại!");
    }
  }
  if (action === "clear") {
    stopMovement();
    state.path = [];
    state.visitedCells.clear();
    setState("idle");
    document.getElementById("pathBadge").textContent = "Dijkstra: — steps";
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
  state.mqttTx++;
  state.mqttRx += Math.random() > 0.3 ? 1 : 0;
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
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
function init() {
  drawArc("arcV", 0, 0.4, "#38bdf8");
  drawArc("arcW", 0, 0.3, "#a78bfa");
  updateTelemetry();
  setState("idle");

  renderX = state.agv.col * CELL + CELL / 2;
  renderY = (ROWS - 1 - state.agv.row) * CELL + CELL / 2;

  drawMap();
  setInterval(updateNav, 1000);

  addLog("ok", "[SYS]", "AGV Dashboard initialized");
  addLog("ok", "[ROS]", "ROS2 Humble node connected");
  addLog("info", "[AGV]", "Vị trí ban đầu: (0,0) — Góc dưới trái");
  addLog("info", "[SYS]", "Sẵn sàng nhận lệnh... Click lên Map rồi nhấn START.");
}

init();