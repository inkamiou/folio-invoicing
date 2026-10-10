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
    .filter(clientHasName)
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
          ${invoice.status === "draft" && !invoice.issued && !invoiceIsPending(invoice) ? `<button type="button" class="btn btn-danger" id="delete">Delete</button>` : ""}
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
    if (invoice.status !== "draft" || invoice.issued) return;
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
      <button type="button" class="btn" data-status="cancelled">Mark cancelled</button>`;
  }
  if (invoice.status === "paid") return `<button type="button" class="btn" data-status="sent">Mark unpaid</button>`;
  return "";
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
  if (!invoice || status === "draft" || invoiceIsPending(invoice) || invoice.status === "cancelled") return;
  if (status === "cancelled") {
    if (invoice.status !== "sent") return;
    if (!confirm(`Cancel ${invoice.number}? It stays on record and is no longer payable.`)) return;
    invoice.status = "cancelled";
    ui.error = "";
    save();
    render();
    return;
  }
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
