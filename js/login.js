import { auth, db } from "./firebase.js"; // Nhớ phải có db xuất ra từ firebase.js nhé
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
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
    const credential = await signInWithEmailAndPassword(
      auth,
      email.value.trim(),
      pass.value,
    );

    console.log("AUTH UID:", credential.user.uid);
    console.log("AUTH EMAIL:", credential.user.email);

    // Ưu tiên cách đúng: document ID trong users trùng với UID của Firebase Auth
    let userRef = doc(db, "users", credential.user.uid);
    let userSnap = await getDoc(userRef);

    // Fallback: nếu lỡ tạo document ID sai, thử tìm theo email để không bị kẹt tài khoản admin
    if (!userSnap.exists()) {
      const emailQuery = query(
        collection(db, "users"),
        where("email", "==", credential.user.email || email.value.trim()),
      );
      const emailSnapshot = await getDocs(emailQuery);

      if (!emailSnapshot.empty) {
        userSnap = emailSnapshot.docs[0];
      }
    }

    if (!userSnap.exists()) {
      await signOut(auth);
      btn.classList.remove("loading");
      errPass.textContent = "Tài khoản chưa được cấp quyền truy cập.";
      pass.classList.add("has-error");
      return;
    }

    const userData = userSnap.data();
    const role = String(userData.role || "operator").toLowerCase();
    const status = String(userData.status || "active").toLowerCase();

    if (status !== "active") {
      await signOut(auth);
      btn.classList.remove("loading");
      errPass.textContent = "Tài khoản của bạn chưa được kích hoạt.";
      pass.classList.add("has-error");
      return;
    }

    btn.classList.remove("loading");

    if (role === "admin") {
      showSuccess("ĐĂNG NHẬP THÀNH CÔNG", "Đang chuyển đến trang quản trị...");
      setTimeout(() => {
        window.location.href = "admin_overview.html";
      }, 1200);
    } else {
      showSuccess("ĐĂNG NHẬP THÀNH CÔNG", "Đang chuyển đến bảng điều khiển...");
      setTimeout(() => {
        window.location.href = "dashboard.html";
      }, 1200);
    }
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


// --- GẮN VÀO WINDOW ĐỂ FORM GỌI ĐƯỢC ---
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
