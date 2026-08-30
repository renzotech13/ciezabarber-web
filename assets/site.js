/* =========================================================================
   Interacciones del sitio: menú, cursor, revelados, acordeón, galería,
   marquesina y lista de precios. Nada de esto depende de la red — si
   Supabase o el bot se caen, la portada sigue completa.
   ========================================================================= */
(function () {
  "use strict";

  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  /* ---------------- modales (compartido con booking.js y tienda.js) ------- */
  const openModals = [];
  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add("open");
    document.body.classList.add("is-locked");
    if (!openModals.includes(id)) openModals.push(id);
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("open");
    const i = openModals.indexOf(id);
    if (i >= 0) openModals.splice(i, 1);
    if (!openModals.length) document.body.classList.remove("is-locked");
  }
  window.CB = { openModal, closeModal };

  document.addEventListener("click", (e) => {
    const closer = e.target.closest("[data-close-modal]");
    if (closer) {
      const modal = closer.closest(".modal");
      if (modal) closeModal(modal.id);
      return;
    }
    // clic en el fondo oscuro cierra
    if (e.target.classList && e.target.classList.contains("modal")) closeModal(e.target.id);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openModals.length) closeModal(openModals[openModals.length - 1]);
  });

  /* ---------------- menú superior ---------------- */
  const topbar = $("#topbar");
  let lastY = window.scrollY;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y > 250) topbar.classList.toggle("hidden", y > lastY);
    else topbar.classList.remove("hidden");
    lastY = y;
  }, { passive: true });

  const burger = $("#burger");
  const menu = $("#menuOverlay");
  function setMenu(open) {
    menu.classList.toggle("open", open);
    menu.setAttribute("aria-hidden", String(!open));
    burger.setAttribute("aria-expanded", String(open));
    $(".burger-label", burger).textContent = open ? "Cerrar" : "Menú";
    document.body.classList.toggle("is-locked", open);
  }
  burger.addEventListener("click", () => setMenu(!menu.classList.contains("open")));
  $$("#menuOverlay a").forEach((a) => a.addEventListener("click", () => setMenu(false)));

  /* ---------------- cursor ---------------- */
  const cursor = $("#cursor");
  if (window.matchMedia("(hover:hover) and (pointer:fine)").matches) {
    window.addEventListener("mousemove", (e) => {
      cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    }, { passive: true });
    document.addEventListener("mouseover", (e) => {
      const big = e.target.closest("a, button, .card, .price-row, .svc, .day, .time");
      cursor.classList.toggle("big", !!big);
    });
  }

  /* ---------------- revelado al hacer scroll ---------------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { threshold: 0.12 });
  $$("[data-reveal]").forEach((el) => io.observe(el));

  /* ---------------- lista de enlaces con imagen ---------------- */
  const visual = $("#hoverVisual");
  if (visual) {
    const imgs = $$("img", visual);
    $$("#hoverLinks a").forEach((a) => {
      a.addEventListener("mouseenter", () => {
        const i = Number(a.dataset.img);
        imgs.forEach((img, n) => img.classList.toggle("on", n === i));
      });
    });
  }

  /* ---------------- acordeón ---------------- */
  $$("#acc .acc-item").forEach((item) => {
    const btn = $(".acc-toggle", item);
    const body = $(".acc-body", item);
    btn.addEventListener("click", () => {
      const isOpen = item.classList.contains("open");
      $$("#acc .acc-item").forEach((other) => {
        other.classList.remove("open");
        $(".acc-body", other).style.height = "0px";
      });
      if (!isOpen) {
        item.classList.add("open");
        body.style.height = $(".inner", body).offsetHeight + "px";
      }
    });
  });
  // el primero abierto de entrada
  const first = $("#acc .acc-item");
  if (first) {
    first.classList.add("open");
    const b = $(".acc-body", first);
    window.addEventListener("load", () => { b.style.height = $(".inner", b).offsetHeight + "px"; });
    b.style.height = $(".inner", b).offsetHeight + "px";
  }
  window.addEventListener("resize", () => {
    const open = $("#acc .acc-item.open");
    if (open) {
      const b = $(".acc-body", open);
      b.style.height = $(".inner", b).offsetHeight + "px";
    }
  });

  /* ---------------- marquesina ---------------- */
  const PALABRAS = ["Corte", "Ritual de barba", "Color", "Facial", "Platinado", "Mechas", "MUK", "Los Olivos"];
  ["#mq1", "#mq2"].forEach((sel) => {
    const track = $(sel);
    if (!track) return;
    track.innerHTML = PALABRAS.map((p) => `<span>${p}</span>`).join("");
  });

  /* ---------------- lista de precios ---------------- */
  const table = $("#priceTable");
  if (table && window.CIEZA_CARTA) {
    table.innerHTML = CIEZA_CARTA.map((grupo) => {
      const items = CIEZA_SERVICIOS.filter((s) => s.categoria === grupo.categoria);
      const filas = items.map((s) => `
        <div class="price-row" data-servicio="${s.id}" role="button" tabindex="0">
          <div>
            <div class="n">${s.nombre}</div>
            <span class="d">${s.duracion}</span>
          </div>
          <div class="p">${s.precio == null ? "Consultar" : "S/ " + s.precio}</div>
        </div>`).join("");
      return `
        <div class="price-cell">
          <div class="head">
            <h3 class="display">${grupo.titulo}</h3>
            <p class="text"><sub>${grupo.nota}</sub></p>
          </div>
          <div>${filas}</div>
        </div>`;
    }).join("");

    table.addEventListener("click", (e) => {
      const row = e.target.closest(".price-row");
      if (row) window.dispatchEvent(new CustomEvent("cb:reservar", { detail: { servicio: row.dataset.servicio } }));
    });
    table.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target.closest(".price-row");
      if (row) { e.preventDefault(); window.dispatchEvent(new CustomEvent("cb:reservar", { detail: { servicio: row.dataset.servicio } })); }
    });
  }

  /* ---------------- botones que abren la reserva ---------------- */
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-open-booking]");
    if (!btn) return;
    e.preventDefault();
    setMenu(false);
    window.dispatchEvent(new CustomEvent("cb:reservar", { detail: {} }));
  });
})();
