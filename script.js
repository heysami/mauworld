const revealables = document.querySelectorAll("[data-reveal]");

if (revealables.length > 0) {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    {
      threshold: 0.2,
      rootMargin: "0px 0px -8% 0px",
    },
  );

  revealables.forEach((element) => revealObserver.observe(element));
}

const footerYears = document.querySelectorAll("[data-current-year]");
const currentYear = new Date().getFullYear();
footerYears.forEach((node) => {
  node.textContent = String(currentYear);
});

const guideLinks = Array.from(document.querySelectorAll(".guide-index a[href^='#']"));
const guideTargets = guideLinks
  .map((link) => {
    const id = link.getAttribute("href")?.slice(1) ?? "";
    const target = id ? document.getElementById(id) : null;
    return target ? { link, target } : null;
  })
  .filter(Boolean);

if (guideTargets.length > 0) {
  const setCurrentLink = (id) => {
    guideLinks.forEach((link) => {
      const matches = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("is-current", matches);
      if (matches) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const hashId = window.location.hash.replace(/^#/, "");
  if (hashId) {
    setCurrentLink(hashId);
  }

  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

      if (visible?.target?.id) {
        setCurrentLink(visible.target.id);
      }
    },
    {
      threshold: [0.2, 0.45, 0.7],
      rootMargin: "-12% 0px -50% 0px",
    },
  );

  guideTargets.forEach(({ target }) => sectionObserver.observe(target));
}

