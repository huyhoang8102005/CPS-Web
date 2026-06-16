let isAnimating = false;

// 1. LOGIC CHUYỂN TAB
export function switchTab(tab) {
  if (isAnimating) return;

  const loginBtn = document.getElementById("tabLogin");
  const regBtn = document.getElementById("tabRegister");
  const indicator = document.getElementById("tabIndicator");
  const loginForm = document.getElementById("loginForm");
  const regForm = document.getElementById("registerForm");

  const currentForm = tab === "login" ? regForm : loginForm;
  const nextForm = tab === "login" ? loginForm : regForm;

  if (!currentForm.classList.contains("hidden")) {
    isAnimating = true;

    if (tab === "login") {
      loginBtn.classList.add("active");
      regBtn.classList.remove("active");
      indicator.classList.remove("right");
    } else {
      regBtn.classList.add("active");
      loginBtn.classList.remove("active");
      indicator.classList.add("right");
    }

    const fadeOut = currentForm.animate(
      [
        { opacity: 1, transform: "translateY(0) scale(1)" },
        { opacity: 0, transform: "translateY(-15px) scale(0.98)" },
      ],
      {
        duration: 250,
        easing: "cubic-bezier(0.4, 0, 0.2, 1)",
        fill: "forwards",
      },
    );

    fadeOut.onfinish = () => {
      currentForm.classList.add("hidden");
      nextForm.classList.remove("hidden");
      nextForm.style.animation = "none";

      const fadeIn = nextForm.animate(
        [
          { opacity: 0, transform: "translateY(20px) scale(0.97)" },
          { opacity: 1, transform: "translateY(0) scale(1)" },
        ],
        {
          duration: 350,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        },
      );

      fadeIn.onfinish = () => {
        nextForm.style.animation = "";
        isAnimating = false;
      };
    };
  }
}

// 2. ẨN / HIỆN MẬT KHẨU
export function togglePass(inputId, btn) {
  const input = document.getElementById(inputId);
  if (input.type === "password") {
    input.type = "text";
    btn.style.color = "var(--cyan)";
  } else {
    input.type = "password";
    btn.style.color = "var(--muted)";
  }
}

// 3. KIỂM TRA ĐỘ MẠNH MẬT KHẨU
export function checkStrength(val) {
  const bar = document.getElementById("strengthBar");
  const label = document.getElementById("strengthLabel");
  let strength = 0;

  if (val.length >= 6) strength += 25;
  if (val.length >= 10) strength += 25;
  if (/[A-Z]/.test(val)) strength += 25;
  if (/[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val)) strength += 25;

  bar.style.width = strength + "%";

  if (val.length === 0) {
    bar.style.width = "0";
    label.textContent = "";
  } else if (strength <= 25) {
    bar.style.background = "var(--red)";
    label.textContent = "YẾU";
    label.style.color = "var(--red)";
  } else if (strength <= 50) {
    bar.style.background = "var(--orange)";
    label.textContent = "TRUNG BÌNH";
    label.style.color = "var(--orange)";
  } else if (strength <= 75) {
    bar.style.background = "var(--cyan)";
    label.textContent = "KHÁ";
    label.style.color = "var(--cyan)";
  } else {
    bar.style.background = "var(--green)";
    label.textContent = "MẠNH";
    label.style.color = "var(--green)";
  }
}

// 4. HIỂN THỊ OVERLAY THÀNH CÔNG (Cập nhật thêm cờ isRegister)
export function showSuccess(title, subTitle, isRegister = false) {
  document.getElementById("successTitle").textContent = title;
  document.getElementById("successSub").textContent = subTitle;

  const overlay = document.getElementById("successOverlay");
  const barContainer = document.getElementById("successBarContainer");
  const closeBtn = document.getElementById("successCloseBtn");

  overlay.classList.add("show");

  if (isRegister) {
    // Nếu là Đăng ký: Ẩn thanh chạy, Hiện nút bấm
    if (barContainer) barContainer.style.display = "none";
    if (closeBtn) closeBtn.style.display = "block";
  } else {
    // Nếu là Đăng nhập: Hiện thanh chạy, Ẩn nút bấm
    if (barContainer) barContainer.style.display = "block";
    if (closeBtn) closeBtn.style.display = "none";

    setTimeout(() => {
      document.getElementById("successFill").style.width = "100%";
    }, 100);
  }
}

// 4.5. ĐÓNG OVERLAY & VỀ TAB ĐĂNG NHẬP
export function closeSuccessOverlay() {
  const overlay = document.getElementById("successOverlay");
  overlay.classList.remove("show");

  // Tự động chuyển Form về lại tab Login cho mượt
  switchTab("login");
}

// --- GẮN CÁC HÀM UI VÀO WINDOW ĐỂ HTML GỌI QUA ONCLICK ---
window.switchTab = switchTab;
window.togglePass = togglePass;
window.checkStrength = checkStrength;
window.closeSuccessOverlay = closeSuccessOverlay; // Gắn thêm hàm này

// 5. BACKGROUND CANVAS
const canvas = document.getElementById("bgCanvas");
const ctx = canvas.getContext("2d");
let width, height;
let particles = [];

function initCanvas() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
  particles = [];
  const particleCount = width < 768 ? 40 : 80;
  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      radius: Math.random() * 1.5 + 0.5,
    });
  }
}

function animateCanvas() {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(56, 189, 248, 0.4)";
  particles.forEach((p, i) => {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0 || p.x > width) p.vx *= -1;
    if (p.y < 0 || p.y > height) p.vy *= -1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    for (let j = i + 1; j < particles.length; j++) {
      const p2 = particles[j];
      const dist = Math.hypot(p.x - p2.x, p.y - p2.y);
      if (dist < 120) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(56, 189, 248, ${0.15 - dist / 800})`;
        ctx.lineWidth = 0.5;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  });
  requestAnimationFrame(animateCanvas);
}
window.addEventListener("resize", initCanvas);
initCanvas();
animateCanvas();

// 6. LIVE TERMINAL LOGIC
const termLines = [
  '<span class="log-sys">[SYS]</span> Initializing LiDAR mapping sequence...',
  '<span class="log-sys">[SYS]</span> Connecting to MQTT Broker at tcp://agv-core:1883',
  '<span class="log-ok">[OK]</span> Connection established. Latency: 4ms.',
  '<span class="log-sys">[AI]</span> Loading SOTACNN inference module...',
  '<span class="log-ok">[OK]</span> Parameter count: 99,268 (Optimized).',
  '<span class="log-sys">[AI]</span> Initializing INT8 Quantization for Edge.',
  '<span class="log-sys">[NET]</span> Handshake with ZCU102 Edge Node...',
  '<span class="log-ok">[OK]</span> Sync successful. Awaiting command.',
  '<span class="log-warn">[WARN]</span> Sensor 03 noise detected. Calibrating...',
  '<span class="log-sys">[SYS]</span> Auth gateway ready. Listening on port 443.',
];
const termLog = document.getElementById("termLog");
let lineIndex = 0;
function printLogLine() {
  if (!termLog) return;
  const p = document.createElement("div");
  p.className = "log-line";
  p.innerHTML = termLines[lineIndex];
  termLog.appendChild(p);
  if (termLog.children.length > 5) termLog.removeChild(termLog.firstChild);
  lineIndex = (lineIndex + 1) % termLines.length;
  setTimeout(printLogLine, Math.random() * 1500 + 500);
}
setTimeout(printLogLine, 1000);
