import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

export function toDate(value) {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return "—";
  return d.toLocaleString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function roleLabel(role = "") {
  const labels = {
    admin: "Admin",
    operator: "Operator",
    user: "User",
  };
  return labels[String(role).toLowerCase()] || role || "Chưa rõ";
}

export function setTopClock() {
  const navTime = document.getElementById("navTime");
  if (!navTime) return;

  const tick = () => {
    navTime.textContent = new Date().toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  };

  tick();
  window.setInterval(tick, 1000);
}

export function showToast(message, type = "ok") {
  let toast = document.getElementById("adminToast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "adminToast";
    toast.className = "admin-toast";
    document.body.appendChild(toast);
  }

  toast.className = `admin-toast show ${type}`;
  toast.textContent = message;

  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}

function renderAccessDenied(message) {
  const root = document.getElementById("adminRoot");
  if (!root) return;

  root.innerHTML = `
    <section class="admin-hero compact">
      <div>
        <span class="section-kicker">ACCESS CONTROL</span>
        <h1>Không có quyền truy cập</h1>
        <p>${escapeHTML(message)}</p>
      </div>
      <a class="admin-nav-pill" href="dashboard.html">Quay về Dashboard</a>
    </section>
  `;
}

function waitForAuth() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export async function requireAdmin() {
  setTopClock();

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await signOut(auth);
      window.location.href = "auth.html";
    });
  }

  const user = await waitForAuth();
  if (!user) {
    window.location.href = "auth.html";
    return null;
  }

  console.log("ADMIN GUARD UID:", user.uid);
  console.log("ADMIN GUARD EMAIL:", user.email);

  // Cách đúng: document ID trong users trùng với UID của Firebase Auth.
  let profileSnap = await getDoc(doc(db, "users", user.uid));

  // Fallback: nếu trước đó lỡ tạo document ID khác UID, tìm thêm theo email
  // để tránh bị kẹt ở trang Admin.
  if (!profileSnap.exists() && user.email) {
    const profileQuery = query(
      collection(db, "users"),
      where("email", "==", user.email),
    );
    const profileQuerySnap = await getDocs(profileQuery);
    if (!profileQuerySnap.empty) {
      profileSnap = profileQuerySnap.docs[0];
    }
  }

  if (!profileSnap.exists()) {
    renderAccessDenied(
      `Tài khoản ${user.email || ""} chưa có hồ sơ quản trị. Hãy tạo document trong users với email này, role = 'admin' và status = 'active'.`,
    );
    return null;
  }

  const profile = profileSnap.data();
  const role = String(profile.role || "").toLowerCase();
  const status = String(profile.status || "active").toLowerCase();

  if (status !== "active") {
    renderAccessDenied("Tài khoản này chưa được kích hoạt.");
    return null;
  }

  if (role !== "admin") {
    renderAccessDenied("Trang này chỉ dành cho tài khoản quản trị viên.");
    return null;
  }

  const adminEmailEls = document.querySelectorAll("[data-admin-email]");
  adminEmailEls.forEach((el) => {
    el.textContent = profile.email || user.email || "Admin";
  });

  const adminNameEls = document.querySelectorAll("[data-admin-name]");
  const fullName = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
  adminNameEls.forEach((el) => {
    el.textContent = fullName || profile.email || user.email || "Admin";
  });

  return { user, profile };
}
