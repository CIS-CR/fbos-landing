const form = document.getElementById("leadForm");
const status = document.getElementById("formStatus");

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  status.textContent = "Solicitud registrada (staging).";
  form.reset();
});
