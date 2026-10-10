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
  ui.preview = false;
  ui.view = "invoices";
  document.body.classList.remove("preview-open");
  save();
  render();
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
      ${["all", "draft", "sent", "paid", "overdue", "cancelled"]
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
      const voided = invoice.status === "cancelled";
      return `
        <tr class="invoice-row${voided ? " invoice-cancelled" : ""}" data-open="${invoice.id}">
          <td class="num"><button type="button" class="row-open" data-open="${invoice.id}">${esc(invoice.number)}</button></td>
          <td>${esc(client?.name || "No client")}</td>
          <td>${esc(formatDate(invoice.issueDate, invoice.dateFormat))}</td>
          <td>${esc(formatDate(invoice.dueDate, invoice.dateFormat))}</td>
          <td><span class="status status-${status}">${status}</span></td>
          <td class="amount">${money(voided ? 0 : totals(invoice).total)}</td>
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
