(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const PHONE = '<a href="tel:+420519425986">519 425 986</a>';

  /* ---------- poptávka dílu ---------- */
  const form = document.querySelector("[data-form]");
  const done = document.querySelector("[data-done]");
  const msg = document.querySelector("[data-msg]");
  const submit = document.querySelector("[data-submit]");
  const ts = document.querySelector("[data-ts]");
  if (ts) ts.value = String(Date.now());

  const MESSAGES = {
    znacka: "Vyplňte značku vozu.",
    model: "Vyplňte model vozu.",
    rok: "Zadejte rok jako čtyřmístné číslo, např. 2016.",
    vin: "VIN má 17 znaků (bez písmen I, O, Q). Pokud si nejste jistí, nechte pole prázdné.",
    dil: "Napište, jaký díl sháníte.",
    jmeno: "Vyplňte jméno.",
    telefon: "Zadejte telefon, na kterém vás zastihneme.",
    email: "E-mail nemá správný tvar.",
    souhlas: "Bez souhlasu nemůžeme poptávku zpracovat.",
    foto: "Fotka může mít nejvýš 8 MB (JPG, PNG, WEBP nebo HEIC).",
  };

  function setError(name, text) {
    const el = form.elements[name];
    if (!el) return;
    const box = el.closest(".field, .check");
    box.classList.add("is-bad");
    el.setAttribute("aria-invalid", "true");
    if (box.classList.contains("field") && !box.querySelector(".field__err")) {
      const e = document.createElement("span");
      e.className = "field__err";
      e.id = "err-" + name;
      e.textContent = text;
      box.appendChild(e);
      el.setAttribute("aria-describedby", e.id);
    }
  }
  function clearError(el) {
    const box = el.closest(".field, .check");
    if (!box) return;
    box.classList.remove("is-bad");
    el.removeAttribute("aria-invalid");
    box.querySelector(".field__err")?.remove();
  }
  function validate() {
    const bad = [];
    const v = (n) => (form.elements[n].value || "").trim();
    if (!v("znacka")) bad.push("znacka");
    if (!v("model")) bad.push("model");
    if (v("rok") && !/^(19|20)\d{2}$/.test(v("rok"))) bad.push("rok");
    if (v("vin") && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(v("vin"))) bad.push("vin");
    if (!v("dil")) bad.push("dil");
    if (!v("jmeno")) bad.push("jmeno");
    if ((v("telefon").match(/\d/g) || []).length < 9) bad.push("telefon");
    if (v("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v("email"))) bad.push("email");
    const f = form.elements.foto.files[0];
    if (f && f.size > 8 * 1024 * 1024) bad.push("foto");
    if (!form.elements.souhlas.checked) bad.push("souhlas");
    return bad;
  }
  function showMsg(html) { msg.innerHTML = html; msg.hidden = false; }
  function showDone() {
    form.hidden = true;
    done.hidden = false;
    done.focus();
    done.closest(".formcard").scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
  }

  if (form) {
    form.addEventListener("input", (e) => clearError(e.target));
    form.addEventListener("change", (e) => clearError(e.target));
    form.elements.vin.addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/\s/g, ""); });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.hidden = true;
      form.querySelectorAll(".is-bad").forEach((b) => b.classList.remove("is-bad"));
      form.querySelectorAll(".field__err").forEach((x) => x.remove());
      const bad = validate();
      if (bad.length) {
        bad.forEach((n) => setError(n, MESSAGES[n]));
        showMsg("Zkontrolujte prosím označená pole.");
        form.elements[bad[0]].focus();
        return;
      }
      submit.disabled = true;
      submit.textContent = "Odesílám…";
      try {
        const res = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { Accept: "application/json" } });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok) { showDone(); return; }
        if (data && data.errors) {
          Object.keys(data.errors).forEach((n) => setError(n, data.errors[n]));
          showMsg(data.message || "Zkontrolujte prosím označená pole.");
        } else {
          showMsg((data && data.message) || `Poptávku se nepodařilo odeslat. Zkuste to prosím znovu, nebo zavolejte na ${PHONE}.`);
        }
      } catch (err) {
        showMsg(`Poptávku se nepodařilo odeslat (chyba spojení). Zavolejte nám prosím na ${PHONE}.`);
      } finally {
        submit.disabled = false;
        submit.textContent = "Odeslat poptávku";
      }
    });

    document.querySelector("[data-again]")?.addEventListener("click", () => {
      form.reset();
      if (ts) ts.value = String(Date.now());
      done.hidden = true;
      form.hidden = false;
      form.elements.dil.focus();
    });

    // výsledek po odeslání bez JavaScriptu (poptavka.php přesměruje zpět)
    const q = new URLSearchParams(location.search);
    if (q.get("odeslano") === "1") showDone();
    else if (q.get("chyba")) showMsg(`Poptávku se nepodařilo odeslat. Zkontrolujte povinná pole, nebo zavolejte na ${PHONE}.`);
  }

  // skupina dílů -> předvyplnit formulář (delegace: tlačítka u 3D dodávky vznikají až později)
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick], [data-pick-typ]");
    if (!b || !form) return;
    e.preventDefault();
    const sel = document.querySelector("[data-skupina]");
    if (sel && b.dataset.pick) sel.value = b.dataset.pick;
    if (b.dataset.pickTyp) form.querySelector(`[name="typ"][value="${b.dataset.pickTyp}"]`).checked = true;
    if (form.hidden) document.querySelector("[data-again]").click();
    document.querySelector(".formcard").scrollIntoView({ behavior: reduce.matches ? "auto" : "smooth", block: "start" });
    setTimeout(() => form.elements.znacka.value ? form.elements.dil.focus({ preventScroll: true }) : form.elements.znacka.focus({ preventScroll: true }), reduce.matches ? 0 : 600);
  });

  /* ---------- otevírací doba: dnešní den + otevřeno/zavřeno (čas Praha) ---------- */
  const HOURS = { 1: [8, 17], 2: [8, 17], 3: [8, 17], 4: [8, 17], 5: [8, 17], 6: null, 0: null };
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const now = +get("hour") + get("minute") / 60;
    document.querySelector(`[data-hours] [data-day="${day}"]`)?.classList.add("is-today");
    const h = HOURS[day];
    const open = !!h && now >= h[0] && now < h[1];
    document.querySelectorAll("[data-status]").forEach((s) => {
      s.textContent = open ? "Nyní otevřeno" : "Nyní zavřeno";
      s.classList.add(open ? "is-open" : "is-closed");
      s.hidden = false;
    });
  } catch (e) {}

  /* ---------- mobilní lišta: schovat, když je formulář na obrazovce ---------- */
  const dock = document.querySelector(".dock");
  const card = document.querySelector(".formcard");
  if (dock && card && "IntersectionObserver" in window) {
    let formVisible = true;
    new IntersectionObserver(([en]) => { formVisible = en.isIntersecting; toggleDock(); }).observe(card);
    const toggleDock = () => dock.classList.toggle("is-on", !formVisible && scrollY > 300);
    addEventListener("scroll", toggleDock, { passive: true });
  }

  /* ---------- vstup částí sekcí ---------- */
  const rise = document.querySelectorAll("[data-rise]");
  if ("IntersectionObserver" in window && !reduce.matches) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px" });
    rise.forEach((el) => io.observe(el));
  } else rise.forEach((el) => el.classList.add("is-in"));

  /* ---------- dodávka ve žlutém pruhu jede jen na obrazovce (ilustrace dílů jen po najetí myší) ---------- */
  if ("IntersectionObserver" in window && !reduce.matches) {
    const targets = document.querySelectorAll("[data-play]");
    const pio = new IntersectionObserver((entries) => entries.forEach((en) => en.target.classList.toggle("is-play", en.isIntersecting)), { rootMargin: "0px 0px -10% 0px" });
    targets.forEach((el) => pio.observe(el));
  }

  /* ---------- recenze: pás jede zleva doprava, dá se posouvat myší i prstem ---------- */
  const belt = document.querySelector("[data-belt]");
  if (belt) {
    const track = belt.querySelector("[data-belt-track]");
    const items = [...track.children];
    items.forEach((el) => {
      const c = el.cloneNode(true);
      c.setAttribute("aria-hidden", "true");
      track.append(c);
    });
    const SPEED = 42; // px za sekundu
    let half = 0, pos = 0, last = 0, hold = false, seen = false, resume = 0;
    const measure = () => { half = items[0].nextElementSibling ? track.children[items.length].offsetLeft - items[0].offsetLeft : 0; };
    const wrapPos = () => { if (!half) return; while (pos < 1) pos += half; while (pos >= half + 1) pos -= half; };
    const set = () => { wrapPos(); belt.scrollLeft = pos; };
    measure();
    pos = half;
    set();
    addEventListener("resize", () => { measure(); set(); });

    belt.addEventListener("scroll", () => {
      if (Math.abs(belt.scrollLeft - pos) > 2) { pos = belt.scrollLeft; if (pos < 1 || pos >= half + 1) set(); }
    }, { passive: true });

    const pause = (ms) => { clearTimeout(resume); hold = true; if (ms) resume = setTimeout(() => { hold = false; }, ms); };
    belt.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") pause(); });
    belt.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !drag) hold = false; });
    belt.addEventListener("touchstart", () => pause(), { passive: true });
    belt.addEventListener("touchend", () => pause(2500), { passive: true });
    belt.addEventListener("focusin", () => pause());
    belt.addEventListener("focusout", () => { hold = false; });

    // tažení myší (prst posouvá nativně)
    let drag = null;
    belt.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      drag = { x: e.clientX, p: pos };
      belt.setPointerCapture(e.pointerId);
      belt.classList.add("is-drag");
    });
    belt.addEventListener("pointermove", (e) => {
      if (!drag) return;
      pos = drag.p - (e.clientX - drag.x);
      set();
    });
    const endDrag = (e) => {
      if (!drag) return;
      drag = null;
      belt.classList.remove("is-drag");
      if (!belt.matches(":hover")) hold = false;
    };
    belt.addEventListener("pointerup", endDrag);
    belt.addEventListener("pointercancel", endDrag);

    const tick = (t) => {
      const dt = last ? Math.min(t - last, 100) / 1000 : 0;
      last = t;
      if (seen && !hold && !reduce.matches) { pos -= SPEED * dt; set(); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([en]) => { seen = en.isIntersecting; }).observe(belt);
    } else seen = true;
  }

  const y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();
})();
