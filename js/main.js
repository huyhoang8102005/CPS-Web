typewriter/* ═══════════════════════════════════════════════
   AGV CONTROL CENTER — MAIN JS
   Includes: Hero Canvas, Mini Grid AGV, Typewriter,
             Scroll-Reveal, Stats Counter, Navbar, Time
═══════════════════════════════════════════════ */

'use strict';

/* ────────────────────────────────────────────
   1. HERO CANVAS — Animated Grid + AGV Path
──────────────────────────────────────────── */
(function initHeroCanvas() {
  const canvas = document.getElementById('heroCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, animId;

  // AGV state
  const agv = { x: 80, y: 200, angle: 0.4, speed: 0.6 };
  const particles = [];
  const dataStreams = [];

  function resize() {
    W = canvas.width  = canvas.offsetWidth;
    H = canvas.height = canvas.offsetHeight;
  }

  // Particle class
  function spawnParticle() {
    particles.push({
      x: Math.random() * W,
      y: Math.random() * H,
      size: Math.random() * 1.5 + 0.3,
      alpha: Math.random() * 0.4 + 0.05,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      life: 1
    });
  }

  // Data streams
  function spawnStream() {
    dataStreams.push({
      x: Math.random() * W,
      y: -20,
      speed: Math.random() * 1.5 + 0.5,
      chars: Array.from({ length: 12 }, () =>
        Math.random() > 0.5
          ? String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96))
          : Math.floor(Math.random() * 10).toString()
      ),
      alpha: Math.random() * 0.15 + 0.05,
      fontSize: Math.random() * 6 + 8
    });
  }

  // BFS path points (simulated)
  const path = [];
  function buildPath() {
    path.length = 0;
    if (!isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) return;
    let cx = agv.x, cy = agv.y;
    const steps = 20 + Math.floor(Math.random() * 20);
    for (let i = 0; i < steps; i++) {
      cx += (Math.random() - 0.5) * 40;
      cy += (Math.random() - 0.5) * 40;
      cx = Math.max(40, Math.min(W - 40, cx));
      cy = Math.max(40, Math.min(H - 40, cy));
      path.push({ x: cx, y: cy });
    }
  }

  let pathIdx = 0;
  let pathTimer = 0;

  for (let i = 0; i < 60; i++) spawnParticle();
  for (let i = 0; i < 8; i++) spawnStream();
  // buildPath() is called after resize() below

  function drawGrid() {
    const CELL = 40;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= W; x += CELL) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y <= H; y += CELL) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    // Glowing intersections
    ctx.fillStyle = 'rgba(56, 189, 248, 0.15)';
    for (let x = 0; x <= W; x += CELL) {
      for (let y = 0; y <= H; y += CELL) {
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawPath() {
    if (path.length < 2) return;

    // Validate all points are finite before drawing
    const valid = path.every(p => isFinite(p.x) && isFinite(p.y));
    if (!valid) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Endpoint glow — only if coords are valid
    const end = path[path.length - 1];
    if (!isFinite(end.x) || !isFinite(end.y)) return;
    try {
      const grad = ctx.createRadialGradient(end.x, end.y, 0, end.x, end.y, 20);
      grad.addColorStop(0, 'rgba(57,255,20,0.4)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(end.x, end.y, 20, 0, Math.PI * 2); ctx.fill();
    } catch (_) { /* skip glow if gradient fails */ }
    ctx.fillStyle = 'rgba(57,255,20,0.9)';
    ctx.beginPath(); ctx.arc(end.x, end.y, 4, 0, Math.PI * 2); ctx.fill();
  }

  // Polyfill for roundRect
  function roundRect(ctx, x, y, w, h, r) {
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

  function drawAGV(x, y, angle) {
    if (!isFinite(x) || !isFinite(y) || !isFinite(angle)) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Outer glow ring
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 28);
    grad.addColorStop(0, 'rgba(56,189,248,0.35)');
    grad.addColorStop(0.5, 'rgba(56,189,248,0.1)');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, Math.PI * 2); ctx.fill();

    // Body
    ctx.fillStyle = 'rgba(56,189,248,0.18)';
    ctx.strokeStyle = 'rgba(56,189,248,0.95)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, -10, -7, 20, 14, 3);
    ctx.fill(); ctx.stroke();

    // Arrow (heading)
    ctx.fillStyle = 'rgba(56,189,248,0.95)';
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(5, -4); ctx.lineTo(5, 4);
    ctx.closePath(); ctx.fill();

    // Center dot
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
  }

  function drawParticles() {
    particles.forEach((p, i) => {
      p.x += p.vx; p.y += p.vy;
      p.life -= 0.002;
      if (p.life <= 0 || p.x < 0 || p.x > W || p.y < 0 || p.y > H) {
        particles[i] = {
          x: Math.random() * W, y: Math.random() * H,
          size: Math.random() * 1.5 + 0.3,
          alpha: Math.random() * 0.4 + 0.05,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
          life: 1
        };
        return;
      }
      ctx.fillStyle = `rgba(56,189,248,${p.alpha * p.life})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawStreams() {
    dataStreams.forEach((s, i) => {
      ctx.font = `${s.fontSize}px Share Tech Mono, monospace`;
      ctx.fillStyle = `rgba(56,189,248,${s.alpha})`;
      s.chars.forEach((ch, j) => {
        ctx.fillText(ch, s.x, s.y + j * (s.fontSize + 2));
      });
      s.y += s.speed;
      if (s.y > H + 200) {
        dataStreams[i] = {
          x: Math.random() * W, y: -20,
          speed: Math.random() * 1.5 + 0.5,
          chars: Array.from({ length: 12 }, () =>
            Math.random() > 0.5
              ? String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96))
              : Math.floor(Math.random() * 10).toString()
          ),
          alpha: Math.random() * 0.15 + 0.05,
          fontSize: Math.random() * 6 + 8
        };
      }
    });
  }

  let frame = 0;
  function loop() {
    ctx.clearRect(0, 0, W, H);
    frame++;

    drawGrid();
    drawStreams();
    drawParticles();
    drawPath();

    // Move AGV along path
    pathTimer++;
    if (pathTimer > 4 && path.length > 0) {
      pathTimer = 0;
      const target = path[pathIdx];
      const dx = target.x - agv.x;
      const dy = target.y - agv.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 3) {
        pathIdx = (pathIdx + 1) % path.length;
        if (pathIdx === 0) buildPath();
      } else {
        agv.x += (dx / dist) * agv.speed * 2;
        agv.y += (dy / dist) * agv.speed * 2;
        agv.angle = Math.atan2(dy, dx);
      }
    }

    drawAGV(agv.x, agv.y, agv.angle);

    // Scanning line
    const scanY = ((frame * 0.5) % (H + 40)) - 20;
    const scanGrad = ctx.createLinearGradient(0, scanY - 20, 0, scanY + 20);
    scanGrad.addColorStop(0, 'transparent');
    scanGrad.addColorStop(0.5, 'rgba(0,229,255,0.04)');
    scanGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = scanGrad;
    ctx.fillRect(0, scanY - 20, W, 40);

    animId = requestAnimationFrame(loop);
  }

  resize();
  window.addEventListener('resize', resize);
  buildPath(); // W & H are now valid after resize()
  loop();

  // Live coord display
  setInterval(() => {
    const gx = Math.round(agv.x / 40);
    const gy = Math.round(agv.y / 40);
    const deg = Math.round((agv.angle * 180 / Math.PI + 360) % 360);
    const el1 = document.getElementById('posX'); if (el1) el1.textContent = `X: ${String(gx).padStart(2,'0')}`;
    const el2 = document.getElementById('posY'); if (el2) el2.textContent = `Y: ${String(gy).padStart(2,'0')}`;
    const el3 = document.getElementById('posTheta'); if (el3) el3.textContent = `θ: ${deg}°`;
    const v = (0.15 + Math.random() * 0.15).toFixed(2);
    const w = (0.05 + Math.random() * 0.12).toFixed(2);
    const el4 = document.getElementById('velV'); if (el4) el4.textContent = `V: ${v} m/s`;
    const el5 = document.getElementById('velW'); if (el5) el5.textContent = `ω: ${w} rad/s`;
  }, 500);
})();

/* ────────────────────────────────────────────
   2. MINI GRID (Demo Section) — BFS AGV sim
──────────────────────────────────────────── */
(function initMiniGrid() {
  const canvas = document.getElementById('miniGrid');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const COLS = 15, ROWS = 10;
  const CW = canvas.width / COLS;
  const CH = canvas.height / ROWS;

  // Obstacles
  const obstacles = new Set(['3,2','3,3','3,4','7,1','7,2','10,5','10,6','10,7','5,7','6,7']);

  // BFS
  function bfs(start, goal) {
    const q = [[...start]], visited = new Map();
    visited.set(`${start[0]},${start[1]}`, null);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    while (q.length) {
      const [cx, cy] = q.shift();
      if (cx === goal[0] && cy === goal[1]) {
        const path = [];
        let cur = `${cx},${cy}`;
        while (cur) { const [x,y] = cur.split(',').map(Number); path.push([x,y]); cur = visited.get(cur); }
        return path.reverse();
      }
      for (const [dx,dy] of dirs) {
        const nx = cx+dx, ny = cy+dy;
        const key = `${nx},${ny}`;
        if (nx<0||ny<0||nx>=COLS||ny>=ROWS||obstacles.has(key)||visited.has(key)) continue;
        visited.set(key, `${cx},${cy}`);
        q.push([nx, ny]);
      }
    }
    return [];
  }

  let agvPos = [0, 9]; // bottom-left home
  let goalPos = [14, 0];
  let currentPath = bfs(agvPos, goalPos);
  let pathStep = 0;
  let pathAnim = [];

  function setNewGoal() {
    let gx, gy;
    do { gx = Math.floor(Math.random()*COLS); gy = Math.floor(Math.random()*ROWS); }
    while (obstacles.has(`${gx},${gy}`) || (gx===agvPos[0]&&gy===agvPos[1]));
    goalPos = [gx, gy];
    currentPath = bfs(agvPos, goalPos);
    pathStep = 0;
    pathAnim = [];
  }

  function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Cells
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const key = `${c},${r}`;
        if (obstacles.has(key)) {
          ctx.fillStyle = 'rgba(20,40,55,0.9)';
          ctx.fillRect(c*CW+1, r*CH+1, CW-2, CH-2);
          ctx.strokeStyle = 'rgba(30,60,80,0.8)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c*CW+1, r*CH+1, CW-2, CH-2);
        } else {
          ctx.strokeStyle = 'rgba(56,189,248,0.09)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(c*CW, r*CH, CW, CH);
        }
      }
    }

    // Path
    pathAnim.forEach(([pc, pr], i) => {
      const alpha = 0.1 + (i / pathAnim.length) * 0.25;
      ctx.fillStyle = `rgba(56,189,248,${alpha})`;
      ctx.fillRect(pc*CW+2, pr*CH+2, CW-4, CH-4);
    });

    // Goal
    const [gc, gr] = goalPos;
    const gGrad = ctx.createRadialGradient(gc*CW+CW/2, gr*CH+CH/2, 0, gc*CW+CW/2, gr*CH+CH/2, CW/2);
    gGrad.addColorStop(0, 'rgba(57,255,20,0.5)');
    gGrad.addColorStop(1, 'rgba(57,255,20,0)');
    ctx.fillStyle = gGrad;
    ctx.fillRect(gc*CW, gr*CH, CW, CH);
    ctx.fillStyle = 'rgba(57,255,20,0.9)';
    ctx.fillRect(gc*CW+CW/2-3, gr*CH+CH/2-3, 6, 6);

    // AGV
    const [ac, ar] = agvPos;
    const ax = ac*CW + CW/2, ay = ar*CH + CH/2;
    const aGrad = ctx.createRadialGradient(ax, ay, 0, ax, ay, CW*0.8);
    aGrad.addColorStop(0, 'rgba(0,229,255,0.5)');
    aGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = aGrad; ctx.fillRect(ac*CW, ar*CH, CW, CH);
    ctx.fillStyle = '#00e5ff';
    ctx.beginPath(); ctx.arc(ax, ay, 5, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,229,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(ax, ay, 8, 0, Math.PI*2); ctx.stroke();

    // Home label
    ctx.font = '6px Share Tech Mono';
    ctx.fillStyle = 'rgba(0,229,255,0.5)';
    ctx.fillText('HOME', 2, canvas.height - 3);
  }

  let gridFrame = 0;
  function gridLoop() {
    gridFrame++;
    if (gridFrame % 18 === 0) {
      if (pathStep < currentPath.length - 1) {
        pathStep++;
        agvPos = [...currentPath[pathStep]];
        pathAnim = currentPath.slice(0, pathStep);
        if (pathStep === currentPath.length - 1) {
          setTimeout(setNewGoal, 1200);
        }
      }
    }
    drawGrid();
    requestAnimationFrame(gridLoop);
  }
  gridLoop();
})();

/* ────────────────────────────────────────────
   3. TYPEWRITER EFFECT
──────────────────────────────────────────── */
(function initTypewriter() {
  const el = document.getElementById('typewriter');
  if (!el) return;
  const lines = [
    "Hệ thống Digital Twin đồng bộ toàn bộ không gian vật lý lên nền tảng Web Dashboard theo thời gian thực.",
    "Điều hướng bằng ngôn ngữ tự nhiên — BFS pathfinding — MQTT real-time communication.",
    "ROS 2 Humble · STM32 Motor Control · LiDAR C1M1 · Raspberry Pi 4."
  ];
  let lineIdx = 0, charIdx = 0, deleting = false, pause = 0;

  function tick() {
    const line = lines[lineIdx];
    if (!deleting) {
      el.textContent = line.slice(0, charIdx + 1);
      charIdx++;
      if (charIdx === line.length) { deleting = true; pause = 80; }
    } else {
      if (pause > 0) { pause--; }
      else {
        el.textContent = line.slice(0, charIdx - 1);
        charIdx--;
        if (charIdx === 0) { deleting = false; lineIdx = (lineIdx + 1) % lines.length; }
      }
    }
    setTimeout(tick, deleting && pause === 0 ? 30 : 40);
  }
  setTimeout(tick, 1200);
})();

/* ────────────────────────────────────────────
   4. SCROLL REVEAL
──────────────────────────────────────────── */
(function initScrollReveal() {
  const els = document.querySelectorAll('.reveal');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); } });
  }, { threshold: 0.12 });
  els.forEach(el => io.observe(el));
})();

/* ────────────────────────────────────────────
   5. STATS COUNTER ANIMATION
──────────────────────────────────────────── */
(function initCounters() {
  const els = document.querySelectorAll('.stat-num[data-target]');
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = parseInt(el.dataset.target);
      let current = 0;
      const step = Math.max(1, Math.ceil(target / 40));
      const interval = setInterval(() => {
        current = Math.min(current + step, target);
        el.textContent = current;
        if (current >= target) clearInterval(interval);
      }, 30);
      io.unobserve(el);
    });
  }, { threshold: 0.5 });
  els.forEach(el => io.observe(el));
})();

/* ────────────────────────────────────────────
   6. NAVBAR SCROLL STATE
──────────────────────────────────────────── */
(function initNavbar() {
  const nav = document.getElementById('navbar');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  // Mobile hamburger
  const hb = document.getElementById('hamburger');
  const links = nav.querySelector('.nav-links');
  
  if (hb && links) {
    // Bỏ hết inline style cũ, thay bằng việc toggle class 'active'
    hb.addEventListener('click', (e) => {
      e.stopPropagation(); // Ngăn sự kiện click lan ra ngoài
      links.classList.toggle('active');
      hb.classList.toggle('active'); // Dùng để biến icon hamburger thành dấu X
    });

    // Tự động đóng menu khi bấm vào 1 link bất kỳ
    links.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        links.classList.remove('active');
        hb.classList.remove('active');
      });
    });

    // Tự động đóng khi bấm ra ngoài vùng menu
    document.addEventListener('click', (e) => {
      if (links.classList.contains('active') && !links.contains(e.target) && !hb.contains(e.target)) {
        links.classList.remove('active');
        hb.classList.remove('active');
      }
    });
  }
})();

/* ────────────────────────────────────────────
   7. FOOTER CLOCK
──────────────────────────────────────────── */
(function initClock() {
  const el = document.getElementById('footerTime');
  if (!el) return;
  function update() {
    const now = new Date();
    const pad = n => String(n).padStart(2,'0');
    el.textContent = `SYS_TIME: ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  }
  update();
  setInterval(update, 1000);
})();

/* ────────────────────────────────────────────
   8. DEMO MESSAGES — Auto scroll & animate
──────────────────────────────────────────── */
(function initDemoMessages() {
  const container = document.getElementById('demoMessages');
  if (!container) return;
  const messages = container.querySelectorAll('.msg');
  messages.forEach((msg, i) => {
    msg.style.opacity = '0';
    msg.style.transform = 'translateY(10px)';
    setTimeout(() => {
      msg.style.transition = 'all 0.4s ease';
      msg.style.opacity = '1';
      msg.style.transform = 'translateY(0)';
    }, 600 + i * 600);
  });

  // Replay animation every 12s
  setInterval(() => {
    messages.forEach(msg => {
      msg.style.transition = 'none';
      msg.style.opacity = '0';
      msg.style.transform = 'translateY(10px)';
    });
    messages.forEach((msg, i) => {
      setTimeout(() => {
        msg.style.transition = 'all 0.4s ease';
        msg.style.opacity = '1';
        msg.style.transform = 'translateY(0)';
      }, 300 + i * 600);
    });
  }, 12000);
})();

/* ────────────────────────────────────────────
   9. SMOOTH ANCHOR LINKS
──────────────────────────────────────────── */
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const target = document.querySelector(a.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ────────────────────────────────────────────
   10. CURSOR GLOW EFFECT (desktop only)
──────────────────────────────────────────── */
(function initCursorGlow() {
  if (window.innerWidth < 768) return;
  const glow = document.createElement('div');
  glow.style.cssText = `
    position: fixed; pointer-events: none; z-index: 9999;
    width: 300px; height: 300px; border-radius: 50%;
    background: radial-gradient(circle, rgba(0,229,255,0.04) 0%, transparent 70%);
    transform: translate(-50%, -50%);
    transition: opacity 0.3s;
    mix-blend-mode: screen;
  `;
  document.body.appendChild(glow);
  let mx = 0, my = 0, glowX = 0, glowY = 0;
  window.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
  function animGlow() {
    glowX += (mx - glowX) * 0.08;
    glowY += (my - glowY) * 0.08;
    glow.style.left = glowX + 'px';
    glow.style.top  = glowY + 'px';
    requestAnimationFrame(animGlow);
  }
  animGlow();
})();

/* ────────────────────────────────────────────
   12. HERO MINI-MAP — AGV Grid HUD (Right Panel)
──────────────────────────────────────────── */
(function initHeroMiniMap() {
  const canvas = document.getElementById('heroMiniMap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const COLS = 10, ROWS = 10;
  // Size canvas to exactly fill the container
  function setup() {
    const parent = canvas.parentElement;
    const W = parent.clientWidth  || 480;
    const H = parent.clientHeight || 400;
    canvas.width  = W;
    canvas.height = H;
    return { cw: W / COLS, ch: H / ROWS };
  }
  let cells = setup();
  window.addEventListener('resize', () => { cells = setup(); });

  // Static obstacles — spread across 10×10 grid, leaving clear BFS routes
  const OBS = new Set([
    '2,1','2,2','5,0','5,1','8,3','8,4',
    '1,5','4,3','7,5','3,6','6,2',
    '0,8','9,7','4,8','6,7','2,8',
    '1,3','7,1','3,4','9,2','5,6',
    '8,8','4,6','0,5','6,9'
  ]);

  // BFS pathfinding
  function bfs(sc, sr, ec, er) {
    const q = [[sc, sr]];
    const visited = new Map();
    visited.set(`${sc},${sr}`, null);
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    while (q.length) {
      const [c, r] = q.shift();
      if (c === ec && r === er) {
        const path = [];
        let key = `${ec},${er}`;
        while (key !== null) {
          const [pc, pr] = key.split(',').map(Number);
          path.unshift({ col: pc, row: pr });
          key = visited.get(key);
        }
        return path;
      }
      for (const [dc, dr] of dirs) {
        const nc = c + dc, nr = r + dr;
        const nk = `${nc},${nr}`;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS || OBS.has(nk) || visited.has(nk)) continue;
        visited.set(nk, `${c},${r}`);
        q.push([nc, nr]);
      }
    }
    return [];
  }

  // AGV state
  const agv = { col: 0, row: 6, angle: 0 };
  let target = { col: 9, row: 0 };
  let path = [];
  let pathIdx = 0;
  let waiting = false;

  function newTarget() {
    waiting = false;
    let tc, tr;
    do {
      tc = Math.floor(Math.random() * COLS);
      tr = Math.floor(Math.random() * ROWS);
    } while (OBS.has(`${tc},${tr}`) || (tc === agv.col && tr === agv.row));
    target = { col: tc, row: tr };
    path = bfs(agv.col, agv.row, target.col, target.row);
    pathIdx = 0;
  }
  newTarget();

  // Pulse phase for target cell
  let pulse = 0;
  let stepTimer = 0;
  const STEP_INTERVAL = 22; // frames between each step (~370ms @ 60fps)

  // Rounded rect helper
  function rr(x, y, w, h, r) {
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

  function draw() {
    const W = canvas.width, H = canvas.height;
    const CW = cells.cw, CH = cells.ch;
    ctx.clearRect(0, 0, W, H);

    // Dark background
    ctx.fillStyle = '#060e1c';
    ctx.fillRect(0, 0, W, H);

    // Grid cells
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * CW, y = r * CH;
        const key = `${c},${r}`;
        if (OBS.has(key)) {
          // Obstacle: orange-tinted with X mark
          ctx.fillStyle = 'rgba(251,146,60,0.1)';
          ctx.fillRect(x + 1, y + 1, CW - 2, CH - 2);
          ctx.strokeStyle = 'rgba(251,146,60,0.3)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(x + 1, y + 1, CW - 2, CH - 2);
          ctx.strokeStyle = 'rgba(251,146,60,0.22)';
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(x + 5, y + 5); ctx.lineTo(x + CW - 5, y + CH - 5);
          ctx.moveTo(x + CW - 5, y + 5); ctx.lineTo(x + 5, y + CH - 5);
          ctx.stroke();
        } else {
          ctx.strokeStyle = 'rgba(56,189,248,0.09)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(x, y, CW, CH);
          // Glowing intersections
          ctx.fillStyle = 'rgba(56,189,248,0.18)';
          ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    // BFS path trail
    if (path.length > 1) {
      // Filled cells (visited trail)
      for (let i = 0; i < pathIdx && i < path.length; i++) {
        const { col, row } = path[i];
        const alpha = 0.06 + (i / path.length) * 0.12;
        ctx.fillStyle = `rgba(56,189,248,${alpha})`;
        ctx.fillRect(col * CW + 1, row * CH + 1, CW - 2, CH - 2);
      }
      // Dashed line for remaining path ahead
      ctx.strokeStyle = 'rgba(56,189,248,0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (let i = pathIdx; i < path.length; i++) {
        const { col, row } = path[i];
        const px = col * CW + CW / 2, py = row * CH + CH / 2;
        if (i === pathIdx) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Target cell (pulsing green)
    pulse += 0.06;
    const pAlpha = 0.22 + 0.14 * Math.sin(pulse);
    const tx = target.col * CW, ty = target.row * CH;
    ctx.fillStyle = `rgba(74,222,128,${pAlpha})`;
    ctx.fillRect(tx + 1, ty + 1, CW - 2, CH - 2);
    ctx.strokeStyle = `rgba(74,222,128,${0.5 + 0.3 * Math.sin(pulse)})`;
    ctx.lineWidth = 1;
    // Crosshair in target
    ctx.beginPath();
    ctx.moveTo(tx + CW/2, ty + 3); ctx.lineTo(tx + CW/2, ty + CH - 3);
    ctx.moveTo(tx + 3, ty + CH/2); ctx.lineTo(tx + CW - 3, ty + CH/2);
    ctx.stroke();
    // Corner ticks
    const d = 5;
    [[tx,ty],[tx+CW,ty],[tx,ty+CH],[tx+CW,ty+CH]].forEach(([cx,cy],i) => {
      ctx.beginPath();
      ctx.moveTo(cx + (i%2===0?d:-d), cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + (i<2?d:-d));
      ctx.stroke();
    });

    // AGV
    const ax = agv.col * CW + CW / 2;
    const ay = agv.row * CH + CH / 2;
    const aura = Math.min(CW, CH);

    try {
      const gGrad = ctx.createRadialGradient(ax, ay, 0, ax, ay, aura);
      gGrad.addColorStop(0, 'rgba(56,189,248,0.45)');
      gGrad.addColorStop(0.5, 'rgba(56,189,248,0.12)');
      gGrad.addColorStop(1, 'transparent');
      ctx.fillStyle = gGrad;
      ctx.beginPath(); ctx.arc(ax, ay, aura, 0, Math.PI * 2); ctx.fill();
    } catch(_) {}

    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(agv.angle);
    // Body rect
    ctx.fillStyle = 'rgba(56,189,248,0.22)';
    ctx.strokeStyle = 'rgba(56,189,248,0.95)';
    ctx.lineWidth = 1.5;
    const bw = CW * 0.6, bh = CH * 0.4;
    rr(-bw/2, -bh/2, bw, bh, 2);
    ctx.fill(); ctx.stroke();
    // Direction arrow
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(bw/2 + 4, 0);
    ctx.lineTo(bw/2 - 4, -bh*0.45);
    ctx.lineTo(bw/2 - 4, bh*0.45);
    ctx.closePath(); ctx.fill();
    // Center dot
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Coord label under AGV
    ctx.font = `${Math.max(8, CW * 0.28)}px "Share Tech Mono", monospace`;
    ctx.fillStyle = 'rgba(56,189,248,0.5)';
    ctx.textAlign = 'center';
    ctx.fillText(`${agv.col},${agv.row}`, ax, Math.min(ay + CH * 0.85, H - 4));
    ctx.textAlign = 'left';

    // HOME label
    ctx.font = `${Math.max(7, CW * 0.24)}px "Share Tech Mono", monospace`;
    ctx.fillStyle = 'rgba(56,189,248,0.3)';
    ctx.fillText('HOME', 2, H - 3);
  }

  function updateTelemetry() {
    const posEl = document.getElementById('hvPos');
    const velEl = document.getElementById('hvVel');
    const thetaEl = document.getElementById('hvTheta');
    const pathEl = document.getElementById('hvPath');
    if (posEl) posEl.textContent = `X:${String(agv.col).padStart(2,'0')} Y:${String(agv.row).padStart(2,'0')}`;
    if (velEl) velEl.textContent = `${(0.10 + Math.random() * 0.14).toFixed(2)} m/s`;
    if (thetaEl) thetaEl.textContent = `${Math.round((agv.angle * 180/Math.PI + 360) % 360)}°`;
    if (pathEl) pathEl.textContent = path.length > 0 ? `${Math.max(0, path.length - pathIdx)} nodes` : '—';
  }

  // HUD clock
  (function hudClock() {
    const el = document.getElementById('hvTime');
    if (!el) return;
    function tick() {
      const n = new Date(), p = x => String(x).padStart(2,'0');
      el.textContent = `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
    }
    tick(); setInterval(tick, 1000);
  })();

  let frame = 0;
  function loop() {
    frame++;
    stepTimer++;

    if (!waiting && stepTimer >= STEP_INTERVAL) {
      stepTimer = 0;
      if (path.length > 0 && pathIdx < path.length) {
        const next = path[pathIdx];
        const dc = next.col - agv.col, dr = next.row - agv.row;
        if (dc !== 0 || dr !== 0) agv.angle = Math.atan2(dr, dc);
        agv.col = next.col; agv.row = next.row;
        pathIdx++;
        updateTelemetry();
        if (pathIdx >= path.length) {
          waiting = true;
          setTimeout(newTarget, 1200);
        }
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  updateTelemetry();
  loop();
})();

(function initTeamSlider() {
  const track = document.getElementById('sliderTrack');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  if (!track || !prevBtn || !nextBtn) return;

  let autoPlayTimer;
  const autoPlayDelay = 3500; // Thời gian tự động chuyển slide (3.5 giây)

  // Hàm tính toán và cuộn tới slide tiếp theo
  function moveNext() {
    const cardWidth = track.querySelector('.team-card').offsetWidth;
    const gap = 24; // Bằng với thuộc tính gap trong CSS
    const maxScroll = track.scrollWidth - track.clientWidth;

    // Kiểm tra nếu đã cuộn đến cuối (trừ hao 5px sai số pixel)
    if (track.scrollLeft >= maxScroll - 5) {
      track.scrollTo({ left: 0, behavior: 'smooth' }); // Quay lại đầu
    } else {
      track.scrollBy({ left: cardWidth + gap, behavior: 'smooth' });
    }
  }

  // Hàm tính toán và cuộn lùi lại
  function movePrev() {
    const cardWidth = track.querySelector('.team-card').offsetWidth;
    const gap = 24;

    // Kiểm tra nếu đang ở vị trí đầu tiên
    if (track.scrollLeft <= 5) {
      track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' }); // Cuộn tít về cuối
    } else {
      track.scrollBy({ left: -(cardWidth + gap), behavior: 'smooth' });
    }
  }

  // Khởi động auto-play
  function startAutoPlay() {
    autoPlayTimer = setInterval(moveNext, autoPlayDelay);
  }

  // Dừng auto-play (khi người dùng thao tác)
  function stopAutoPlay() {
    clearInterval(autoPlayTimer);
  }

  // Khởi động lại auto-play (để reset bộ đếm thời gian)
  function resetAutoPlay() {
    stopAutoPlay();
    startAutoPlay();
  }

  // Gán sự kiện cho các nút bấm
  nextBtn.addEventListener('click', () => {
    moveNext();
    resetAutoPlay();
  });

  prevBtn.addEventListener('click', () => {
    movePrev();
    resetAutoPlay();
  });

  // Tạm dừng tự động cuộn khi người dùng đưa chuột vào hoặc đang vuốt trên điện thoại
  track.addEventListener('mouseenter', stopAutoPlay);
  track.addEventListener('mouseleave', startAutoPlay);
  track.addEventListener('touchstart', stopAutoPlay, { passive: true });
  track.addEventListener('touchend', startAutoPlay);

  // Kích hoạt auto-play lần đầu khi load trang
  startAutoPlay();
})();