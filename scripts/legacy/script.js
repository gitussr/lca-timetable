/* =========================================================
   LCA TIMETABLE — script.js
   ========================================================= */

const ACCESS_CODE = 'LCA1234';
const AUTH_KEY = 'lca_authed';

/* ---------------------------------------------------------
   LOGIN
   --------------------------------------------------------- */
const loginScreen = document.getElementById('loginScreen');
const loginForm = document.getElementById('loginForm');
const passwordInput = document.getElementById('passwordInput');
const loginError = document.getElementById('loginError');
const rememberMe = document.getElementById('rememberMe');
const togglePw = document.getElementById('togglePw');
const app = document.getElementById('app');

function unlockApp() {
  loginScreen.style.display = 'none';
  app.classList.remove('app-hidden');
  initApp();
}

function lockApp() {
  localStorage.removeItem(AUTH_KEY);
  app.classList.add('app-hidden');
  loginScreen.style.display = 'flex';
  passwordInput.value = '';
  rememberMe.checked = false;
  passwordInput.focus();
}

togglePw.addEventListener('click', () => {
  const isPw = passwordInput.type === 'password';
  passwordInput.type = isPw ? 'text' : 'password';
  togglePw.innerHTML = isPw ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
});

/* ---------- Secret unlock: triple click/tap the logo ---------- */
const loginLogo = document.querySelector('.login-mark img');
let logoTapCount = 0;
let logoTapTimer = null;
let logoLastEventTime = 0;

function handleLogoTap() {
  // Debounce so a single physical tap isn't double-counted
  // (mobile browsers can fire both touchend and click for one tap).
  const now = Date.now();
  if (now - logoLastEventTime < 350) return;
  logoLastEventTime = now;

  logoTapCount++;
  clearTimeout(logoTapTimer);
  logoTapTimer = setTimeout(() => { logoTapCount = 0; }, 900);

  if (logoTapCount >= 3) {
    logoTapCount = 0;
    clearTimeout(logoTapTimer);
    if (rememberMe.checked) {
      localStorage.setItem(AUTH_KEY, 'true');
    }
    loginError.classList.remove('show');
    unlockApp();
  }
}

if (loginLogo) {
  loginLogo.addEventListener('click', handleLogoTap);
  loginLogo.addEventListener('touchend', (e) => {
    e.preventDefault();
    handleLogoTap();
  }, { passive: false });
}

loginForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (passwordInput.value === ACCESS_CODE) {
    if (rememberMe.checked) {
      localStorage.setItem(AUTH_KEY, 'true');
    }
    loginError.classList.remove('show');
    unlockApp();
  } else {
    loginError.classList.add('show');
    passwordInput.classList.remove('shake');
    void passwordInput.offsetWidth; // restart animation
    passwordInput.classList.add('shake');
    passwordInput.value = '';
    passwordInput.focus();
  }
});

// Auto-unlock if previously remembered
window.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem(AUTH_KEY) === 'true') {
    unlockApp();
  }
});

/* ---------------------------------------------------------
   APP INITIALISATION (runs once unlocked)
   --------------------------------------------------------- */
let appInitialised = false;

function initApp() {
  if (appInitialised) return;
  appInitialised = true;

  setupClock();
  calculateEmptySeats();
  setupToggleSections();
  highlightTodaySchedule();
  setInterval(highlightTodaySchedule, 60000);
  setupThemeSwitcher();
  setupLogout();
}

/* ---------- Date & time ---------- */
function formatDateWithDay(date) {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[date.getDay()]}, ${date.getDate().toString().padStart(2, '0')}/${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getFullYear()}`;
}

function getCurrentTime() {
  const now = new Date();
  const hours = (now.getHours() % 12 || 12).toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
  return `<i class="bi bi-clock"></i> ${hours}:${minutes}:${seconds} ${ampm}`;
}

function setupClock() {
  document.querySelector('#today').textContent = `Today: ${formatDateWithDay(new Date())}`;
  const timeElement = document.querySelector('#time');
  timeElement.innerHTML = getCurrentTime();
  setInterval(() => timeElement.innerHTML = getCurrentTime(), 1000);
}

/* ---------- Empty seats ---------- */
function calculateEmptySeats() {
  const timetableSlots = document.querySelectorAll('.slot ul li');
  let emptyCount = 0;
  timetableSlots.forEach(li => {
    if (!li.textContent.trim() && li.innerHTML === '') {
      emptyCount++;
    }
  });
  const availableSeats = Math.floor(emptyCount / 3);
  document.querySelector('#empty-seats').textContent = `Empty Seats: ${availableSeats}+`;
  return availableSeats;
}

/* ---------- Roster toggle sections ---------- */
function setupToggleSections() {
  const toggleSections = document.querySelectorAll('.toggle-section');
  toggleSections.forEach(section => {
    const summary = section.querySelector('summary');
    summary.addEventListener('click', (e) => {
      e.preventDefault();
      toggleSections.forEach(other => {
        if (other !== section) other.classList.remove('active');
      });
      section.classList.toggle('active');
    });
  });
}

/* ---------- Highlight today's schedule (class-based, theme-aware) ---------- */
function highlightTodaySchedule() {
  const today = new Date();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const currentDay = dayNames[today.getDay()];

  const allDayElements = document.querySelectorAll('.day');
  const allSlots = document.querySelectorAll('.slot');

  // Reset
  allDayElements.forEach(d => d.classList.remove('is-today'));
  allSlots.forEach(s => s.classList.remove('is-today-col', 'is-live'));

  let todayElement = null;
  allDayElements.forEach(dayElement => {
    if (dayElement.textContent.trim() === currentDay) {
      dayElement.classList.add('is-today');
      todayElement = dayElement;
    }
  });

  if (!todayElement) return;

  const dayIndex = Array.from(allDayElements).indexOf(todayElement);
  const todaySlots = [];
  for (let i = 0; i < 4; i++) {
    todaySlots.push(allSlots[dayIndex * 4 + i]);
  }

  todaySlots.forEach(slot => slot && slot.classList.add('is-today-col'));

  const currentHour = today.getHours();
  const currentMinutes = today.getMinutes();
  const currentTime = currentHour + (currentMinutes / 60);

  const timeSlots = [
    { start: 10.5, end: 12.5, index: 0 },
    { start: 12.5, end: 14.5, index: 1 },
    { start: 16.0, end: 18.0, index: 2 },
    { start: 18.0, end: 20.0, index: 3 },
  ];

  let currentSlotFound = false;
  for (const ts of timeSlots) {
    if (currentTime >= ts.start && currentTime < ts.end) {
      if (todaySlots[ts.index]) {
        todaySlots[ts.index].classList.add('is-live');
        currentSlotFound = true;
      }
      break;
    }
  }

  if (!currentSlotFound) {
    for (const ts of timeSlots) {
      if (currentTime < ts.start) {
        if (todaySlots[ts.index]) todaySlots[ts.index].classList.add('is-live');
        break;
      }
    }
  }
}

/* ---------- Theme switcher ---------- */
function setupThemeSwitcher() {
  const toggleBtn = document.getElementById('themeToggle');
  const panel = document.getElementById('themePanel');
  const buttons = document.querySelectorAll('[data-theme]');

  toggleBtn.addEventListener('click', () => panel.classList.toggle('active'));

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
      panel.classList.remove('active');
    }
  });

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', theme);
      localStorage.setItem('selectedTheme', theme);
    });
  });

  const savedTheme = localStorage.getItem('selectedTheme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
}

/* --------- Context Menu and Right Click Disable ------------ */
// document.addEventListener('contextmenu', e => e.preventDefault());
// document.addEventListener('keydown', e => {
//   if (
//     e.key === 'F12' ||
//     (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) ||
//     (e.ctrlKey && e.key.toUpperCase() === 'U')
//   ) {
//     e.preventDefault();
//   }
// });

/* ---------- Logout / lock screen ---------- */
function setupLogout() {
  document.getElementById('logoutBtn').addEventListener('click', lockApp);
}
