(() => {
  const doc = document.documentElement;
  doc.classList.add("js");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- hero video: right size, no download for reduced motion / data saver ---------- */
  const video = document.querySelector(".hero__video");
  const saveData = navigator.connection && navigator.connection.saveData;
  function loadVideo() {
    if (!video || video.dataset.loaded || reduce.matches || saveData) return;
    const small = Math.min(innerWidth, innerHeight) < 720 || innerWidth < 900;
    video.src = small ? video.dataset.srcSd : video.dataset.srcHd;
    video.dataset.loaded = "1";
    video.load();
    const p = video.play();
    if (p && p.catch) p.catch(() => {});
  }
  if (document.readyState === "complete") loadVideo();
  else addEventListener("load", loadVideo, { once: true });
  reduce.addEventListener?.("change", (e) => {
    if (!video) return;
    if (e.matches) video.pause(); else { loadVideo(); video.play().catch(() => {}); }
  });
  // pause the loop while the hero is off-screen
  if (video && "IntersectionObserver" in window) {
    new IntersectionObserver(([en]) => {
      if (!video.dataset.loaded) return;
      en.isIntersecting ? video.play().catch(() => {}) : video.pause();
    }).observe(video);
  }

  /* ---------- reveal on scroll ---------- */
  const reveals = document.querySelectorAll(".reveal, .gauge");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    reveals.forEach((el) => {
      const sibs = el.parentElement ? [...el.parentElement.children].filter((c) => c.classList.contains("reveal")) : [];
      const i = sibs.indexOf(el);
      if (i > 0) el.style.setProperty("--d", Math.min(i, 6) * 0.08 + "s");
      io.observe(el);
    });
  } else reveals.forEach((el) => el.classList.add("is-in"));

  /* ---------- transform-based parallax (2–3 depths per section) ---------- */
  const layers = [...document.querySelectorAll("[data-depth]")].map((el) => ({
    el, depth: parseFloat(el.dataset.depth) || 0, host: el.closest("section") || el.parentElement,
  }));
  let vh = innerHeight, ticking = false, active = !reduce.matches;
  const mobileFactor = () => (innerWidth < 860 ? 0.6 : 1);

  function frame() {
    ticking = false;
    if (!active) return;
    const f = mobileFactor();
    for (const l of layers) {
      const r = l.host.getBoundingClientRect();
      if (r.bottom < -vh * 0.5 || r.top > vh * 1.5) continue;
      const offset = (r.top + r.height / 2 - vh / 2) * l.depth * f;
      l.el.style.transform = `translate3d(0, ${offset.toFixed(1)}px, 0)`;
    }
  }
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", () => { vh = innerHeight; request(); }, { passive: true });
  reduce.addEventListener?.("change", (e) => {
    active = !e.matches;
    if (!active) layers.forEach((l) => (l.el.style.transform = "")); else request();
  });
  request();

  /* ---------- nav + mobile dock ---------- */
  const nav = document.querySelector("[data-nav]");
  const dock = document.querySelector(".dock");
  const hero = document.querySelector(".hero");
  const onScroll = () => {
    const y = scrollY;
    nav.classList.toggle("is-solid", y > 40);
    if (dock) dock.classList.toggle("is-on", y > hero.offsetHeight * 0.6);
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- today's row + open/closed badge (Prague time) ---------- */
  const HOURS = { 1: [8, 17], 2: [8, 17], 3: [8, 17], 4: [8, 17], 5: [8, 17], 6: null, 0: null };
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const now = +get("hour") + get("minute") / 60;
    document.querySelector(`[data-hours] [data-day="${day}"]`)?.classList.add("is-today");
    const badge = document.querySelector("[data-status]");
    if (badge && day in HOURS) {
      const h = HOURS[day];
      const open = !!h && now >= h[0] && now < h[1];
      badge.textContent = open ? `Otevřeno do ${h[1]}:00` : "Nyní zavřeno";
      badge.classList.add(open ? "is-open" : "is-closed");
      badge.hidden = false;
    }
  } catch (e) {}

  const y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();
})();
