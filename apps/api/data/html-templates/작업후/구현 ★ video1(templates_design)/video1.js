/* =====================
   SECRET LEVEL CLONE
   script.js
   ===================== */

// ── 1. Lenis Smooth Scroll ──────────────────────────
const lenis = new Lenis({
  duration: 1.4,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  orientation: 'vertical',
  smoothWheel: true,
});

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// Lenis + GSAP ScrollTrigger 연동
lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => { lenis.raf(time * 1000); });
gsap.ticker.lagSmoothing(0);


// ── 2. Header scroll effect ─────────────────────────
const header = document.getElementById('hdr');

lenis.on('scroll', ({ scroll }) => {
  if (scroll > 30) {
    header.classList.add('scrolled');
  } else {
    header.classList.remove('scrolled');
  }
});


// ── 3. Mobile Menu ──────────────────────────────────
const menuToggle = document.getElementById('menuToggle');
const menuClose  = document.getElementById('menuClose');
const mobileMenu = document.getElementById('mobileMenu');

function openMenu() {
  mobileMenu.classList.add('is-open');
  lenis.stop();
  document.body.style.overflow = 'hidden';
}

function closeMenu() {
  mobileMenu.classList.remove('is-open');
  lenis.start();
  document.body.style.overflow = '';
}

menuToggle.addEventListener('click', openMenu);
menuClose.addEventListener('click', closeMenu);

// ESC 키로 닫기
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

// 바깥 클릭으로 닫기
mobileMenu.addEventListener('click', (e) => {
  if (e.target === mobileMenu) closeMenu();
});


// ── 4. Section Fade-in (IntersectionObserver) ────────
const sectionContents = document.querySelectorAll('.section-content');

const observerOptions = {
  root: null,
  threshold: 0.15,
  rootMargin: '0px 0px -5% 0px',
};

const sectionObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      sectionObserver.unobserve(entry.target);
    }
  });
}, observerOptions);

sectionContents.forEach((el) => sectionObserver.observe(el));


// ── 5. GSAP Parallax - 비디오 배경 패럴랙스 ──────────
const scrollSections = document.querySelectorAll('.scroll-section');

scrollSections.forEach((section) => {
  const videoBg = section.querySelector('.video-bg');
  if (!videoBg) return;

  gsap.fromTo(videoBg,
    { yPercent: -8 },
    {
      yPercent: 8,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      }
    }
  );
});


// ── 6. GSAP 헤딩 텍스트 애니메이션 ───────────────────
const headings = document.querySelectorAll('.type-heading-xl, .type-heading-lg');

headings.forEach((heading) => {
  gsap.fromTo(heading,
    { opacity: 0, y: 50, skewY: 2 },
    {
      opacity: 1,
      y: 0,
      skewY: 0,
      duration: 1.0,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: heading,
        start: 'top 85%',
        toggleActions: 'play none none none',
      }
    }
  );
});


// ── 7. GSAP 태그(type-tag) 애니메이션 ────────────────
const tags = document.querySelectorAll('.type-tag');

tags.forEach((tag) => {
  gsap.fromTo(tag,
    { opacity: 0, y: 20 },
    {
      opacity: 0.85,
      y: 0,
      duration: 0.8,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: tag,
        start: 'top 88%',
        toggleActions: 'play none none none',
      }
    }
  );
});


// ── 8. GSAP 버튼 애니메이션 ──────────────────────────
const btnRows = document.querySelectorAll('.btn-row, .btn-wrap');

btnRows.forEach((row) => {
  const btns = row.querySelectorAll('.btn-glass, .btn-text');
  gsap.fromTo(btns,
    { opacity: 0, y: 20 },
    {
      opacity: 1,
      y: 0,
      duration: 0.7,
      stagger: 0.12,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: row,
        start: 'top 90%',
        toggleActions: 'play none none none',
      }
    }
  );
});


// ── 9. hero-desc 페이드인 ────────────────────────────
const heroDescs = document.querySelectorAll('.hero-desc');

heroDescs.forEach((desc) => {
  gsap.fromTo(desc,
    { opacity: 0, y: 24 },
    {
      opacity: 0.9,
      y: 0,
      duration: 0.9,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: desc,
        start: 'top 87%',
        toggleActions: 'play none none none',
      }
    }
  );
});


// ── 10. 비디오 자동재생 보장 (모바일 대응) ───────────
document.querySelectorAll('video').forEach((video) => {
  video.muted = true;
  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // 자동재생 차단 시 첫 터치/클릭으로 재생
      document.addEventListener('touchstart', () => video.play(), { once: true });
      document.addEventListener('click', () => video.play(), { once: true });
    });
  }
});


// ── 11. 현재 섹션 인디케이터 (선택사항) ──────────────
let currentSection = 0;

scrollSections.forEach((section, index) => {
  ScrollTrigger.create({
    trigger: section,
    start: 'top center',
    end: 'bottom center',
    onEnter: () => { currentSection = index; },
    onEnterBack: () => { currentSection = index; },
  });
});


// ── 12. 글래스 버튼 마우스 광택 효과 ────────────────
document.querySelectorAll('.btn-glass').forEach((btn) => {
  btn.addEventListener('mousemove', (e) => {
    const rect = btn.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    btn.style.setProperty('--shine-x', x + '%');
    btn.style.setProperty('--shine-y', y + '%');
  });
});


// ── 13. ScrollTrigger 리프레시 ───────────────────────
window.addEventListener('load', () => {
  ScrollTrigger.refresh();
});

window.addEventListener('resize', () => {
  ScrollTrigger.refresh();
});