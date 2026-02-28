const form = document.getElementById("leadForm");
const status = document.getElementById("formStatus");

const requestTypeInput = document.getElementById("requestType");
const demoVerticalInput = document.getElementById("demoVertical");
const painField = document.getElementById("pain");

// --- BOTONES DE SOLICITAR DEMO ---
document.querySelectorAll('[data-request="demo"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    if (requestTypeInput) requestTypeInput.value = "demo";
    if (demoVerticalInput) demoVerticalInput.value = btn.dataset.vertical || "";

    if (painField) {
      painField.placeholder =
        "¿Qué te gustaría ver en el demo? (captura, estados, cierre, historial...)";
    }
  });
});

// --- RESET A EVALUATION SI NO ES DEMO ---
document.querySelectorAll('a[href="#explorar"]').forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.dataset.request === "demo") return;

    if (requestTypeInput) requestTypeInput.value = "evaluation";
    if (demoVerticalInput) demoVerticalInput.value = "";

    if (painField) {
      painField.placeholder =
        "Principal problema operativo";
    }
  });
});

// --- SUBMIT (STAGING) ---
form?.addEventListener("submit", (e) => {
  e.preventDefault();

  const data = new FormData(form);

  console.log("Solicitud (staging):", {
    name: data.get("name"),
    email: data.get("email"),
    industry: data.get("industry"),
    teamSize: data.get("teamSize"),
    pain: data.get("pain"),
    country: data.get("country"),
    category: data.get("category"),
    requestType: data.get("requestType"),
    demoVertical: data.get("demoVertical"),
  });

  status.textContent = "Solicitud registrada (staging).";
  form.reset();

  // Reset hidden inputs after reset()
  if (requestTypeInput) requestTypeInput.value = "evaluation";
  if (demoVerticalInput) demoVerticalInput.value = "";
});
