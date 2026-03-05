// flota/canvas.js — basado en implementations/canvas.js (referencia)
// ✅ Mobile-first (selector por estado)
// ✅ Desktop Trello-like (columnas)
// ✅ Estados backend en Español (mismos del core)
// ✅ Endpoints: https://api.fbos.org/api/demos/flota/*
// ✅ Avanzar estado (PATCH /state) + confirm modal en transiciones críticas
// ✅ (Opcional) Job modal + comments si existen en el HTML

const API_BASE = "https://api.fbos.org";
const DEMO_SLUG = "flota";

// Endpoints (core-engine style)
const ENDPOINT_ACTIONS = `${API_BASE}/api/demos/${DEMO_SLUG}/actions?limit=50`;
const ENDPOINT_CLOSED = `${API_BASE}/api/demos/${DEMO_SLUG}/actions/closed?limit=6`;

// Rutas UI
const FORM_URL = "/flota/";
const CANVAS_URL = "/flota/canvas/";
const HISTORY_URL = "/flota/history/";

// Estados backend (deben coincidir con el Worker)
const FLOW_STATES = ["Nuevas", "Validadas", "Asignadas", "En ejecución", "En revisión", "Cerradas"];

// Transiciones backend (MVP: solo “next state”)
const NEXT_STATE = {
  Nuevas: "Validadas",
  Validadas: "Asignadas",
  Asignadas: "En ejecución",
  "En ejecución": "En revisión",
  "En revisión": "Cerradas",
  Cerradas: null,
};

// Etiquetas UI
const STATE_LABEL = {
  Nuevas: "Nuevas",
  Validadas: "Validadas",
  Asignadas: "Asignadas",
  "En ejecución": "En ejecución",
  "En revisión": "En revisión",
  Cerradas: "Cerradas",
};

// Botones UI
const ACTION_LABEL = {
  Nuevas: "Validar",
  Validadas: "Asignar",
  Asignadas: "Iniciar",
  "En ejecución": "Revisión",
  "En revisión": "Cerrar",
  Cerradas: "Cerrada",
};

const DEFAULT_VISIBLE_PER_STATE = 6;

// Cerradas: memoria operativa
const COLLAPSED_VISIBLE_CERRADAS = 3;
const MAX_VISIBLE_CERRADAS = 6;

// Cantidad visible por columna/estado
const visibleByState = Object.fromEntries(FLOW_STATES.map((s) => [s, DEFAULT_VISIBLE_PER_STATE]));
const isExpandedByState = Object.fromEntries(FLOW_STATES.map((s) => [s, false]));
let closedCache = [];

// Mobile state selector
let activeStateMobile = "Nuevas";

/* =========================
   Inject minimal CSS (safe)
========================= */
function ensureCanvasCss() {
  if (document.getElementById("fbosCanvasCss")) return;

  const style = document.createElement("style");
  style.id = "fbosCanvasCss";
  style.textContent = `
    /* Layout helpers (no pisa tu styles.css, solo complementa) */
    .fbos-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}
    .fbos-topbar .tabs{display:flex;gap:8px;flex-wrap:wrap}
    .fbos-tab{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(0,0,0,.12);padding:8px 12px;border-radius:12px;text-decoration:none;color:inherit;background:#fff}
    .fbos-tab--active{background:rgba(0,0,0,.06)}
    .fbos-btn{border:0;border-radius:12px;padding:10px 14px;font-weight:700;cursor:pointer;background:rgba(0,0,0,.90);color:#fff}
    .fbos-btn:disabled{opacity:.6;cursor:not-allowed}
    .fbos-hint{font-size:12px;opacity:.7}
    .fbos-pillbar{display:flex;gap:8px;overflow:auto;padding-bottom:6px;margin:10px 0}
    .fbos-pill{white-space:nowrap;border:1px solid rgba(0,0,0,.12);border-radius:999px;padding:8px 12px;background:#fff;cursor:pointer;font-weight:600}
    .fbos-pill--active{background:rgba(0,0,0,.06)}
    .fbos-board{display:grid;gap:12px}
    .fbos-col{background:rgba(0,0,0,.03);border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:10px}
    .fbos-col__head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
    .fbos-col__title{font-weight:800}
    .fbos-cards{display:flex;flex-direction:column;gap:10px}
    .fbos-card{background:#fff;border:1px solid rgba(0,0,0,.10);border-radius:16px;padding:12px}
    .fbos-card__top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
    .fbos-card__id{font-weight:900}
    .fbos-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
    .fbos-badge{font-size:11px;padding:6px 8px;border-radius:999px;background:rgba(0,0,0,.06);border:1px solid rgba(0,0,0,.10)}
    .fbos-badge--state{background:rgba(17, 122, 169, .10);border-color:rgba(17, 122, 169, .20)}
    .fbos-badge--urg-low{background:rgba(0,0,0,.05)}
    .fbos-badge--urg-mid{background:rgba(250, 173, 20, .12);border-color:rgba(250, 173, 20, .20)}
    .fbos-badge--urg-high{background:rgba(244, 67, 54, .12);border-color:rgba(244, 67, 54, .20)}
    .fbos-card__title{margin:10px 0 6px;font-weight:800}
    .fbos-card__desc{margin:0 0 10px;opacity:.85}
    .fbos-card__meta{display:flex;flex-wrap:wrap;gap:10px;font-size:12px;opacity:.8}
    .fbos-card__actions{margin-top:10px}
    .fbos-card__actions .fbos-btn{width:100%}
    .fbos-inline-error{margin-top:10px;font-size:12px;color:#b00020}
    .fbos-empty{padding:18px;border:1px dashed rgba(0,0,0,.25);border-radius:16px;background:rgba(255,255,255,.6)}
    .fbos-divider{height:1px;background:rgba(0,0,0,.10);margin:12px 0}
    .fbos-more{width:100%;border:1px solid rgba(0,0,0,.12);border-radius:12px;background:#fff;padding:10px 12px;font-weight:700;cursor:pointer}
    .fbos-more:disabled{opacity:.6;cursor:not-allowed}
    .fbos-kpis{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
    .fbos-kpi{font-size:12px;opacity:.8}
    .fbos-kpi strong{opacity:1}

    /* Responsive behavior:
       - Mobile: show single column (active state)
       - Desktop: show Trello-like columns */
    @media (min-width: 920px){
      .fbos-pillbar{display:none}
      .fbos-board{grid-template-columns:repeat(6, minmax(220px, 1fr))}
      .fbos-col{min-height:240px}
      .fbos-card__actions .fbos-btn{width:auto}
      .fbos-card__actions{display:flex;justify-content:flex-end}
    }
    @media (max-width: 919px){
      .fbos-board{grid-template-columns:1fr}
      .fbos-col[data-state]:not([data-active="true"]){display:none}
    }
  `;
  document.head.appendChild(style);
}

/* =========================
   Confirm modal
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
      const nb = parseActionNumber(b?.action_id);
      return nb - na;
    });
}

function nextStateFor(current) {
  const s = String(current || "").trim();
  return NEXT_STATE[s] || null;
}

function urgencyClass(urgency) {
  const u = String(urgency || "").toLowerCase();
  if (u.includes("crít") || u.includes("critic") || u.includes("emerg")) return "fbos-badge--urg-high";
  if (u.includes("alta") || u.includes("urgent")) return "fbos-badge--urg-mid";
  return "fbos-badge--urg-low";
}

function badgeState(state) {
  return `<span class="fbos-badge fbos-badge--state">${escapeHtml(STATE_LABEL[state] || state || "—")}</span>`;
}

function badgeUrgency(urgency) {
  const cls = urgencyClass(urgency);
  return `<span class="fbos-badge ${cls}">${escapeHtml(urgency || "—")}</span>`;
}

function actionButtonHtml(actionId, currentState) {
  const s = String(currentState || "").trim();
  const next = nextStateFor(s);
  const label = ACTION_LABEL[s] || "Avanzar";

  return `
    <button
      class="fbos-btn action-next-btn"
      type="button"
      ${next ? "" : "disabled"}
      data-action-id="${escapeHtml(actionId)}"
      data-current-state="${escapeHtml(s)}"
      data-next-state="${escapeHtml(next || "")}"
    >
      ${escapeHtml(next ? `Avanzar → ${next}` : label)}
    </button>
  `;
}

function inlineErrorHtml(text) {
  if (!text) return "";
  return `<div class="fbos-inline-error">${escapeHtml(text)}</div>`;
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

/* =========================
   UI render
========================= */
function rootTemplate() {
  const root = document.getElementById("canvas-root");
  if (!root) return;

  root.innerHTML = `
    <div class="card">
      <div class="header">
        <div class="brand">
          <div class="mark"></div>
          <div>
            <h1>FBOS Flota</h1>
            <p>Canvas — Tablero operativo</p>
            <div class="fbos-kpis" id="kpis"></div>
          </div>
        </div>
      </div>

      <div class="fbos-topbar">
        <div class="tabs">
          <a class="fbos-tab" href="${escapeHtml(FORM_URL)}">Formulario</a>
          <a class="fbos-tab fbos-tab--active" href="${escapeHtml(CANVAS_URL)}">Canvas</a>
          <a class="fbos-tab" href="${escapeHtml(HISTORY_URL)}">Historial</a>
        </div>

        <button class="fbos-btn" id="refreshBtn" type="button">Actualizar</button>
      </div>

      <!-- Mobile pills -->
      <div class="fbos-pillbar" id="pillbar"></div>

      <div id="statusLine" class="fbos-hint"></div>
      <div class="fbos-divider"></div>

      <div id="board" class="fbos-board"></div>
    </div>
  `;
}

function renderPills(countsByState) {
  const bar = document.getElementById("pillbar");
  if (!bar) return;

  bar.innerHTML = FLOW_STATES.map((st) => {
    const active = st === activeStateMobile;
    const n = countsByState?.[st] ?? 0;
    return `
      <button class="fbos-pill ${active ? "fbos-pill--active" : ""}"
        type="button"
        data-state="${escapeHtml(st)}">
        ${escapeHtml(STATE_LABEL[st] || st)} (${n})
      </button>
    `;
  }).join("");
}

function renderKPIs(countsByState) {
  const k = document.getElementById("kpis");
  if (!k) return;

  const total = FLOW_STATES.reduce((acc, s) => acc + (countsByState[s] || 0), 0);
  k.innerHTML = `
    <div class="fbos-kpi"><strong>${total}</strong> total</div>
    <div class="fbos-kpi"><strong>${countsByState["Nuevas"] || 0}</strong> nuevas</div>
    <div class="fbos-kpi"><strong>${countsByState["En revisión"] || 0}</strong> en revisión</div>
    <div class="fbos-kpi"><strong>${countsByState["Cerradas"] || 0}</strong> cerradas</div>
  `;
}

function sectionColumnHtml(stateName, actions, inlineMsgById) {
  const title = STATE_LABEL[stateName] || stateName;
  const total = actions.length;

  const isActive = stateName === activeStateMobile;
  const visible = Math.max(1, visibleByState[stateName] || DEFAULT_VISIBLE_PER_STATE);
  const shown = actions.slice(0, visible);
  const remaining = Math.max(0, total - shown.length);

  const cardsHtml = shown
    .map((a) => {
      const id = a.action_id || "—";
      const st = a.state || "—";
      const urgency = a.urgency || "—";
      const category = a.category || "Sin categoría";
      const desc = a.description || "";

      // Flota-specific helpful context (si viene en payload)
      const name = a.customer_name || "";
      const placa = a.placa || a.vehicle_plate || "";
      const location = a.location || "";
      const created = a.created_at ? new Date(a.created_at).toLocaleString() : "";

      const inline = inlineMsgById?.[id]?.text || "";

      return `
        <article class="fbos-card" data-id="${escapeHtml(id)}">
          <div class="fbos-card__top">
            <button class="fbos-card__id js-open-job"
              type="button"
              data-action-id="${escapeHtml(id)}"
              style="background:none;border:0;padding:0;font:inherit;cursor:pointer;text-align:left;">
              ${escapeHtml(id)}
            </button>
            <div class="fbos-badges">
              ${badgeState(st)}
              ${badgeUrgency(urgency)}
            </div>
          </div>

          <div class="fbos-card__title">${escapeHtml(category)}</div>
          ${desc ? `<p class="fbos-card__desc">${escapeHtml(desc)}</p>` : ""}

          <div class="fbos-card__meta">
            ${name ? `<span>👤 ${escapeHtml(name)}</span>` : ""}
            ${placa ? `<span>🚚 ${escapeHtml(placa)}</span>` : ""}
            ${location ? `<span>📍 ${escapeHtml(location)}</span>` : ""}
            ${created ? `<span>🕒 ${escapeHtml(created)}</span>` : ""}
          </div>

          ${inlineErrorHtml(inline)}

          <div class="fbos-card__actions">
            ${actionButtonHtml(id, st)}
          </div>
        </article>
      `;
    })
    .join("");

  // Footer “ver más”
  let footerHtml = "";
  if (stateName === "Cerradas") {
    const expanded = !!isExpandedByState["Cerradas"];
    const hasMoreThanCollapsed = total > COLLAPSED_VISIBLE_CERRADAS;

    const maxTotal = Math.min(total, MAX_VISIBLE_CERRADAS);
    const hiddenCount = Math.max(0, maxTotal - COLLAPSED_VISIBLE_CERRADAS);

    const toggleBtn = hasMoreThanCollapsed
      ? `
        <button class="fbos-more section-more-btn" type="button" data-state="Cerradas">
          ${expanded ? "Ver menos" : `Ver ${hiddenCount} más`}
        </button>
      `
      : "";

    footerHtml = `
      <div style="display:flex; gap:10px; align-items:center; justify-content:space-between; margin-top:10px;">
        <div style="flex:1;">${toggleBtn}</div>
        <a class="fbos-tab" style="width:auto" href="${escapeHtml(HISTORY_URL)}">Ver historial</a>
      </div>
    `;
  } else if (remaining > 0) {
    footerHtml = `
      <button class="fbos-more section-more-btn" type="button" data-state="${escapeHtml(stateName)}">
        Ver ${remaining} más
      </button>
    `;
  }

  return `
    <section class="fbos-col" data-state="${escapeHtml(stateName)}" data-active="${isActive ? "true" : "false"}">
      <div class="fbos-col__head">
        <div class="fbos-col__title">${escapeHtml(title)} (${total})</div>
        <div class="fbos-hint">${total ? " " : " "}</div>
      </div>

      <div class="fbos-cards">
        ${total ? cardsHtml : `<div class="fbos-empty">No hay tickets en este estado.</div>`}
      </div>

      ${footerHtml ? `<div style="margin-top:10px;">${footerHtml}</div>` : ""}
    </section>
  `;
}

function renderBoard(actions, inlineMsgById = {}) {
  const board = document.getElementById("board");
  const status = document.getElementById("statusLine");
  if (!board) return;

  if (!actions || actions.length === 0) {
    board.innerHTML = `<div class="fbos-empty">Aún no hay tickets. Crea uno desde el formulario y vuelve.</div>`;
    if (status) status.textContent = "";
    return;
  }

  const buckets = groupByState(actions);
  const counts = Object.fromEntries(FLOW_STATES.map((s) => [s, buckets[s].length]));

  renderPills(counts);
  renderKPIs(counts);

  board.innerHTML = FLOW_STATES.map((st) => sectionColumnHtml(st, buckets[st], inlineMsgById)).join("");

  // Status line
  const total = FLOW_STATES.reduce((acc, s) => acc + (counts[s] || 0), 0);
  if (status) status.textContent = `✅ ${total} tickets cargados.`;
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
  const { preserveUI = true, toast = null } = opts;

  const btn = document.getElementById("refreshBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Cargando…";
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

    if (!closedActions.length) {
      closedActions = mainActions
        .filter((a) => String(a?.state || "").trim() === "Cerradas")
        .slice(0, MAX_VISIBLE_CERRADAS);
    }

    closedActions = sortNewestFirst(closedActions).slice(0, MAX_VISIBLE_CERRADAS);
    closedCache = closedActions;

    // Cerradas visible count
    visibleByState["Cerradas"] = isExpandedByState["Cerradas"]
      ? MAX_VISIBLE_CERRADAS
      : COLLAPSED_VISIBLE_CERRADAS;

    const mainWithoutClosed = mainActions.filter((a) => String(a?.state || "").trim() !== "Cerradas");
    const merged = [...mainWithoutClosed, ...closedActions];

    // Inline toast by action id (show below cards)
    const inline = {};
    if (toast?.id && toast?.text) inline[toast.id] = { kind: toast.kind || "error", text: toast.text };

    renderBoard(merged, inline);
  } catch (err) {
    const board = document.getElementById("board");
    const status = document.getElementById("statusLine");
    if (status) status.textContent = `❌ ${String(err?.message || err)}`;
    if (board) {
      board.innerHTML = `
        <div class="fbos-empty">
          No se pudo cargar Canvas.<br/>
          <span class="fbos-hint">${escapeHtml(String(err?.message || err))}</span>
        </div>
      `;
    }
  } finally {
    const btn2 = document.getElementById("refreshBtn");
    if (btn2) {
      btn2.disabled = false;
      btn2.textContent = "Actualizar";
    }
  }
}

/* =========================
   Events
========================= */
let handlersAttached = false;

function attachHandlers() {
  if (handlersAttached) return;
  handlersAttached = true;

  document.addEventListener("click", async (e) => {
    // Refresh
    const refresh = e.target?.closest?.("#refreshBtn");
    if (refresh) {
      await loadActions({ preserveUI: true });
      return;
    }

    // Mobile pill (switch state)
    const pill = e.target?.closest?.(".fbos-pill");
    if (pill) {
      const st = pill.getAttribute("data-state");
      if (st && FLOW_STATES.includes(st)) {
        activeStateMobile = st;
        await loadActions({ preserveUI: true });
      }
      return;
    }

    // More per section
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

        visibleByState[st] = (visibleByState[st] || DEFAULT_VISIBLE_PER_STATE) + DEFAULT_VISIBLE_PER_STATE;
        await loadActions({ preserveUI: true });
      }
      return;
    }

    // Advance state
    const btn = e.target?.closest?.(".action-next-btn");
    if (btn) {
      if (btn.disabled) return;

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
      return;
    }

    // Open job details (if modal exists)
    const openJob = e.target?.closest?.(".js-open-job");
    if (openJob) {
      const id = openJob.getAttribute("data-action-id");
      if (id) showJobDetails(id);
      return;
    }
  });
}

/* =========================================================
   (Opcional) Job Modal + Comments
   - Solo funciona si tu HTML tiene estos IDs:
     jobModal, jobCloseBtn, jobModalId, jobModalState, jobModalCategory, jobModalUrgency,
     jobModalDesc, jobModalCreated, jobModalUpdated, jobCommentsList, jobCommentText,
     jobCommentBy, jobCommentSendBtn, jobCommentStatus, jobOpenApiBtn
========================================================= */
function $(id) {
  return document.getElementById(id);
}

function modalExists() {
  return !!$("jobModal");
}

function openJobModal() {
  if (!modalExists()) return;
  const modal = $("jobModal");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeJobModal() {
  if (!modalExists()) return;
  const modal = $("jobModal");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function extractCommentsFromHistory(action) {
  const hist = Array.isArray(action?.history) ? action.history : [];
  return hist
    .filter((h) => h && h.type === "comment" && (h.text || h.note))
    .map((h) => ({
      ts: h.ts || h.created_at || h.at || "",
      by: h.by || "system",
      text: h.text || h.note || "",
    }));
}

function renderComments(comments) {
  const list = $("jobCommentsList");
  if (!list) return;

  const arr = Array.isArray(comments) ? comments : [];
  if (!arr.length) {
    list.innerHTML = `<div class="fbos-empty">Aún no hay comentarios.</div>`;
    return;
  }

  list.innerHTML = arr
    .map((c) => {
      const by = c?.by || "—";
      const at = c?.ts || "";
      const text = c?.text || "";
      return `
        <div class="fbos-card" style="border-radius:12px;">
          <div class="fbos-hint">${escapeHtml(by)}${at ? ` · ${escapeHtml(at)}` : ""}</div>
          <div>${escapeHtml(text)}</div>
        </div>
      `;
    })
    .join("");
}

async function fetchComments(actionId) {
  try {
    const url = `${API_BASE}/api/demos/${DEMO_SLUG}/actions/${encodeURIComponent(actionId)}/comments`;
    const res = await fetch(url, { method: "GET" });
    const out = await res.json().catch(() => null);
    if (res.ok && out?.success && Array.isArray(out.comments)) return out.comments;
  } catch {}

  try {
    const res = await fetch(`${API_BASE}/api/demos/${DEMO_SLUG}/actions/${encodeURIComponent(actionId)}`);
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out?.success || !out?.action) return [];
    return extractCommentsFromHistory(out.action);
  } catch {
    return [];
  }
}

async function postComment(actionId, text, by) {
  const tryUrls = [
    `${API_BASE}/api/demos/${DEMO_SLUG}/actions/${encodeURIComponent(actionId)}/comment`,
    `${API_BASE}/api/demos/${DEMO_SLUG}/actions/${encodeURIComponent(actionId)}/comments`,
  ];

  let lastErr = null;

  for (const url of tryUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, by: by || "anonymous" }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      return data;
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("No se pudo guardar el comentario.");
}

let currentJobIdForComments = null;

function setCommentStatus(kind, msg) {
  const el = $("jobCommentStatus");
  if (!el) return;

  if (!msg) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }

  el.style.display = "block";
  el.textContent = msg;
  el.style.color = kind === "error" ? "#b00020" : "inherit";
}

function initCommentComposer() {
  const sendBtn = $("jobCommentSendBtn");
  if (!sendBtn || sendBtn.dataset.wired === "1") return;
  sendBtn.dataset.wired = "1";

  sendBtn.addEventListener("click", async () => {
    const textEl = $("jobCommentText");
    const byEl = $("jobCommentBy");

    const text = String(textEl?.value || "").trim();
    const by = String(byEl?.value || "").trim() || "anonymous";

    if (!currentJobIdForComments) {
      setCommentStatus("error", "No hay ticket seleccionado.");
      return;
    }

    if (!text) {
      setCommentStatus("error", "Escribe un comentario primero.");
      return;
    }

    sendBtn.disabled = true;
    const prev = sendBtn.textContent;
    sendBtn.textContent = "Guardando…";
    setCommentStatus("", "");

    try {
      await postComment(currentJobIdForComments, text, by);

      if (textEl) textEl.value = "";

      const comments = await fetchComments(currentJobIdForComments);
      renderComments(comments);
      setCommentStatus("", "");
    } catch (e) {
      setCommentStatus("error", e?.message ? String(e.message) : "No se pudo guardar el comentario.");
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = prev || "Comentar";
    }
  });
}

async function showJobDetails(actionId) {
  if (!modalExists()) return;

  const id = String(actionId || "").trim();
  if (!id) return;

  currentJobIdForComments = id;
  initCommentComposer();
  setCommentStatus("", "");
  renderComments([]);

  const elId = $("jobModalId");
  const elState = $("jobModalState");
  const elCategory = $("jobModalCategory");
  const elUrgency = $("jobModalUrgency");
  const elDesc = $("jobModalDesc");
  const elCreated = $("jobModalCreated");
  const elUpdated = $("jobModalUpdated");

  if (elId) elId.textContent = id;
  if (elState) elState.textContent = "Cargando…";

  const apiBtn = $("jobOpenApiBtn");
  if (apiBtn) apiBtn.onclick = () =>
    window.open(`${API_BASE}/api/demos/${DEMO_SLUG}/actions/${encodeURIComponent(id)}`, "_blank");

  openJobModal();

  try {
    const res = await fetch(`${API_BASE}/api/demos/${DEMO_SLUG}/actions/${encodeURIComponent(id)}`);
    const out = await res.json().catch(() => ({}));
    const a = out?.action;

    if (!res.ok || !out?.success || !a) throw new Error(out?.error || "Failed");

    const payload = a.payload || {};
    if (elState) elState.textContent = `Estado: ${a.state || "—"}`;
    if (elCategory) elCategory.textContent = payload.category || "—";
    if (elUrgency) elUrgency.textContent = payload.urgency || "—";
    if (elDesc) elDesc.textContent = payload.description || "—";
    if (elCreated) elCreated.textContent = a.created_at || "—";
    if (elUpdated) elUpdated.textContent = a.updated_at || "—";

    const comments = extractCommentsFromHistory(a);
    renderComments(comments);
    fetchComments(id).then(renderComments).catch(() => {});
  } catch {
    if (elState) elState.textContent = "Error cargando ticket";
    renderComments([]);
  }
}

(function initJobModal() {
  if (!modalExists()) return;

  const modal = $("jobModal");
  const closeBtn = $("jobCloseBtn");

  if (closeBtn) closeBtn.addEventListener("click", closeJobModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeJobModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.getAttribute("aria-hidden") === "false") closeJobModal();
  });

  initCommentComposer();
})();

/* =========================
   Boot
========================= */
document.addEventListener("DOMContentLoaded", () => {
  ensureCanvasCss();
  ensureConfirmModal();
  rootTemplate();
  attachHandlers();
  loadActions({ preserveUI: false });
});
