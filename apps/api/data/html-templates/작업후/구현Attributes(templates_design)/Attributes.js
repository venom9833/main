      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("visible");
              /* Animate priority bars when their card becomes visible */
              e.target.querySelectorAll(".pbar-fill[data-w]").forEach((bar) => {
                bar.style.width = bar.dataset.w + "%";
              });
              io.unobserve(e.target);
            }
          });
        },
        { threshold: 0.08 }
      );
      document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

      /* Nav active state */
      const sections = document.querySelectorAll("section[id]");
      const links = document.querySelectorAll(".nav-links a");
      const navIo = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              links.forEach((a) => a.classList.remove("active"));
              const l = document.querySelector(
                `.nav-links a[href="#${e.target.id}"]`
              );
              if (l) l.classList.add("active");
            }
          });
        },
        { rootMargin: "-40% 0px -55% 0px" }
      );
      sections.forEach((s) => navIo.observe(s));
   