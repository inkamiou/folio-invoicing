const STORAGE_KEY = "folio.invoices.v1";

const CURRENCIES = [
  ["EUR", "Euro"],
  ["USD", "US dollar"],
  ["JPY", "Yen"],
  ["GBP", "Pound"],
  ["CNY", "Yuan"],
  ["AUD", "Australian dollar"],
  ["CAD", "Canadian dollar"],
  ["CHF", "Swiss franc"],
  ["HKD", "Hong Kong dollar"],
  ["SGD", "Singapore dollar"],
];

function emptyDesk() {
  return {
    business: {
      name: "",
      email: "",
      phone: "",
      address: "",
      taxId: "",
      registrationNumber: "",
      logo: "",
      currency: "EUR",
      extraCurrencies: [],
      taxRate: 0,
      invoiceTemplate: "",
      numberLength: 3,
      dateFormat: "iso",
      accounts: [],
    },
    businesses: [],
    clients: [],
    invoices: [],
    nextNumber: 1,
  };
}

function deskIsBlank(desk) {
  const businesses = Array.isArray(desk.businesses) && desk.businesses.length ? desk.businesses : [desk.business || {}];
  return !desk.clients?.length && !desk.invoices?.length && !businesses.some((business) => businessHasData(business));
}

function readBrowserDesk() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved && Array.isArray(saved.invoices) && saved.business) return saved;
  } catch {
    /* keep going if the browser copy is unreadable */
  }
  return null;
}

function adoptTaxId(party) {
  if (!party) return;
  if (!hasMark(party.taxId) && hasMark(party.vatCode)) party.taxId = party.vatCode;
  delete party.vatCode;
}

function normalizeBusiness(raw, fallbackNumber) {
  const business = {
    id: raw?.id || uid(),
    name: raw?.name || "",
    email: raw?.email || "",
    phone: raw?.phone || "",
    address: raw?.address || "",
    taxId: raw?.taxId || "",
    registrationNumber: raw?.registrationNumber || "",
    logo: raw?.logo || "",
    currency: raw?.currency || "EUR",
    extraCurrencies: Array.isArray(raw?.extraCurrencies) ? raw.extraCurrencies : [],
    taxRate: Number(raw?.taxRate) || 0,
    invoiceTemplate: raw?.invoiceTemplate || "",
    numberLength: raw?.numberLength || 3,
    dateFormat: knownDateFormat(raw?.dateFormat),
    nextNumber: Math.max(1, Math.round(Number(raw?.nextNumber ?? fallbackNumber)) || 1),
    accounts: Array.isArray(raw?.accounts) ? raw.accounts : [],
  };
  adoptTaxId(business);
  return business;
}

function prepareDesk(desk) {
  if (!desk) return desk;
  const fallbackNumber = Number(desk.nextNumber) || 1;
  if (!Array.isArray(desk.businesses) || !desk.businesses.length) {
    desk.businesses = businessHasData(desk.business) ? [normalizeBusiness(desk.business, fallbackNumber)] : [];
  } else {
    desk.businesses = desk.businesses.map((business) => normalizeBusiness(business, fallbackNumber));
  }
  desk.business = desk.businesses[0] || normalizeBusiness(desk.business, fallbackNumber);
  desk.nextNumber = desk.business.nextNumber || fallbackNumber;
  adoptTaxId(desk.business);
  (desk.clients || []).forEach(adoptTaxId);
  (desk.invoices || []).forEach((invoice) => {
    invoice.issued = Boolean(invoice.issued) || invoice.status !== "draft";
    invoice.dateFormat = knownDateFormat(invoice.dateFormat);
    (invoice.items || []).forEach((item) => {
      if (item.tax == null || item.tax === "") item.tax = Number(invoice.taxRate) || 0;
    });
  });
  return desk;
}

function load() {
  const injected = prepareDesk(window.__FOLIO_DESK__);
  if (injected && Array.isArray(injected.invoices) && injected.business) {
    if (deskIsBlank(injected)) {
      const browserCopy = prepareDesk(readBrowserDesk());
      if (browserCopy && !deskIsBlank(browserCopy)) return browserCopy;
    }
    return injected;
  }
  return prepareDesk(readBrowserDesk()) || emptyDesk();
}

const data = load();
if (window.__FOLIO_DESK__ && deskIsBlank(window.__FOLIO_DESK__) && !deskIsBlank(data)) save();

const note = document.querySelector(".rail-note");
if (note) {
  note.textContent = window.webkit?.messageHandlers?.folio || window.__FOLIO_WIN__
    ? "Saved in the Folio database on this computer."
    : "Stored in this browser only. Open the Folio app to keep a database copy.";
}

const ui = {
  view: "invoices",
  invoiceId: null,
  filter: "all",
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

const main = document.querySelector("#main");

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

function save() {
  const bridge = window.webkit?.messageHandlers?.folio;
  if (bridge) bridge.postMessage({ type: "save", desk: data });
  else if (window.__FOLIO_WIN__ && window.pywebview?.api?.save) window.pywebview.api.save(data);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  paintStats();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function knownDateFormat(value) {
  return value === "dmy" || value === "mdy" ? value : "iso";
}

function dateFormat() {
  return knownDateFormat(data.business.dateFormat);
}

function invoiceDateFormat(invoice) {
  return knownDateFormat(invoice?.dateFormat);
}

function formatDate(value, format) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  const [, year, month, day] = match;
  const chosen = knownDateFormat(format);
  if (chosen === "mdy") return `${month}/${day}/${year}`;
  if (chosen === "dmy") return `${day}.${month}.${year}`;
  return `${year}-${month}-${day}`;
}

function parseDate(value, format) {
  const text = String(value || "").trim();
  if (!text) return "";
  const chosen = knownDateFormat(format);
  const parts =
    chosen === "mdy"
      ? /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text)
      : chosen === "dmy"
        ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text)
        : null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const year = Number(parts ? parts[3] : iso?.[1]);
  const month = Number(parts ? (chosen === "mdy" ? parts[1] : parts[2]) : iso?.[2]);
  const day = Number(parts ? (chosen === "mdy" ? parts[2] : parts[1]) : iso?.[3]);
  if (!parts && !iso) return null;
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function datePattern(format) {
  const chosen = knownDateFormat(format);
  if (chosen === "mdy") return "MM/DD/YYYY";
  if (chosen === "dmy") return "DD.MM.YYYY";
  return "YYYY-MM-DD";
}

function plusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function uid() {
  return crypto.randomUUID();
}

function defaultTax() {
  const rate = Number(data.business.taxRate);
  return Number.isFinite(rate) ? rate : 0;
}

function blankItem() {
  return { id: uid(), code: "", description: "", unit: "", qty: "", rate: "", discount: "", tax: defaultTax() };
}

function blankAccount() {
  return { id: uid(), bank: "", account: "", bic: "" };
}

function logoSrc(value) {
  const text = String(value || "").trim();
  return /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(text) ? text : "";
}

function hasMark(value) {
  return /[0-9A-Za-z]/.test(String(value ?? ""));
}

function marked(label, value) {
  if (!hasMark(value)) return "";
  return label ? `${label} ${value}` : String(value);
}

function paymentDays(invoice) {
  if (!invoice.issueDate || !invoice.dueDate) return null;
  const issued = invoice.issueDate.split("-").map(Number);
  const due = invoice.dueDate.split("-").map(Number);
  if (issued.length !== 3 || due.length !== 3 || issued.some(Number.isNaN) || due.some(Number.isNaN)) return null;
  const start = Date.UTC(issued[0], issued[1] - 1, issued[2]);
  const end = Date.UTC(due[0], due[1] - 1, due[2]);
  return Math.round((end - start) / 86400000);
}

function paymentTerms(invoice) {
  const days = paymentDays(invoice);
  if (days === null || days < 0) return "";
  if (days === 0) return "Payment due on the issue date.";
  if (days === 1) return "Payment due within 1 day.";
  return `Payment due within ${days} days.`;
}

function isGeneratedPaymentNote(notes) {
  const text = String(notes || "").trim();
  return text === "Payment due on the issue date." || /^Payment due within \d+ days?\.$/.test(text);
}

function clearGeneratedPaymentNote(invoice) {
  if (!isGeneratedPaymentNote(invoice.notes)) return false;
  invoice.notes = "";
  return true;
}

function numberLength(business = data.business) {
  const length = Math.round(Number(business?.numberLength));
  if (!Number.isFinite(length)) return 3;
  return Math.min(12, Math.max(1, length));
}

function nextNumberValue(business = data.business) {
  const value = Math.round(Number(business?.nextNumber ?? data.nextNumber));
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(999999999999, value);
}

function rememberNextNumber(value, business = data.business) {
  const next = Math.min(999999999999, Math.max(1, Math.round(Number(value)) || 1));
  if (business) business.nextNumber = next;
  if (!business || business === data.business) data.nextNumber = next;
  return next;
}

function formatInvoiceNumber(index, business = data.business) {
  const padded = String(index).padStart(numberLength(business), "0");
  const template = String(business?.invoiceTemplate || "").trim();
  if (!template) return `INV-${new Date().getFullYear()}-${padded}`;
  if (/\{nr\}/i.test(template)) return template.replace(/\{nr\}/gi, padded);
  return `${template}${padded}`;
}

function indexFromNumber(number, business = data.business) {
  const text = String(number || "").trim();
  if (!text) return null;
  const template = String(business?.invoiceTemplate || "").trim();
  const pattern = template
    ? new RegExp(
        `^${(/\{nr\}/i.test(template) ? template : `${template}{nr}`)
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\\\{nr\\\}/gi, "(\\d+)")}$`,
        "i"
      )
    : /^INV-\d{4}-(\d+)$/i;
  const matched = text.match(pattern);
  const digits = matched ? matched.slice(1).find(Boolean) : /^\d+$/.test(text) ? text : "";
  const index = Number(digits);
  if (!Number.isInteger(index) || index < 1 || index > 999999999999) return null;
  return index;
}

function confirmNextNumber(index) {
  if (index == null) return false;
  const following = index + 1;
  if (following === nextNumberValue()) return false;
  const approved = confirm(
    `Set the next invoice number to ${formatInvoiceNumber(following)}? It is currently ${formatInvoiceNumber(nextNumberValue())}.`
  );
  if (!approved) return false;
  rememberNextNumber(following);
  return true;
}

function invoiceNumberTaken(number, exceptId) {
  const key = String(number || "").trim().toLowerCase();
  if (!key) return false;
  return data.invoices.some(
    (invoice) => invoice.id !== exceptId && String(invoice.number || "").trim().toLowerCase() === key
  );
}

function invoicesInSeries(business) {
  const id = business?.id || "";
  return data.invoices.filter((invoice) => (invoice.businessId || "") === id);
}

function highestSavedIndex(business) {
  let highest = 0;
  for (const invoice of invoicesInSeries(business)) {
    const index = indexFromNumber(invoice.number, business);
    if (index != null && index > highest) highest = index;
  }
  return highest;
}

function nextInvoiceIndex(business = data.business) {
  let index = Math.max(nextNumberValue(business), highestSavedIndex(business) + 1);
  for (let step = 0; step < 10000 && invoiceNumberTaken(formatInvoiceNumber(index, business)); step += 1) index += 1;
  return index;
}

function paintNumberPreview() {
  const preview = main.querySelector("#number-preview");
  const error = main.querySelector("#number-error");
  const number = formatInvoiceNumber(nextInvoiceIndex());
  if (preview) preview.textContent = `Use {nr} where the number goes. Next invoice: ${number}`;
  if (error) error.textContent = invoiceNumberTaken(number) ? "An invoice with this number already exists." : "";
}

function lastPickedBusinessId() {
  if (businessById(ui.lastBusinessId)) return ui.lastBusinessId;
  const recent = data.invoices.find((invoice) => businessById(invoice.businessId));
  return recent?.businessId || "";
}

function createInvoice() {
  const open = currentInvoice();
  if (invoiceIsPending(open)) {
    if (!discardPendingInvoice()) return null;
  } else if (open && ui.view === "editor" && (finishOpenLine(open) || releaseEmptyLine(open))) save();
  const pickedId = lastPickedBusinessId();
  const supplier = businessById(pickedId) || data.businesses.find(businessHasData) || data.business;
  if (supplier) data.business = supplier;
  const businessId = supplier?.id || "";
  const number = formatInvoiceNumber(nextInvoiceIndex(supplier), supplier);
  if (invoiceNumberTaken(number)) {
    ui.view = "business";
    ui.editingBusinessId = supplier?.id || null;
    ui.creatingBusiness = false;
    ui.businessSnapshot = supplier ? JSON.parse(JSON.stringify(supplier)) : null;
    render();
    return null;
  }
  const invoice = {
    id: uid(),
    number,
    businessId,
    clientId: data.clients[0]?.id || "",
    issueDate: today(),
    dueDate: plusDays(14),
    status: "draft",
    issued: false,
    dateFormat: dateFormat(),
    notes: "",
    taxRate: Number(data.business.taxRate) || 0,
    items: [blankItem()],
  };
  ui.pendingInvoice = invoice;
  ui.pendingNumber = number;
  ui.pendingSnapshot = JSON.stringify(invoice);
  if (businessId) ui.lastBusinessId = businessId;
  return invoice.id;
}

function currentInvoice() {
  if (ui.pendingInvoice && ui.pendingInvoice.id === ui.invoiceId) return ui.pendingInvoice;
  return data.invoices.find((invoice) => invoice.id === ui.invoiceId) || null;
}

function invoiceIsPending(invoice = currentInvoice()) {
  return Boolean(invoice && ui.pendingInvoice && invoice.id === ui.pendingInvoice.id);
}

function dropPendingInvoice() {
  if (ui.pendingInvoice && ui.invoiceId === ui.pendingInvoice.id) ui.invoiceId = null;
  ui.pendingInvoice = null;
  ui.pendingSnapshot = "";
  ui.pendingNumber = "";
}

function discardPendingInvoice() {
  const invoice = ui.pendingInvoice;
  if (!invoice) return true;
  if (ui.invoiceId === invoice.id && JSON.stringify(invoice) !== ui.pendingSnapshot) {
    if (!confirm(`Discard ${invoice.number}? It has not been created.`)) return false;
  }
  dropPendingInvoice();
  return true;
}

function releaseEditor() {
  const open = currentInvoice();
  if (invoiceIsPending(open)) return discardPendingInvoice();
  if (finishOpenLine(open) || (open && releaseEmptyLine(open))) save();
  return true;
}

function reserveCommittedNumber(invoice) {
  const supplier = businessFor(invoice) || data.business;
  if (supplier) data.business = supplier;
  const index = indexFromNumber(invoice.number, supplier);
  const following = Math.max(highestSavedIndex(supplier) + 1, index == null ? 0 : index + 1);
  if (following > nextNumberValue(supplier)) rememberNextNumber(following, supplier);
}

function commitDraft() {
  const invoice = currentInvoice();
  if (!invoiceIsPending(invoice)) return;
  const number = String(invoice.number || "").trim();
  invoice.number = number;
  if (!number) {
    ui.error = "Enter an invoice number.";
    const error = main.querySelector("#form-error");
    if (error) error.textContent = ui.error;
    return;
  }
  if (invoiceNumberTaken(number, invoice.id)) {
    ui.error = "An invoice with this number already exists.";
    const error = main.querySelector("#form-error");
    if (error) error.textContent = ui.error;
    return;
  }
  data.invoices.unshift(invoice);
  ui.pendingInvoice = null;
  ui.pendingSnapshot = "";
  ui.pendingNumber = "";
  reserveCommittedNumber(invoice);
  ui.error = "";
  save();
  render();
}

function clientById(id) {
  return data.clients.find((client) => client.id === id) || null;
}

function businessById(id) {
  return data.businesses.find((business) => business.id === id) || null;
}

function businessFor(invoice) {
  return businessById(invoice?.businessId);
}

function businessHasData(business) {
  if (!business) return false;
  if (["name", "email", "phone", "address", "registrationNumber", "taxId"].some((key) => hasMark(business[key]))) return true;
  if (logoSrc(business.logo)) return true;
  return (business.accounts || []).some((account) => [account.bank, account.account, account.bic].some((value) => hasMark(value)));
}

function blankBusiness() {
  return normalizeBusiness({ nextNumber: 1 }, 1);
}

function knownCurrency(code) {
  return CURRENCIES.some(([item]) => item === code);
}

function currencyCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return code.length >= 2 && code.length <= 12 ? code : "";
}

function extraCurrencies() {
  return Array.isArray(data.business.extraCurrencies) ? data.business.extraCurrencies : [];
}

function currencyChoices() {
  const codes = CURRENCIES.map(([code]) => code);
  for (const code of extraCurrencies()) {
    if (!codes.includes(code)) codes.push(code);
  }
  const selected = currencyCode(data.business.currency) || "EUR";
  if (!codes.includes(selected)) codes.push(selected);
  return codes;
}

function roundMoney(value) {
  const places = knownCurrency(data.business.currency || "EUR") ? 2 : 8;
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function lineGross(item) {
  const qty = Number(item.qty);
  const rate = Number(item.rate);
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return 0;
  return qty * rate;
}

function lineDiscountAmount(item) {
  if (!hasMark(item.discount)) return 0;
  const discount = Number(item.discount);
  if (!Number.isFinite(discount)) return 0;
  return roundMoney(lineGross(item) * (discount / 100));
}

function lineAmount(item) {
  if (!lineGross(item)) return 0;
  return roundMoney(lineGross(item) - lineDiscountAmount(item));
}

function lineTaxRate(item) {
  if (!hasMark(item.tax)) return null;
  const tax = Number(item.tax);
  return Number.isFinite(tax) ? tax : null;
}

function lineTaxAmount(item) {
  const tax = lineTaxRate(item);
  if (tax == null) return 0;
  return roundMoney(lineAmount(item) * (tax / 100));
}

function taxRows(lines) {
  const groups = new Map();
  lines.forEach((item) => {
    const rate = lineTaxRate(item);
    if (rate == null) return;
    const key = String(rate);
    groups.set(key, (groups.get(key) || 0) + lineTaxAmount(item));
  });
  return [...groups.entries()].map(([rate, amount]) => ({ rate, amount: roundMoney(amount) }));
}

function lineHasData(item) {
  return ["code", "description", "unit", "qty", "rate", "discount"].some((key) => hasMark(item[key]));
}

function lineOnInvoice(item) {
  return hasMark(item.description) && hasMark(item.rate);
}

function invoiceLines(invoice) {
  return invoice.items.filter(lineOnInvoice);
}

function totals(invoice) {
  const lines = invoiceLines(invoice);
  const discount = roundMoney(lines.reduce((sum, item) => sum + lineDiscountAmount(item), 0));
  const subtotal = roundMoney(lines.reduce((sum, item) => sum + lineAmount(item), 0));
  const tax = roundMoney(lines.reduce((sum, item) => sum + lineTaxAmount(item), 0));
  return { discount, subtotal, tax, total: roundMoney(subtotal + tax) };
}

function money(amount) {
  const currency = currencyCode(data.business.currency) || "EUR";
  const value = roundMoney(amount);
  if (!knownCurrency(currency)) {
    const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 }).format(value);
    return `${number} ${currency}`;
  }
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isOverdue(invoice) {
  return invoice.status === "sent" && invoice.dueDate && invoice.dueDate < today();
}

function statusLabel(invoice) {
  return isOverdue(invoice) ? "overdue" : invoice.status;
}

function outstandingTotal() {
  return data.invoices
    .filter((invoice) => invoice.status === "sent")
    .reduce((sum, invoice) => sum + totals(invoice).total, 0);
}

function paidTotal() {
  return data.invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((sum, invoice) => sum + totals(invoice).total, 0);
}

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

function renderInvoices() {
  main.innerHTML = `
    <div class="toolbar">
      <div>
        <h2>Invoices</h2>
        <p class="lede">Drafts, what is still owed, and what has been paid.</p>
      </div>
      <input id="search" class="search" type="search" placeholder="Search number or client" value="${esc(ui.query)}" />
    </div>
    <div class="filters" role="group" aria-label="Filter invoices">
      ${["all", "draft", "sent", "paid", "overdue"]
        .map(
          (filter) =>
            `<button type="button" class="chip" data-filter="${filter}" aria-pressed="${ui.filter === filter}">${filter}</button>`
        )
        .join("")}
    </div>
    <div class="date-range">
      ${rangeField("from", "Issued from", ui.fromDate)}
      ${rangeField("to", "Issued to", ui.toDate)}
      <p class="hint" id="range-note"></p>
    </div>
    <div class="ledger">
      <table>
        <thead>
          <tr>
            <th>Number</th>
            <th>Client</th>
            <th>Issued</th>
            <th>Due</th>
            <th>Status</th>
            <th class="amount">Total</th>
          </tr>
        </thead>
        <tbody id="invoice-rows"></tbody>
      </table>
      <div id="invoice-empty"></div>
    </div>
  `;

  main.querySelector("#search").addEventListener("input", (event) => {
    ui.query = event.target.value;
    paintInvoiceRows();
  });
  main.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.filter = button.dataset.filter;
      main.querySelectorAll("[data-filter]").forEach((chip) => {
        chip.setAttribute("aria-pressed", chip.dataset.filter === ui.filter);
      });
      paintInvoiceRows();
    });
  });
  main.querySelectorAll("[data-range]").forEach((field) => {
    field.addEventListener("input", () => applyRange(field, false));
    field.addEventListener("blur", () => applyRange(field, true));
  });
  main.querySelectorAll("[data-range-picker]").forEach((picker) => {
    picker.addEventListener("input", () => {
      const key = picker.dataset.rangePicker === "from" ? "fromDate" : "toDate";
      ui[key] = picker.value;
      const text = main.querySelector(`[data-range="${picker.dataset.rangePicker}"]`);
      if (text) text.value = formatDate(picker.value, dateFormat());
      paintInvoiceRows();
    });
  });
  paintInvoiceRows();
}

function rangeField(name, label, value) {
  const format = dateFormat();
  return `<label><span>${label}</span><span class="date-field"><input data-range="${name}" type="text" inputmode="numeric" maxlength="10" placeholder="${datePattern(format)}" value="${esc(formatDate(value, format))}" autocomplete="off" /><input data-range-picker="${name}" type="date" value="${esc(value)}" aria-label="Choose ${label.toLowerCase()} date" /></span></label>`;
}

function applyRange(field, restore) {
  const key = field.dataset.range === "from" ? "fromDate" : "toDate";
  const parsed = parseDate(field.value, dateFormat());
  if (parsed == null) {
    if (restore) field.value = formatDate(ui[key], dateFormat());
    return;
  }
  ui[key] = parsed;
  field.value = formatDate(parsed, dateFormat());
  const picker = main.querySelector(`[data-range-picker="${field.dataset.range}"]`);
  if (picker) picker.value = parsed;
  paintInvoiceRows();
}

function visibleInvoices() {
  const query = ui.query.trim().toLowerCase();
  return data.invoices.filter((invoice) => {
    if (ui.filter === "sent" && invoice.status !== "sent") return false;
    if (ui.filter !== "all" && ui.filter !== "sent" && statusLabel(invoice) !== ui.filter) return false;
    if (ui.fromDate && invoice.issueDate < ui.fromDate) return false;
    if (ui.toDate && invoice.issueDate > ui.toDate) return false;
    if (!query) return true;
    const client = clientById(invoice.clientId);
    return [invoice.number, client?.name, client?.email].join(" ").toLowerCase().includes(query);
  });
}

function paintInvoiceRows() {
  const rows = main.querySelector("#invoice-rows");
  const empty = main.querySelector("#invoice-empty");
  const note = main.querySelector("#range-note");
  const invoices = visibleInvoices();
  if (note) note.textContent = ui.fromDate && ui.toDate && ui.fromDate > ui.toDate ? "Issued from is after issued to." : "";
  rows.innerHTML = invoices
    .map((invoice) => {
      const client = clientById(invoice.clientId);
      const status = statusLabel(invoice);
      return `
        <tr class="invoice-row" data-open="${invoice.id}">
          <td class="num"><button type="button" class="row-open" data-open="${invoice.id}">${esc(invoice.number)}</button></td>
          <td>${esc(client?.name || "No client")}</td>
          <td>${esc(formatDate(invoice.issueDate, invoice.dateFormat))}</td>
          <td>${esc(formatDate(invoice.dueDate, invoice.dateFormat))}</td>
          <td><span class="status status-${status}">${status}</span></td>
          <td class="amount">${money(totals(invoice).total)}</td>
        </tr>
      `;
    })
    .join("");
  rows.querySelectorAll("[data-open]").forEach((row) => {
    row.addEventListener("click", () => openInvoice(row.dataset.open));
  });
  empty.innerHTML = invoices.length
    ? ""
    : `<div class="empty"><h3>${data.invoices.length ? "Nothing in this pile" : "The desk is clear"}</h3><p>${
        data.invoices.length
          ? "Try another filter or a different search."
          : "Write the first invoice when you are ready to bill someone."
      }</p>${data.invoices.length ? "" : `<button type="button" class="btn btn-primary" id="empty-new">New invoice</button>`}</div>`;
  empty.querySelector("#empty-new")?.addEventListener("click", () => {
    const id = createInvoice();
    if (id) openInvoice(id);
  });
}

function openInvoice(id) {
  ui.invoiceId = id;
  ui.view = "editor";
  ui.error = "";
  ui.preview = false;
  ui.draftLineIds.clear();
  ui.lineSnapshot = null;
  const invoice = currentInvoice();
  const only = invoice?.items.length === 1 ? invoice.items[0] : null;
  if (only && !lineHasData(only)) {
    ui.editingLineId = only.id;
    ui.draftLineIds.add(only.id);
  } else ui.editingLineId = null;
  render();
}

function renderEditor() {
  const invoice = currentInvoice();
  if (!invoice) {
    ui.view = "invoices";
    renderInvoices();
    return;
  }
  if (clearGeneratedPaymentNote(invoice)) save();
  const supplier = businessFor(invoice);
  if (supplier) data.business = supplier;
  const clientOptions = data.clients
    .map(
      (client) =>
        `<option value="${client.id}" ${client.id === invoice.clientId ? "selected" : ""}>${esc(client.name)}</option>`
    )
    .join("");

  main.innerHTML = `
    <div class="editor">
      <form class="editor-form" id="invoice-form">
        <button type="button" class="back" id="back">← Invoices</button>
        <div class="editor-head">
          <h2>${invoiceIsPending(invoice) ? "New invoice" : "Edit"}</h2>
          <div class="editor-tools">
            <button type="button" class="btn" id="draft-preview" aria-pressed="${ui.preview}">Draft Preview</button>
            <span class="status status-${statusLabel(invoice)}">${statusLabel(invoice)}</span>
          </div>
        </div>
        <div class="stack">
          <div class="editor-identity">
            <label><span>Supplier</span>
              <select data-field="businessId" data-placeholder="Select a supplier">
                <option value="" hidden ${invoice.businessId ? "" : "selected"}>Select a supplier</option>
                ${data.businesses
                  .filter(businessHasData)
                  .map(
                    (business) =>
                      `<option value="${business.id}" ${business.id === invoice.businessId ? "selected" : ""}>${esc(business.name || "Business")}</option>`
                  )
                  .join("")}
              </select>
            </label>
            <label><span>Client</span>
              <select data-field="clientId">
                <option value="">Select a client</option>
                ${clientOptions}
              </select>
            </label>
          </div>
          <label class="field-number"><span>Number</span><input data-field="number" type="text" value="${esc(invoice.number)}" required /></label>
          <div class="editor-dates">
            <label><span>Issued</span><span class="date-field"><input data-field="issueDate" type="text" inputmode="numeric" maxlength="10" placeholder="${datePattern(invoice.dateFormat)}" value="${esc(formatDate(invoice.issueDate, invoice.dateFormat))}" autocomplete="off" /><input data-date-for="issueDate" type="date" value="${esc(invoice.issueDate)}" aria-label="Choose issue date" /></span></label>
            <label><span>Due</span><span class="date-field"><input data-field="dueDate" type="text" inputmode="numeric" maxlength="10" placeholder="${datePattern(invoice.dateFormat)}" value="${esc(formatDate(invoice.dueDate, invoice.dateFormat))}" autocomplete="off" /><input data-date-for="dueDate" type="date" value="${esc(invoice.dueDate)}" aria-label="Choose due date" /></span></label>
          </div>
          <div>
            <div class="lines" id="lines"></div>
            <button type="button" class="btn btn-quiet" id="add-line">Add line</button>
          </div>
          <label><span>Notes</span><textarea data-field="notes">${esc(invoice.notes)}</textarea></label>
        </div>
        <p class="form-error" id="form-error">${esc(ui.error)}</p>
        <div class="actions">
          ${statusActions(invoice)}
          <button type="button" class="btn" id="print">Print</button>
          ${invoice.status === "draft" ? `<button type="button" class="btn btn-danger" id="delete">Delete</button>` : ""}
        </div>
      </form>
      <div class="sheet-wrap" id="sheet-wrap" ${ui.preview ? "" : "hidden"}>
        <div class="sheet-bar"><button type="button" class="btn" id="close-preview">Close</button></div>
        <div id="sheet-page"></div>
      </div>
    </div>
  `;

  paintLines();
  paintSheet({ animate: ui.preview });
  document.body.classList.toggle("preview-open", ui.preview);

  const setPreview = (open) => {
    ui.preview = open;
    const wrap = main.querySelector("#sheet-wrap");
    const button = main.querySelector("#draft-preview");
    wrap.hidden = !open;
    button.setAttribute("aria-pressed", String(open));
    document.body.classList.toggle("preview-open", open);
    if (open) {
      paintSheet({ animate: true });
      main.querySelector("#close-preview").focus();
    } else button.focus();
  };
  main.querySelector("#back").addEventListener("click", () => {
    if (!releaseEditor()) return;
    ui.view = "invoices";
    ui.preview = false;
    document.body.classList.remove("preview-open");
    render();
  });
  main.querySelector("#draft-preview").addEventListener("click", () => setPreview(!ui.preview));
  main.querySelector("#close-preview").addEventListener("click", () => setPreview(false));
  main.querySelector("#sheet-wrap").addEventListener("click", (event) => {
    if (event.target.id === "sheet-wrap") setPreview(false);
  });
  main.querySelector("#invoice-form").addEventListener("input", onInvoiceInput);
  const numberInput = main.querySelector('[data-field="number"]');
  numberInput.dataset.settled = numberInput.value.trim();
  numberInput.addEventListener("blur", (event) => {
    if (invoiceNumberTaken(event.target.value, invoice.id)) {
      event.target.value = invoice.number;
      ui.error = "";
      const error = main.querySelector("#form-error");
      if (error) error.textContent = "";
      return;
    }
    const typed = event.target.value.trim();
    if (typed === event.target.dataset.settled) return;
    event.target.dataset.settled = typed;
    if (!invoice.issued) return;
    if (confirmNextNumber(indexFromNumber(typed))) save();
  });
  main.querySelectorAll("[data-field='issueDate'], [data-field='dueDate']").forEach((field) => {
    field.addEventListener("blur", () => {
      const parsed = parseDate(field.value, invoice.dateFormat);
      if (parsed == null) {
        field.value = formatDate(invoice[field.dataset.field], invoice.dateFormat);
        return;
      }
      invoice[field.dataset.field] = parsed;
      field.value = formatDate(parsed, invoice.dateFormat);
      const picker = main.querySelector(`[data-date-for="${field.dataset.field}"]`);
      if (picker) picker.value = parsed;
      save();
      paintSheet();
    });
  });
  main.querySelectorAll("[data-date-for]").forEach((picker) => {
    picker.addEventListener("input", () => {
      const field = picker.dataset.dateFor;
      invoice[field] = picker.value;
      const text = main.querySelector(`[data-field="${field}"]`);
      if (text) text.value = formatDate(picker.value, invoice.dateFormat);
      save();
      paintSheet();
    });
  });
  main.querySelector("#add-line").addEventListener("click", () => {
    const current = invoice.items.find((item) => item.id === ui.editingLineId);
    if (current && ui.draftLineIds.has(current.id) && !lineOnInvoice(current)) {
      const missing = hasMark(current.description) ? "rate" : "description";
      main.querySelector(`[data-item-id="${current.id}"][data-item-field="${missing}"]`)?.focus();
      return;
    }
    finishOpenLine(invoice);
    releaseEmptyLine(invoice);
    const item = blankItem();
    invoice.items.push(item);
    ui.draftLineIds.add(item.id);
    ui.editingLineId = item.id;
    save();
    paintLines();
    paintSheet();
    focusEditingLine();
  });
  main.querySelector("#print").addEventListener("click", () => {
    const bridge = window.webkit?.messageHandlers?.folio;
    if (bridge) {
      bridge.postMessage({ type: "print", number: invoice.number });
      return;
    }
    window.print();
  });
  main.querySelector("#delete")?.addEventListener("click", () => {
    if (!confirm(`Delete ${invoice.number}?`)) return;
    if (invoiceIsPending(invoice)) {
      dropPendingInvoice();
      ui.view = "invoices";
      ui.preview = false;
      document.body.classList.remove("preview-open");
      render();
      return;
    }
    const supplier = businessFor(invoice) || data.business;
    const index = indexFromNumber(invoice.number, supplier);
    const reusable = !invoice.issued && index != null && index + 1 === nextNumberValue(supplier);
    data.invoices = data.invoices.filter((item) => item.id !== invoice.id);
    if (reusable) rememberNextNumber(index, supplier);
    save();
    ui.view = "invoices";
    render();
  });
  main.querySelector("#create-draft")?.addEventListener("click", () => commitDraft());
  main.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => setStatus(button.dataset.status));
  });
  enhanceSelects(main);
}

function statusActions(invoice) {
  if (invoiceIsPending(invoice)) return `<button type="button" class="btn btn-primary" id="create-draft">Create</button>`;
  if (invoice.status === "draft") return `<button type="button" class="btn btn-primary" data-status="sent">Mark sent</button>`;
  if (invoice.status === "sent") {
    return `<button type="button" class="btn btn-primary" data-status="paid">Mark paid</button>
      <button type="button" class="btn" data-status="draft">Back to draft</button>`;
  }
  return `<button type="button" class="btn" data-status="sent">Mark unpaid</button>`;
}

function releaseEmptyLine(invoice) {
  if (!invoice) return false;
  const kept = invoice.items.filter((item) => item.id === ui.editingLineId || lineHasData(item));
  if (kept.length === invoice.items.length) return false;
  invoice.items = kept;
  if (!invoice.items.some((item) => item.id === ui.editingLineId)) ui.editingLineId = null;
  return true;
}

function finishOpenLine(invoice, { discard = false } = {}) {
  if (!invoice) {
    ui.editingLineId = null;
    ui.lineSnapshot = null;
    return false;
  }
  const current = invoice.items.find((item) => item.id === ui.editingLineId);
  let changed = false;
  if (current && ui.draftLineIds.has(current.id)) {
    ui.draftLineIds.delete(current.id);
    if (discard || !lineHasData(current)) {
      invoice.items = invoice.items.filter((item) => item.id !== current.id);
      changed = true;
    }
  } else if (discard && ui.lineSnapshot && current && ui.lineSnapshot.id === current.id) {
    const index = invoice.items.findIndex((item) => item.id === current.id);
    if (index >= 0) invoice.items[index] = ui.lineSnapshot;
    changed = true;
  }
  ui.editingLineId = null;
  ui.lineSnapshot = null;
  return changed;
}

function focusEditingLine() {
  const field = main.querySelector(`#lines [data-item-id="${ui.editingLineId}"][data-item-field="description"]`);
  if (field) field.focus();
}

function summaryColumns(items) {
  return [
    ["code", "Code"],
    ["description", "Description"],
    ["unit", "Unit"],
    ["qty", "Qty"],
    ["rate", "Unit price"],
    ["discount", "Discount"],
    ["tax", "Tax"],
    ["amount", "Amount"],
  ].filter(([key]) => items.some((item) => columnHasMark(item, key)));
}

function summaryNum(key) {
  return ["qty", "rate", "discount", "tax", "amount"].includes(key) ? "num" : "";
}

function paintLines() {
  const invoice = currentInvoice();
  const lines = main.querySelector("#lines");
  if (!invoice || !lines) return;
  if (ui.editingLineId && !invoice.items.some((item) => item.id === ui.editingLineId)) ui.editingLineId = null;
  if (releaseEmptyLine(invoice)) save();
  const collapsed = invoice.items.filter((item) => item.id !== ui.editingLineId && lineHasData(item));
  const columns = summaryColumns(collapsed);
  const openLine = (item) => `
    <div class="line">
      <div class="line-copy">
        <label data-area="code"><span>Code</span><input data-item-id="${item.id}" data-item-field="code" type="text" aria-label="Code" value="${esc(item.code)}" /></label>
        <label data-area="description"><span>Description</span><input data-item-id="${item.id}" data-item-field="description" type="text" aria-label="Description" value="${esc(item.description)}" /></label>
        <div class="line-figures">
          <label data-area="unit"><span>Unit</span><input data-item-id="${item.id}" data-item-field="unit" type="text" aria-label="Unit" value="${esc(item.unit)}" /></label>
          <label data-area="qty"><span>Qty</span><input data-item-id="${item.id}" data-item-field="qty" type="number" min="0" step="any" aria-label="Qty" value="${esc(item.qty)}" /></label>
          <label data-area="rate"><span>Unit price</span><input data-item-id="${item.id}" data-item-field="rate" type="number" min="0" step="any" aria-label="Unit price" value="${esc(item.rate)}" /></label>
          <label data-area="discount"><span>Discount %</span><input data-item-id="${item.id}" data-item-field="discount" type="number" min="0" step="0.01" aria-label="Discount percent" value="${esc(item.discount)}" /></label>
          <label data-area="tax"><span>Tax %</span><input data-item-id="${item.id}" data-item-field="tax" type="number" min="0" step="any" aria-label="Tax percent" value="${esc(item.tax)}" /></label>
        </div>
        <button type="button" class="btn btn-quiet" data-clear="${item.id}">Clear</button>
      </div>
      <div class="line-summary-actions">
        <button type="button" class="btn" data-cancel-line="${item.id}">Cancel</button>
        <button type="button" class="btn btn-primary" data-add-line="${item.id}">${ui.draftLineIds.has(item.id) ? "Add" : "Save changes"}</button>
      </div>
    </div>`;
  lines.innerHTML = columns.length
    ? `<table class="line-table">
        <thead>
          <tr>
            ${columns.map(([key, label]) => `<th class="${summaryNum(key)}">${esc(label)}</th>`).join("")}
            <th class="actions"></th>
          </tr>
        </thead>
        <tbody>
          ${invoice.items
            .filter((item) => item.id === ui.editingLineId || lineHasData(item))
            .map((item) =>
              item.id === ui.editingLineId
                ? `<tr class="line-form-row"><td colspan="${columns.length + 1}">${openLine(item)}</td></tr>`
                : `<tr>
                    ${columns.map(([key]) => `<td class="${summaryNum(key)}">${itemCell(item, key)}</td>`).join("")}
                    <td class="actions">
                      <span class="line-summary-actions">
                        <button type="button" class="btn" data-edit="${item.id}">Edit</button>
                        <button type="button" class="btn btn-danger" data-remove="${item.id}">Remove</button>
                      </span>
                    </td>
                  </tr>`
            )
            .join("")}
        </tbody>
      </table>`
    : invoice.items.map((item) => openLine(item)).join("");
  lines.querySelectorAll("[data-add-line]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = invoice.items.find((entry) => entry.id === button.dataset.addLine);
      if (!item || !lineOnInvoice(item)) {
        const missing = item && hasMark(item.description) ? "rate" : "description";
        main.querySelector(`[data-item-id="${item?.id}"][data-item-field="${missing}"]`)?.focus();
        return;
      }
      ui.draftLineIds.delete(item.id);
      ui.editingLineId = null;
      ui.lineSnapshot = null;
      save();
      paintLines();
      paintSheet();
    });
  });
  lines.querySelectorAll("[data-cancel-line]").forEach((button) => {
    button.addEventListener("click", () => {
      finishOpenLine(invoice, { discard: true });
      save();
      paintLines();
      paintSheet();
    });
  });
  lines.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.edit === ui.editingLineId) return;
      const current = invoice.items.find((item) => item.id === ui.editingLineId);
      if (current && ui.draftLineIds.has(current.id) && !lineOnInvoice(current)) {
        const missing = hasMark(current.description) ? "rate" : "description";
        main.querySelector(`[data-item-id="${current.id}"][data-item-field="${missing}"]`)?.focus();
        return;
      }
      finishOpenLine(invoice);
      releaseEmptyLine(invoice);
      const item = invoice.items.find((entry) => entry.id === button.dataset.edit);
      if (!item) return;
      ui.lineSnapshot = JSON.parse(JSON.stringify(item));
      ui.draftLineIds.delete(item.id);
      ui.editingLineId = item.id;
      save();
      paintLines();
      paintSheet();
      focusEditingLine();
    });
  });
  lines.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.draftLineIds.delete(button.dataset.remove);
      if (ui.lineSnapshot?.id === button.dataset.remove) ui.lineSnapshot = null;
      if (ui.editingLineId === button.dataset.remove) ui.editingLineId = null;
      invoice.items = invoice.items.filter((item) => item.id !== button.dataset.remove);
      save();
      paintLines();
      paintSheet();
    });
  });
  lines.querySelectorAll("[data-clear]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = invoice.items.find((entry) => entry.id === button.dataset.clear);
      if (!item) return;
      item.code = "";
      item.description = "";
      item.unit = "";
      item.qty = "";
      item.rate = "";
      item.discount = "";
      item.tax = defaultTax();
      save();
      paintLines();
      paintSheet();
    });
  });
}

function onInvoiceInput(event) {
  const invoice = currentInvoice();
  const target = event.target;
  if (!invoice) return;
  if (target.dataset.field) {
    if (target.dataset.field === "number" && invoiceNumberTaken(target.value, invoice.id)) {
      ui.error = "An invoice with this number already exists.";
      const error = main.querySelector("#form-error");
      if (error) error.textContent = ui.error;
      return;
    }
    if (target.dataset.field === "issueDate" || target.dataset.field === "dueDate") {
      const parsed = parseDate(target.value, invoice.dateFormat);
      if (parsed == null) return;
      invoice[target.dataset.field] = parsed;
      const picker = main.querySelector(`[data-date-for="${target.dataset.field}"]`);
      if (picker) picker.value = parsed;
    } else invoice[target.dataset.field] = target.type === "number" ? Number(target.value) : target.dataset.field === "number" ? target.value.trim() : target.value;
    if (target.dataset.field === "businessId") {
      const selected = businessById(invoice.businessId);
      if (selected) {
        data.business = selected;
        ui.lastBusinessId = selected.id;
        if (invoiceIsPending(invoice) && invoice.number === ui.pendingNumber) {
          invoice.number = formatInvoiceNumber(nextInvoiceIndex(selected), selected);
          ui.pendingNumber = invoice.number;
          const input = main.querySelector('[data-field="number"]');
          if (input) {
            input.value = invoice.number;
            input.dataset.settled = invoice.number;
          }
        }
      }
    }
  }
  if (target.dataset.itemField) {
    const item = invoice.items.find((entry) => entry.id === target.dataset.itemId);
    if (item) {
      const textField = ["code", "description", "unit"].includes(target.dataset.itemField);
      item[target.dataset.itemField] = textField || target.value === "" ? target.value : Number(target.value);
    }
  }
  ui.error = "";
  const error = main.querySelector("#form-error");
  if (error) error.textContent = "";
  const badge = main.querySelector(".editor-head .status");
  if (badge) {
    const label = statusLabel(invoice);
    badge.className = `status status-${label}`;
    badge.textContent = label;
  }
  save();
  paintSheet();
}

function invoiceProblems(invoice) {
  const problems = [];
  if (!data.businesses.some(businessHasData)) problems.push("Add your business name first.");
  else if (!businessById(invoice.businessId)) problems.push("Choose a supplier.");
  if (!invoice.clientId) problems.push("Choose a client.");
  if (!invoiceLines(invoice).length) problems.push("Add a line with a description and a unit price.");
  if (invoiceNumberTaken(invoice.number, invoice.id)) problems.push("An invoice with this number already exists.");
  return problems;
}

function setStatus(status) {
  const invoice = currentInvoice();
  if (!invoice) return;
  if (status === "sent") {
    const problems = invoiceProblems(invoice);
    if (problems.length) {
      ui.error = problems[0];
      const error = main.querySelector("#form-error");
      if (error) error.textContent = ui.error;
      return;
    }
    if (!invoice.issued) confirmNextNumber(indexFromNumber(invoice.number));
    invoice.issued = true;
  }
  invoice.status = status;
  ui.error = "";
  save();
  render();
}

function columnHasMark(item, key) {
  if (key === "amount") return hasMark(item.qty) || hasMark(item.rate);
  return hasMark(item[key]);
}

function itemCell(item, key) {
  if (key === "amount") return hasMark(item.qty) || hasMark(item.rate) ? esc(money(lineAmount(item))) : "";
  if (key === "rate") return hasMark(item.rate) ? esc(money(item.rate)) : "";
  if (key === "discount") return hasMark(item.discount) ? `${esc(item.discount)}%` : "";
  if (key === "tax") return hasMark(item.tax) ? `${esc(item.tax)}%` : "";
  return hasMark(item[key]) ? esc(item[key]) : "";
}

function sheetText(text) {
  return String(text || "")
    .split("\n")
    .map((line) => `<span class="sheet-line">${esc(line) || "&#8203;"}</span>`)
    .join("");
}

function sheetLabel(label) {
  return String(label)
    .split(" ")
    .map((word) => `<span class="sheet-word">${esc(word)}</span>`)
    .join(" ");
}

function paintSheet({ animate = false } = {}) {
  const invoice = currentInvoice();
  const wrap = main.querySelector("#sheet-page");
  if (!invoice || !wrap) return;
  const client = clientById(invoice.clientId);
  const business = businessFor(invoice) || {
    name: "",
    address: "",
    email: "",
    phone: "",
    registrationNumber: "",
    taxId: "",
    logo: "",
    accounts: [],
  };
  const sums = totals(invoice);
  const stamp =
    invoice.status === "paid"
      ? `<div class="stamp stamp-paid">PAID</div>`
      : invoice.status === "draft"
        ? `<div class="stamp stamp-draft">DRAFT</div>`
        : "";
  const businessLines = [
    marked("", business.address),
    marked("", business.email),
    marked("", business.phone),
    marked("Reg. no.", business.registrationNumber),
    marked("Tax ID", business.taxId),
  ]
    .filter(Boolean)
    .join("\n");
  const clientLines = client
    ? [
        marked("", client.name),
        marked("", client.address),
        marked("", client.email),
        marked("Reg. no.", client.registrationNumber),
        marked("Tax ID", client.taxId),
      ]
        .filter(Boolean)
        .join("\n")
    : "No client yet";
  const columnWeight = {
    code: 1.1,
    description: 2.6,
    unit: 0.9,
    qty: 1,
    rate: 1.3,
    discount: 1.8,
    tax: 0.9,
    amount: 1.3,
  };
  const columns = [
    ["code", "Code"],
    ["description", "Description"],
    ["unit", "Unit"],
    ["qty", "Qty"],
    ["rate", "Unit price"],
    ["discount", "Discount"],
    ["tax", "Tax"],
    ["amount", "Amount"],
  ].filter(([key]) => invoiceLines(invoice).some((item) => columnHasMark(item, key)));
  const weightTotal = columns.reduce((sum, [key]) => sum + columnWeight[key], 0);
  const accountBlocks = (business.accounts || [])
    .map((account) =>
      [marked("Bank", account.bank), marked("Account", account.account), marked("BIC", account.bic)]
        .filter(Boolean)
        .join("\n")
    )
    .filter(Boolean);

  wrap.innerHTML = `
    <article class="sheet" id="sheet">
      ${stamp}
      <header class="sheet-top">
        <div>
          ${logoSrc(business.logo) ? `<img class="sheet-logo" src="${logoSrc(business.logo)}" alt="" />` : ""}
          <p class="sheet-brand">${esc(business.name || "Your business")}</p>
          <p class="sheet-meta">${sheetText(businessLines)}</p>
        </div>
        <div>
          <p class="invoice-word">Invoice</p>
          <p class="invoice-no">${esc(invoice.number)}</p>
        </div>
      </header>
      <section class="bill-row">
        <div>
          <h3>Bill to</h3>
          <p>${sheetText(clientLines)}</p>
        </div>
        <div>
          <h3>Dates</h3>
          <p>${sheetText(`Issued ${formatDate(invoice.issueDate, invoice.dateFormat) || "—"}\nDue ${formatDate(invoice.dueDate, invoice.dateFormat) || "—"}`)}</p>
        </div>
      </section>
      ${
        columns.length
          ? `<table>
        <thead>
          <tr>
            ${columns
              .map(
                ([key, label]) =>
                  `<th class="${["qty", "rate", "discount", "tax", "amount"].includes(key) ? "amount" : ""} ${key === "qty" ? "qty" : ""}" style="width:${((columnWeight[key] / weightTotal) * 100).toFixed(2)}%">${sheetLabel(label)}</th>`
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${invoiceLines(invoice)
            .map(
              (item) => `
            <tr>
              ${columns
                .map(
                  ([key]) =>
                    `<td class="${["qty", "rate", "discount", "tax", "amount"].includes(key) ? "amount" : ""} ${key === "qty" ? "qty" : ""}">${itemCell(item, key)}</td>`
                )
                .join("")}
            </tr>`
            )
            .join("")}
        </tbody>
      </table>`
          : ""
      }
      <div class="totals">
        ${sums.discount ? `<div><span>Discount</span><span>−${money(sums.discount)}</span></div>` : ""}
        <div><span>Subtotal</span><span>${money(sums.subtotal)}</span></div>
        ${taxRows(invoiceLines(invoice))
          .map((row) => `<div><span>Tax ${esc(row.rate)}%</span><span>${money(row.amount)}</span></div>`)
          .join("")}
        <div class="grand"><span>Total</span><span>${money(sums.total)}</span></div>
      </div>
      ${
        accountBlocks.length
          ? `<section class="payment"><h3>Payment</h3>${accountBlocks.map((block) => `<p>${esc(block)}</p>`).join("")}</section>`
          : ""
      }
      ${paymentTerms(invoice) ? `<p class="notes">${esc(paymentTerms(invoice))}</p>` : ""}
      ${invoice.notes && !isGeneratedPaymentNote(invoice.notes) ? `<p class="notes">${esc(invoice.notes)}</p>` : ""}
    </article>
  `;
  if (!animate) wrap.querySelector(".sheet")?.classList.add("sheet-quiet");
}

function renderClients() {
  main.innerHTML = `
    <div class="panel">
      <h2>Clients</h2>
      <p class="lede">People and companies you bill.</p>
      <form id="client-form" class="stack" style="margin-top:18px">
        <label><span>Name</span><input name="name" type="text" required /></label>
        <label><span>Email</span><input name="email" type="email" /></label>
        <label><span>Address</span><textarea name="address"></textarea></label>
        <div class="grid-2">
          <label><span>Registration no.</span><input name="registrationNumber" type="text" /></label>
          <label><span>Tax ID</span><input name="taxId" type="text" /></label>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="submit" id="client-submit">Add client</button>
          <button type="button" class="btn" id="cancel-client" hidden>Cancel</button>
        </div>
      </form>
      <div class="client-tools">
        <button type="button" class="btn btn-quiet" id="show-client-search" ${ui.clientQuery ? "hidden" : ""}>Search</button>
        <input id="client-search" class="search" type="search" placeholder="Name, email, or tax ID" value="${esc(ui.clientQuery)}" ${ui.clientQuery ? "" : "hidden"} />
      </div>
      <div class="client-list" id="client-list"></div>
    </div>
  `;
  paintClients();
  main.querySelector("#client-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.name.value.trim();
    if (!name) return;
    const details = {
      name,
      email: form.email.value.trim(),
      address: form.address.value.trim(),
      registrationNumber: form.registrationNumber.value.trim(),
      taxId: form.taxId.value.trim(),
    };
    const existing = data.clients.find((client) => client.id === ui.editingClientId);
    if (existing) Object.assign(existing, details);
    else data.clients.push({ id: uid(), ...details });
    ui.editingClientId = null;
    save();
    resetClientForm();
    paintClients();
  });
  main.querySelector("#cancel-client").addEventListener("click", () => {
    ui.editingClientId = null;
    resetClientForm();
  });
  main.querySelector("#show-client-search").addEventListener("click", () => {
    const button = main.querySelector("#show-client-search");
    const field = main.querySelector("#client-search");
    button.hidden = true;
    field.hidden = false;
    field.focus();
  });
  main.querySelector("#client-search").addEventListener("input", (event) => {
    ui.clientQuery = event.target.value;
    paintClients();
  });
}

function visibleClients() {
  const query = ui.clientQuery.trim().toLowerCase();
  if (!query) return data.clients;
  return data.clients.filter((client) =>
    [client.name, client.email, client.address, client.registrationNumber, client.taxId]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function resetClientForm() {
  const form = main.querySelector("#client-form");
  if (!form) return;
  form.reset();
  const submit = main.querySelector("#client-submit");
  const cancel = main.querySelector("#cancel-client");
  if (submit) submit.textContent = "Add client";
  if (cancel) cancel.hidden = true;
}

function editClient(id) {
  const client = data.clients.find((item) => item.id === id);
  const form = main.querySelector("#client-form");
  if (!client || !form) return;
  ui.editingClientId = client.id;
  form.name.value = client.name || "";
  form.email.value = client.email || "";
  form.address.value = client.address || "";
  form.registrationNumber.value = client.registrationNumber || "";
  form.taxId.value = client.taxId || "";
  main.querySelector("#client-submit").textContent = "Save changes";
  main.querySelector("#cancel-client").hidden = false;
  form.name.focus();
}

function paintClients() {
  const list = main.querySelector("#client-list");
  if (!list) return;
  const clients = visibleClients();
  if (!data.clients.length) {
    list.innerHTML = `<div class="empty"><h3>No clients yet</h3><p>Add one before you send an invoice.</p></div>`;
    return;
  }
  if (!clients.length) {
    list.innerHTML = `<div class="empty"><h3>No matches</h3><p>Try a different name, email, or tax ID.</p></div>`;
    return;
  }
  list.innerHTML = clients
    .map(
      (client) => `
      <article class="client-card">
        <div>
          <strong>${esc(client.name)}</strong>
          <p>
            ${[client.email, client.address, client.registrationNumber && `Reg. no. ${client.registrationNumber}`, client.taxId && `Tax ID ${client.taxId}`]
              .filter(Boolean)
              .map((line) => sheetText(line))
              .join("")}
          </p>
        </div>
        <div class="client-actions">
          <button type="button" class="btn" data-edit-client="${client.id}">Edit</button>
          <button type="button" class="btn btn-danger" data-remove-client="${client.id}">Remove</button>
        </div>
      </article>`
    )
    .join("");
  list.querySelectorAll("[data-edit-client]").forEach((button) => {
    button.addEventListener("click", () => editClient(button.dataset.editClient));
  });
  list.querySelectorAll("[data-remove-client]").forEach((button) => {
    button.addEventListener("click", () => {
      const used = data.invoices.some((invoice) => invoice.clientId === button.dataset.removeClient);
      if (used) {
        alert("This client is on an invoice. Reassign those invoices before removing them.");
        return;
      }
      data.clients = data.clients.filter((client) => client.id !== button.dataset.removeClient);
      if (ui.editingClientId === button.dataset.removeClient) {
        ui.editingClientId = null;
        resetClientForm();
      }
      save();
      paintClients();
    });
  });
}

function businessSummary(business) {
  const detail = [
    business.address,
    business.email,
    business.phone,
    hasMark(business.registrationNumber) ? `Reg. no. ${business.registrationNumber}` : "",
    hasMark(business.taxId) ? `Tax ID ${business.taxId}` : "",
  ]
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .join("\n");
  return { title: business.name || "Business", detail };
}

function prepareBusinessView() {
  if (!Array.isArray(data.businesses)) data.businesses = [];
  data.businesses = data.businesses.filter((business) => businessHasData(business) || business.id === ui.editingBusinessId);
  if (!data.businesses.some(businessHasData)) {
    let editing = data.businesses.find((business) => business.id === ui.editingBusinessId);
    if (!editing) {
      editing = blankBusiness();
      data.businesses = [editing];
      ui.editingBusinessId = editing.id;
      ui.creatingBusiness = true;
      ui.businessSnapshot = null;
    }
  }
  const editing = data.businesses.find((business) => business.id === ui.editingBusinessId);
  data.business = editing || data.businesses.find(businessHasData) || data.business;
  if (data.business && data.business.nextNumber == null) data.business.nextNumber = data.nextNumber || 1;
}

function renderBusiness() {
  prepareBusinessView();
  const business = data.business;
  const rows = data.businesses
    .map((item) => {
      if (item.id === ui.editingBusinessId) return `<div class="business-form" id="business-slot"></div>`;
      if (!businessHasData(item)) return "";
      const summary = businessSummary(item);
      return `<article class="business-row">
        <div>
          <h3>${esc(summary.title)}</h3>
          ${summary.detail ? `<p>${esc(summary.detail)}</p>` : ""}
        </div>
        <span class="line-summary-actions">
          <button type="button" class="btn" data-edit-business="${item.id}">Edit</button>
          <button type="button" class="btn btn-danger" data-remove-business="${item.id}">Remove</button>
        </span>
      </article>`;
    })
    .join("");
  main.innerHTML = `
    <div class="panel">
      <h2>Business</h2>
      <p class="lede">Each business can issue its own invoices.</p>
      <div class="business-list" id="business-list">${rows}</div>
      <button type="button" class="btn btn-quiet" id="add-business" ${data.businesses.some(businessHasData) ? "" : "hidden"}>Add business</button>
      <form id="business-form" class="stack" hidden>
        <div>
          <span class="field-label">Logo</span>
          <div class="logo-picker">
            ${logoSrc(business.logo) ? `<img class="logo-preview" src="${logoSrc(business.logo)}" alt="" />` : ""}
            <label class="btn file-row">Add logo<input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden /></label>
            ${logoSrc(business.logo) ? `<button type="button" class="btn btn-danger" id="remove-logo">Remove</button>` : ""}
          </div>
        </div>
        <label><span>Name</span><input data-business="name" type="text" value="${esc(business.name)}" /></label>
        <div class="grid-2">
          <label><span>Email</span><input data-business="email" type="email" value="${esc(business.email)}" /></label>
          <label><span>Phone</span><input data-business="phone" type="text" value="${esc(business.phone)}" /></label>
        </div>
        <label><span>Address</span><textarea data-business="address">${esc(business.address)}</textarea></label>
        <div class="grid-2">
          <label><span>Registration no.</span><input data-business="registrationNumber" type="text" value="${esc(business.registrationNumber)}" /></label>
          <label><span>Tax ID</span><input data-business="taxId" type="text" value="${esc(business.taxId)}" /></label>
        </div>
        <div class="stack">
          <span class="field-label">Invoice number</span>
          <label><span>Template</span><input data-business="invoiceTemplate" type="text" maxlength="80" placeholder="{nr}_Company_invoice" value="${esc(business.invoiceTemplate || "")}" /></label>
          <div class="grid-2">
            <label><span>Next number</span><input id="next-number" type="number" min="1" max="999999999999" step="1" value="${esc(nextNumberValue())}" /></label>
            <label><span>Number length</span><input data-business="numberLength" type="number" min="1" max="12" step="1" value="${esc(numberLength())}" /></label>
          </div>
          <p class="hint" id="number-preview"></p>
          <p class="form-error" id="number-error"></p>
        </div>
        <div class="grid-2">
          <label><span>Currency</span>
            <select data-business="currency">
              ${currencyChoices()
                .map((code) => {
                  const known = CURRENCIES.find(([item]) => item === code);
                  const label = known ? `${code} — ${known[1]}` : code;
                  return `<option value="${esc(code)}" ${business.currency === code ? "selected" : ""}>${esc(label)}</option>`;
                })
                .join("")}
            </select>
          </label>
          <label><span>Default tax %</span><input data-business="taxRate" type="number" min="0" step="any" value="${esc(business.taxRate)}" /></label>
        </div>
        <div class="grid-2">
          <label><span>Date format</span>
            <select data-business="dateFormat">
              <option value="iso" ${dateFormat() === "iso" ? "selected" : ""}>ISO — YYYY-MM-DD</option>
              <option value="dmy" ${dateFormat() === "dmy" ? "selected" : ""}>European — DD.MM.YYYY</option>
              <option value="mdy" ${dateFormat() === "mdy" ? "selected" : ""}>North America — MM/DD/YYYY</option>
            </select>
            <p class="hint">New invoices use this format. Existing invoices keep theirs.</p>
          </label>
        </div>
        <div>
          <button type="button" class="btn btn-quiet" id="show-currency">Add Currency</button>
          <div id="currency-form" hidden>
            <div class="currency-add">
              <input id="new-currency" type="text" maxlength="12" placeholder="BTC" autocomplete="off" />
              <button type="button" class="btn" id="add-currency">Add</button>
            </div>
            <p class="form-error" id="currency-error"></p>
          </div>
          <div class="currency-extra" id="currency-extra"></div>
        </div>
        <div>
          <span class="field-label">Bank accounts</span>
          <div class="accounts" id="accounts"></div>
          <button type="button" class="btn btn-quiet" id="add-account">Add account</button>
        </div>
        <div class="line-summary-actions">
          <button type="button" class="btn" id="cancel-business">Cancel</button>
          <button type="button" class="btn btn-primary" id="create-business">${ui.creatingBusiness ? "Create" : "Save changes"}</button>
        </div>
      </form>
      <div class="actions">
        <button type="button" class="btn" id="export">Export backup</button>
        <label class="btn file-row">Import backup<input id="import" type="file" accept="application/json" hidden /></label>
      </div>
    </div>
  `;
  const slot = main.querySelector("#business-slot");
  const form = main.querySelector("#business-form");
  if (slot && form) {
    form.hidden = false;
    slot.append(form);
  }
  if (!Array.isArray(data.business.accounts)) data.business.accounts = [];
  if (!Array.isArray(data.business.extraCurrencies)) data.business.extraCurrencies = [];
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", (event) => {
    const field = event.target.dataset.business;
    const accountField = event.target.dataset.accountField;
    if (accountField) {
      const account = data.business.accounts.find((entry) => entry.id === event.target.dataset.accountId);
      if (account) account[accountField] = event.target.value;
      save();
      return;
    }
    if (!field) return;
    if (field === "taxRate") data.business[field] = Number(event.target.value);
    else if (field === "dateFormat") data.business.dateFormat = knownDateFormat(event.target.value);
    else if (field === "numberLength") {
      const length = Math.round(Number(event.target.value));
      if (Number.isFinite(length) && length >= 1) data.business.numberLength = Math.min(12, length);
    } else data.business[field] = event.target.value;
    const add = main.querySelector("#add-business");
    if (add) add.hidden = !data.businesses.some(businessHasData);
    save();
    paintNumberPreview();
  });
  main.querySelector('[data-business="numberLength"]').addEventListener("blur", (event) => {
    event.target.value = String(numberLength());
    paintNumberPreview();
  });
  const nextNumberInput = main.querySelector("#next-number");
  nextNumberInput.addEventListener("input", () => {
    const value = Math.round(Number(nextNumberInput.value));
    if (!Number.isFinite(value) || value < 1) return;
    rememberNextNumber(value, data.business);
    save();
    paintNumberPreview();
  });
  nextNumberInput.addEventListener("blur", () => {
    rememberNextNumber(nextNumberValue(data.business), data.business);
    nextNumberInput.value = String(data.business.nextNumber);
    save();
    paintNumberPreview();
  });
  main.querySelector("#logo-file").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    readLogo(file)
      .then((logo) => {
        data.business.logo = logo;
        save();
        render();
      })
      .catch(() => alert("That file is not an image Folio can use."));
  });
  main.querySelector("#remove-logo")?.addEventListener("click", () => {
    data.business.logo = "";
    save();
    render();
  });
  main.querySelector("#show-currency").addEventListener("click", () => {
    main.querySelector("#show-currency").hidden = true;
    main.querySelector("#currency-form").hidden = false;
    main.querySelector("#new-currency").focus();
  });
  main.querySelector("#add-currency").addEventListener("click", addCurrency);
  main.querySelector("#new-currency").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addCurrency();
  });
  paintCurrencies();
  main.querySelector("#add-account").addEventListener("click", () => {
    data.business.accounts.push(blankAccount());
    save();
    paintAccounts();
  });
  paintAccounts();
  paintNumberPreview();
  enhanceSelects(main);
  main.querySelector("#create-business")?.addEventListener("click", () => {
    if (!businessHasData(data.business)) {
      main.querySelector('[data-business="name"]')?.focus();
      return;
    }
    ui.editingBusinessId = null;
    ui.creatingBusiness = false;
    ui.businessSnapshot = null;
    save();
    render();
  });
  main.querySelector("#cancel-business")?.addEventListener("click", () => {
    if (ui.creatingBusiness) {
      data.businesses = data.businesses.filter((item) => item.id !== ui.editingBusinessId);
    } else if (ui.businessSnapshot) {
      const index = data.businesses.findIndex((item) => item.id === ui.businessSnapshot.id);
      if (index >= 0) data.businesses[index] = ui.businessSnapshot;
      if (data.business?.id === ui.businessSnapshot.id) {
        data.business = ui.businessSnapshot;
        data.nextNumber = ui.businessSnapshot.nextNumber;
      }
    }
    ui.editingBusinessId = null;
    ui.creatingBusiness = false;
    ui.businessSnapshot = null;
    save();
    render();
  });
  main.querySelector("#add-business").addEventListener("click", () => {
    const current = businessById(ui.editingBusinessId);
    if (current && ui.creatingBusiness && !businessHasData(current)) {
      main.querySelector('[data-business="name"]')?.focus();
      return;
    }
    const created = blankBusiness();
    data.businesses.push(created);
    ui.editingBusinessId = created.id;
    ui.creatingBusiness = true;
    ui.businessSnapshot = null;
    render();
    main.querySelector('[data-business="name"]')?.focus();
  });
  main.querySelectorAll("[data-edit-business]").forEach((button) => {
    button.addEventListener("click", () => {
      const current = businessById(ui.editingBusinessId);
      if (current && ui.creatingBusiness && !businessHasData(current)) {
        data.businesses = data.businesses.filter((item) => item.id !== current.id);
      }
      const target = businessById(button.dataset.editBusiness);
      ui.businessSnapshot = target ? JSON.parse(JSON.stringify(target)) : null;
      ui.creatingBusiness = false;
      ui.editingBusinessId = button.dataset.editBusiness;
      render();
      main.querySelector('[data-business="name"]')?.focus();
    });
  });
  main.querySelectorAll("[data-remove-business]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.removeBusiness;
      data.businesses = data.businesses.filter((item) => item.id !== id);
      data.invoices.forEach((invoice) => {
        if (invoice.businessId === id) invoice.businessId = "";
      });
      if (ui.lastBusinessId === id) ui.lastBusinessId = "";
      if (ui.editingBusinessId === id) ui.editingBusinessId = null;
      if (ui.businessSnapshot?.id === id) ui.businessSnapshot = null;
      if (!data.businesses.some(businessHasData)) ui.editingBusinessId = null;
      save();
      render();
    });
  });
  main.querySelector("#export").addEventListener("click", exportBackup);
  main.querySelector("#import").addEventListener("change", importBackup);
}

function enhanceSelects(root) {
  root.querySelectorAll("select").forEach((select) => {
    const picker = document.createElement("div");
    picker.className = "picker";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "picker-value";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    const menu = document.createElement("ul");
    menu.className = "picker-menu";
    menu.hidden = true;
    menu.setAttribute("role", "listbox");
    const placeholder = () => Boolean(select.dataset.placeholder) && !select.value;
    const labelOf = () => (placeholder() ? select.dataset.placeholder : select.selectedOptions[0]?.textContent || "");
    const paintLabel = () => {
      button.textContent = labelOf();
      button.classList.toggle("picker-placeholder", placeholder());
    };
    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    [...select.options].forEach((option) => {
      if (option.hidden || (select.dataset.placeholder && option.value === "")) return;
      const item = document.createElement("li");
      const choice = document.createElement("button");
      choice.type = "button";
      choice.textContent = option.textContent;
      if (option.selected) choice.setAttribute("aria-selected", "true");
      choice.addEventListener("click", (event) => {
        event.stopPropagation();
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        menu.querySelectorAll("button").forEach((entry) => entry.removeAttribute("aria-selected"));
        choice.setAttribute("aria-selected", "true");
        paintLabel();
        close();
      });
      item.append(choice);
      menu.append(item);
    });
    paintLabel();
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!menu.hidden) {
        close();
        return;
      }
      if (!menu.childElementCount) return;
      root.querySelectorAll(".picker-menu").forEach((other) => {
        other.hidden = true;
      });
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      const bounds = button.getBoundingClientRect();
      const roomBelow = window.innerHeight - bounds.bottom;
      picker.classList.toggle("picker-up", roomBelow < 220 && bounds.top > roomBelow);
    });
    picker.append(button, menu);
    select.classList.add("picker-native");
    select.after(picker);
  });
}

function addCurrency() {
  const input = main.querySelector("#new-currency");
  const error = main.querySelector("#currency-error");
  const code = currencyCode(input?.value);
  if (!code) {
    if (error) error.textContent = "Use 2–12 letters or numbers, such as BTC.";
    return;
  }
  if (!knownCurrency(code) && !extraCurrencies().includes(code)) data.business.extraCurrencies.push(code);
  data.business.currency = code;
  save();
  render();
}

function paintCurrencies() {
  const box = main.querySelector("#currency-extra");
  if (!box) return;
  const custom = extraCurrencies().filter((code) => !knownCurrency(code));
  box.innerHTML = custom
    .map(
      (code) => `
      <span class="currency-chip">
        ${esc(code)}
        <button type="button" class="icon-btn" data-remove-currency="${esc(code)}" aria-label="Remove ${esc(code)}">×</button>
      </span>`
    )
    .join("");
  box.querySelectorAll("[data-remove-currency]").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.dataset.removeCurrency;
      data.business.extraCurrencies = extraCurrencies().filter((item) => item !== code);
      if (data.business.currency === code) data.business.currency = "EUR";
      save();
      render();
    });
  });
}

function readLogo(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("unreadable"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("not an image"));
      image.onload = () => {
        const scale = Math.min(1, 480 / Math.max(image.width, image.height, 1));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        const png = file.type === "image/png" || file.type === "image/webp" || file.type === "image/gif";
        const logo = logoSrc(canvas.toDataURL(png ? "image/png" : "image/jpeg", 0.85));
        if (!logo) reject(new Error("unusable"));
        else resolve(logo);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function paintAccounts() {
  const box = main.querySelector("#accounts");
  if (!box) return;
  const accounts = data.business.accounts || [];
  box.innerHTML = accounts
    .map(
      (account) => `
      <div class="account">
        <label><span>Bank</span><input data-account-id="${account.id}" data-account-field="bank" type="text" value="${esc(account.bank)}" /></label>
        <label><span>Account</span><input data-account-id="${account.id}" data-account-field="account" type="text" value="${esc(account.account)}" /></label>
        <label><span>BIC</span><input data-account-id="${account.id}" data-account-field="bic" type="text" value="${esc(account.bic)}" /></label>
        <button type="button" class="btn btn-danger" data-remove-account="${account.id}">Remove</button>
      </div>`
    )
    .join("");
  box.querySelectorAll("[data-remove-account]").forEach((button) => {
    button.addEventListener("click", () => {
      data.business.accounts = data.business.accounts.filter((account) => account.id !== button.dataset.removeAccount);
      save();
      paintAccounts();
    });
  });
}

async function exportBackup() {
  const bridge = window.webkit?.messageHandlers?.folio;
  if (bridge) {
    bridge.postMessage({ type: "export", desk: data });
    return;
  }
  if (window.__FOLIO_WIN__ && window.pywebview?.api?.export) {
    const error = await window.pywebview.api.export(data);
    if (error) alert(error);
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "folio-backup.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const next = JSON.parse(String(reader.result));
      if (!next || !Array.isArray(next.invoices) || !Array.isArray(next.clients) || (!next.business && !Array.isArray(next.businesses))) {
        throw new Error("Unrecognized backup");
      }
      if (!confirm("Replace the invoices on this computer with the backup?")) return;
      const merged = prepareDesk({
        business: next.business || {},
        businesses: next.businesses,
        clients: next.clients,
        invoices: next.invoices,
        nextNumber: next.nextNumber,
      });
      ui.editingBusinessId = null;
      ui.creatingBusiness = false;
      ui.businessSnapshot = null;
      dropPendingInvoice();
      ui.lastBusinessId =
        merged.invoices.find((invoice) => merged.businesses.some((business) => business.id && business.id === invoice.businessId))
          ?.businessId || "";
      Object.assign(data, {
        business: merged.business,
        businesses: merged.businesses,
        clients: merged.clients,
        invoices: merged.invoices,
        nextNumber: merged.nextNumber,
      });
      save();
      render();
    } catch {
      alert("That file is not a Folio backup.");
    }
  };
  reader.readAsText(file);
}
