/* burger menu v hlavičce (mobil a tablet) */
(() => {
  const head = document.querySelector(".head");
  const btn = head && head.querySelector(".burger");
  if (!btn) return;
  const mq = matchMedia("(max-width: 999px)");

  function set(open) {
    head.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", open ? "Zavřít menu" : "Otevřít menu");
  }

  btn.addEventListener("click", () => set(!head.classList.contains("is-open")));
  head.querySelector(".menu").addEventListener("click", (e) => {
    if (e.target.closest("a")) set(false);
  });
  document.addEventListener("click", (e) => {
    if (head.classList.contains("is-open") && !head.contains(e.target)) set(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && head.classList.contains("is-open")) {
      set(false);
      btn.focus();
    }
  });
  mq.addEventListener("change", () => set(false));
})();
