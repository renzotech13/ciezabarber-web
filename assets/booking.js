/* =========================================================================
   Reserva de cita — ahora vive dentro de la portada como modal, no como
   página aparte. La disponibilidad y la reserva pasan por el bot (mismo
   motor que WhatsApp), así una reserva web y una por WhatsApp compiten por
   el mismo horario de verdad.
   ========================================================================= */
(function () {
  "use strict";

  const BOT_API_URL = "https://bot.ciezabarber.com";
  const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  const DIAS_PLURAL = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];
  const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const GRUPOS = ["Principales", "Complementarios", "Opcionales"];

  // `descanso` es el índice de Date.getDay() (0=domingo … 6=sábado) del día
  // que ese barbero no atiende. Es un bloqueo puramente de calendario (no
  // depende del bot, que todavía no distingue citas por barbero) — el
  // selector de fecha simplemente deshabilita esos días de la semana.
  const BARBEROS = [
    { id: "cieza", nombre: "Cieza", rol: "Fundador · Barbero", descanso: 3, foto: "assets/img/ciezabarber_2.jpg" },
    { id: "nilton", nombre: "Nilton", rol: "Barbero profesional", descanso: 2, foto: "assets/img/ciezabarber-nilton.jpg" },
    { id: "bryan", nombre: "Bryan", rol: "Barbero profesional", descanso: 1, foto: "assets/img/bryan-barber.jpg" }
  ];

  const $ = (s, c) => (c || document).querySelector(s);
  const body = $("#bkBody");
  const foot = $("#bkFoot");
  const stepsEl = $("#bkSteps");
  const backBtn = $("#bkBack");
  const nextBtn = $("#bkNext");
  const summaryEl = $("#bkSummary");

  // Catálogo local de respaldo, por si Supabase no responde: la carta que se
  // muestra en la portada, agrupada como la espera el reservador.
  function gruposLocales() {
    return GRUPOS.map((title) => ({
      title,
      services: (window.CIEZA_SERVICIOS || [])
        .filter((s) => s.grupo === title)
        .map((s) => ({ id: s.id, name: s.nombre, duration: s.duracion, price: s.precio == null ? "—" : String(s.precio), description: s.desc }))
    })).filter((g) => g.services.length);
  }

  const state = {
    step: 1, grupos: [], cargandoCatalogo: true, catalogoError: false,
    filtro: "Todos", serviceIds: [],
    barbero: null,
    dayOffset: 0, dateIdx: null, time: null, firstVisit: null,
    nombre: "", telefono: "", comentario: "",
    disponibilidad: {}, dispLoading: false, dispError: false,
    enviando: false, error: null, confirmada: false,
    // Pago del adelanto: `pago` llega de /public/reservas cuando la reserva
    // quedó en stand-by. Sin él la cita ya está confirmada y no hay paso de
    // pago que mostrar.
    reservaId: null, pago: null, pagoEstado: "pendiente", pagoError: null,
    subiendo: false, copiado: false, restanteMs: 0, previewCaptura: null
  };

  /* ------------------------------ datos ------------------------------ */
  async function cargarCatalogo() {
    try {
      const grupos = await fetchServiceGroups();
      state.grupos = grupos.length ? grupos : gruposLocales();
    } catch (e) {
      state.grupos = gruposLocales();
      state.catalogoError = true;
    }
    state.cargandoCatalogo = false;
    render();
  }

  async function cargarDisponibilidad() {
    if (!state.serviceIds.length) return;
    state.dispLoading = true;
    state.dispError = false;
    render();
    const days = getDays();
    const desde = toISO(days[0]);
    const hasta = toISO(days[days.length - 1]);
    try {
      // El barbero ya se eligió en el paso anterior: pedimos SU agenda, no la
      // del local entero — cada barbero atiende en su propia silla.
      const barberoSel = BARBEROS.find((b) => b.id === state.barbero);
      const qBarbero = barberoSel ? `&barbero=${encodeURIComponent(barberoSel.nombre)}` : "";
      const url = `${BOT_API_URL}/public/disponibilidad?servicio_ids=${encodeURIComponent(state.serviceIds.join(","))}&fecha_desde=${desde}&fecha_hasta=${hasta}${qBarbero}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("bad_status");
      const data = await res.json();
      const mapa = {};
      data.forEach((d) => { mapa[d.fecha] = d.horas; });
      state.disponibilidad = mapa;
    } catch (e) {
      state.dispError = true;
    }
    state.dispLoading = false;
    render();
  }

  async function enviarReserva() {
    state.enviando = true;
    state.error = null;
    render();
    const days = getDays();
    const barbero = BARBEROS.find((b) => b.id === state.barbero);
    try {
      const res = await fetch(`${BOT_API_URL}/public/reservas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          servicio_ids: state.serviceIds,
          fecha: toISO(days[state.dateIdx]),
          hora: state.time,
          nombre: state.nombre.trim(),
          telefono: normalizarTelefono(state.telefono.trim()),
          primera_visita: state.firstVisit === "si" ? true : state.firstVisit === "no" ? false : null,
          comentario: state.comentario || undefined,
          ...(barbero ? { barbero: barbero.nombre } : {})
        })
      });
      if (res.status === 409) {
        // Alguien tomó ese horario mientras el cliente llenaba el formulario.
        state.enviando = false;
        state.error = "Ese horario se acaba de ocupar. Elige otro, por favor.";
        state.step = 3;
        state.time = null;
        await cargarDisponibilidad();
        return;
      }
      if (!res.ok) throw new Error("bad_status");
      const data = await res.json();
      state.reservaId = data.reserva_id || null;
      state.pago = data.pago || null;
    } catch (e) {
      state.enviando = false;
      state.error = "No se pudo enviar tu solicitud. Revisa tu conexión e inténtalo de nuevo.";
      render();
      return;
    }
    state.enviando = false;
    state.confirmada = true;
    if (state.pago) arrancarCuenta();
    render();
  }

  /* --------------------------- adelanto (Yape) --------------------------- */

  // El límite viene del servidor como instante absoluto, no como "quedan N
  // minutos": si el reloj del teléfono está desfasado, igual se cuenta contra
  // el mismo momento que va a aplicar el barrido del bot.
  let tickHandle = null;
  function arrancarCuenta() {
    clearInterval(tickHandle);
    const limite = new Date(state.pago.expira_at).getTime();
    const tick = () => {
      state.restanteMs = Math.max(0, limite - Date.now());
      if (state.restanteMs === 0) {
        clearInterval(tickHandle);
        // Solo se marca expirada si el cliente no llegó a subir nada; si ya
        // subió y quedó en revisión, su horario sigue apartado.
        if (state.pagoEstado === "pendiente") state.pagoEstado = "expirado";
      }
      render();
    };
    tick();
    tickHandle = setInterval(tick, 1000);
  }

  function mmss(ms) {
    const total = Math.ceil(ms / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  async function copiarYape() {
    const numero = state.pago.yape;
    try {
      await navigator.clipboard.writeText(numero);
    } catch (e) {
      // Safari/iOS fuera de HTTPS y navegadores viejos no exponen el
      // portapapeles: se copia con el textarea temporal de toda la vida.
      const ta = document.createElement("textarea");
      ta.value = numero;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (e2) { /* nada que hacer */ }
      document.body.removeChild(ta);
    }
    state.copiado = true;
    render();
    setTimeout(() => { state.copiado = false; render(); }, 2200);
  }

  /**
   * Reescala la captura antes de subirla: un screenshot de un iPhone puede
   * pesar 6 MB y no aporta nada frente a 1600px de ancho — la subida por
   * datos móviles se vuelve viable y el análisis lee igual el monto.
   */
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
        resolve({ base64: dataUrl.split(",")[1], mime: "image/jpeg", preview: dataUrl });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("no_es_imagen")); };
      img.src = url;
    });
  }

  async function subirComprobante(file) {
    if (!file || !state.pago) return;
    state.subiendo = true;
    state.pagoError = null;
    render();

    try {
      const { base64, mime, preview } = await comprimirImagen(file);
      state.previewCaptura = preview;
      const res = await fetch(`${BOT_API_URL}/public/reservas/${encodeURIComponent(state.reservaId)}/comprobante`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upload_token: state.pago.upload_token, mime_type: mime, imagen_base64: base64 })
      });

      if (res.status === 409) {
        state.pagoEstado = "expirado";
        clearInterval(tickHandle);
        return;
      }
      if (!res.ok) throw new Error("bad_status");

      const data = await res.json();
      state.pagoEstado = data.estado === "confirmado" ? "confirmado" : "revision";
      // Confirmada o en revisión, en ambos casos el horario deja de correr
      // peligro: el reloj del servidor ya se detuvo.
      clearInterval(tickHandle);
    } catch (e) {
      state.pagoError = "No se pudo subir la captura. Revisa tu conexión e inténtalo otra vez.";
    } finally {
      state.subiendo = false;
      render();
    }
  }

  /* ------------------------------ utilidades ------------------------------ */
  function serviciosElegidos() {
    const out = [];
    state.grupos.forEach((g) => g.services.forEach((s) => { if (state.serviceIds.includes(s.id)) out.push(s); }));
    return out;
  }
  function total() {
    return serviciosElegidos().reduce((t, s) => t + (parseFloat(s.price) || 0), 0);
  }
  function getDays() {
    const hoy = new Date();
    const days = [];
    for (let i = 0; i < 10; i++) {
      const d = new Date(hoy);
      d.setDate(hoy.getDate() + state.dayOffset + i);
      days.push(d);
    }
    return days;
  }
  function toISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function normalizarTelefono(raw) {
    const soloDigitos = raw.replace(/\D/g, "");
    return soloDigitos.startsWith("51") ? soloDigitos : `51${soloDigitos}`;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  /** Enlace de respaldo: si el motor de agenda no responde, el cliente igual
   *  puede reservar por WhatsApp con su selección ya escrita. */
  function waLink() {
    const nombres = serviciosElegidos().map((s) => s.name).join(", ");
    const barbero = BARBEROS.find((b) => b.id === state.barbero);
    let texto = nombres ? `Hola, quisiera agendar una cita para: ${nombres}` : "Hola, quisiera agendar una cita";
    if (barbero) texto += ` con ${barbero.nombre}`;
    return `https://wa.me/51973298407?text=${encodeURIComponent(texto)}`;
  }

  function precio(p) {
    const n = parseFloat(p);
    return isNaN(n) ? "Consultar" : "S/ " + n;
  }

  /* ------------------------------ pasos ------------------------------ */
  function paso1() {
    if (state.cargandoCatalogo) return '<p class="loading">Cargando la carta…</p>';
    const filtros = ["Todos"].concat(state.grupos.map((g) => g.title));
    const chips = filtros.map((f) =>
      `<button class="chip${state.filtro === f ? " on" : ""}" data-filtro="${esc(f)}">${esc(f)}</button>`).join("");
    const visibles = state.grupos.filter((g) => state.filtro === "Todos" || g.title === state.filtro);
    const bloques = visibles.map((g) => `
      <p class="mini muted" style="margin:22px 0 10px">${esc(g.title)}</p>
      <div class="svc-list">
        ${g.services.map((s) => `
          <button class="svc${state.serviceIds.includes(s.id) ? " on" : ""}" data-servicio="${esc(s.id)}">
            <span>
              <span class="svc-n">${esc(s.name)}</span>
              <span class="svc-d">${esc(s.duration)}${s.description ? " · " + esc(s.description.slice(0, 70)) : ""}</span>
            </span>
            <span class="svc-p">${precio(s.price)}</span>
          </button>`).join("")}
      </div>`).join("");
    return `
      <h2 class="display" style="font-size:clamp(26px,4vw,42px);margin-bottom:6px">Elige tu servicio</h2>
      <p class="text muted">Puedes combinar varios; sumamos la duración para buscarte un horario que alcance.</p>
      <div class="shop-filters">${chips}</div>
      ${bloques}`;
  }

  function paso2() {
    const tarjetas = BARBEROS.map((b) => `
      <button class="barbero-card${state.barbero === b.id ? " on" : ""}" data-barbero="${b.id}">
        <span class="barbero-photo"><img src="${b.foto}" alt="${esc(b.nombre)}"></span>
        <span class="barbero-nombre">${esc(b.nombre)}</span>
        <span class="barbero-rol">${esc(b.rol)}</span>
      </button>`).join("");
    return `
      <h2 class="display" style="font-size:clamp(26px,4vw,42px);margin-bottom:6px">Elige a tu barbero</h2>
      <p class="text muted">Cada barbero tiene su día de descanso — en el siguiente paso, ese día no aparece disponible.</p>
      <div class="barbero-grid">${tarjetas}</div>`;
  }

  function paso3() {
    const days = getDays();
    const barbero = BARBEROS.find((b) => b.id === state.barbero);
    const tarjetas = days.map((d, i) => {
      const iso = toISO(d);
      const horas = state.disponibilidad[iso];
      const descansa = !!barbero && d.getDay() === barbero.descanso;
      const sinCupo = !descansa && !state.dispLoading && Array.isArray(horas) && horas.length === 0;
      return `
        <button class="day${state.dateIdx === i ? " on" : ""}${(sinCupo || descansa) ? " off" : ""}" data-dia="${i}"${descansa ? ` title="${esc(barbero.nombre)} descansa este día"` : ""}>
          <span class="dw">${WEEKDAYS[d.getDay()]}</span>
          <span class="dd">${d.getDate()}</span>
          <span class="dm">${descansa ? "Descansa" : MONTHS[d.getMonth()]}</span>
        </button>`;
    }).join("");

    let horasHtml = '<p class="loading">Elige un día para ver los horarios libres.</p>';
    if (state.dispLoading) horasHtml = '<p class="loading">Consultando horarios…</p>';
    else if (state.dispError) horasHtml = `
      <div class="alert">No pudimos consultar la agenda en este momento.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="chip" data-reintentar>Reintentar</button>
        <a class="btn23" href="${waLink()}" target="_blank" rel="noopener"><span>Reservar por WhatsApp</span><i class="f1"></i><i class="f2"></i></a>
      </div>`;
    else if (state.dateIdx != null) {
      const diaElegido = days[state.dateIdx];
      const descansaHoy = !!barbero && diaElegido.getDay() === barbero.descanso;
      const horas = state.disponibilidad[toISO(diaElegido)] || [];
      horasHtml = descansaHoy
        ? `<p class="loading">${esc(barbero.nombre)} no atiende ese día. Elige otra fecha.</p>`
        : horas.length
          ? `<div class="times">${horas.map((h) => `<button class="time${state.time === h ? " on" : ""}" data-hora="${esc(h)}">${esc(h)}</button>`).join("")}</div>`
          : '<p class="loading">Ese día ya no tiene cupos. Prueba con otro.</p>';
    }

    return `
      <h2 class="display" style="font-size:clamp(26px,4vw,42px);margin-bottom:6px">Fecha y hora</h2>
      <p class="text muted">Horarios reales: lo que ves libre es lo que hay.${barbero ? ` ${esc(barbero.nombre)} descansa los ${DIAS_PLURAL[barbero.descanso]}.` : ""}</p>
      ${state.error ? `<div class="alert" style="margin-top:16px">${esc(state.error)}</div>` : ""}
      <div style="display:flex;align-items:center;gap:10px;margin:22px 0 4px">
        <button class="chip" data-nav="-1"${state.dayOffset === 0 ? " disabled style=opacity:.35" : ""}>←</button>
        <div class="days" style="flex:1">${tarjetas}</div>
        <button class="chip" data-nav="1">→</button>
      </div>
      ${horasHtml}`;
  }

  function paso4() {
    return `
      <h2 class="display" style="font-size:clamp(26px,4vw,42px);margin-bottom:6px">Cuéntanos</h2>
      <p class="text muted">¿Es tu primera vez en Cieza Barber?</p>
      <div class="pick" style="margin:18px 0 28px">
        <button data-visita="si" class="${state.firstVisit === "si" ? "on" : ""}">Sí, primera vez</button>
        <button data-visita="no" class="${state.firstVisit === "no" ? "on" : ""}">Ya vine antes</button>
      </div>
      <div class="field">
        <label for="bkComentario">¿Algo que debamos saber? (opcional)</label>
        <textarea id="bkComentario" rows="4" placeholder="Ej. quiero fade bajo, tengo el cabello teñido…">${esc(state.comentario)}</textarea>
      </div>`;
  }

  function paso5() {
    const days = getDays();
    const fecha = state.dateIdx != null ? days[state.dateIdx] : null;
    const servicios = serviciosElegidos();
    const barbero = BARBEROS.find((b) => b.id === state.barbero);
    return `
      <h2 class="display" style="font-size:clamp(26px,4vw,42px);margin-bottom:6px">Tus datos</h2>
      <p class="text muted">Te confirmamos la cita por WhatsApp.</p>
      ${state.error ? `<div class="alert" style="margin-top:16px">${esc(state.error)} <a href="${waLink()}" target="_blank" rel="noopener" style="text-decoration:underline">Reservar por WhatsApp</a></div>` : ""}
      <div style="display:flex;gap:28px;flex-wrap:wrap;margin-top:22px">
        <div style="flex:1;min-width:260px">
          <div class="field">
            <label for="bkNombre">Nombre y apellido</label>
            <input id="bkNombre" type="text" autocomplete="name" value="${esc(state.nombre)}" placeholder="Renzo Cieza">
          </div>
          <div class="field">
            <label for="bkTelefono">WhatsApp</label>
            <input id="bkTelefono" type="tel" inputmode="numeric" autocomplete="tel" value="${esc(state.telefono)}" placeholder="987 654 321">
          </div>
        </div>
        <div style="flex:1;min-width:260px">
          <div class="resume">
            ${servicios.map((s) => `<div class="r"><span>${esc(s.name)}</span><span>${precio(s.price)}</span></div>`).join("")}
            <div class="r"><span>Barbero</span><span>${barbero ? esc(barbero.nombre) : "—"}</span></div>
            <div class="r"><span>Fecha</span><span>${fecha ? `${WEEKDAYS[fecha.getDay()]} ${fecha.getDate()} ${MONTHS[fecha.getMonth()]}` : "—"}</span></div>
            <div class="r"><span>Hora</span><span>${esc(state.time || "—")}</span></div>
            <div class="r" style="border-top:1px solid var(--line);padding-top:10px;font-weight:700"><span>Total</span><span>S/ ${total()}</span></div>
          </div>
          <p class="mini muted" style="margin-top:12px">Si necesitas cancelar, avísanos con anticipación por WhatsApp.</p>
        </div>
      </div>
      <div class="policy"><strong>Política de reserva:</strong> se confirma con el 50% de adelanto. Si llegas con más de 5 minutos de retraso, el 50% abonado no se reembolsa.</div>`;
  }

  function cuandoTexto() {
    const days = getDays();
    const fecha = days[state.dateIdx];
    if (!fecha) return "";
    return `${WEEKDAYS[fecha.getDay()]} ${fecha.getDate()} de ${MONTHS[fecha.getMonth()]} a las ${esc(state.time || "")}`;
  }

  /** Ícono oficial de Yape (recortado del logo completo, solo la burbuja). */
  function yapeMark() {
    return `<img class="yape-mark" src="assets/img/yape-icon.png" alt="" width="42" height="42">`;
  }

  /** Pantalla del adelanto: la cita está apartada, todavía no agendada. */
  function pasoPago() {
    const p = state.pago;

    if (state.pagoEstado === "confirmado") {
      return `
        <div class="ok-box">
          <div class="tick">✓</div>
          <h2 class="display" style="font-size:clamp(26px,4vw,42px)">Cita agendada</h2>
          <p class="text muted" style="max-width:44ch">
            Recibimos tu adelanto y tu cita del ${cuandoTexto()} quedó confirmada. Te esperamos en el estudio 💈
          </p>
          ${state.previewCaptura ? `<img class="pay-thumb" src="${state.previewCaptura}" alt="Constancia enviada">` : ""}
          <button class="btn23 outline" data-close-modal><span>Listo</span><i class="f1"></i><i class="f2"></i></button>
        </div>`;
    }

    if (state.pagoEstado === "revision") {
      return `
        <div class="ok-box">
          <div class="tick">⏳</div>
          <h2 class="display" style="font-size:clamp(26px,4vw,42px)">Captura recibida</h2>
          <p class="text muted" style="max-width:46ch">
            No pudimos validarla automáticamente, así que la va a revisar un asesor. Tu horario del ${cuandoTexto()}
            queda apartado mientras tanto — te escribimos al ${esc(state.telefono)} apenas quede confirmado.
          </p>
          ${state.previewCaptura ? `<img class="pay-thumb" src="${state.previewCaptura}" alt="Constancia enviada">` : ""}
          <button class="btn23 outline" data-close-modal><span>Entendido</span><i class="f1"></i><i class="f2"></i></button>
        </div>`;
    }

    if (state.pagoEstado === "expirado") {
      return `
        <div class="ok-box">
          <div class="tick">⌛</div>
          <h2 class="display" style="font-size:clamp(26px,4vw,42px)">Se liberó el horario</h2>
          <p class="text muted" style="max-width:46ch">
            Pasó el tiempo para enviar la constancia del adelanto, así que el ${cuandoTexto()} volvió a quedar
            disponible. Si ya yapeaste, escríbenos por WhatsApp con la captura y lo resolvemos.
          </p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
            <a class="btn23" href="${waLink()}" target="_blank" rel="noopener"><span>Escribir por WhatsApp</span><i class="f1"></i><i class="f2"></i></a>
            <button class="btn23 outline" data-close-modal><span>Cerrar</span><i class="f1"></i><i class="f2"></i></button>
          </div>
        </div>`;
    }

    const quedanPoco = state.restanteMs < 2 * 60 * 1000;
    return `
      <div class="pay">
        <div class="pay-head">
          <p class="mini muted" style="margin:0">Tu horario está apartado, falta el adelanto</p>
          <div class="pay-amount">${esc(p.adelanto_texto)}
            <small>50% de adelanto · ${cuandoTexto()}</small>
          </div>
        </div>

        <button type="button" class="yape-card${state.copiado ? " copied" : ""}" data-copiar-yape>
          ${yapeMark()}
          <span class="yape-txt">
            <span class="yape-name">Yape · Cieza Barber Studio</span>
            <span class="yape-num">${esc(formatearNumero(p.yape))}</span>
          </span>
          <span class="yape-hint">${state.copiado ? "¡Copiado!" : "Toca para<br>copiar"}</span>
        </button>

        ${state.pagoError ? `<div class="alert" style="margin:0">${esc(state.pagoError)}</div>` : ""}

        <div class="pay-upload${state.subiendo ? " busy" : ""}">
          <input type="file" id="bkComprobante" accept="image/jpeg,image/png,image/webp">
          <label for="bkComprobante">${state.subiendo ? "Subiendo captura…" : "Subir captura del Yape"}</label>
        </div>

        <p class="pay-count${quedanPoco ? " warn" : ""}">
          <b>${mmss(state.restanteMs)}</b><br>
          Si no recibimos la captura en ese tiempo, la fecha y hora quedan liberadas.
        </p>

        <div class="pay-steps">
          <ol>
            <li>Yapea ${esc(p.adelanto_texto)} al número de arriba.</li>
            <li>Toma captura de la constancia.</li>
            <li>Súbela acá y tu cita queda agendada al instante.</li>
          </ol>
        </div>

        <p class="pay-note">
          ¿Prefieres mandarla por WhatsApp? También vale:
          <a href="${waLink()}" target="_blank" rel="noopener" style="color:inherit">escríbenos</a>.
        </p>
      </div>`;
  }

  /** 914851374 → 914 851 374, más fácil de verificar de un vistazo. */
  function formatearNumero(n) {
    return String(n).replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
  }

  /** Reserva sin adelanto calculable: el monto lo coordina el staff. */
  function confirmacion() {
    const barbero = BARBEROS.find((b) => b.id === state.barbero);
    return `
      <div class="ok-box">
        <div class="tick">✓</div>
        <h2 class="display" style="font-size:clamp(26px,4vw,42px)">Cita solicitada</h2>
        <p class="text muted" style="max-width:44ch">
          Te escribiremos al <strong>${esc(state.telefono)}</strong> para confirmar tu cita${barbero ? ` con ${esc(barbero.nombre)}` : ""} del
          ${cuandoTexto()} y coordinar el adelanto.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:8px">
          <a class="btn23" href="https://wa.me/51973298407?text=${encodeURIComponent("Hola, acabo de reservar una cita en la web a nombre de " + state.nombre)}" target="_blank" rel="noopener"><span>Escribir por WhatsApp</span><i class="f1"></i><i class="f2"></i></a>
          <button class="btn23 outline" data-close-modal><span>Listo</span><i class="f1"></i><i class="f2"></i></button>
        </div>
      </div>`;
  }

  /* ------------------------------ render ------------------------------ */
  function puedeAvanzar() {
    if (state.step === 1) return state.serviceIds.length > 0;
    if (state.step === 2) return !!state.barbero;
    if (state.step === 3) return state.dateIdx != null && !!state.time;
    if (state.step === 4) return !!state.firstVisit;
    if (state.step === 5) return state.nombre.trim().length > 1 && state.telefono.replace(/\D/g, "").length >= 6 && !state.enviando;
    return false;
  }

  function render() {
    if (state.confirmada) {
      stepsEl.innerHTML = "";
      foot.style.display = "none";
      body.innerHTML = state.pago ? pasoPago() : confirmacion();
      return;
    }
    foot.style.display = "";
    stepsEl.innerHTML = [1, 2, 3, 4, 5].map((n) => `<i class="${n <= state.step ? "on" : ""}"></i>`).join("");
    body.innerHTML = [paso1, paso2, paso3, paso4, paso5][state.step - 1]();
    body.scrollTop = 0;

    backBtn.style.visibility = state.step === 1 ? "hidden" : "visible";
    const listo = puedeAvanzar();
    nextBtn.disabled = !listo;
    $("span", nextBtn).textContent = state.enviando ? "Enviando…" : state.step === 5 ? "Confirmar cita" : "Continuar";

    const servicios = serviciosElegidos();
    summaryEl.textContent = servicios.length
      ? `${servicios.length} servicio${servicios.length > 1 ? "s" : ""} · S/ ${total()}`
      : "";
  }

  /* ------------------------------ eventos ------------------------------ */
  body.addEventListener("change", (e) => {
    if (e.target.id === "bkComprobante") {
      const file = e.target.files && e.target.files[0];
      // Se limpia el input para que volver a elegir la MISMA foto (tras un
      // error de red) dispare el change otra vez.
      e.target.value = "";
      subirComprobante(file);
    }
  });

  body.addEventListener("click", (e) => {
    if (e.target.closest("[data-copiar-yape]")) { copiarYape(); return; }

    const chip = e.target.closest("[data-filtro]");
    if (chip) { state.filtro = chip.dataset.filtro; render(); return; }

    const svc = e.target.closest("[data-servicio]");
    if (svc) {
      const id = svc.dataset.servicio;
      state.serviceIds = state.serviceIds.includes(id)
        ? state.serviceIds.filter((x) => x !== id)
        : state.serviceIds.concat(id);
      render();
      return;
    }

    const barb = e.target.closest("[data-barbero]");
    if (barb) { state.barbero = barb.dataset.barbero; render(); return; }

    const nav = e.target.closest("[data-nav]");
    if (nav) {
      const dir = Number(nav.dataset.nav);
      state.dayOffset = Math.max(0, state.dayOffset + dir * 6);
      state.dateIdx = null; state.time = null;
      cargarDisponibilidad();
      return;
    }

    const dia = e.target.closest("[data-dia]");
    if (dia) { state.dateIdx = Number(dia.dataset.dia); state.time = null; render(); return; }

    if (e.target.closest("[data-reintentar]")) { cargarDisponibilidad(); return; }

    const hora = e.target.closest("[data-hora]");
    if (hora) { state.time = hora.dataset.hora; render(); return; }

    const visita = e.target.closest("[data-visita]");
    if (visita) { state.firstVisit = visita.dataset.visita; render(); return; }
  });

  body.addEventListener("input", (e) => {
    if (e.target.id === "bkNombre") state.nombre = e.target.value;
    if (e.target.id === "bkTelefono") state.telefono = e.target.value;
    if (e.target.id === "bkComentario") state.comentario = e.target.value;
    if (e.target.id === "bkNombre" || e.target.id === "bkTelefono") {
      nextBtn.disabled = !puedeAvanzar();
    }
  });

  backBtn.addEventListener("click", () => {
    state.step = Math.max(1, state.step - 1);
    state.error = null;
    render();
  });

  nextBtn.addEventListener("click", () => {
    if (!puedeAvanzar()) return;
    // Recién al elegir barbero se sabe qué día de descanso descartar, así
    // que la disponibilidad real se pide al entrar al paso de fecha/hora,
    // no antes.
    if (state.step === 2) { state.step = 3; render(); cargarDisponibilidad(); return; }
    if (state.step === 5) { enviarReserva(); return; }
    state.step += 1;
    render();
  });

  /* ------------------------------ apertura ------------------------------ */
  function abrir(ids) {
    if (state.confirmada) {
      // nueva reserva desde cero después de confirmar una
      state.confirmada = false;
      state.step = 1; state.serviceIds = []; state.barbero = null; state.dateIdx = null; state.time = null;
      state.firstVisit = null; state.comentario = ""; state.error = null;
      // El contador de la reserva anterior seguiría corriendo y repintando
      // el modal encima del paso 1.
      clearInterval(tickHandle);
      state.reservaId = null; state.pago = null; state.pagoEstado = "pendiente";
      state.pagoError = null; state.subiendo = false; state.previewCaptura = null; state.restanteMs = 0;
    }
    // Solo se preselecciona lo que existe en el catálogo real: el bot valida
    // los ids contra la tabla `services` y rechaza lo que no reconoce.
    const validos = state.grupos.flatMap((g) => g.services.map((s) => s.id));
    (ids || []).filter((id) => validos.includes(id) && !state.serviceIds.includes(id))
      .forEach((id) => state.serviceIds.push(id));
    window.CB.openModal("bookingModal");
    render();
  }

  window.addEventListener("cb:reservar", (e) => {
    const d = e.detail || {};
    abrir(d.servicios || (d.servicio ? [d.servicio] : []));
  });

  // Enlaces entrantes: index.html?servicios=corte-basico#reservar (lo que usan
  // salon.html y la vieja reserva.html, ahora redirigida acá).
  cargarCatalogo().then(() => {
    const params = new URLSearchParams(location.search);
    const pedidos = (params.get("servicios") || params.get("services") || "")
      .split(",").map((x) => x.trim()).filter(Boolean);
    if (location.hash === "#reservar" || pedidos.length) abrir(pedidos);
  });
})();
