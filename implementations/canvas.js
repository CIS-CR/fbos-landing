// implementations/canvas.js — basado en service-desk/canvas.js
// - Mantiene estados backend en Español
// - UI en Español (Implementations / Leads)
// - Usa endpoints /api/demos/implementations/*
// - Soporta confirm modal (Nuevas->Validadas y En revisión->Cerradas)
// - Soporta comments (POST /comment + fallback history)

const API_BASE = "https://api.fbos.org";
const DEMO_SLUG = "implementations";

const ENDPOINT_ACTIONS = `${API_BASE}/api/demos/${DEMO_SLUG}/actions?limit=50`;
const ENDPOINT_CLOSED = `${API_BASE}/api/demos/${DEMO_SLUG}/actions/closed?limit=6`;

// Estados backend (deben coincidir con API)
const FLOW_STATES = ["Nuevas", "Validadas", "Asignadas", "En ejecución", "En revisión", "Cerradas"];

// Transiciones backend
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

const DEFAULT_VISIBLE_PER_STATE = 3;

// Cerradas: memoria operativa
const COLLAPSED_VISIBLE_CERRADAS = 3;
const MAX_VISIBLE_CERRADAS = 6;

// 🔁 OJO: ruta de history para implementations
const HISTORY_URL = "/implementations/history/";

// Cantidad visible por columna
const visibleByState = Object.fromEntries(FLOW_STATES.map((s) => [s, DEFAULT_VISIBLE_PER_STATE]));
const isExpandedByState = Object.fromEntries(FLOW_STATES.map((s) => [s, false]));
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
  if (u.includes("emerg")) cls += " badge-urgency-high";
  else if (u.includes("urgent")) cls += " badge-urgency-mid";
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
      const nb = parseActionNumber(b?.action_id);
      return nb - na;
    });
}

function toolbarHtml(btnLabel = "Actualizar", btnDisabled = false) {
  return `
    <div class="canvas-toolbar">
      <div class="canvas-title"></div>
      <button class="btn btn-small" id="refreshBtn" type="button" ${btnDisabled ? "disabled" : ""}>
        ${escapeHtml(btnLabel)}
      </button>
    </div>
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

function sectionHtml(stateName, actions, inlineMsgById) {
  const total = actions.length;
  const title = STATE_LABEL[stateName] || stateName;

  if (total === 0) {
    return `
      <section class="state-section state-empty-section" data-state="${escapeHtml(stateName)}">
        <div class="state-header">
          <div class="state-title">${escapeHtml(title)} (0)</div>
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
      const title = a.category || "Sin categoría";
      const desc = a.description || "";

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
          ${desc ? `<p class="action-desc">${escapeHtml(desc)}</p>` : ""}

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

function render(actions, inlineMsgById = {}) {
  const el = document.getElementById("actionsList");
  if (!el) return;

  if (!actions || actions.length === 0) {
    el.innerHTML = `
      ${toolbarHtml("Actualizar")}
      <div class="empty-state">
        Aún no hay solicitudes.
        <div class="empty-hint">Crea una desde el landing y regresa aquí.</div>
      </div>
    `;
    document.getElementById("refreshBtn")?.addEventListener("click", () =>
      loadActions({ preserveUI: true })
    );
    attachHandlers();
    return;
  }

  const buckets = groupByState(actions);
  const sections = FLOW_STATES.map((st) => sectionHtml(st, buckets[st], inlineMsgById)).join("");

  el.innerHTML = `
    ${toolbarHtml("Actualizar")}
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

  const container = document.getElementById("actionsList");
  if (!container) return;

  container.addEventListener("click", async (e) => {
    const openJob = e.target?.closest?.(".js-open-job");
    if (openJob) {
      const id = openJob.getAttribute("data-action-id");
      if (id) showJobDetails(id);
      return;
    }

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

  const el = document.getElementById("actionsList");
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

    const mainWithoutClosed = mainActions.filter((a) => String(a?.state || "").trim() !== "Cerradas");
    const merged = [...mainWithoutClosed, ...closedActions];

    const inline = {};
    if (toast?.id && toast?.text) inline[toast.id] = { kind: toast.kind || "error", text: toast.text };

    render(merged, inline);
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

document.addEventListener("DOMContentLoaded", () => {
  ensureConfirmModal();
  loadActions({ preserveUI: false });
});

/* =========================================================
   Job Modal + Comments
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
    list.innerHTML = `<div class="empty-box">Aún no hay comentarios.</div>`;
    return;
  }

  list.innerHTML = arr
    .map((c) => {
      const by = c?.by || "—";
      const at = c?.ts || "";
      const text = c?.text || "";
      return `
        <div class="comment-item">
          <div class="comment-meta">${escapeHtml(by)}${at ? ` · ${escapeHtml(at)}` : ""}</div>
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
    el.className = "inline-msg";
    return;
  }

  el.style.display = "block";
  el.textContent = msg;
  el.className = kind === "error" ? "inline-msg inline-msg--error" : "inline-msg";
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
      setCommentStatus("error", "No hay solicitud seleccionada.");
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
  const elDamage = $("jobModalDamage"); // Nombre
  const elPrice = $("jobModalPrice");   // País
  const elDesc = $("jobModalDesc");
  const elCreated = $("jobModalCreated");
  const elUpdated = $("jobModalUpdated");

  if (elId) elId.textContent = id;
  if (elState) elState.textContent = "Cargando…";

  const scanBtn = $("jobOpenScanBtn");
  const apiBtn = $("jobOpenApiBtn");

  // "Abrir landing" — vuelve a la sección explorar
  if (scanBtn) {
    scanBtn.onclick = () => window.open(`/#explorar`, "_blank");
  }
  if (apiBtn) {
    apiBtn.onclick = () => window.open(`${API_BASE}/api/demos/${DEMO_SLUG}/actions/${encodeURIComponent(id)}`, "_blank");
  }

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
    if (elDamage) elDamage.textContent = payload.customer_name || payload.name || "—";
    if (elPrice) elPrice.textContent = payload.location || payload.country || "—";
    if (elDesc) elDesc.textContent = payload.description || "—";
    if (elCreated) elCreated.textContent = a.created_at || "—";
    if (elUpdated) elUpdated.textContent = a.updated_at || "—";

    const comments = extractCommentsFromHistory(a);
    renderComments(comments);
    fetchComments(id).then(renderComments).catch(() => {});
  } catch {
    if (elState) elState.textContent = "Error cargando solicitud";
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
