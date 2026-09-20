/* =========================================================================
   Tienda MUK — catálogo con filtros, ficha de producto, bolsa y pago.

   El último paso ya no es "coordinar por WhatsApp": el cliente paga con
   Yape y sube la captura ahí mismo, igual que en la reserva. Recién
   después se abre WhatsApp, ya con la compra hecha y registrada, para
   coordinar la entrega — no para cerrar la venta.

   El catálogo se lee de Supabase (tabla `products`, editable desde el
   admin — precio, línea, categorías, stock, activo/inactivo). Si Supabase
   no responde, cae al catálogo estático de assets/mukhair.js (el mismo que
   genera scripts/sync-mukhair.mjs), para que la tienda nunca se quede
   vacía por un problema de red.
   ========================================================================= */
(function () {
  "use strict";

  const WA = "51973298407";
  const BOT_API_URL = "https://bot.ciezabarber.com";
  const YAPE_NUMERO = "914851374";
  const PASO = 12;
  const $ = (s, c) => (c || document).querySelector(s);

  const grid = $("#shopGrid");
  const filtrosEl = $("#shopFilters");
  const moreBtn = $("#shopMore");
  if (!grid) return;

  const state = {
    filtro: "todos",
    visibles: PASO,
    // Dentro del modal de la bolsa hay tres pantallas: la bolsa, el pago y
    // el cierre. Una sola `vista` evita tener tres modales encadenados.
    vista: "bolsa",
    nombre: "",
    telefono: "",
    copiado: false,
    subiendo: false,
    error: null,
    resultado: null
  };
  let carrito = cargarCarrito();
  let PRODUCTOS = [];

  /** Fila de la tabla `products` -> la forma que ya espera el resto de este
   *  archivo (heredada del catálogo estático MUK_PRODUCTOS). */
  function desdeSupabase(row) {
    return {
      id: row.id,
      nombre: row.name,
      precio: Number(row.price),
      precio_lista: Number(row.price),
      oferta: false,
      tags: row.tags && row.tags.length ? row.tags : ["estilismo"],
      img: row.image_url || "",
      desc: row.description || "",
      linea: row.linea || "muk",
      // null = catálogo de respaldo, que no sabe de stock: ahí no se
      // bloquea nada, el servidor tiene la última palabra igual.
      stock: row.stock == null ? null : Number(row.stock)
    };
  }

  async function cargarProductos() {
    try {
      const rows = await fetchProducts();
      if (!rows.length) throw new Error("catálogo vacío");
      PRODUCTOS = rows.map(desdeSupabase);
    } catch (e) {
      PRODUCTOS = (window.MUK_PRODUCTOS || []).map((p) => Object.assign({ stock: null }, p));
    }
  }

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
  function lineasCarrito() {
    return carrito
      .map((l) => {
        const p = PRODUCTOS.find((x) => String(x.id) === String(l.id));
        return p ? { producto: p, cant: l.cant, subtotal: p.precio * l.cant } : null;
      })
      .filter(Boolean);
  }
  function totalCarrito() {
    return lineasCarrito().reduce((t, l) => t + l.subtotal, 0);
  }

  /* ------------------------------ utilidades ------------------------------ */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const soles = (n) => "S/ " + n.toFixed(2).replace(/\.00$/, "");
  const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function filtrados() {
    return state.filtro === "todos"
      ? PRODUCTOS
      : PRODUCTOS.filter((p) => p.tags.includes(state.filtro));
  }

  /* ------------------------------ vitrina ------------------------------ */
  function pintarFiltros() {
    filtrosEl.innerHTML = MUK_FILTROS.map((f) =>
      `<button class="chip${state.filtro === f.id ? " on" : ""}" data-filtro="${f.id}">${esc(f.label)}</button>`).join("");
  }

  function tarjeta(p) {
    const agotado = p.stock === 0;
    return `
      <article class="card" data-producto="${p.id}">
        <div class="ph">
          ${agotado ? '<span class="tag">Agotado</span>' : p.oferta ? '<span class="tag">Oferta</span>' : ""}
          <img src="${esc(p.img)}" alt="${esc(p.nombre)}" loading="lazy">
        </div>
        <span class="linea">${esc(p.linea)}</span>
        <h3 class="nm">${esc(p.nombre)}</h3>
        <div class="pr">
          <b>${soles(p.precio)}</b>
          ${p.oferta ? `<s>${soles(p.precio_lista)}</s>` : ""}
        </div>
        <button class="add" data-add="${p.id}"${agotado ? " disabled" : ""}>${agotado ? "Sin stock" : "Añadir"}</button>
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
    const p = PRODUCTOS.find((x) => String(x.id) === String(id));
    if (!p) return;
    const agotado = p.stock === 0;
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
          ${agotado ? "" : `
          <div class="qty" data-qty>
            <button data-step="-1" aria-label="Quitar uno">−</button><span data-cant>1</span><button data-step="1" aria-label="Agregar uno">+</button>
          </div>`}
          <button class="btn23" data-add-ficha="${p.id}"${agotado ? " disabled" : ""}><span>${agotado ? "Sin stock por ahora" : "Añadir a la bolsa"}</span><i class="f1"></i><i class="f2"></i></button>
          <p class="mini muted">Pagas con Yape acá mismo · Retiro en Jr. Manuel Gonzales Prada 875, Los Olivos · Delivery en Lima coordinado por WhatsApp.</p>
        </div>
      </div>`;
    window.CB.openModal("productModal");
  }

  /* ------------------------ bolsa y pago (modal) ------------------------ */
  function abrirBolsa() {
    // Volver a la bolsa siempre empieza limpio: si la compra anterior ya se
    // cerró, no tiene sentido reabrir el modal en la pantalla del "listo".
    if (state.vista === "listo") state.vista = "bolsa";
    state.error = null;
    pintarModal();
    window.CB.openModal("cartModal");
  }

  function pintarModal() {
    const cuerpo = $("#cartBody");
    const pie = $("#cartFoot");
    pintarPantalla(cuerpo, pie);
    // Un pie vacío igual dibujaría su borde y su franja beige: se oculta
    // para que la pantalla de cierre termine limpia.
    pie.style.display = pie.innerHTML.trim() ? "" : "none";
  }

  function pintarPantalla(cuerpo, pie) {
    if (state.vista === "pago") {
      cuerpo.innerHTML = vistaPago();
      pie.innerHTML = `<button class="btn23 outline" data-volver-bolsa><span>Volver a la bolsa</span><i class="f1"></i><i class="f2"></i></button>`;
      return;
    }
    if (state.vista === "listo") {
      cuerpo.innerHTML = vistaListo();
      pie.innerHTML = "";
      return;
    }
    cuerpo.innerHTML = vistaBolsa();
    pie.innerHTML = carrito.length
      ? `<div class="mini muted">Pagas con Yape y subes tu captura acá</div>
         <button class="btn23" data-ir-pago><span>Pagar con Yape</span><i class="f1"></i><i class="f2"></i></button>`
      : `<div class="mini muted">Agrega un producto para continuar</div>`;
  }

  function vistaBolsa() {
    const lineas = lineasCarrito();
    if (!lineas.length) return '<p class="empty">Tu bolsa está vacía.</p>';
    return lineas.map((l) => `
        <div class="cart-line">
          <img src="${esc(l.producto.img)}" alt="${esc(l.producto.nombre)}">
          <div style="flex:1">
            <div class="cl-n">${esc(l.producto.nombre)}</div>
            <div class="cl-p">${soles(l.producto.precio)} c/u</div>
          </div>
          <div class="qty">
            <button data-linea="${l.producto.id}" data-step="-1" aria-label="Quitar uno">−</button>
            <span>${l.cant}</span>
            <button data-linea="${l.producto.id}" data-step="1" aria-label="Agregar uno">+</button>
          </div>
          <button class="cl-x" data-quitar="${l.producto.id}" aria-label="Quitar producto">&times;</button>
        </div>`).join("") + `
      <div class="cart-total"><span class="mini muted">Total</span><b>${soles(totalCarrito())}</b></div>`;
  }

  function vistaPago() {
    const lineas = lineasCarrito();
    return `
      <div class="pay">
        <div class="pay-head">
          <p class="mini muted" style="margin:0">${lineas.map((l) => esc(`${l.cant} × ${l.producto.nombre}`)).join(" · ")}</p>
          <div class="pay-amount">${soles(totalCarrito())}
            <small>pago completo de tu pedido</small>
          </div>
        </div>

        <button type="button" class="yape-card${state.copiado ? " copied" : ""}" data-copiar-yape>
          <img class="yape-mark" src="assets/img/yape-icon.png" alt="" width="42" height="42">
          <span class="yape-txt">
            <span class="yape-name">Yape · Cieza Barber Studio</span>
            <span class="yape-num">${esc(YAPE_NUMERO.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3"))}</span>
          </span>
          <span class="yape-hint">${state.copiado ? "¡Copiado!" : "Toca para<br>copiar"}</span>
        </button>

        ${state.error ? `<div class="alert" style="margin:0">${esc(state.error)}</div>` : ""}

        <div class="field" style="margin:0">
          <label for="pedNombre">Tu nombre</label>
          <input id="pedNombre" type="text" autocomplete="name" placeholder="Nombre y apellido" value="${esc(state.nombre)}">
        </div>
        <div class="field" style="margin:0">
          <label for="pedTelefono">Tu WhatsApp</label>
          <input id="pedTelefono" type="tel" inputmode="numeric" autocomplete="tel" placeholder="987 654 321" value="${esc(state.telefono)}">
        </div>

        <div class="pay-upload${state.subiendo ? " busy" : ""}">
          <input type="file" id="pedComprobante" accept="image/jpeg,image/png,image/webp">
          <label for="pedComprobante">${state.subiendo ? "Enviando captura…" : "Enviar captura del Yape"}</label>
        </div>

        <p class="mini muted" style="text-align:center">
          Yapea ${soles(totalCarrito())} al número de arriba y sube la captura. Apenas la enviamos, se abre WhatsApp para coordinar la entrega.
        </p>
      </div>`;
  }

  function vistaListo() {
    const r = state.resultado || {};
    return `
      <div class="ok-box">
        <div class="tick">✓</div>
        <h2 class="display" style="font-size:clamp(24px,3.6vw,38px)">
          ${r.estado === "confirmado" ? "Compra registrada" : "Captura recibida"}
        </h2>
        <p class="text muted" style="max-width:420px">
          ${r.estado === "confirmado"
            ? "Tu pago se validó y el pedido ya quedó tomado. Te escribimos por WhatsApp para coordinar la entrega."
            : "Estamos revisando tu captura a mano. En unos minutos te confirmamos por WhatsApp."}
        </p>
        <button class="btn23" data-abrir-wa><span>Abrir WhatsApp</span><i class="f1"></i><i class="f2"></i></button>
      </div>`;
  }

  /* ------------------------------ pago ------------------------------ */
  function textoWhatsApp() {
    const r = state.resultado || {};
    const lineas = (r.lineas || []).map((l) => `• ${l.cant} x ${l.nombre} — ${soles(l.subtotal)}`);
    return [
      "Hola Cieza Barber, acabo de hacer una compra por la web y la pagué con Yape.",
      "",
      lineas.join("\n"),
      `Total: ${soles(r.total || 0)}`,
      "",
      "Ya subí la captura en la página. Quedo atento para coordinar la entrega."
    ].join("\n");
  }

  async function copiarYape() {
    try {
      await navigator.clipboard.writeText(YAPE_NUMERO);
    } catch (e) {
      // Safari/iOS fuera de HTTPS y navegadores viejos no exponen el
      // portapapeles: se copia con el textarea temporal de toda la vida.
      const ta = document.createElement("textarea");
      ta.value = YAPE_NUMERO;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e2) { /* nada que hacer */ }
      document.body.removeChild(ta);
    }
    state.copiado = true;
    pintarModal();
    setTimeout(() => { state.copiado = false; pintarModal(); }, 2200);
  }

  function abrirWhatsApp() {
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(textoWhatsApp())}`, "_blank", "noopener");
  }

  /** Reduce la captura antes de mandarla: una foto de celular sin escalar se
   *  va a varios MB en base64 y el endpoint la rechaza por tamaño. */
  function comprimirImagen(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1600;
        const escala = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * escala);
        canvas.height = Math.round(img.height * escala);
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ base64: dataUrl.split(",")[1], mime: "image/jpeg" });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("no_es_imagen")); };
      img.src = url;
    });
  }

  function normalizarTelefono(raw) {
    const soloDigitos = String(raw || "").replace(/\D/g, "");
    if (!soloDigitos) return "";
    return soloDigitos.startsWith("51") ? soloDigitos : `51${soloDigitos}`;
  }

  async function enviarPedido(file) {
    if (!file || state.subiendo) return;
    const lineas = lineasCarrito();
    if (!lineas.length) return;

    state.subiendo = true;
    state.error = null;
    pintarModal();

    try {
      const { base64, mime } = await comprimirImagen(file);
      const telefono = normalizarTelefono(state.telefono);
      const res = await fetch(`${BOT_API_URL}/public/pedidos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: l.cant })),
          ...(state.nombre.trim() ? { nombre: state.nombre.trim() } : {}),
          ...(telefono ? { telefono } : {}),
          mime_type: mime,
          imagen_base64: base64
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // El servidor manda el motivo concreto (sin stock, producto dado de
        // baja): mostrarlo tal cual le dice al cliente qué corregir.
        state.error = data.mensaje || "No pudimos registrar tu pedido. Revisa tu conexión e inténtalo otra vez.";
        return;
      }

      const data = await res.json();
      state.resultado = {
        estado: data.estado,
        total: Number(data.total) || totalCarrito(),
        lineas: lineas.map((l) => ({ cant: l.cant, nombre: l.producto.nombre, subtotal: l.subtotal }))
      };
      // La compra ya está del lado del servidor: vaciar la bolsa evita que
      // el cliente la vuelva a pagar creyendo que no se envió.
      carrito = [];
      guardarCarrito();
      state.vista = "listo";
      // Se intenta abrir WhatsApp solo: como el fetch cortó el gesto del
      // usuario, el navegador puede bloquearlo — por eso la pantalla igual
      // deja el botón a la vista.
      abrirWhatsApp();
    } catch (e) {
      state.error = "No se pudo enviar la captura. Revisa tu conexión e inténtalo otra vez.";
    } finally {
      state.subiendo = false;
      pintarModal();
    }
  }

  /** Catálogo de respaldo: sin ids reales de la BD el pedido no se puede
   *  registrar, así que se cierra por WhatsApp como antes. */
  function pedirPorWhatsApp() {
    const lineas = lineasCarrito();
    if (!lineas.length) return;
    const texto = `Hola Cieza Barber, quiero pedir estos productos MUK:\n\n${lineas
      .map((l) => `• ${l.cant} x ${l.producto.nombre} — ${soles(l.subtotal)}`)
      .join("\n")}\n\nTotal: ${soles(totalCarrito())}`;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  }

  function irAPago() {
    const lineas = lineasCarrito();
    if (!lineas.length) return;
    if (!lineas.every((l) => ES_UUID.test(String(l.producto.id)))) return pedirPorWhatsApp();
    state.vista = "pago";
    state.error = null;
    pintarModal();
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
      const cantEl = $("[data-cant]", $("#pdpBody"));
      agregar(add.dataset.addFicha, Number(cantEl && cantEl.textContent) || 1);
      window.CB.closeModal("productModal");
      abrirBolsa();
    }
  });

  $("#cartBody").addEventListener("click", (e) => {
    if (e.target.closest("[data-copiar-yape]")) return copiarYape();
    if (e.target.closest("[data-abrir-wa]")) return abrirWhatsApp();

    const quitar = e.target.closest("[data-quitar]");
    if (quitar) {
      carrito = carrito.filter((l) => String(l.id) !== quitar.dataset.quitar);
      guardarCarrito();
      pintarModal();
      return;
    }
    const step = e.target.closest("[data-linea]");
    if (step) {
      const linea = carrito.find((l) => String(l.id) === step.dataset.linea);
      if (!linea) return;
      linea.cant += Number(step.dataset.step);
      if (linea.cant < 1) carrito = carrito.filter((l) => l !== linea);
      guardarCarrito();
      pintarModal();
    }
  });

  // Los datos del comprador se guardan en el estado a medida que se
  // escriben: el modal se repinta entero en cada cambio de pantalla y si no
  // se conservaran, el nombre se perdería al subir la captura.
  $("#cartBody").addEventListener("input", (e) => {
    if (e.target.id === "pedNombre") state.nombre = e.target.value;
    if (e.target.id === "pedTelefono") state.telefono = e.target.value;
  });

  $("#cartBody").addEventListener("change", (e) => {
    if (e.target.id !== "pedComprobante") return;
    const file = e.target.files && e.target.files[0];
    if (file) enviarPedido(file);
  });

  $("#cartFoot").addEventListener("click", (e) => {
    if (e.target.closest("[data-ir-pago]")) return irAPago();
    if (e.target.closest("[data-volver-bolsa]")) {
      state.vista = "bolsa";
      state.error = null;
      pintarModal();
    }
  });

  ["#cartBtn", "#cartBtn2"].forEach((sel) => {
    const btn = $(sel);
    if (btn) btn.addEventListener("click", abrirBolsa);
  });

  /* ------------------------------ arranque ------------------------------ */
  pintarContador();
  pintarFiltros();
  grid.innerHTML = '<p class="loading">Cargando productos…</p>';
  cargarProductos().then(pintarGrid);
})();
