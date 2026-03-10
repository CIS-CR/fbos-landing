// /app.js — FBOS Landing (Implementations intake) v3
// - Connects form to fbos-landing-intake Worker
// - Worker forwards to Core API
// - Worker sends email to client + hello@fbos.org
// - Vertical cards set requestType=demo + demoVertical
// - CTA "Evaluar mi caso" forces evaluation mode

const API_BASE = "https://fbos-landing-intake.colinisaunders.workers.dev";
const ENDPOINT = "/api/demos/implementations/submit";

const form = document.getElementById("leadForm");
const statusEl = document.getElementById("formStatus");
const submitBtn = form?.querySelector('button[type="submit"]');

const requestTypeEl = document.getElementById("requestType");
const demoVerticalEl = document.getElementById("demoVertical");

function setStatus(msg, kind = "") {
  if (!statusEl) return;
  statusEl.className = `fine ${kind}`.trim();
  statusEl.textContent = msg || "";
}

function str(v) {
  return String(v ?? "").trim();
}

function setMode(mode, vertical = "") {
  if (!requestTypeEl || !demoVerticalEl) return;

  requestTypeEl.value = mode === "demo" ? "demo" : "evaluation";
  demoVerticalEl.value = mode === "demo" ? str(vertical) : "";

  if (submitBtn) {
    submitBtn.textContent = mode === "demo" ? "Solicitar demo" : "Evaluar mi caso";
  }

  setStatus("");
}

function getFormJSON(formEl) {
  const fd = new FormData(formEl);
  const data = {};

  fd.forEach((v, k) => {
    data[k] = str(v);
  });

  data.source = "fbos-landing.pages";
  data.user_agent = navigator.userAgent;
  data.client_ts = new Date().toISOString();

  return data;
}

// Wire “Solicitar demo” buttons
document.querySelectorAll('[data-request="demo"][data-vertical]').forEach((a) => {
  a.addEventListener("click", () => {
    const vertical = a.getAttribute("data-vertical") || "";
    setMode("demo", vertical);
  });
});

// Force evaluation when clicking non-demo links to #explorar
document.querySelectorAll('a[href="#explorar"]:not([data-request="demo"])').forEach((a) => {
  a.addEventListener("click", () => setMode("evaluation"));
});

// Default mode on load
setMode("evaluation");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setStatus("");

  if (!form.checkValidity()) {
    form.reportValidity();
    setStatus("Por favor completa los campos requeridos.", "err");
    return;
  }

  const payload = getFormJSON(form);

  if (!payload.name || !payload.email) {
    setStatus("Por favor completa Nombre y Email.", "err");
    return;
  }

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

    const currentMode = requestTypeEl?.value || "evaluation";
    const currentVertical = demoVerticalEl?.value || "";

    form.reset();

    if (requestTypeEl) requestTypeEl.value = currentMode;
    if (demoVerticalEl) demoVerticalEl.value = currentVertical;

    if (submitBtn) {
      submitBtn.textContent = currentMode === "demo" ? "Solicitar demo" : "Evaluar mi caso";
    }

    window.dispatchEvent(
      new CustomEvent("fbos:created", {
        detail: {
          action_id: id,
          demo: "implementations",
        },
      })
    );
  } catch (err) {
    setStatus(`No se pudo registrar: ${err.message}`, "err");

    if (submitBtn) {
      submitBtn.textContent = originalBtnText || "Enviar";
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }
});
