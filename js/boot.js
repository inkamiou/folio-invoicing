function render() {
  const section = ui.view === "editor" ? "invoices" : ui.view;
  document.querySelectorAll("[data-nav]").forEach((button) => {
    if (button.dataset.nav === section) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  paintStats();
  if (ui.view === "clients") renderClients();
  else if (ui.view === "business") renderBusiness();
  else if (ui.view === "editor") renderEditor();
  else renderInvoices();
}

function paintStats() {
  document.querySelector("#stat-outstanding").textContent = money(outstandingTotal());
  document.querySelector("#stat-paid").textContent = money(paidTotal());
}

var data = load();
if (window.__FOLIO_DESK__ && deskIsBlank(window.__FOLIO_DESK__) && !deskIsBlank(data)) save();

const note = document.querySelector(".rail-note");
if (note) {
  note.textContent = window.webkit?.messageHandlers?.folio || window.__FOLIO_WIN__
    ? "Saved in the Folio database on this computer."
    : "Stored in this browser only. Open the Folio app to keep a database copy.";
}

var ui = {
  view: "invoices",
  invoiceId: null,
  filter: "all",
  businessFilter: "",
  query: "",
  fromDate: "",
  toDate: "",
  error: "",
  editingClientId: null,
  clientQuery: "",
  preview: false,
  editingLineId: null,
  editingBusinessId: null,
  creatingBusiness: false,
  businessSnapshot: null,
  lineSnapshot: null,
  draftLineIds: new Set(),
  lastBusinessId: "",
  pendingInvoice: null,
  pendingSnapshot: "",
  pendingNumber: "",
};

ui.lastBusinessId =
  data.invoices.find((invoice) => data.businesses.some((business) => business.id && business.id === invoice.businessId))
    ?.businessId || "";

var main = document.querySelector("#main");

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!releaseEditor()) return;
    ui.view = button.dataset.nav;
    ui.error = "";
    ui.preview = false;
    ui.editingBusinessId = null;
    ui.creatingBusiness = false;
    ui.businessSnapshot = null;
    if (Array.isArray(data.businesses)) data.businesses = data.businesses.filter(businessHasData);
    document.body.classList.remove("preview-open");
    render();
  });
});

document.querySelector("#new-invoice").addEventListener("click", () => {
  const id = createInvoice();
  if (id) openInvoice(id);
});

document.addEventListener("click", (event) => {
  if (event.target.closest(".picker")) return;
  document.querySelectorAll(".picker-menu").forEach((menu) => {
    menu.hidden = true;
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && ui.preview) {
    ui.preview = false;
    document.body.classList.remove("preview-open");
    const wrap = document.querySelector("#sheet-wrap");
    const button = document.querySelector("#draft-preview");
    if (wrap) wrap.hidden = true;
    if (button) {
      button.setAttribute("aria-pressed", "false");
      button.focus();
    }
    return;
  }
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.field !== "taxRate" && target.dataset.business !== "taxRate" && target.dataset.itemField !== "tax") return;
  event.preventDefault();
  const current = Number(target.value);
  const base = Number.isFinite(current) ? current : 0;
  const next = Math.max(0, base + (event.key === "ArrowUp" ? 1 : -1));
  target.value = String(Number(next.toFixed(6)));
  target.dispatchEvent(new Event("input", { bubbles: true }));
});

render();
