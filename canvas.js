// canvas.js — FBOS Canvas (multi-demo aware) ✅
// Adaptado desde service-desk/canvas.js para:
// - Usar window.FBOS_CANVAS_CONFIG (si existe) y data-demo del container (#actionsList)
// - Default demo: "implementations"
// - Endpoints /api/demos/:demo/*
// - Mantiene confirm modal + comments + job modal
// - scanPath configurable por demo (para implementations apunta a /#explorar)

const API_BASE = "https://api.fbos.org";
const DEFAULT_DEMO = "implementations";

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

// Etiquetas UI (Español)
const STATE_LABEL = {
  Nuevas: "Nuevas",
  Validadas: "Validadas",
  Asignadas: "Asignadas",
  "En ejecución": "En ejecución",
  "En revisión": "En revisión",
  Cerradas: "Cerradas",
};

// Botones UI (Español)
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

// Cantidad visible por columna
const visibleByState = Object.fromEntries(FLOW_STATES.map((s) => [s, DEFAULT_VISIBLE_PER_STATE]));
const isExpandedByState = Object.fromEntries(FLOW_STATES.map((s) => [s, false]));
let closedCache = [];

// Demo/runtime config
let DEMO_SLUG = DEFAULT_DEMO;

function getCanvasConfig() {
  const cfg = window.FBOS_CANVAS_CONFIG || {};
  return {
    useMultiDemo: cfg.useMultiDemo !== false, // default true
    demos: cfg.demos || {},
  };
}

function getDemoSlugFromDOM() {
  const el = document.getElementById("actionsList");
  const d = el?.getAttribute("data-demo");
  return d ? String(d).trim() : "";
}

function getDemoConfig(demo) {
  const { demos } = getCanvasConfig();
  return demos?.[demo] || null;
}

function initDemo() {
  const fromDom = getDemoSlugFromDOM();
  const cfg = getCanvasConfig();
  const pick = fromDom || DEFAULT_DEMO;

  DEMO_SLUG = pick;

  // Si hay config explícito, respétalo
  const dcfg = getDemoConfig(DEMO_SLUG);
  if (dcfg?.demo) DEMO_SLUG = String(dcfg.demo).trim() || DEMO_SLUG;

  // Si config trae labels/estados, podrías sobre-escribir aquí.
  // (Mantenemos FLOW_STATES como base para no romper CSS/UI)
}

function endpointsFor(demo) {
  return {
    ACTIONS: `${API_BASE}/api/demos/${encodeURIComponent(demo)}/actions?limit=50`,
    CLOSED: `${API_BASE}/api/demos/${encodeURIComponent(demo)}/actions/closed?limit=6`,
    ACTION: (id) =>
      `${API_BASE}/api/demos/${encodeURIComponent(demo)}/actions/${encodeURIComponent(id)}`,
    STATE: (id) =>
      `${API_BASE}/api/demos/${encodeURIComponent(demo)}/actions/${encodeURIComponent(id)}/state`,
    COMMENTS: (id) =>
      `${API_BASE}/api/demos/${encodeURIComponent(demo)}/actions/${encodeURIComponent(id)}/comments`,
    COMMENT: (id) =>
      `${API_BASE}/api/demos/${encodeURIComponent(demo)}/actions/${encodeURIComponent(id)}/comment`,
  };
}

function historyUrlForDemo(demo) {
  // Si el demo define un history path, úsalo. Si no, fallback sensible.
  const dcfg = getDemoConfig(demo);
  if (dcfg?.historyPath) return String(dcfg.historyPath);
  // Fallbacks:
  if (demo === "service-desk") return "/service-desk/history/";
  if (demo === "ding-repairs") return "/ding-repairs/history/";
  // landing
  return "/history/";
}

function scanPathForDemo(demo) {
  const dcfg = getDemoConfig(demo);
  if (dcfg?.scanPath) return String(dcfg.scanPath);
  // fallback: implementations => landing
  if (demo === "implementations") return "/#explorar";
  return "/";
}

/* =========================
   Confirm modal (injected)
========================= */
const CONFIRM_TEXT = "¿Estás seguro que deseas mover este ticket?";
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
  return Number.isFinite(t) ? t : 0
