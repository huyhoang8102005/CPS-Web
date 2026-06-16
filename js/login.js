import { auth, db } from "./firebase.js"; // Nhớ phải có db xuất ra từ firebase.js nhé
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
// Import thêm các hàm của Firestore
// Import thêm các hàm của Firestore
import {
  doc,
  setDoc,
  getDoc,
  collection,
  addDoc,
  query, // Thêm hàm này
  where, // Thêm hàm này
  getDocs, // Thêm hàm này
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// IMPORT HÀM GIAO DIỆN TỪ FILE UI.JS
import { showSuccess } from "./auth_ui.js";

// Khởi tạo Google Provider
const googleProvider = new GoogleAuthProvider();

// 1. XỬ LÝ ĐĂNG NHẬP (Email/Pass)
async function handleLogin(e) {
  e.preventDefault();

  const email = document.getElementById("loginUser");
  const pass = document.getElementById("loginPass");
  const btn = document.getElementById("loginBtn");
  const errUser = document.getElementById("errUser");
  const errPass = document.getElementById("errPass");

  errUser.textContent = "";
  errPass.textContent = "";
  email.classList.remove("has-error");
  pass.classList.remove("has-error");

  if (!email.value || !pass.value) {
    if (!email.value) {
      errUser.textContent = "Vui lòng nhập email";
      email.classList.add("has-error");
    }
    if (!pass.value) {
      errPass.textContent = "Vui lòng nhập mật khẩu";
      pass.classList.add("has-error");
    }
    return;
  }

  btn.classList.add("loading");

  try {
    await signInWithEmailAndPassword(auth, email.value, pass.value);
    btn.classList.remove("loading");

    // Gọi hàm từ ui.js
    showSuccess("ACCESS GRANTED", "Đang thiết lập phiên điều khiển...");
    setTimeout(() => {
      window.location.href = "dashboard.html"; // Thay 'dashboard.html' bằng đường dẫn thực tế của bạn
    }, 1500);
  } catch (error) {
    btn.classList.remove("loading");
    const code = error.code;
    if (
      code === "auth/invalid-credential" ||
      code === "auth/user-not-found" ||
      code === "auth/wrong-password"
    ) {
      errPass.textContent = "Sai tài khoản hoặc mật khẩu!";
      pass.classList.add("has-error");
    } else if (code === "auth/invalid-email") {
      errUser.textContent = "Định dạng email không hợp lệ.";
      email.classList.add("has-error");
    } else {
      errPass.textContent = "Lỗi hệ thống: " + error.message;
    }
  }
}

// 2. XỬ LÝ ĐĂNG KÝ (Gửi yêu cầu chờ Admin duyệt)
async function handleRegister(e) {
  e.preventDefault();

  const email = document.getElementById("regEmail");
  const pass = document.getElementById("regPass"); // Lưu ý: không nên lưu pass dạng plain-text lên Firestore. Nếu Admin tự tạo acc thì user sẽ nhận mail reset pass.
  const firstName = document.getElementById("regFirst");
  const lastName = document.getElementById("regLast");
  const role = document.getElementById("regRole");
  const btn = document.getElementById("regBtn");
  const errRegEmail = document.getElementById("errRegEmail");

  errRegEmail.textContent = "";
  email.classList.remove("has-error");

  if (!role.value) {
    alert("Vui lòng chọn vai trò!");
    return;
  }

  btn.classList.add("loading");

  try {
    const q = query(
      collection(db, "pending_requests"),
      where("email", "==", email.value),
    );
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      // Nếu querySnapshot không rỗng, tức là email đã có người đăng ký
      btn.classList.remove("loading");
      errRegEmail.textContent =
        "Email này đã được gửi đi để xác nhận, vui lòng đợi Admin duyệt.";
      email.classList.add("has-error");
      return; // Dừng tiến trình đăng ký lại
    }
    // Bước 1: Chỉ lưu thông tin vào collection "pending_requests"
    await addDoc(collection(db, "pending_requests"), {
      firstName: firstName.value,
      lastName: lastName.value,
      email: email.value,
      role: role.value,
      status: "pending", // Trạng thái chờ duyệt
      createdAt: new Date().toISOString(),
    });

    // Bước 2: Gửi email cho Admin qua EmailJS
    const templateParams = {
      name: `${firstName.value} ${lastName.value}`, // Khớp với {{name}} ở header
      from_name: `${firstName.value} ${lastName.value}`, // Khớp với {{from_name}}
      from_email: email.value, // Khớp với {{from_email}}
      message: `Yêu cầu cấp quyền truy cập với vai trò: ${role.value}`, // Khớp với {{message}}
      to_email: "tonghuuhuyhoang2005@gmail.com", // Giữ nguyên email người nhận
    };

    // Điền Service ID và Template ID bạn tạo trên hệ thống EmailJS
    await emailjs.send("service_inji2pw", "template_cgfuwdc", templateParams);

    btn.classList.remove("loading");

    // Đổi thông báo thành báo cho user biết cần chờ duyệt
    showSuccess(
      "REQUEST SENT",
      "Yêu cầu tạo tài khoản đã được gửi tới Admin. Vui lòng chờ phê duyệt.",
      true,
    );

    // Reset form
    document.getElementById("registerForm").reset();
  } catch (error) {
    btn.classList.remove("loading");
    console.error("Lỗi khi gửi yêu cầu:", error);
    errRegEmail.textContent = "Có lỗi xảy ra: " + error.message;
  }
}

// 3. XỬ LÝ ĐĂNG NHẬP BẰNG GOOGLE & LƯU VÀO FIRESTORE (NẾU MỚI)
async function handleGoogleLogin() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;

    // Kiểm tra xem user này đã có profile trong Firestore chưa
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      // Nếu chưa có (đăng nhập lần đầu), tạo profile với vai trò mặc định
      await setDoc(userRef, {
        firstName: user.displayName,
        lastName: "",
        email: user.email,
        role: "operator",
        createdAt: new Date().toISOString(),
      });
    }

    showSuccess(
      "ACCESS GRANTED",
      `Xin chào ${user.displayName}, đang thiết lập phiên AGV...`,
    );

    // THÊM ĐOẠN NÀY: Chuyển hướng sau 1.5 giây
    setTimeout(() => {
      window.location.href = "dashboard.html"; // Thay 'dashboard.html' bằng đường dẫn thực tế của bạn
    }, 1500);
  } catch (error) {
    if (error.code !== "auth/popup-closed-by-user") {
      alert("Lỗi đăng nhập Google: " + error.message);
    }
  }
}

// --- GẮN VÀO WINDOW ĐỂ FORM GỌI ĐƯỢC ---
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleGoogleLogin = handleGoogleLogin;
