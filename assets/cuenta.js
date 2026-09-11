/* =========================================================================
   Cuenta del cliente: entra con Google, vincula su WhatsApp y desde ahí ve
   sus citas, sus recompensas y su saldo a favor.

   Casi todo se lee directo de Supabase con la sesión del cliente: las
   policies de la 0028 ya garantizan que solo vea lo suyo, así que un
   endpoint intermedio en el bot no agregaría seguridad, solo latencia. Al
   bot solo se le pide lo que necesita la service role key: el código de
   vínculo y la cancelación (que borra el evento de Calendar y avisa al
   negocio).
   ========================================================================= */
(function () {
  "use strict";

  const BOT_API_URL = "https://bot.ciezabarber.com";
  const cuentaClient = supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  const app = document.getElementById("app");

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const soles = (n) => `S/ ${Number.isInteger(n) ? n : Number(n).toFixed(2)}`;

  const ESTADO_LABEL = {
    pendiente_pago: "Esperando tu pago",
    confirmada: "Confirmada",
    completada: "Atendida",
    cancelada: "Cancelada",
    no_asistio: "No asististe",
    expirada: "Liberada",
  };

  function fechaLarga(iso) {
    return new Date(iso).toLocaleString("es-PE", {
      timeZone: "America/Lima",
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /** Faltan más de 30 min: el mismo plazo que aplica el bot al cancelar. */
  function sePuedeCancelar(cita) {
    if (cita.estado !== "confirmada" && cita.estado !== "pendiente_pago") return false;
    return new Date(cita.inicio_utc).getTime() - Date.now() > 30 * 60_000;
  }

  async function llamarBot(path, opciones) {
    const { data } = await cuentaClient.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("sin_sesion");
    const res = await fetch(`${BOT_API_URL}${path}`, {
      ...opciones,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opciones?.headers || {}) },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.mensaje || json.error || "No se pudo completar la acción.");
    return json;
  }

  /* ------------------------------- pantallas ------------------------------ */

  function pintarLogin() {
    app.innerHTML = `
      <div class="card">
        <div class="card-head"><h2>Entra a tu cuenta</h2></div>
        <div class="card-body">
          <p class="serif muted" style="margin:0 0 18px;max-width:52ch">
            Con tu cuenta de Google ves tus citas, cuántos cortes llevas para tu próxima recompensa y el saldo que
            tengas a favor.
          </p>
          <button class="btn on" id="btnGoogle">Entrar con Google</button>
        </div>
      </div>`;
    document.getElementById("btnGoogle").addEventListener("click", async () => {
      const { error } = await cuentaClient.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/mi-cuenta.html" },
      });
      if (error) alert("No se pudo abrir el login de Google. Inténtalo de nuevo.");
    });
  }

  /**
   * Tarjeta de WhatsApp dentro del perfil.
   *
   * Verificar el número es OPCIONAL y no bloquea nada: al perfil se entra
   * solo con Google. Sirve para dos cosas concretas — traer el historial de
   * citas que hizo por WhatsApp (que está guardado bajo su número, no bajo
   * su correo) y poder avisarle por ahí.
   */
  function bloqueWhatsapp(vinculo) {
    if (vinculo.vinculado) {
      return `
        <div class="card" style="margin-top:16px">
          <div class="card-head"><h2>WhatsApp</h2></div>
          <div class="card-body">
            <p class="serif" style="margin:0">
              Verificado: <strong>+${esc(vinculo.telefono)}</strong>. Te avisamos por ahí de tus citas y de tus
              recompensas.
            </p>
          </div>
        </div>`;
    }
    return `
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>Verifica tu WhatsApp</h2></div>
        <div class="card-body" id="bloqueWa">
          <p class="serif muted" style="margin:0 0 14px;max-width:52ch">
            Tus citas anteriores están guardadas con tu número, no con tu correo. Verifícalo y aparecerán acá
            —con los cortes que llevas acumulados— y podremos avisarte por WhatsApp.
          </p>
          <button class="btn on" id="btnVerificarWa">Verificar mi WhatsApp</button>
        </div>
      </div>`;
  }

  /** Paso 2 de la verificación: el código que el cliente nos manda. */
  function pintarCodigoWa(datos) {
    const caja = document.getElementById("bloqueWa");
    if (!caja) return;
    caja.innerHTML = `
      <p class="serif" style="margin:0 0 6px;max-width:52ch">
        Mándanos este código por WhatsApp desde el número que quieres verificar:
      </p>
      <div class="codigo">${esc(datos.codigo)}</div>
      <div class="row">
        <a class="btn on" href="${esc(datos.wa_url)}" target="_blank" rel="noopener">Enviar por WhatsApp</a>
        <button class="btn" id="btnYaEnvie">Ya lo envié</button>
      </div>
      <p class="serif muted" style="margin:14px 0 0;font-size:14px;max-width:52ch">
        Se vincula con el número desde el que nos escribas — por eso te pedimos el mensaje a ti en vez de mandarte
        un código: así nadie puede reclamar el historial de otra persona.
      </p>`;
    document.getElementById("btnYaEnvie").addEventListener("click", cargar);
  }

  function bloqueCitas(citas) {
    const ahora = Date.now();
    const proximas = citas.filter((c) => new Date(c.inicio_utc).getTime() >= ahora && c.estado !== "cancelada");
    const pasadas = citas.filter((c) => new Date(c.inicio_utc).getTime() < ahora || c.estado === "cancelada");

    const fila = (c, conAcciones) => `
      <div class="cita">
        <div class="row" style="justify-content:space-between">
          <div>
            <div class="cuando">${esc(fechaLarga(c.inicio_utc))}</div>
            <div class="serif muted">
              ${esc(c.services?.name || "Servicio")}${c.barbero ? ` · con ${esc(c.barbero)}` : ""}
            </div>
          </div>
          <span class="estado">${esc(ESTADO_LABEL[c.estado] || c.estado)}</span>
        </div>
        ${
          conAcciones && sePuedeCancelar(c)
            ? `<button class="btn btn-danger" style="margin-top:10px" data-cancelar="${esc(c.id)}">Cancelar cita</button>`
            : conAcciones && (c.estado === "confirmada" || c.estado === "pendiente_pago")
              ? `<p class="serif muted" style="margin:8px 0 0;font-size:14px">Faltan menos de 30 minutos: escríbenos por WhatsApp para moverla.</p>`
              : ""
        }
      </div>`;

    return `
      <div class="card">
        <div class="card-head"><h2>Tus próximas citas</h2></div>
        ${
          proximas.length
            ? proximas.map((c) => fila(c, true)).join("")
            : `<div class="card-body"><p class="serif muted" style="margin:0">No tienes citas agendadas. Reserva desde la portada.</p></div>`
        }
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>Historial</h2></div>
        ${
          pasadas.length
            ? pasadas.slice(0, 20).map((c) => fila(c, false)).join("")
            : `<div class="card-body"><p class="serif muted" style="margin:0">Todavía no hay visitas registradas.</p></div>`
        }
      </div>`;
  }

  function bloqueRecompensas(cortes, recompensas, canjeadas) {
    const canjeadasIds = new Set(canjeadas.map((c) => c.recompensa_id));
    const siguiente = recompensas.find((r) => r.cortes_requeridos > cortes);
    const faltan = siguiente ? siguiente.cortes_requeridos - cortes : 0;
    const progreso = siguiente ? Math.min(100, (cortes / siguiente.cortes_requeridos) * 100) : 100;

    return `
      <div class="card">
        <div class="card-head">
          <h2>Tus recompensas</h2>
          <p class="serif muted" style="margin:6px 0 0">
            Llevas <strong>${cortes}</strong> ${cortes === 1 ? "corte" : "cortes"} con nosotros.
            ${siguiente ? `Te ${faltan === 1 ? "falta" : "faltan"} ${faltan} para: ${esc(siguiente.titulo)}.` : "Ya alcanzaste todas las metas 🎉"}
          </p>
          ${siguiente ? `<div class="barra"><i style="width:${progreso}%"></i></div>` : ""}
        </div>
        ${
          recompensas.length
            ? recompensas
                .map((r) => {
                  const ganada = cortes >= r.cortes_requeridos;
                  const usada = canjeadasIds.has(r.id);
                  const estado = usada ? "Ya la usaste" : ganada ? "¡La ganaste!" : `A los ${r.cortes_requeridos} cortes`;
                  return `
                    <div class="premio" style="${ganada && !usada ? "" : "opacity:.55"}">
                      <div class="n">${r.cortes_requeridos}</div>
                      <div style="flex:1">
                        <div style="font-weight:700">${esc(r.titulo)}</div>
                        <div class="serif muted">${esc(r.descripcion || "")}</div>
                      </div>
                      <span class="estado">${esc(estado)}</span>
                    </div>`;
                })
                .join("")
            : `<div class="card-body"><p class="serif muted" style="margin:0">Todavía no hay recompensas configuradas.</p></div>`
        }
      </div>`;
  }

  function bloqueSaldo(saldo) {
    if (saldo <= 0) return "";
    return `
      <div class="card" style="margin-top:16px">
        <div class="card-head"><h2>Saldo a favor</h2></div>
        <div class="card-body">
          <div style="font-weight:700;font-stretch:125%;font-size:30px;line-height:1">${soles(saldo)}</div>
          <p class="serif muted" style="margin:8px 0 0;max-width:52ch">
            De una cita que cancelaste. Menciónalo al reservar tu próxima cita y te lo descontamos.
          </p>
        </div>
      </div>`;
  }

  function pintarPanel({ vinculo, cliente, citas, recompensas, canjeadas, saldo }) {
    const cortes = citas.filter((c) => c.estado === "completada").length;
    const identidad = vinculo.vinculado
      ? `${esc(cliente.nombre || "Hola")} · WhatsApp +${esc(cliente.telefono)}`
      : esc(vinculo.email || "Tu cuenta");

    app.innerHTML = `
      <div class="row" style="justify-content:space-between;margin-bottom:20px">
        <p class="serif muted" style="margin:0">${identidad}</p>
        <button class="btn" id="btnSalir">Cerrar sesión</button>
      </div>
      <div class="grid dos">
        <div>${bloqueCitas(citas)}</div>
        <div>
          ${bloqueRecompensas(cortes, recompensas, canjeadas)}
          ${bloqueSaldo(saldo)}
          ${bloqueWhatsapp(vinculo)}
        </div>
      </div>`;

    document.getElementById("btnSalir").addEventListener("click", salir);
    app.querySelectorAll("[data-cancelar]").forEach((btn) => {
      btn.addEventListener("click", () => cancelar(btn.dataset.cancelar, btn));
    });

    const btnWa = document.getElementById("btnVerificarWa");
    if (btnWa) {
      btnWa.addEventListener("click", async () => {
        btnWa.disabled = true;
        btnWa.textContent = "Generando…";
        try {
          const datos = await llamarBot("/cliente/vinculo/whatsapp", { method: "POST", body: "{}" });
          if (datos.vinculado) return cargar();
          pintarCodigoWa(datos);
        } catch (err) {
          alert(err.message);
          btnWa.disabled = false;
          btnWa.textContent = "Verificar mi WhatsApp";
        }
      });
    }
  }

  async function cancelar(citaId, btn) {
    if (!window.confirm("¿Cancelar esta cita? Lo que ya pagaste queda como saldo a favor para tu próxima reserva.")) return;
    btn.disabled = true;
    btn.textContent = "Cancelando…";
    try {
      const r = await llamarBot(`/cliente/citas/${citaId}/cancelar`, { method: "POST", body: "{}" });
      alert(r.credito > 0 ? `Cita cancelada. Te quedan ${soles(r.credito)} a favor.` : "Cita cancelada.");
      cargar();
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
      btn.textContent = "Cancelar cita";
    }
  }

  async function salir() {
    await cuentaClient.auth.signOut();
    cargar();
  }

  /* -------------------------------- carga -------------------------------- */

  // onAuthStateChange dispara de una con INITIAL_SESSION, así que sin este
  // candado la página pedía el código DOS veces en paralelo al cargar y se
  // creaban dos verificaciones a milisegundos de distancia.
  let cargando = null;
  function cargar() {
    if (!cargando) cargando = cargarAhora().finally(() => { cargando = null; });
    return cargando;
  }

  async function cargarAhora() {
    const { data: sesion } = await cuentaClient.auth.getSession();
    if (!sesion.session) return pintarLogin();

    app.innerHTML = '<p class="serif muted">Cargando tu cuenta…</p>';

    let vinculo;
    try {
      vinculo = await llamarBot("/cliente/vinculo", { method: "POST", body: "{}" });
    } catch (err) {
      app.innerHTML = `<p class="serif">No pudimos cargar tu cuenta: ${esc(err.message)}</p>`;
      return;
    }

    // Al perfil se entra SIEMPRE con solo haber entrado con Google. Antes,
    // no tener ficha de cliente devolvía una pantalla muerta sin panel — y
    // como las reservas guardan nombre y teléfono pero no correo, eso le
    // pasaba a casi todo el mundo.
    //
    // Las recompensas se piden aunque no haya ficha: son la promesa pública
    // del programa, y verlas con el contador en cero es justamente lo que
    // invita a verificar el WhatsApp.
    const recompensasRes = await cuentaClient
      .from("recompensas")
      .select("*")
      .eq("activo", true)
      .order("cortes_requeridos");

    if (!vinculo.vinculado) {
      return pintarPanel({
        vinculo,
        cliente: { nombre: null, telefono: "" },
        citas: [],
        recompensas: recompensasRes.data || [],
        canjeadas: [],
        saldo: 0,
      });
    }

    // A partir de acá manda RLS: cada consulta devuelve solo lo del cliente
    // que entró, sin que el navegador tenga que filtrar por su id.
    const [clienteRes, citasRes, canjeadasRes, creditosRes] = await Promise.all([
      cuentaClient.from("clientes").select("id, nombre, telefono").maybeSingle(),
      cuentaClient.from("citas").select("id, inicio_utc, estado, barbero, services(name)").order("inicio_utc", { ascending: false }),
      cuentaClient.from("recompensas_canjeadas").select("recompensa_id"),
      cuentaClient.from("creditos_cliente").select("monto"),
    ]);

    const cliente = clienteRes.data || { nombre: null, telefono: vinculo.telefono };
    const saldo = (creditosRes.data || []).reduce((s, c) => s + Number(c.monto), 0);

    pintarPanel({
      vinculo,
      cliente,
      citas: citasRes.data || [],
      recompensas: recompensasRes.data || [],
      canjeadas: canjeadasRes.data || [],
      saldo,
    });
  }

  // El login de Google vuelve con la sesión en la URL; onAuthStateChange
  // dispara cuando supabase-js termina de canjearla, así que no hace falta
  // leer el hash a mano ni recargar.
  // Las dos: onAuthStateChange atrapa la vuelta del login de Google, y la
  // llamada directa cubre el caso de que no dispare. El candado de arriba se
  // encarga de que no se pida nada dos veces.
  cuentaClient.auth.onAuthStateChange(() => cargar());
  cargar();
})();
