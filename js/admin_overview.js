import { db } from "./firebase.js";
import {
  requireAdmin,
  toDate,
  formatDateTime,
  escapeHTML,
  roleLabel,
  showToast,
} from "./admin_common.js";
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

let chartState = null;
let resizeTimer = null;

document.addEventListener("DOMContentLoaded", initOverview);
window.addEventListener("resize", () => {
  if (!chartState) return;
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => renderCharts(chartState), 160);
});

async function initOverview() {
  const session = await requireAdmin();
  if (!session) return;

  try {
    await loadOverviewData();
  } catch (error) {
    console.error(error);
    showToast("Không tải được dữ liệu Admin: " + error.message, "error");
  }
}

async function loadOverviewData() {
  const [usersSnap, pendingSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "pending_requests")),
  ]);

  const users = usersSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));

  const pending = pendingSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthCounts = Array.from({ length: daysInMonth }, () => 0);

  const newThisMonthUsers = [];
  users.forEach((user) => {
    const createdAt = toDate(user.createdAt || user.approvedAt);
    if (!createdAt) return;
    if (createdAt.getFullYear() === year && createdAt.getMonth() === month) {
      monthCounts[createdAt.getDate() - 1] += 1;
      newThisMonthUsers.push(user);
    }
  });

  const roleCounts = users.reduce((acc, user) => {
    const role = String(user.role || "unknown").toLowerCase();
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {});

  document.getElementById("totalUsers").textContent = users.length;
  document.getElementById("newThisMonth").textContent = newThisMonthUsers.length;
  document.getElementById("pendingCount").textContent = pending.length;
  document.getElementById("adminCount").textContent = roleCounts.admin || 0;

  const monthText = `Tháng ${String(month + 1).padStart(2, "0")}/${year}`;
  document.getElementById("monthLabel").textContent = monthText;
  document.getElementById("chartMonthChip").textContent = monthText.toUpperCase();

  chartState = {
    monthLabels: monthCounts.map((_, index) => String(index + 1)),
    monthCounts,
    roleLabels: Object.keys(roleCounts).map(roleLabel),
    roleCounts: Object.values(roleCounts),
  };
  renderCharts(chartState);
  renderLatestUsers(users);
}

function renderLatestUsers(users) {
  const body = document.getElementById("latestUsersBody");
  const sorted = [...users]
    .sort((a, b) => {
      const da = toDate(a.createdAt || a.approvedAt)?.getTime() || 0;
      const db = toDate(b.createdAt || b.approvedAt)?.getTime() || 0;
      return db - da;
    })
    .slice(0, 8);

  if (!sorted.length) {
    body.innerHTML = `
      <tr>
        <td colspan="5">Chưa có dữ liệu trong collection users.</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = sorted
    .map((user) => {
      const name = `${user.firstName || ""} ${user.lastName || ""}`.trim() || "—";
      const role = String(user.role || "unknown").toLowerCase();
      const status = String(user.status || "active").toLowerCase();
      return `
        <tr>
          <td>${escapeHTML(name)}</td>
          <td>${escapeHTML(user.email || "—")}</td>
          <td><span class="role-badge ${escapeHTML(role)}">${escapeHTML(roleLabel(role))}</span></td>
          <td><span class="status-badge ${escapeHTML(status)}">${escapeHTML(status)}</span></td>
          <td>${escapeHTML(formatDateTime(user.createdAt || user.approvedAt))}</td>
        </tr>
      `;
    })
    .join("");
}

function renderCharts(state) {
  drawMonthlyBarChart(
    document.getElementById("newUsersChart"),
    state.monthLabels,
    state.monthCounts,
  );
  drawRoleDoughnutChart(
    document.getElementById("roleChart"),
    state.roleLabels,
    state.roleCounts,
  );
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, rect.width);
  const height = Math.max(280, rect.height);
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function drawMonthlyBarChart(canvas, labels, values) {
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const pad = { left: 46, right: 20, top: 24, bottom: 48 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const maxValue = Math.max(...values, 1);
  const tickMax = Math.max(1, Math.ceil(maxValue));

  ctx.font = "12px 'Share Tech Mono', monospace";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i++) {
    const ratio = i / 4;
    const y = pad.top + chartH - chartH * ratio;
    const label = Math.round(tickMax * ratio);

    ctx.strokeStyle = "rgba(125, 211, 252, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = "rgba(184, 200, 221, 0.88)";
    ctx.textAlign = "right";
    ctx.fillText(label, pad.left - 12, y);
  }

  const slot = chartW / values.length;
  const barW = Math.max(5, Math.min(22, slot * 0.58));

  values.forEach((value, index) => {
    const x = pad.left + slot * index + (slot - barW) / 2;
    const barH = value > 0 ? Math.max(8, (value / tickMax) * chartH) : 0;
    const y = pad.top + chartH - barH;

    if (value > 0) {
      const grad = ctx.createLinearGradient(0, y, 0, pad.top + chartH);
      grad.addColorStop(0, "rgba(103, 232, 249, 1)");
      grad.addColorStop(0.55, "rgba(56, 189, 248, 0.78)");
      grad.addColorStop(1, "rgba(59, 130, 246, 0.28)");
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, barW, barH, 7);
      ctx.fill();

      ctx.shadowColor = "rgba(56, 189, 248, 0.35)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = "rgba(103, 232, 249, 0.95)";
      roundRect(ctx, x, y, barW, Math.min(5, barH), 5);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = "rgba(125, 211, 252, 0.12)";
      roundRect(ctx, x, pad.top + chartH - 3, barW, 3, 3);
      ctx.fill();
    }

    if ((index + 1) % 5 === 0 || index === 0 || index === values.length - 1) {
      ctx.fillStyle = "rgba(184, 200, 221, 0.86)";
      ctx.textAlign = "center";
      ctx.fillText(labels[index], x + barW / 2, height - 24);
    }
  });

  ctx.fillStyle = "rgba(103, 232, 249, 0.95)";
  ctx.textAlign = "left";
  ctx.fillText("Ngày trong tháng", pad.left, height - 10);
}

function drawRoleDoughnutChart(canvas, labels, values) {
  const { ctx, width, height } = setupCanvas(canvas);
  ctx.clearRect(0, 0, width, height);

  const total = values.reduce((sum, value) => sum + value, 0);
  const cx = width / 2;
  const cy = height / 2 - 18;
  const radius = Math.min(width, height) * 0.27;
  const lineWidth = Math.max(24, radius * 0.34);
  const colors = [
    "#38bdf8",
    "#a78bfa",
    "#4ade80",
    "#facc15",
    "#fb923c",
    "#fb7185",
  ];

  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";

  ctx.strokeStyle = "rgba(125, 211, 252, 0.13)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (!total) {
    ctx.fillStyle = "rgba(234, 244, 255, 0.86)";
    ctx.font = "700 14px 'DM Sans', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Chưa có user", cx, cy);
    return;
  }

  let start = -Math.PI / 2;
  values.forEach((value, index) => {
    const angle = (value / total) * Math.PI * 2;
    const grad = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    grad.addColorStop(0, colors[index % colors.length]);
    grad.addColorStop(1, "rgba(56, 189, 248, 0.35)");
    ctx.strokeStyle = grad;
    ctx.shadowColor = colors[index % colors.length];
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.stroke();
    ctx.shadowBlur = 0;
    start += angle;
  });

  ctx.fillStyle = "rgba(255, 255, 255, 0.98)";
  ctx.font = "900 36px 'DM Sans', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(total, cx, cy - 6);
  ctx.font = "12px 'Share Tech Mono', monospace";
  ctx.fillStyle = "rgba(184, 200, 221, 0.95)";
  ctx.fillText("USERS", cx, cy + 28);

  const legendTop = cy + radius + 44;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "13px 'DM Sans', sans-serif";

  labels.forEach((label, index) => {
    const x = width * 0.12 + (index % 2) * width * 0.44;
    const y = legendTop + Math.floor(index / 2) * 26;
    ctx.fillStyle = colors[index % colors.length];
    roundRect(ctx, x, y - 6, 12, 12, 4);
    ctx.fill();
    ctx.fillStyle = "rgba(234, 244, 255, 0.94)";
    ctx.fillText(`${label}: ${values[index]}`, x + 20, y);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
