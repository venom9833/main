/* ─── PARALLAX (hero columns) ─────────────────── */
const cols = document.querySelectorAll(".parallax-col");
let ticking = false;

function updateParallax() {
  const scrollY = window.scrollY;
  const heroH = document.querySelector(".hero").offsetHeight;
  if (scrollY > heroH * 1.2) {
    ticking = false;
    return;
  }
  cols.forEach((col) => {
    const speed = parseFloat(col.dataset.speed) || 0.3;
    const offset = scrollY * speed * 0.6;
    col.style.transform = `translateY(${offset}px)`;
  });
  ticking = false;
}

window.addEventListener(
  "scroll",
  () => {
    if (!ticking) {
      requestAnimationFrame(updateParallax);
      ticking = true;
    }
  },
  { passive: true }
);

/* ─── GALLERY DRAG SCROLL ─────────────────────── */
const gallery = document.getElementById("galleryStrip");
let isDown = false,
  startX = 0,
  scrollLeft = 0;

gallery.addEventListener("mousedown", (e) => {
  isDown = true;
  startX = e.pageX - gallery.offsetLeft;
  scrollLeft = gallery.parentElement.scrollLeft;
  gallery.style.cursor = "grabbing";
});
window.addEventListener("mouseup", () => {
  isDown = false;
  gallery.style.cursor = "crosshair";
});
gallery.addEventListener("mousemove", (e) => {
  if (!isDown) return;
  e.preventDefault();
  const x = e.pageX - gallery.offsetLeft;
  const walk = (x - startX) * 1.5;
  gallery.parentElement.scrollLeft = scrollLeft - walk;
});

/* ─── GALLERY AUTO-PARALLAX ───────────────────── */
const gallerySection = document.querySelector(".gallery-strip");
function updateGallery() {
  const rect = gallerySection.getBoundingClientRect();
  const center = rect.top + rect.height / 2 - window.innerHeight / 2;
  const shift = center * 0.12;
  gallery.style.transform = `translateX(${-shift}px)`;
}
window.addEventListener("scroll", () => requestAnimationFrame(updateGallery), {
  passive: true
});

/* ─── SUBSCRIBE ───────────────────────────────── */
document.getElementById("subBtn").addEventListener("click", () => {
  const val = document.getElementById("emailInput").value.trim();
  if (!val || !val.includes("@")) {
    document.getElementById("emailInput").style.borderColor = "#B05C52";
    document.getElementById("emailInput").style.background = "#FDF0EB";
    setTimeout(() => {
      document.getElementById("emailInput").style.borderColor = "";
      document.getElementById("emailInput").style.background = "";
    }, 1200);
    return;
  }
  document.getElementById("subForm").style.display = "none";
  document.getElementById("successMsg").style.display = "block";
});
document.getElementById("emailInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("subBtn").click();
});

/* ─── CARD HOVER COLOUR TINT ──────────────────── */
document.querySelectorAll(".class-card").forEach((card) => {
  const orig = card.style.background || getComputedStyle(card).backgroundColor;
  card.addEventListener("mouseenter", () => {
    card.style.filter = "brightness(0.96)";
  });
  card.addEventListener("mouseleave", () => {
    card.style.filter = "";
  });
});
