// /app.js — FBOS Landing (Implementations intake) v1
// Sends form to FBOS Core Engine:
// POST https://api.fbos.org/api/demos/implementations/submit

const API_BASE = "https://api.fbos.org";
const ENDPOINT = "/api/demos/implementations/submit";

const form = document.getElementById("leadForm");
const statusEl = document.getElementById("formStatus");

const requestTypeInput = form?.querySelector('input[name="requestType"]');
const demoVerticalInput = form?.querySelector('input[name="demoVertical"]');

function setStatus(msg, kind = "") {
  if (!statusEl) return;
  statusEl.className = `fine ${kind}`.trim(); // keep your existing typography class
  statusEl.textContent = msg || "";
}

function str(v) {
  return String(v ?? "").trim();
}

function getFormJSON(formEl) {
  const fd = new FormData(formEl);
  const data = {};
  fd.forEach((v, k) => (data[k] = str(v)));

  // Add standard metadata (same pattern as Ding Repairs)
  data.source = "fbos-landing.pages";
  data.user_agent = navigator.userAgent;
  data.client_ts = new Date().toISOString();

  return data;
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  if (!form.checkValidity()) {
    form.reportValidity();
    setStatus("Por favor completa los campos requeridos.", "err");
    return;
  }

  const payload = getFormJSON(form);

  // Minimal sanity (helps avoid silent fails)
  if (!payload.name || !payload.email) {
    setStatus("Por favor completa Nombre y Email.", "err");
    return;
  }

  // UX: disable button while sending
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn ? submitBtn.textContent : "";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando…";
  }
  setStatus("Registrando solicitud…");

  try {
    const res = await fetch(`${API_BASE}${ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const out = await res.json().catch(() => ({}));

    if (!res.ok || !out?.success) {
      const msg = out?.error || `Error (${res.status})`;
      throw new Error(msg);
    }

    const id = out?.action_id || out?.id || "—";
    setStatus(`Solicitud registrada. ID: ${id}`, "ok");

    // Reset form & restore defaults
    form.reset();
    if (requestTypeInput) requestTypeInput.value = "evaluation";
    if (demoVerticalInput) demoVerticalInput.value = "";

    // Optional: event hook if you ever want analytics
    window.dispatchEvent(new CustomEvent("fbos:created", { detail: { action_id: id, demo: "implementations" } }));
  } catch (err) {
    setStatus(`No se pudo registrar: ${err.message}`, "err");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalBtnText || "Evaluar mi caso";
    }
  }
});
