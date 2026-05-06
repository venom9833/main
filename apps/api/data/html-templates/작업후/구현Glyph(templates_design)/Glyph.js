/* -------------------------------------------------------------------------
       #NAVIGATION — Sticky scroll class
       ------------------------------------------------------------------------- */
const nav = document.getElementById("site-nav");
const navLinks = document.querySelectorAll("[data-nav-link]");
const sections = document.querySelectorAll("section[id]");
const scrollTopBtn = document.getElementById("scroll-top-btn");
const toast = document.getElementById("toast");
const toastMsg = document.getElementById("toast-msg");
let toastTimer;

window.addEventListener(
  "scroll",
  () => {
    const y = window.scrollY;

    // Sticky Nav background
    nav.classList.toggle("nav--scrolled", y > 20);

    // Active state via IntersectionObserver (below) or fallback
    // Scroll-to-top visibility (Fixed Positioning)
    scrollTopBtn.classList.toggle("is-visible", y > 400);
  },
  { passive: true }
);

// Scroll-to-top
scrollTopBtn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* -------------------------------------------------------------------------
       #ACTIVE STATE — IntersectionObserver for nav links
       ------------------------------------------------------------------------- */
const navObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const id = entry.target.getAttribute("id");
        navLinks.forEach((link) => {
          const isActive = link.getAttribute("href") === `#${id}`;
          link.classList.toggle("nav__link--active", isActive);
          if (isActive) link.setAttribute("aria-current", "page");
          else link.removeAttribute("aria-current");
        });
      }
    });
  },
  { rootMargin: `-${72}px 0px -60% 0px`, threshold: 0 }
);

sections.forEach((s) => navObserver.observe(s));

/* -------------------------------------------------------------------------
       #MOBILE MENU — Keyboard Navigation
       ------------------------------------------------------------------------- */
const burger = document.getElementById("nav-burger");
const mobileMenu = document.getElementById("mobile-menu");
const mobileLinks = document.querySelectorAll("[data-mobile-link]");

function toggleMenu(open) {
  burger.classList.toggle("is-open", open);
  mobileMenu.classList.toggle("is-open", open);
  mobileMenu.setAttribute("aria-hidden", String(!open));
  burger.setAttribute("aria-expanded", String(open));
  document.body.style.overflow = open ? "hidden" : "";
}

burger.addEventListener("click", () => {
  toggleMenu(!mobileMenu.classList.contains("is-open"));
});

mobileLinks.forEach((link) => {
  link.addEventListener("click", () => toggleMenu(false));
});

// Close on Escape (Keyboard Navigation)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && mobileMenu.classList.contains("is-open")) {
    toggleMenu(false);
    burger.focus();
  }
});

/* -------------------------------------------------------------------------
       #TOAST — utility
       ------------------------------------------------------------------------- */
function showToast(msg, duration = 3000) {
  clearTimeout(toastTimer);
  toastMsg.textContent = msg;
  toast.classList.add("is-visible");
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), duration);
}

document.getElementById("get-started-btn").addEventListener("click", () => {
  showToast("🚀 Redirecting to wallet creation…");
});

document.getElementById("launch-btn").addEventListener("click", () => {
  showToast("✅ Launching Glyph App…");
});

document.getElementById("cta-primary-btn").addEventListener("click", () => {
  showToast("🛡 Generating your keyless wallet…");
});

/* -------------------------------------------------------------------------
       #CONNECT WALLET — show on larger viewports
       ------------------------------------------------------------------------- */
const connectBtn = document.querySelector("#connect-btn");
const mq = window.matchMedia("(min-width: 900px)");
function handleMQ(e) {
  connectBtn.style.display = e.matches ? "inline-flex" : "none";
}
mq.addEventListener("change", handleMQ);
handleMQ(mq);
