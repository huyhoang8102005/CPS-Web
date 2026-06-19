import { db, firebaseConfig } from "./firebase.js";
import {
  requireAdmin,
  formatDateTime,
  escapeHTML,
  roleLabel,
  showToast,
} from "./admin_common.js";
import {
  initializeApp,
  getApps,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const pendingMap = new Map();
let currentKeyword = "";
let currentAdmin = null;

document.addEventListener("DOMContentLoaded", initRequestsPage);

async function initRequestsPage() {
  currentAdmin = await requireAdmin();
  if (!currentAdmin) return;

  const searchInput = document.getElementById("requestSearch");
  searchInput?.addEventListener("input", (event) => {
    currentKeyword = event.target.value.trim().toLowerCase();
    renderRequests([...pendingMap.values()]);
  });

  document.getElementById("requestList")?.addEventListener("click", handleListClick);
  listenPendingRequests();
}

function listenPendingRequests() {
  const list = document.getElementById("requestList");
  const pendingQuery = query(collection(db, "pending_requests"), orderBy("createdAt", "desc"));

  onSnapshot(
    pendingQuery,
    (snapshot) => {
      pendingMap.clear();
      snapshot.docs.forEach((docSnap) => {
        pendingMap.set(docSnap.id, {
          id: docSnap.id,
          ...docSnap.data(),
        });
      });
      renderStats([...pendingMap.values()]);
      renderRequests([...pendingMap.values()]);
    },
    (error) => {
      console.error(error);
      list.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1">
          <strong>Không thể tải danh sách yêu cầu</strong>
          ${escapeHTML(error.message)}
        </div>
      `;
      showToast("Không thể tải danh sách đăng ký. Vui lòng thử lại sau.", "error");
    },
  );
}

function renderStats(requests) {
  const operatorCount = requests.filter((req) => req.role === "operator").length;
  const adminCount = requests.filter((req) => req.role === "admin").length;

  document.getElementById("pendingCount").textContent = requests.length;
  document.getElementById("pendingTotalHero").textContent = `${requests.length} yêu cầu`;
  document.getElementById("operatorCount").textContent = operatorCount;
  document.getElementById("adminReqCount").textContent = adminCount;
  document.getElementById("lastUpdate").textContent = new Date().toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderRequests(requests) {
  const list = document.getElementById("requestList");
  const filtered = requests.filter((req) => {
    if (!currentKeyword) return true;
    const fullName = `${req.firstName || ""} ${req.lastName || ""}`.toLowerCase();
    const email = String(req.email || "").toLowerCase();
    return fullName.includes(currentKeyword) || email.includes(currentKeyword);
  });

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <strong>${requests.length ? "Không tìm thấy tài khoản phù hợp" : "Chưa có tài khoản nào chờ duyệt"}</strong>
        ${requests.length ? "Thử tìm bằng tên hoặc email khác." : "Các đăng ký mới sẽ tự động xuất hiện tại đây."}
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.map(renderRequestCard).join("");
}

function renderRequestCard(req) {
  const id = escapeHTML(req.id);
  const firstName = escapeHTML(req.firstName || "");
  const lastName = escapeHTML(req.lastName || "");
  const fullName = `${firstName} ${lastName}`.trim() || "User mới";
  const email = escapeHTML(req.email || "—");
  const requestedRole = String(req.role || "operator").toLowerCase();

  return `
    <article class="request-card" data-request-card="${id}">
      <div class="request-head">
        <div>
          <div class="request-name">${fullName}</div>
          <div class="request-email">${email}</div>
        </div>
        <div class="request-time">${escapeHTML(formatDateTime(req.createdAt))}</div>
      </div>

      <div class="request-body">
        <div class="info-grid">
          <div class="info-item">
            <span class="info-label">VAI TRÒ ĐĂNG KÝ</span>
            <span class="info-value"><span class="role-badge ${escapeHTML(requestedRole)}">${escapeHTML(roleLabel(requestedRole))}</span></span>
          </div>
          <div class="info-item">
            <span class="info-label">TRẠNG THÁI</span>
            <span class="info-value"><span class="status-badge pending">${escapeHTML(statusLabel(req.status))}</span></span>
          </div>
        </div>

        <div class="approve-box">
          <div class="form-field">
            <label for="role-${id}">VAI TRÒ CẤP</label>
            <select id="role-${id}" data-role-input="${id}">
              <option value="operator" ${requestedRole === "operator" ? "selected" : ""}>Operator</option>
              <option value="admin" ${requestedRole === "admin" ? "selected" : ""}>Admin</option>
            </select>
          </div>

          <div class="form-field">
            <label for="pass-${id}">MẬT KHẨU TẠM</label>
            <input id="pass-${id}" data-password-input="${id}" type="text" placeholder="Tối thiểu 6 ký tự" autocomplete="off" />
          </div>

          <div class="request-actions">
            <button class="action-btn" type="button" data-action="random" data-id="${id}">GỢI Ý MẬT KHẨU</button>
            <button class="action-btn primary" type="button" data-action="approve" data-id="${id}">CẤP TÀI KHOẢN</button>
            <button class="action-btn" type="button" data-action="reset-mail" data-id="${id}" title="Gửi email để người dùng tự đặt lại mật khẩu">GỬI EMAIL ĐẶT LẠI</button>
            <button class="action-btn danger" type="button" data-action="reject" data-id="${id}">XÓA YÊU CẦU</button>
          </div>
        </div>
      </div>
    </article>
  `;
}

async function handleListClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  const action = button.dataset.action;

  if (action === "random") {
    const input = document.querySelector(`[data-password-input="${CSS.escape(id)}"]`);
    if (input) input.value = generateTempPassword();
    return;
  }

  if (action === "approve") {
    await approveRequest(id, button);
    return;
  }

  if (action === "reset-mail") {
    await sendResetEmailForRequest(id, button);
    return;
  }

  if (action === "reject") {
    await rejectRequest(id, button);
  }
}

function statusLabel(status) {
  const value = String(status || "pending").toLowerCase();
  const labels = {
    pending: "Đang chờ duyệt",
    approved: "Đã duyệt",
    rejected: "Đã từ chối",
    active: "Đang hoạt động",
  };
  return labels[value] || "Đang chờ duyệt";
}

function generateTempPassword() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  const n = Math.floor(100 + Math.random() * 900);
  return `AGV-${random}#${n}`;
}

function getSecondaryAuth() {
  const appName = "admin-secondary-auth";
  const secondaryApp = getApps().find((app) => app.name === appName) || initializeApp(firebaseConfig, appName);
  return getAuth(secondaryApp);
}

async function approveRequest(id, button) {
  const req = pendingMap.get(id);
  if (!req) {
    showToast("Yêu cầu này đã được xử lý hoặc không còn tồn tại.", "warn");
    return;
  }

  const passwordInput = document.querySelector(`[data-password-input="${CSS.escape(id)}"]`);
  const roleInput = document.querySelector(`[data-role-input="${CSS.escape(id)}"]`);
  const password = passwordInput?.value.trim() || "";
  const role = roleInput?.value || req.role || "operator";

  if (!req.email) {
    showToast("Không thể tạo tài khoản vì thông tin đăng ký thiếu email.", "error");
    return;
  }

  if (password.length < 6) {
    passwordInput?.focus();
    showToast("Mật khẩu tạm phải có ít nhất 6 ký tự.", "warn");
    return;
  }

  setButtonLoading(button, true, "ĐANG TẠO...");

  try {
    const secondaryAuth = getSecondaryAuth();
    const credential = await createUserWithEmailAndPassword(secondaryAuth, req.email, password);
    const createdUser = credential.user;

    await setDoc(
      doc(db, "users", createdUser.uid),
      {
        uid: createdUser.uid,
        email: req.email,
        firstName: req.firstName || "",
        lastName: req.lastName || "",
        role,
        status: "active",
        source: "admin_approval",
        pendingRequestId: id,
        createdAt: serverTimestamp(),
        approvedAt: serverTimestamp(),
        approvedBy: currentAdmin?.user?.uid || null,
      },
      { merge: true },
    );

    await signOut(secondaryAuth).catch(() => {});
    await deleteDoc(doc(db, "pending_requests", id));

    const displayName = `${req.firstName || ""} ${req.lastName || ""}`.trim() || req.email;
    showToast(`Đã kích hoạt tài khoản cho ${displayName}.`, "ok");
  } catch (error) {
    console.error(error);
    if (error.code === "auth/email-already-in-use") {
      showToast(
        "Email này đã có tài khoản trong hệ thống.",
        "warn",
      );
    } else if (error.code === "auth/weak-password") {
      showToast("Mật khẩu chưa đủ mạnh. Hãy nhập mật khẩu khác.", "warn");
    } else {
      showToast("Không thể kích hoạt tài khoản. Vui lòng kiểm tra lại thông tin.", "error");
    }
  } finally {
    setButtonLoading(button, false, "CẤP TÀI KHOẢN");
  }
}

async function sendResetEmailForRequest(id, button) {
  const req = pendingMap.get(id);
  if (!req?.email) {
    showToast("Không thể gửi email vì hồ sơ này thiếu địa chỉ email.", "error");
    return;
  }

  setButtonLoading(button, true, "ĐANG GỬI...");
  try {
    const secondaryAuth = getSecondaryAuth();
    await sendPasswordResetEmail(secondaryAuth, req.email);
    showToast("Đã gửi email đặt lại mật khẩu cho " + req.email, "ok");
  } catch (error) {
    console.error(error);
    showToast("Không thể gửi email đặt lại mật khẩu. Vui lòng thử lại.", "error");
  } finally {
    setButtonLoading(button, false, "GỬI EMAIL ĐẶT LẠI");
  }
}

async function rejectRequest(id, button) {
  const req = pendingMap.get(id);
  if (!req) return;

  const ok = window.confirm(`Từ chối yêu cầu đăng ký của ${req.email || "người dùng này"}?`);
  if (!ok) return;

  setButtonLoading(button, true, "ĐANG XÓA...");
  try {
    await deleteDoc(doc(db, "pending_requests", id));
    showToast("Đã từ chối yêu cầu đăng ký.", "ok");
  } catch (error) {
    console.error(error);
    showToast("Không thể từ chối yêu cầu lúc này. Vui lòng thử lại.", "error");
  } finally {
    setButtonLoading(button, false, "XÓA YÊU CẦU");
  }
}

function setButtonLoading(button, isLoading, text) {
  if (!button) return;
  button.disabled = isLoading;
  button.textContent = text;
}
