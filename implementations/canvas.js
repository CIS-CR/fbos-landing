// flota/canvas.js — basado en implementations/canvas.js + service-desk/canvas.js
// ✅ Mobile-first (vertical): estados de arriba hacia abajo (tipo Ding Repairs)
// ✅ Desktop: mantiene layout tipo board (si el CSS lo soporta)
// ✅ API producción: https://api.fbos.org
// ✅ Endpoints: /api/demos/flota/actions, /api/demos/flota/actions/closed, /api/demos/flota/actions/:id/state
// ✅ Soporta confirm modal (Nuevas->Validadas y En revisión->Cerradas)
// ✅ Soporta comments (GET/POST /comments + fallback history)

const API_BASE = "https://api.fbos.org";
const DEMO_SLUG = "flota";

const ENDPOINT_ACTIONS = `${API_BASE}/api/demos/${DEMO_SLUG}/actions?limit=50`;
const ENDPOINT_CLOSED = `${API_BASE}/api/demos/${DEMO_SLUG}/actions/closed?limit=6`;

// Estados backend (deben coincidir con API)
const FLOW_STATES = ["Nuevas", "Validadas", "Asignadas", "En ejecución", "En revisión", "Cerradas"];

// Transiciones backend (MVP: solo “siguiente”)
const NEXT_STATE = {
  Nuevas: "Validadas",
  Validadas: "Asignadas",
  Asignadas: "En ejecución",
  "En ejecución": "En revisión",
  "En revisión": "Cerradas",
  Cerradas: null,
};

// Etiquetas UI (mismo español)
const STATE_LABEL = {
  Nuevas: "Nuevas",
  Validadas: "Validadas",
  Asignadas: "Asignadas",
  "En ejecución": "En ejecución",
  "En revisión": "En revisión",
  Cerradas: "Cerradas",
};

// Labels para botones (acción siguiente)
const ACTION_LABEL = {
  Nuevas: "Validar",
  Validadas: "Asignar",
  Asignadas: "Iniciar",
  "En ejecución": "Revisión",
  "En revisión": "Cerrar",
  Cerradas: "Cerrada",
};

const DEFAULT_VISIBLE_PER_STATE = 3;

// Cerradas: memoria operativa (mostramos pocas + historial)
const COLLAPSED_VISIBLE_CERRADAS = 3;
const MAX_VISIBLE_CERRADAS = 6;

// Ruta history de Flota
const HISTORY_URL = "/flota/history/";

// Cantidad visible por estado
const visibleByState = Object.fromEntries(FLOW_STATES.map((s) => [s, DEFAULT_VISIBLE_PER_STATE]));
const isExpandedByState = Object.fromEntries(FLOW_STATES.map((s) => [s, false]));

// cache cerradas (opcional)
let closedCache = [];

/* =========================
   Confirm modal (injected)
========================= */
const CONFIRM_TEXT = "¿Estás seguro que deseas mover esta solicitud?";
const CONFIRM_CANCEL = "Cancelar";
const CONFIRM_OK = "Confirmar";

function needsConfirm(currentState, nextState) {
  const cur = String(currentState || "").trim();
  const nxt = String(nextState || "").trim();
  if (cur === "Nuevas" && nxt === "Validadas") return true;
  if (cur === "En revisión" && nxt === "Cerradas") return true;
  return false;
}

function ensureConfirmModal() {
  if (document.getElementById("fbosConfirmModal")) return;

  const style = document.createElement("style");
  style.textContent = `
    .fbos-confirm-overlay{
      position:fixed; inset:0; background:rgba(0,0,0,.45);
      display:none; align-items:center; justify-content:center;
      z-index:9999; padding:16px;
    }
    .fbos-confirm-card{
      width:min(420px, 100%);
      background:#fff; border-radius:16px;
      box-shadow:0 12px 40px rgba(0,0,0,.25);
      overflow:hidden;
    }
    .fbos-confirm-body{ padding:18px 18px 10px; }
    .fbos-confirm-title{
      font-size:16px; font-weight:600; line-height:1.3;
      margin:0;
    }
    .fbos-confirm-actions{
      display:flex; gap:10px; justify-content:flex-end;
      padding:12px 18px 16px;
      border-top:1px solid rgba(0,0,0,.08);
    }
    .fbos-confirm-btn{
      appearance:none; border:0; border-radius:10px;
      padding:10px 14px; font-weight:600; cursor:pointer;
      font-size:14px;
    }
    .fbos-confirm-btn.cancel{ background:rgba(0,0,0,.06); }
    .fbos-confirm-btn.confirm{ background:rgba(0,0,0,.90); color:#fff; }
    .fbos-confirm-btn:disabled{ opacity:.6; cursor:not-allowed; }
  `;
  document.head.appendChild(style);

  const overlay = document.createElement("div");
  overlay.className = "fbos-confirm-overlay";
  overlay.id = "fbosConfirmModal";
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  overlay.innerHTML = `
    <div class="fbos-confirm-card" role="document">
      <div class="fbos-confirm-body">
        <p class="fbos-confirm-title" id="fbosConfirmText">${escapeHtml(CONFIRM_TEXT)}</p>
      </div>
      <div class="fbos-confirm-actions">
        <button type="button" class="fbos-confirm-btn cancel" id="fbosConfirmCancel">${escapeHtml(CONFIRM_CANCEL)}</button>
        <button type="button" class="fbos-confirm-btn confirm" id="fbosConfirmOk">${escapeHtml(CONFIRM_OK)}</button>
      </div>
    </div>
  `;

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) document.getElementById("fbosConfirmCancel")?.click();
  });

  document.body.appendChild(overlay);
}

function openConfirmModal() {
  ensureConfirmModal();

  const overlay = document.getElementById("fbosConfirmModal");
  const btnCancel = document.getElementById("fbosConfirmCancel");
  const btnOk = document.getElementById("fbosConfirmOk");

  if (!overlay || !btnCancel || !btnOk) return Promise.resolve(false);

  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");
  btnOk.focus();

  return new Promise((resolve) => {
    const cleanup = () => {
      btnCancel.removeEventListener("click", onCancel);
      btnOk.removeEventListener("click", onOk);
      document.removeEventListener("keydown", onKey);
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onOk = () => {
      cleanup();
      resolve(true);
    };
    const onKey = (e) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onOk();
    };

    btnCancel.addEventListener("click", onCancel);
    btnOk.addEventListener("click", onOk);
    document.addEventListener("keydown", onKey);
  });
}

/* =========================
   Helpers
========================= */
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stateClass(state) {
  const s = String(state || "").toLowerCase();
  if (s.includes("nuev")) return "badge-state-new";
  if (s.includes("valid")) return "badge-state-validated";
  if (s.includes("asign")) return "badge-state-assigned";
  if (s.includes("ejecu")) return "badge-state-execution";
  if (s.includes("revisi")) return "badge-state-review";
  if (s.includes("cerr")) return "badge-state-closed";
  return "badge-state-default";
}

function stateBadge(state) {
  const cls = `badge ${stateClass(state)}`;
  const label = STATE_LABEL[state] || state || "—";
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function urgencyBadge(urgency) {
  const u = String(urgency || "").toLowerCase();
  let cls = "badge";
  // En Flota usas: Baja/Media/Alta/Crítica (y a veces Normal/Urgente/Emergencia)
  if (u.includes("crít") || u.includes("critic") || u.includes("emerg")) cls += " badge-urgency-high";
  else if (u.includes("alta") || u.includes("urgent")) cls += " badge-urgency-mid";
  else cls += " badge-urgency-low";
  const label = urgency || "—";
  return `<span class="${cls}">${escapeHtml(label)}</span>`;
}

function parseActionNumber(actionId) {
  const m = String(actionId || "").match(/(\d+)\s*$/);
  return m ? Number(m[1]) : -1;
}

function parseCreatedAt(createdAt) {
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? t : 0;
}

function sortNewestFirst(actions) {
  return (actions || [])
    .slice()
    .sort((a, b) => {
      const ta = parseCreatedAt(a?.created_at);
      const tb = parseCreatedAt(b?.created_at);
      if (ta !== tb) return tb - ta;
      const na = parseActionNumber(a?.action_id);
      const nb = parseActionNumber(a?.action_id);
      return nb - na;
    });
}

function toolbarHtml(btnLabel = "Actualizar", btnDisabled = false, subline = "") {
  return `
    <div class="canvas-toolbar">
      <div class="canvas-title"></div>
      <button class="btn btn-small" id="refreshBtn" type="button" ${btnDisabled ? "disabled" : ""}>
        ${escapeHtml(btnLabel)}
      </button>
    </div>
    ${subline ? `<div class="canvas-subline">${escapeHtml(subline)}</div>` : ""}
  `;
}

function nextStateFor(current) {
  const s = String(current || "").trim();
  return NEXT_STATE[s] || null;
}

function actionButtonHtml(actionId, currentState) {
  const s = String(currentState || "").trim();
  const next = nextStateFor(s);
  const label = ACTION_LABEL[s] || "Avanzar";

  return `
    <button
      class="btn-action action-next-btn"
      type="button"
      ${next ? "" : "disabled"}
      data-action-id="${escapeHtml(actionId)}"
      data-current-state="${escapeHtml(s)}"
      data-next-state="${escapeHtml(next || "")}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function inlineMsgHtml(kind, text) {
  if (kind !== "error" || !text) return "";
  return `<div class="inline-msg inline-msg--error">${escapeHtml(text)}</div>`;
}

function cerradasFooterHtml(total) {
  const expanded = !!isExpandedByState["Cerradas"];
  const hasMoreThanCollapsed = total > COLLAPSED_VISIBLE_CERRADAS;

  const maxTotal = Math.min(total, MAX_VISIBLE_CERRADAS);
  const hiddenCount = Math.max(0, maxTotal - COLLAPSED_VISIBLE_CERRADAS);

  const toggleBtn = hasMoreThanCollapsed
    ? `
      <button class="section-more-btn" type="button" data-state="Cerradas">
        ${expanded ? "Ver menos" : `Ver ${hiddenCount} más`}
      </button>
    `
    : "";

  const historyBtn = `
    <a class="section-history-btn" href="${escapeHtml(HISTORY_URL)}">
      Ver historial
    </a>
  `;

  return `
    <div class="state-footer state-footer--dual">
      ${toggleBtn}
      ${historyBtn}
    </div>
  `;
}

function actionIdHtml(id, state) {
  const s = String(state || "").trim();

  if (s === "Cerradas") {
    return `
      <a class="action-id action-id-link"
         href="${escapeHtml(HISTORY_URL)}?q=${encodeURIComponent(String(id || ""))}">
        ${escapeHtml(id)}
      </a>
    `;
  }

  // Si tienes modal: lo abrimos, si no, igual lo dejamos como botón (no rompe)
  return `
    <button class="action-id action-id-link js-open-job"
      type="button"
      data-action-id="${escapeHtml(id)}"
      style="background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left;">
      ${escapeHtml(id)}
    </button>
  `;
}

function groupByState(actions) {
  const buckets = Object.fromEntries(FLOW_STATES.map((s) => [s, []]));

  for (const a of actions || []) {
    const st = String(a?.state || "").trim();
    const key = FLOW_STATES.includes(st) ? st : "Nuevas";
    buckets[key].push(a);
  }

  for (const k of FLOW_STATES) buckets[k] = sortNewestFirst(buckets[k]);
  return buckets;
}

// Flota: cómo “armamos” la tarjeta con los campos existentes en el API summary:
// category, urgency, description, location, customer_name, created_at
function cardTitle(a) {
  return a?.category || "Sin categoría";
}

function cardSubline(a) {
  const name = a?.customer_name ? String(a.customer_name).trim() : "";
  const loc = a?.location ? String(a.location).trim() : "";
  if (name && loc) return `${name} · ${loc}`;
  return name || loc || "";
}

function sectionHtml(stateName, actions, inlineMsgById) {
  const total = actions.length;
  const title = STATE_LABEL[stateName] || stateName;

  // ✅ IMPORTANTE: siempre renderizamos el estado aunque esté vacío
  if (total === 0) {
    return `
      <section class="state-section state-empty-section" data-state="${escapeHtml(stateName)}">
        <div class="state-header">
          <div class="state-title">${escapeHtml(title)} (0)</div>
        </div>
        <div class="state-cards">
          <div class="empty-box">No hay tickets en este estado.</div>
        </div>
        <div class="state-divider"></div>
      </section>
    `;
  }

  const visible = Math.max(1, visibleByState[stateName] || DEFAULT_VISIBLE_PER_STATE);
  const shown = actions.slice(0, visible);

  const cards = shown
    .map((a) => {
      const id = a.action_id || "—";
      const state = a.state || "—";
      const urgency = a.urgency || "—";
      const title = cardTitle(a);
      const desc = a.description || "";
      const sub = cardSubline(a);
      const created = a.created_at ? new Date(a.created_at).toLocaleString() : "";

      const msg = inlineMsgById[id];

      return `
        <article class="action-card" data-id="${escapeHtml(id)}">
          <div class="action-card__top">
            ${actionIdHtml(id, state)}
            <div class="badges">
              ${stateBadge(state)}
              ${urgencyBadge(urgency)}
            </div>
          </div>

          <h3 class="action-title">${escapeHtml(title)}</h3>

          ${sub ? `<div class="hint" style="margin-top:6px;">${escapeHtml(sub)}</div>` : ""}
          ${desc ? `<p class="action-desc">${escapeHtml(desc)}</p>` : ""}

          <div class="hint" style="margin-top:8px;">${escapeHtml(created)}</div>

          <div class="action-card__bottom">
            ${inlineMsgHtml(msg?.kind, msg?.text)}
            <div class="action-actions">
              ${actionButtonHtml(id, state)}
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  let footer = "";

  if (stateName === "Cerradas") {
    footer = cerradasFooterHtml(total);
  } else {
    const remaining = Math.max(0, total - shown.length);
    if (remaining > 0) {
      footer = `
        <div class="state-footer">
          <button class="section-more-btn" type="button" data-state="${escapeHtml(stateName)}">
            Ver ${remaining} más
          </button>
        </div>
      `;
    }
  }

  return `
    <section class="state-section" data-state="${escapeHtml(stateName)}">
      <div class="state-header">
        <div class="state-title">${escapeHtml(title)} (${total})</div>
      </div>

      <div class="state-cards">
        ${cards}
      </div>

      ${footer}
      <div class="state-divider"></div>
    </section>
  `;
}

function getContainer() {
  // Tus templates han usado distintos ids; soportamos ambos.
  return (
    document.getElementById("actionsList") ||
    document.getElementById("canvas-root") ||
    document.getElementById("canvasRoot") ||
    null
  );
}

function ensureBaseMarkup(container) {
  // Si el HTML no trae el contenedor específico, inyectamos uno mínimo.
  if (!container) return null;

  // Si ya tiene toolbar/board dentro, no tocamos.
  // Si es canvas-root, usamos el mismo contenedor como “actionsList”.
  if (container.id !== "actionsList") {
    // Creamos un wrapper interno para no romper estilos existentes.
    if (!document.getElementById("actionsList")) {
      const wrap = document.createElement("div");
      wrap.id = "actionsList";
      container.innerHTML = "";
      container.appendChild(wrap);
      return wrap;
    }
  }

  return document.getElementById("actionsList") || container;
}

function render(actions, inlineMsgById = {}, infoLine = "") {
  const container0 = getContainer();
  const el = ensureBaseMarkup(container0);
  if (!el) return;

  if (!actions || actions.length === 0) {
    el.innerHTML = `
      ${toolbarHtml("Actualizar", false, infoLine)}
      <div class="empty-state">
        Aún no hay tickets.
        <div class="empty-hint">Crea uno desde el formulario y regresa aquí.</div>
      </div>
    `;
    document.getElementById("refreshBtn")?.addEventListener("click", () =>
      loadActions({ preserveUI: true })
    );
    attachHandlers();
    return;
  }

  const buckets = groupByState(actions);

  // ✅ Renderiza SIEMPRE TODOS los estados, de arriba hacia abajo (mobile-first)
  const sections = FLOW_STATES.map((st) => sectionHtml(st, buckets[st], inlineMsgById)).join("");

  el.innerHTML = `
    ${toolbarHtml("Actualizar", false, infoLine)}
    <div class="board">
      ${sections}
    </div>
  `;

  document.getElementById("refreshBtn")?.addEventListener("click", () =>
    loadActions({ preserveUI: true })
  );

  attachHandlers();
}

/* =========================
   Events
========================= */
let handlersAttached = false;

function attachHandlers() {
  if (handlersAttached) return;
  handlersAttached = true;

  const container0 = getContainer();
  const container = ensureBaseMarkup(container0);
  if (!container) return;

  container.addEventListener("click", async (e) => {
    const moreBtn = e.target?.closest?.(".section-more-btn");
    if (moreBtn) {
      const st = moreBtn.getAttribute("data-state");
      if (st && FLOW_STATES.includes(st)) {
        if (st === "Cerradas") {
          const expanded = !!isExpandedByState[st];
          isExpandedByState[st] = !expanded;
          visibleByState[st] = !expanded ? MAX_VISIBLE_CERRADAS : COLLAPSED_VISIBLE_CERRADAS;
          await loadActions({ preserveUI: true });
          return;
        }

        visibleByState[st] =
          (visibleByState[st] || DEFAULT_VISIBLE_PER_STATE) + DEFAULT_VISIBLE_PER_STATE;
        await loadActions({ preserveUI: true });
      }
      return;
    }

    const btn = e.target?.closest?.(".action-next-btn");
    if (!btn || btn.disabled) return;

    const actionId = btn.getAttribute("data-action-id");
    const nextState = btn.getAttribute("data-next-state");
    const currentState = btn.getAttribute("data-current-state");

    if (!actionId || !nextState) return;

    if (needsConfirm(currentState, nextState)) {
      const ok = await openConfirmModal();
      if (!ok) return;
    }

    btn.disabled = true;
    const prevText = btn.textContent;
    btn.textContent = "Actualizando…";

    const result = await updateState(actionId, currentState, nextState);

    btn.textContent = prevText;

    if (result.ok) {
      await loadActions({ preserveUI: true });
    } else {
      await loadActions({
        preserveUI: true,
        toast: { id: actionId, kind: "error", text: result.error || "No se pudo actualizar" },
      });
    }
  });
}

/* =========================
   API calls
========================= */
async function updateState(actionId, currentState, nextState) {
  try {
    const url = `${API_BASE}/api/demos/${DEMO_SLUG}/actions/${encodeURIComponent(actionId)}/state`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: nextState,
        note: `UI advance from ${currentState} → ${nextState}`,
        by: "canvas",
      }),
    });

    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      const msg =
        data?.error || (res.status === 409 ? "Transición no permitida" : `HTTP ${res.status}`);
      return { ok: false, error: msg };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ? String(err.message) : "Error de red" };
  }
}

async function loadActions(opts = {}) {
  const { preserveUI = false, toast = null } = opts;

  const container0 = getContainer();
  const el = ensureBaseMarkup(container0);
  if (!el) return;

  const btn = document.getElementById("refreshBtn");
  const prevBtnText = btn ? btn.textContent : "";

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Cargando…";
  } else if (!preserveUI) {
    el.innerHTML = `
      ${toolbarHtml("Cargando…", true)}
      <div class="empty-state">Cargando…</div>
    `;
  }

  try {
    const resMain = await fetch(ENDPOINT_ACTIONS, { method: "GET" });
    const dataMain = await resMain.json().catch(() => null);
    if (!dataMain?.success) throw new Error(dataMain?.error || "No success (main)");

    const mainActions = Array.isArray(dataMain.actions) ? dataMain.actions : [];

    let closedActions = [];
    try {
      const resClosed = await fetch(ENDPOINT_CLOSED, { method: "GET" });
      const dataClosed = await resClosed.json().catch(() => null);
      if (dataClosed?.success && Array.isArray(dataClosed.actions)) closedActions = dataClosed.actions;
    } catch {}

    // fallback: si el endpoint closed no devuelve, sacamos cerradas del main
    if (!closedActions.length) {
      closedActions = mainActions
        .filter((a) => String(a?.state || "").trim() === "Cerradas")
        .slice(0, MAX_VISIBLE_CERRADAS);
    }

    closedActions = sortNewestFirst(closedActions).slice(0, MAX_VISIBLE_CERRADAS);
    closedCache = closedActions;

    visibleByState["Cerradas"] = isExpandedByState["Cerradas"]
      ? MAX_VISIBLE_CERRADAS
      : COLLAPSED_VISIBLE_CERRADAS;

    // merge: main sin cerradas + cerradas (para asegurar “memoria operativa”)
    const mainWithoutClosed = mainActions.filter((a) => String(a?.state || "").trim() !== "Cerradas");
    const merged = [...mainWithoutClosed, ...closedActions];

    const inline = {};
    if (toast?.id && toast?.text) inline[toast.id] = { kind: toast.kind || "error", text: toast.text };

    const infoLine = `${merged.length} tickets cargados.`;
    render(merged, inline, infoLine);
  } catch (err) {
    const msg = err?.message ? String(err.message) : "Error desconocido";

    el.innerHTML = `
      ${toolbarHtml("Reintentar")}
      <div class="empty-state">
        No se pudo cargar Canvas.
        <div class="empty-hint">${escapeHtml(msg)}</div>
      </div>
    `;

    document.getElementById("refreshBtn")?.addEventListener("click", () =>
      loadActions({ preserveUI: false })
    );
  } finally {
    const btn2 = document.getElementById("refreshBtn");
    if (btn2) {
      btn2.disabled = false;
      btn2.textContent = prevBtnText && prevBtnText !== "Cargando…" ? prevBtnText : "Actualizar";
    }
  }
}

/* =========================
   Init
========================= */
document.addEventListener("DOMContentLoaded", () => {
  ensureConfirmModal();
  loadActions({ preserveUI: false });
});
