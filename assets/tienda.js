/* =========================================================================
   Tienda MUK — catálogo del proveedor (assets/mukhair.js) con filtros,
   ficha de producto y bolsa. El pedido se cierra por WhatsApp, igual que
   las citas: no hay pasarela de pago en el sitio.
   ========================================================================= */
(function () {
  "use strict";

  const WA = "51914851374";
  const PASO = 12;
  const $ = (s, c) => (c || document).querySelector(s);

  const grid = $("#shopGrid");
  const filtrosEl = $("#shopFilters");
  const moreBtn = $("#shopMore");
  if (!grid || !window.MUK_PRODUCTOS) return;

  const state = { filtro: "todos", visibles: PASO };
  let carrito = cargarCarrito();

  /* ------------------------------ bolsa ------------------------------ */
  function cargarCarrito() {
    try { return JSON.parse(localStorage.getItem("cieza_carrito") || "[]"); }
    catch (e) { return []; }
  }
  function guardarCarrito() {
    try { localStorage.setItem("cieza_carrito", JSON.stringify(carrito)); } catch (e) { /* modo privado */ }
    pintarContador();
  }
  function pintarContador() {
    const n = carrito.reduce((t, l) => t + l.cant, 0);
    const btn = $("#cartBtn");
    $("#cartCount").textContent = n;
    btn.classList.toggle("has-items", n > 0);
  }
  function agregar(id, cant) {
    const linea = carrito.find((l) => String(l.id) === String(id));
    if (linea) linea.cant += cant || 1;
    else carrito.push({ id, cant: cant || 1 });
    guardarCarrito();
  }
  function totalCarrito() {
    return carrito.reduce((t, l) => {
      const p = MUK_PRODUCTOS.find((x) => String(x.id) === String(l.id));
      return t + (p ? p.precio * l.cant : 0);
    }, 0);
  }

  /* ------------------------------ utilidades ------------------------------ */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const soles = (n) => "S/ " + n.toFixed(2).replace(/\.00$/, "");

  function filtrados() {
    return state.filtro === "todos"
      ? MUK_PRODUCTOS
      : MUK_PRODUCTOS.filter((p) => p.tags.includes(state.filtro));
  }

  /* ------------------------------ vitrina ------------------------------ */
  function pintarFiltros() {
    filtrosEl.innerHTML = MUK_FILTROS.map((f) =>
      `<button class="chip${state.filtro === f.id ? " on" : ""}" data-filtro="${f.id}">${esc(f.label)}</button>`).join("");
  }

  function tarjeta(p) {
    return `
      <article class="card" data-producto="${p.id}">
        <div class="ph">
          ${p.oferta ? '<span class="tag">Oferta</span>' : ""}
          <img src="${esc(p.img)}" alt="${esc(p.nombre)}" loading="lazy">
        </div>
        <span class="linea">${esc(p.linea)}</span>
        <h3 class="nm">${esc(p.nombre)}</h3>
        <div class="pr">
          <b>${soles(p.precio)}</b>
          ${p.oferta ? `<s>${soles(p.precio_lista)}</s>` : ""}
        </div>
        <button class="add" data-add="${p.id}">Añadir</button>
      </article>`;
  }

  function pintarGrid() {
    const lista = filtrados();
    grid.innerHTML = lista.slice(0, state.visibles).map(tarjeta).join("");
    const quedan = lista.length - state.visibles;
    moreBtn.style.display = quedan > 0 ? "" : "none";
    $("span", moreBtn).textContent = `Ver ${Math.min(quedan, PASO)} productos más`;
  }

  /* ------------------------------ ficha ------------------------------ */
  function abrirFicha(id) {
    const p = MUK_PRODUCTOS.find((x) => String(x.id) === String(id));
    if (!p) return;
    $("#pdpLinea").textContent = p.linea;
    $("#pdpBody").innerHTML = `
      <div class="pdp">
        <div class="pdp-img"><img src="${esc(p.img)}" alt="${esc(p.nombre)}"></div>
        <div class="pdp-info">
          <h2 class="display" style="font-size:clamp(24px,3.4vw,38px)">${esc(p.nombre)}</h2>
          <div class="pdp-price">
            <b>${soles(p.precio)}</b>
            ${p.oferta ? `<s>${soles(p.precio_lista)}</s>` : ""}
          </div>
          <p class="text muted">${esc(p.desc || "Producto profesional MUK, disponible en el local.")}</p>
          <div class="qty" data-qty>
            <button data-step="-1" aria-label="Quitar uno">−</button><span data-cant>1</span><button data-step="1" aria-label="Agregar uno">+</button>
          </div>
          <button class="btn23" data-add-ficha="${p.id}"><span>Añadir a la bolsa</span><i class="f1"></i><i class="f2"></i></button>
          <p class="mini muted">Retiro en Jr. Manuel Gonzales Prada 875, Los Olivos · Delivery en Lima coordinado por WhatsApp.</p>
        </div>
      </div>`;
    window.CB.openModal("productModal");
  }

  /* ------------------------------ bolsa (modal) ------------------------------ */
  function pintarBolsa() {
    const cuerpo = $("#cartBody");
    if (!carrito.length) {
      cuerpo.innerHTML = '<p class="empty">Tu bolsa está vacía.</p>';
      return;
    }
    cuerpo.innerHTML = carrito.map((l) => {
      const p = MUK_PRODUCTOS.find((x) => String(x.id) === String(l.id));
      if (!p) return "";
      return `
        <div class="cart-line">
          <img src="${esc(p.img)}" alt="${esc(p.nombre)}">
          <div style="flex:1">
            <div class="cl-n">${esc(p.nombre)}</div>
            <div class="cl-p">${soles(p.precio)} c/u</div>
          </div>
          <div class="qty">
            <button data-linea="${p.id}" data-step="-1" aria-label="Quitar uno">−</button>
            <span>${l.cant}</span>
            <button data-linea="${p.id}" data-step="1" aria-label="Agregar uno">+</button>
          </div>
          <button class="cl-x" data-quitar="${p.id}" aria-label="Quitar producto">&times;</button>
        </div>`;
    }).join("") + `
      <div class="cart-total"><span class="mini muted">Total</span><b>${soles(totalCarrito())}</b></div>`;
  }

  function pedirPorWhatsApp() {
    if (!carrito.length) return;
    const lineas = carrito.map((l) => {
      const p = MUK_PRODUCTOS.find((x) => String(x.id) === String(l.id));
      return p ? `• ${l.cant} x ${p.nombre} — ${soles(p.precio * l.cant)}` : "";
    }).filter(Boolean);
    const texto = `Hola Cieza Barber, quiero pedir estos productos MUK:\n\n${lineas.join("\n")}\n\nTotal: ${soles(totalCarrito())}`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  }

  /* ------------------------------ eventos ------------------------------ */
  filtrosEl.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filtro]");
    if (!chip) return;
    state.filtro = chip.dataset.filtro;
    state.visibles = PASO;
    pintarFiltros();
    pintarGrid();
  });

  moreBtn.addEventListener("click", () => { state.visibles += PASO; pintarGrid(); });

  grid.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    if (add) {
      e.stopPropagation();
      agregar(add.dataset.add, 1);
      add.textContent = "Añadido ✓";
      setTimeout(() => { add.textContent = "Añadir"; }, 1200);
      return;
    }
    const card = e.target.closest("[data-producto]");
    if (card) abrirFicha(card.dataset.producto);
  });

  $("#pdpBody").addEventListener("click", (e) => {
    const step = e.target.closest("[data-step]");
    if (step && step.closest("[data-qty]")) {
      const span = $("[data-cant]", step.closest("[data-qty]"));
      const n = Math.max(1, Number(span.textContent) + Number(step.dataset.step));
      span.textContent = n;
      return;
    }
    const add = e.target.closest("[data-add-ficha]");
    if (add) {
      const cant = Number($("[data-cant]", $("#pdpBody")).textContent) || 1;
      agregar(add.dataset.addFicha, cant);
      window.CB.closeModal("productModal");
      pintarBolsa();
      window.CB.openModal("cartModal");
    }
  });

  $("#cartBody").addEventListener("click", (e) => {
    const quitar = e.target.closest("[data-quitar]");
    if (quitar) {
      carrito = carrito.filter((l) => String(l.id) !== quitar.dataset.quitar);
      guardarCarrito();
      pintarBolsa();
      return;
    }
    const step = e.target.closest("[data-linea]");
    if (step) {
      const linea = carrito.find((l) => String(l.id) === step.dataset.linea);
      if (!linea) return;
      linea.cant += Number(step.dataset.step);
      if (linea.cant < 1) carrito = carrito.filter((l) => l !== linea);
      guardarCarrito();
      pintarBolsa();
    }
  });

  ["#cartBtn", "#cartBtn2"].forEach((sel) => {
    const btn = $(sel);
    if (btn) btn.addEventListener("click", () => { pintarBolsa(); window.CB.openModal("cartModal"); });
  });
  $("#cartCheckout").addEventListener("click", pedirPorWhatsApp);

  /* ------------------------------ arranque ------------------------------ */
  pintarFiltros();
  pintarGrid();
  pintarContador();
})();
