(() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const PHONE = '<a href="tel:+420519425986">519 425 986</a>';
  const smooth = () => (reduce.matches ? "auto" : "smooth");

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
    if (!el || !el.closest) return;
    const box = el.closest(".field, .check");
    if (!box) return;
    box.classList.add("is-bad");
    el.setAttribute("aria-invalid", "true");
    if (box.classList.contains("field") && !box.querySelector(".field__err")) {
      const e = document.createElement("span");
      e.className = "field__err";
      e.id = "err-" + name;
      e.textContent = text;
      box.appendChild(e);
      el.setAttribute("aria-describedby", [el.getAttribute("aria-describedby"), e.id].filter(Boolean).join(" "));
    }
  }
  function clearError(el) {
    const box = el.closest && el.closest(".field, .check");
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
    done.closest(".formbox").scrollIntoView({ behavior: smooth(), block: "center" });
  }

  /* ---------- VIN: značka a rok výroby z prvních znaků ---------- */
  // WMI (první 3 znaky) → výrobce; nejběžnější značky na českých silnicích
  const WMI = {
    TMB: "Škoda", WVW: "Volkswagen", WV1: "Volkswagen", WV2: "Volkswagen", WV3: "Volkswagen", WAU: "Audi", WUA: "Audi", TRU: "Audi",
    WBA: "BMW", WBS: "BMW", WBY: "BMW", WMW: "MINI", WDB: "Mercedes-Benz", WDD: "Mercedes-Benz", WDC: "Mercedes-Benz", WDF: "Mercedes-Benz",
    W1K: "Mercedes-Benz", W1N: "Mercedes-Benz", W1V: "Mercedes-Benz", VSS: "Seat", VF1: "Renault", UU1: "Dacia", VF3: "Peugeot", VR3: "Peugeot",
    VF7: "Citroën", VR7: "Citroën", ZFA: "Fiat", ZFC: "Fiat", ZAR: "Alfa Romeo", W0L: "Opel", W0V: "Opel", WF0: "Ford", KNA: "Kia", KNE: "Kia",
    U5Y: "Kia", KMH: "Hyundai", TMA: "Hyundai", JTD: "Toyota", JTN: "Toyota", JTM: "Toyota", SB1: "Toyota", NMT: "Toyota", YV1: "Volvo",
    JMZ: "Mazda", JHM: "Honda", SHH: "Honda", JN1: "Nissan", SJN: "Nissan", VSK: "Nissan", JSA: "Suzuki", TSM: "Suzuki", JMB: "Mitsubishi",
    SAL: "Land Rover", SAJ: "Jaguar", WP0: "Porsche", ZCF: "Iveco", YS3: "Saab",
  };
  const YEAR = "ABCDEFGHJKLMNPRSTVWXY123456789"; // 10. znak, cyklus 30 let
  // rok v 10. znaku spolehlivě kódují jen někteří výrobci (koncern VW, Hyundai/Kia); u ostatních ho nehádáme
  const YEAR_WMI = new Set(["TMB", "WVW", "WV1", "WV2", "WV3", "WAU", "WUA", "TRU", "VSS", "KMH", "TMA", "KNA", "KNE", "U5Y"]);
  function vinYear(c) {
    const i = YEAR.indexOf(c);
    if (i < 0) return null;
    const max = new Date().getFullYear() + 1;
    let y = 1980 + i;
    while (y + 30 <= max) y += 30;
    return y;
  }
  const vin = form?.querySelector("[data-vin]");
  const vinHint = form?.querySelector("[data-vin-hint]");
  function readVin(fill) {
    const v = vin.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (vin.value !== v) vin.value = v;
    vinHint.classList.remove("is-good");
    if (v.length < 3) { vinHint.textContent = ""; return; }
    if (/[IOQ]/.test(v)) { vinHint.textContent = "VIN neobsahuje písmena I, O ani Q – zkontrolujte, zda nejde o 1 nebo 0."; return; }
    const make = WMI[v.slice(0, 3)];
    const year = v.length >= 10 && YEAR_WMI.has(v.slice(0, 3)) ? vinYear(v[9]) : null;
    const parts = [];
    if (make) parts.push(make);
    if (year) parts.push(`rok výroby nejspíš ${year}`);
    if (!parts.length) { vinHint.textContent = v.length < 17 ? `${v.length} / 17 znaků` : ""; return; }
    vinHint.textContent = parts.join(", ") + (v.length < 17 ? ` · ${v.length} / 17 znaků` : "");
    vinHint.classList.add("is-good");
    if (fill && v.length === 17) {
      const filled = [];
      if (make && !form.elements.znacka.value.trim()) { form.elements.znacka.value = make; clearError(form.elements.znacka); filled.push("značku"); }
      if (year && !form.elements.rok.value.trim()) { form.elements.rok.value = String(year); filled.push("rok"); }
      if (filled.length) vinHint.textContent = `${parts.join(", ")} – doplnili jsme ${filled.join(" a ")}, zkontrolujte prosím.`;
    }
  }

  if (form) {
    form.addEventListener("input", (e) => clearError(e.target));
    form.addEventListener("change", (e) => clearError(e.target));
    vin.addEventListener("input", () => readVin(true));

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
      vinHint.textContent = "";
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

  // skupina dílů -> předvyplnit formulář
  document.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
    const sel = form.querySelector("[data-skupina]");
    if (sel) sel.value = b.dataset.pick;
    if (form.hidden) document.querySelector("[data-again]").click();
    form.closest(".formbox").scrollIntoView({ behavior: smooth(), block: "start" });
    const target = form.elements.znacka.value ? form.elements.dil : form.elements.vin;
    setTimeout(() => target.focus({ preventScroll: true }), reduce.matches ? 0 : 600);
  }));

  /* ---------- otevírací doba: dnešní den + otevřeno/zavřeno (čas Praha) ---------- */
  const HOURS = { 1: [8, 17], 2: [8, 17], 3: [8, 17], 4: [8, 17], 5: [8, 17], 6: null, 0: null };
  const DAYS = ["v neděli", "v pondělí", "v úterý", "ve středu", "ve čtvrtek", "v pátek", "v sobotu"];
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Prague", weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    const get = (t) => parts.find((p) => p.type === t).value;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
    const now = +get("hour") + get("minute") / 60;
    document.querySelector(`[data-hours] [data-day="${day}"]`)?.classList.add("is-today");
    const h = HOURS[day];
    const open = !!h && now >= h[0] && now < h[1];
    let next = "";
    if (!open) {
      if (h && now < h[0]) next = "dnes v 8:00";
      else { let d = day; do { d = (d + 1) % 7; } while (!HOURS[d]); next = (d === (day + 1) % 7 ? "zítra" : DAYS[d]) + " v 8:00"; }
    }
    const s = document.querySelector("[data-status]");
    if (s) {
      s.textContent = open ? `Právě máme otevřeno, do 17:00.` : `Teď je zavřeno, otevíráme ${next}. Poptávku pošlete kdykoli.`;
      s.classList.add(open ? "is-open" : "is-closed");
      s.hidden = false;
    }
  } catch (e) {}

  /* ---------- entrances: heading, text, picture, staggered once ---------- */
  const reveals = [...document.querySelectorAll(".reveal")];
  if ("IntersectionObserver" in window && !reduce.matches) {
    document.documentElement.classList.add("reveal-ready");
    const groups = new Map();
    reveals.forEach((el) => {
      const sec = el.closest("section, footer") || document.body;
      const i = groups.get(sec) || 0;
      el.style.setProperty("--d", Math.min(i, 6) * 0.075 + "s");
      groups.set(sec, i + 1);
    });
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add("is-in");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.08 });
    reveals.forEach((el) => io.observe(el));
    // safety net: never leave content hidden
    setTimeout(() => reveals.forEach((el) => el.classList.add("is-in")), 6000);
  }

  /* ---------- the moving pictures: full-screen photos settle as they pass ---------- */
  const movers = [...document.querySelectorAll(".verb__pic img, .range__pic img")];
  let ticking = false;
  function frame() {
    ticking = false;
    if (reduce.matches) return;
    const vh = innerHeight;
    for (const img of movers) {
      const r = img.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) continue;
      const p = Math.min(Math.max((vh - r.top) / (vh + r.height), 0), 1); // 0 entering → 1 leaving
      img.style.transform = `scale(${(1.14 - p * 0.14).toFixed(4)}) translate3d(0, ${((p - 0.5) * -4).toFixed(2)}%, 0)`;
    }
  }
  const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener("scroll", request, { passive: true });
  addEventListener("resize", request, { passive: true });
  request();

  /* ---------- phone bar: hidden while the form is on screen ---------- */
  const dock = document.querySelector(".dock");
  const box = document.querySelector(".formbox");
  if (dock && box && "IntersectionObserver" in window) {
    let formVisible = false;
    const toggle = () => dock.classList.toggle("is-on", !formVisible && scrollY > innerHeight * 0.6);
    new IntersectionObserver(([en]) => { formVisible = en.isIntersecting; toggle(); }).observe(box);
    addEventListener("scroll", toggle, { passive: true });
  }

  const y = document.querySelector("[data-year]");
  if (y) y.textContent = new Date().getFullYear();
})();
