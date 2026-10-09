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
      accounts: [],
    },
    clients: [],
    invoices: [],
    nextNumber: 1,
  };
}

function deskIsBlank(desk) {
  const business = desk.business || {};
  return (
    !desk.clients?.length &&
    !desk.invoices?.length &&
    !String(business.name || "").trim() &&
    !String(business.email || "").trim() &&
    !String(business.address || "").trim() &&
    !String(business.registrationNumber || "").trim() &&
    !String(business.taxId || "").trim() &&
    !logoSrc(business.logo) &&
    !(business.accounts || []).some((account) =>
      [account.bank, account.account, account.bic].some((value) => hasMark(value))
    )
  );
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

function prepareDesk(desk) {
  if (!desk) return desk;
  adoptTaxId(desk.business);
  (desk.clients || []).forEach(adoptTaxId);
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
  note.textContent = window.webkit?.messageHandlers?.folio
    ? "Saved in the Folio database on this computer."
    : "Stored in this browser only. Open the Folio app to keep a database copy.";
}

const ui = {
  view: "invoices",
  invoiceId: null,
  filter: "all",
  query: "",
  error: "",
  editingClientId: null,
  clientQuery: "",
};

const main = document.querySelector("#main");

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    ui.view = button.dataset.nav;
    ui.error = "";
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
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.field !== "taxRate" && target.dataset.business !== "taxRate") return;
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
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  paintStats();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function uid() {
  return crypto.randomUUID();
}

function blankItem() {
  return { id: uid(), code: "", description: "", unit: "", qty: "", rate: "", discount: "" };
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

function numberLength() {
  const length = Math.round(Number(data.business.numberLength));
  if (!Number.isFinite(length)) return 3;
  return Math.min(12, Math.max(1, length));
}

function nextNumberValue() {
  const value = Math.round(Number(data.nextNumber));
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(999999999999, value);
}

function formatInvoiceNumber(index) {
  const padded = String(index).padStart(numberLength(), "0");
  const template = String(data.business.invoiceTemplate || "").trim();
  if (!template) return `INV-${new Date().getFullYear()}-${padded}`;
  if (/\{nr\}/i.test(template)) return template.replace(/\{nr\}/gi, padded);
  return `${template}${padded}`;
}

function invoiceNumberTaken(number, exceptId) {
  const key = String(number || "").trim().toLowerCase();
  if (!key) return false;
  return data.invoices.some(
    (invoice) => invoice.id !== exceptId && String(invoice.number || "").trim().toLowerCase() === key
  );
}

function paintNumberPreview() {
  const preview = main.querySelector("#number-preview");
  const error = main.querySelector("#number-error");
  const number = formatInvoiceNumber(nextNumberValue());
  if (preview) preview.textContent = `Use {nr} where the number goes. Next invoice: ${number}`;
  if (error) error.textContent = invoiceNumberTaken(number) ? "An invoice with this number already exists." : "";
}

function createInvoice() {
  data.nextNumber = nextNumberValue();
  const number = formatInvoiceNumber(data.nextNumber);
  if (invoiceNumberTaken(number)) {
    ui.view = "business";
    render();
    return null;
  }
  const invoice = {
    id: uid(),
    number,
    clientId: data.clients[0]?.id || "",
    issueDate: today(),
    dueDate: plusDays(14),
    status: "draft",
    notes: "",
    taxRate: Number(data.business.taxRate) || 0,
    items: [blankItem()],
  };
  data.nextNumber += 1;
  data.invoices.unshift(invoice);
  save();
  return invoice.id;
}

function currentInvoice() {
  return data.invoices.find((invoice) => invoice.id === ui.invoiceId) || null;
}

function clientById(id) {
  return data.clients.find((client) => client.id === id) || null;
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

function lineAmount(item) {
  const qty = Number(item.qty);
  const rate = Number(item.rate);
  if (!Number.isFinite(qty) || !Number.isFinite(rate)) return 0;
  const gross = qty * rate;
  const discount = hasMark(item.discount) ? Number(item.discount) : 0;
  const off = Number.isFinite(discount) ? gross * (discount / 100) : 0;
  return roundMoney(gross - off);
}

function totals(invoice) {
  const subtotal = roundMoney(invoice.items.reduce((sum, item) => sum + lineAmount(item), 0));
  const tax = roundMoney(subtotal * ((Number(invoice.taxRate) || 0) / 100));
  return { subtotal, tax, total: roundMoney(subtotal + tax) };
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
  paintInvoiceRows();
}

function visibleInvoices() {
  const query = ui.query.trim().toLowerCase();
  return data.invoices.filter((invoice) => {
    const status = statusLabel(invoice);
    if (ui.filter !== "all" && status !== ui.filter) return false;
    if (!query) return true;
    const client = clientById(invoice.clientId);
    return [invoice.number, client?.name, client?.email].join(" ").toLowerCase().includes(query);
  });
}

function paintInvoiceRows() {
  const rows = main.querySelector("#invoice-rows");
  const empty = main.querySelector("#invoice-empty");
  const invoices = visibleInvoices();
  rows.innerHTML = invoices
    .map((invoice) => {
      const client = clientById(invoice.clientId);
      const status = statusLabel(invoice);
      return `
        <tr class="invoice-row" data-open="${invoice.id}">
          <td class="num"><button type="button" class="row-open" data-open="${invoice.id}">${esc(invoice.number)}</button></td>
          <td>${esc(client?.name || "No client")}</td>
          <td>${esc(invoice.issueDate)}</td>
          <td>${esc(invoice.dueDate)}</td>
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
          <h2>Edit</h2>
          <span class="status status-${statusLabel(invoice)}">${statusLabel(invoice)}</span>
        </div>
        <div class="stack">
          <label><span>Number</span><input data-field="number" type="text" value="${esc(invoice.number)}" required /></label>
          <label><span>Client</span>
            <select data-field="clientId">
              <option value="">Select a client</option>
              ${clientOptions}
            </select>
          </label>
          <div class="grid-2">
            <label><span>Issued</span><input data-field="issueDate" type="date" value="${esc(invoice.issueDate)}" /></label>
            <label><span>Due</span><input data-field="dueDate" type="date" value="${esc(invoice.dueDate)}" /></label>
          </div>
          <div>
            <div class="lines" id="lines"></div>
            <button type="button" class="btn btn-quiet" id="add-line">Add line</button>
          </div>
          <label><span>Tax %</span><input data-field="taxRate" type="number" min="0" step="any" value="${esc(invoice.taxRate)}" /></label>
          <label><span>Notes</span><textarea data-field="notes">${esc(invoice.notes)}</textarea></label>
        </div>
        <p class="form-error" id="form-error">${esc(ui.error)}</p>
        <div class="actions">
          ${statusActions(invoice)}
          <button type="button" class="btn" id="print">Print</button>
          <button type="button" class="btn btn-danger" id="delete">Delete</button>
        </div>
      </form>
      <div class="sheet-wrap" id="sheet-wrap"></div>
    </div>
  `;

  paintLines();
  paintSheet({ animate: true });

  main.querySelector("#back").addEventListener("click", () => {
    ui.view = "invoices";
    render();
  });
  main.querySelector("#invoice-form").addEventListener("input", onInvoiceInput);
  main.querySelector('[data-field="number"]').addEventListener("blur", (event) => {
    if (!invoiceNumberTaken(event.target.value, invoice.id)) return;
    event.target.value = invoice.number;
    ui.error = "";
    const error = main.querySelector("#form-error");
    if (error) error.textContent = "";
  });
  main.querySelector("#add-line").addEventListener("click", () => {
    invoice.items.push(blankItem());
    save();
    paintLines();
    paintSheet();
  });
  main.querySelector("#print").addEventListener("click", () => window.print());
  main.querySelector("#delete").addEventListener("click", () => {
    if (!confirm(`Delete ${invoice.number}?`)) return;
    data.invoices = data.invoices.filter((item) => item.id !== invoice.id);
    save();
    ui.view = "invoices";
    render();
  });
  main.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => setStatus(button.dataset.status));
  });
  enhanceSelects(main);
}

function statusActions(invoice) {
  if (invoice.status === "draft") return `<button type="button" class="btn btn-primary" data-status="sent">Mark sent</button>`;
  if (invoice.status === "sent") {
    return `<button type="button" class="btn btn-primary" data-status="paid">Mark paid</button>
      <button type="button" class="btn" data-status="draft">Back to draft</button>`;
  }
  return `<button type="button" class="btn" data-status="sent">Mark unpaid</button>`;
}

function paintLines() {
  const invoice = currentInvoice();
  const lines = main.querySelector("#lines");
  if (!invoice || !lines) return;
  lines.innerHTML = invoice.items
    .map(
      (item) => `
      <div class="line">
        <label data-area="code"><span>Code</span><input data-item-id="${item.id}" data-item-field="code" type="text" aria-label="Code" value="${esc(item.code)}" /></label>
        <label data-area="description"><span>Description</span><input data-item-id="${item.id}" data-item-field="description" type="text" aria-label="Description" value="${esc(item.description)}" /></label>
        <button type="button" class="icon-btn" data-remove="${item.id}" aria-label="Remove line">×</button>
        <label data-area="unit"><span>Unit</span><input data-item-id="${item.id}" data-item-field="unit" type="text" aria-label="Unit" value="${esc(item.unit)}" /></label>
        <label data-area="qty"><span>Qty</span><input data-item-id="${item.id}" data-item-field="qty" type="number" min="0" step="any" aria-label="Qty" value="${esc(item.qty)}" /></label>
        <label data-area="rate"><span>Unit price</span><input data-item-id="${item.id}" data-item-field="rate" type="number" min="0" step="any" aria-label="Unit price" value="${esc(item.rate)}" /></label>
        <label data-area="discount"><span>Discount %</span><input data-item-id="${item.id}" data-item-field="discount" type="number" min="0" step="0.01" aria-label="Discount percent" value="${esc(item.discount)}" /></label>
      </div>`
    )
    .join("");
  lines.querySelectorAll("[data-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (invoice.items.length === 1) {
        invoice.items[0] = { ...blankItem(), id: invoice.items[0].id };
      } else {
        invoice.items = invoice.items.filter((item) => item.id !== button.dataset.remove);
      }
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
    invoice[target.dataset.field] = target.type === "number" ? Number(target.value) : target.dataset.field === "number" ? target.value.trim() : target.value;
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
  if (!data.business.name.trim()) problems.push("Add your business name first.");
  if (!invoice.clientId) problems.push("Choose a client.");
  if (!invoice.items.some((item) => item.description.trim() && lineAmount(item) > 0)) {
    problems.push("Add a line with a description and an amount.");
  }
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
  return hasMark(item[key]) ? esc(item[key]) : "";
}

function sheetLabel(label) {
  return String(label)
    .split(" ")
    .map((word) => `<span class="sheet-word">${esc(word)}</span>`)
    .join(" ");
}

function paintSheet({ animate = false } = {}) {
  const invoice = currentInvoice();
  const wrap = main.querySelector("#sheet-wrap");
  if (!invoice || !wrap) return;
  const client = clientById(invoice.clientId);
  const business = data.business;
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
    amount: 1.3,
  };
  const columns = [
    ["code", "Code"],
    ["description", "Description"],
    ["unit", "Unit"],
    ["qty", "Qty"],
    ["rate", "Unit price"],
    ["discount", "Discount"],
    ["amount", "Amount"],
  ].filter(([key]) => invoice.items.some((item) => columnHasMark(item, key)));
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
          <p class="sheet-meta">${esc(businessLines)}</p>
        </div>
        <div>
          <p class="invoice-word">Invoice</p>
          <p class="invoice-no">${esc(invoice.number)}</p>
        </div>
      </header>
      <section class="bill-row">
        <div>
          <h3>Bill to</h3>
          <p>${esc(clientLines)}</p>
        </div>
        <div>
          <h3>Dates</h3>
          <p>Issued ${esc(invoice.issueDate || "—")}
Due ${esc(invoice.dueDate || "—")}</p>
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
                  `<th class="${["qty", "rate", "discount", "amount"].includes(key) ? "amount" : ""} ${key === "qty" ? "qty" : ""}" style="width:${((columnWeight[key] / weightTotal) * 100).toFixed(2)}%">${sheetLabel(label)}</th>`
              )
              .join("")}
          </tr>
        </thead>
        <tbody>
          ${invoice.items
            .map(
              (item) => `
            <tr>
              ${columns
                .map(
                  ([key]) =>
                    `<td class="${["qty", "rate", "discount", "amount"].includes(key) ? "amount" : ""} ${key === "qty" ? "qty" : ""}">${itemCell(item, key)}</td>`
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
        <div><span>Subtotal</span><span>${money(sums.subtotal)}</span></div>
        <div><span>Tax ${esc(invoice.taxRate)}%</span><span>${money(sums.tax)}</span></div>
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
          <p>${esc(
            [
              client.email,
              client.address,
              client.registrationNumber && `Reg. no. ${client.registrationNumber}`,
              client.taxId && `Tax ID ${client.taxId}`,
            ]
              .filter(Boolean)
              .join(" · ")
          )}</p>
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

function renderBusiness() {
  const business = data.business;
  main.innerHTML = `
    <div class="panel">
      <h2>Business</h2>
      <p class="lede">This appears at the top of every invoice.</p>
      <form id="business-form" class="stack" style="margin-top:18px">
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
      </form>
      <div class="actions">
        <button type="button" class="btn" id="export">Export backup</button>
        <label class="btn file-row">Import backup<input id="import" type="file" accept="application/json" hidden /></label>
      </div>
    </div>
  `;
  if (!Array.isArray(data.business.accounts)) data.business.accounts = [];
  if (!Array.isArray(data.business.extraCurrencies)) data.business.extraCurrencies = [];
  main.querySelector("#business-form").addEventListener("submit", (event) => event.preventDefault());
  main.querySelector("#business-form").addEventListener("input", (event) => {
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
    else if (field === "numberLength") {
      const length = Math.round(Number(event.target.value));
      if (Number.isFinite(length) && length >= 1) data.business.numberLength = Math.min(12, length);
    } else data.business[field] = event.target.value;
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
    data.nextNumber = Math.min(999999999999, value);
    save();
    paintNumberPreview();
  });
  nextNumberInput.addEventListener("blur", () => {
    data.nextNumber = nextNumberValue();
    nextNumberInput.value = String(data.nextNumber);
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
    const labelOf = () => select.selectedOptions[0]?.textContent || "";
    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    [...select.options].forEach((option) => {
      const item = document.createElement("li");
      const choice = document.createElement("button");
      choice.type = "button";
      choice.textContent = option.textContent;
      if (option.selected) choice.setAttribute("aria-selected", "true");
      choice.addEventListener("click", (event) => {
        event.stopPropagation();
        select.value = option.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        button.textContent = option.textContent;
        menu.querySelectorAll("button").forEach((entry) => entry.removeAttribute("aria-selected"));
        choice.setAttribute("aria-selected", "true");
        close();
      });
      item.append(choice);
      menu.append(item);
    });
    button.textContent = labelOf();
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!menu.hidden) {
        close();
        return;
      }
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

function exportBackup() {
  const bridge = window.webkit?.messageHandlers?.folio;
  if (bridge) {
    bridge.postMessage({ type: "export", desk: data });
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
      if (!next || !Array.isArray(next.invoices) || !Array.isArray(next.clients) || !next.business) {
        throw new Error("Unrecognized backup");
      }
      if (!confirm("Replace the invoices on this computer with the backup?")) return;
      adoptTaxId(next.business);
      (next.clients || []).forEach(adoptTaxId);
      Object.assign(data, {
        business: { ...data.business, ...next.business },
        clients: next.clients,
        invoices: next.invoices,
        nextNumber: Number(next.nextNumber) || data.nextNumber,
      });
      save();
      render();
    } catch {
      alert("That file is not a Folio backup.");
    }
  };
  reader.readAsText(file);
}
