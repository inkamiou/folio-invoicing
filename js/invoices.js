function lastPickedBusinessId() {
  if (businessById(ui.lastBusinessId)) return ui.lastBusinessId;
  const recent = data.invoices.find((invoice) => businessById(invoice.businessId));
  return recent?.businessId || "";
}

function createInvoice() {
  discardUnsavedClient();
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
    clientId: data.clients.find(clientHasName)?.id || "",
    issueDate: today(),
    dueDate: plusDays(14),
    status: "draft",
    type: "invoice",
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
    ${ui.sendNote ? `<p class="send-note" role="status">${esc(ui.sendNote)}</p>` : ""}
    <div class="filters" role="group" aria-label="Filter invoices">
      ${["all", "draft", "sent", "paid", "overdue", "cancelled"]
        .map(
          (filter) =>
            `<button type="button" class="chip" data-filter="${filter}" aria-pressed="${ui.filter === filter}">${filter}</button>`
        )
        .join("")}
    </div>
    ${businessFilters()}
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
            <th class="row-actions">Actions</th>
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
  main.querySelectorAll("[data-business-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.businessFilter = button.dataset.businessFilter;
      main.querySelectorAll("[data-business-filter]").forEach((chip) => {
        chip.setAttribute("aria-pressed", chip.dataset.businessFilter === ui.businessFilter);
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

function businessFilters() {
  const businesses = data.businesses.filter(businessHasData);
  if (!businesses.length) return "";
  if (ui.businessFilter && !businesses.some((business) => business.id === ui.businessFilter)) ui.businessFilter = "";
  const chips = [
    `<button type="button" class="chip" data-business-filter="" aria-pressed="${ui.businessFilter ? "false" : "true"}">All businesses</button>`,
    ...businesses.map(
      (business) =>
        `<button type="button" class="chip" data-business-filter="${esc(business.id)}" aria-pressed="${ui.businessFilter === business.id ? "true" : "false"}">${esc(business.name || "Business")}</button>`
    ),
  ];
  return `<div class="filters" role="group" aria-label="Filter by business">${chips.join("")}</div>`;
}

function visibleInvoices() {
  const query = ui.query.trim().toLowerCase();
  return data.invoices.filter((invoice) => {
    if (ui.businessFilter && invoice.businessId !== ui.businessFilter) return false;
    if (ui.filter === "sent" && invoice.status !== "sent") return false;
    if (ui.filter !== "all" && ui.filter !== "sent" && statusLabel(invoice) !== ui.filter) return false;
    if (ui.fromDate && invoice.issueDate < ui.fromDate) return false;
    if (ui.toDate && invoice.issueDate > ui.toDate) return false;
    if (!query) return true;
    const client = clientById(invoice.clientId);
    const kind = invoiceType(invoice) === "expense" ? "expense reimbursement" : "";
    return [invoice.number, client?.name, client?.email, kind].join(" ").toLowerCase().includes(query);
  });
}

function sendIcon() {
  return `<svg class="row-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1.8 8.2 14.2 2.2 9.2 14.2 7.6 8.8 1.8 8.2Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7.6 8.8 14.2 2.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
}

function invoiceActions(invoice) {
  return `<div class="row-action-bar"><button type="button" class="btn btn-row" data-send="${esc(invoice.id)}" aria-label="Send email" title="Send email">${sendIcon()}</button></div>`;
}

async function sendInvoice(id) {
  const invoice = data.invoices.find((item) => item.id === id);
  if (!invoice) return;
  const problems = invoiceProblems(invoice);
  if (problems.length) {
    alert(problems[0]);
    return;
  }
  const client = clientById(invoice.clientId);
  const email = String(client?.email || "").trim();
  if (!email) {
    alert("Add an email address for this client before sending.");
    return;
  }
  const supplier = businessFor(invoice);
  const previous = data.business;
  if (supplier) data.business = supplier;
  let total = "";
  try {
    total = money(invoice.status === "cancelled" ? 0 : totals(invoice).total);
  } finally {
    data.business = previous;
  }
  const lines = [`Hello${client?.name ? ` ${client.name}` : ""},`, ""];
  lines.push(`Please find invoice ${invoice.number} for ${total}.`);
  if (invoice.issueDate) lines.push(`Issued ${formatDate(invoice.issueDate, invoice.dateFormat)}.`);
  if (invoice.dueDate) lines.push(`Due ${formatDate(invoice.dueDate, invoice.dateFormat)}.`);
  lines.push("", supplier?.name || "Folio");
  const subject = `Invoice ${invoice.number}`;
  const body = lines.join("\n");
  const wasDraft = invoice.status === "draft";
  const printable = Object.assign({}, invoice, { status: wasDraft ? "sent" : invoice.status });
  const sharing = shareInvoiceFile(invoicePdfFile(printable), subject, body);
  if (sharing) {
    const shared = await sharing;
    if (shared) {
      ui.sendNote = "";
      if (wasDraft) markInvoiceSent(invoice);
      return;
    }
  }
  mountMailSheet(printable);
  const outcome = await deliverInvoiceEmail(invoice, email, subject, body);
  if (outcome === "failed") {
    clearMailSheet();
    return;
  }
  if (outcome === "browser") {
    clearMailSheet();
    openMailClient(
      `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    );
    ui.sendNote = await placeInvoicePdf(printable);
  } else ui.sendNote = "";
  if (wasDraft) markInvoiceSent(invoice);
  else render();
}

function mountMailSheet(invoice) {
  const host = document.getElementById("mail-sheet");
  if (!host) return;
  const previous = data.business;
  const supplier = businessFor(invoice);
  if (supplier) data.business = supplier;
  try {
    host.innerHTML = sheetMarkup(invoice);
  } finally {
    data.business = previous;
  }
  host.querySelector(".sheet")?.classList.add("sheet-quiet");
  document.body.classList.add("mail-print");
}

function clearMailSheet() {
  document.body.classList.remove("mail-print");
  document.getElementById("mail-sheet")?.replaceChildren();
}

async function deliverInvoiceEmail(invoice, to, subject, body) {
  const message = { type: "email", to, subject, body, number: invoice.number };
  const bridge = window.webkit?.messageHandlers?.folio;
  if (bridge) {
    bridge.postMessage(message);
    return "sent";
  }
  if (window.__FOLIO_WIN__ && window.pywebview?.api?.emailInvoice) {
    const html = document.getElementById("mail-sheet")?.innerHTML || "";
    const error = await window.pywebview.api.emailInvoice({ ...message, html });
    clearMailSheet();
    if (typeof error === "string" && error.startsWith("error:")) {
      alert(error.slice(6));
      return "failed";
    }
    if (typeof error === "string" && error.startsWith("opened:")) alert(error.slice(7));
    return "sent";
  }
  return "browser";
}

function invoiceShareName(invoice) {
  const number = String(invoice.number || "invoice").replace(/[\\/:*?"<>|]+/g, "-").trim() || "invoice";
  return `Invoice-${number}.pdf`;
}

function shareInvoiceFile(file, title, text) {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return null;
  let filesOk = false;
  try {
    filesOk = navigator.canShare({ files: [file] });
  } catch {
    filesOk = false;
  }
  if (!filesOk) return null;
  const payload = { files: [file] };
  try {
    if (navigator.canShare({ title, text, files: [file] })) {
      payload.title = title;
      payload.text = text;
    }
  } catch {
    /* This browser can share the file without the title and text. */
  }
  return navigator.share(payload).then(
    () => true,
    () => false
  );
}

function invoicePdfFile(invoice) {
  return new File([invoicePdfBytes(invoice)], invoiceShareName(invoice), { type: "application/pdf" });
}

function invoicePdfBytes(invoice) {
  const previous = data.business;
  const supplier = businessFor(invoice);
  if (supplier) data.business = supplier;
  try {
    return encodeInvoicePdf(invoicePdfRows(invoice));
  } finally {
    data.business = previous;
  }
}

function invoicePdfRows(invoice) {
  const client = clientById(invoice.clientId);
  const business = businessFor(invoice) || {};
  const lines = invoiceLines(invoice);
  const sums = totals(invoice);
  const rows = [
    { text: invoiceType(invoice) === "expense" ? "Expense" : "Invoice", size: 22, bold: true },
    { text: String(invoice.number || ""), size: 14, bold: true },
    { text: "" },
    { text: business.name || "Your business", size: 13, bold: true },
  ];
  pdfDetail(rows, [business.address, business.email, business.phone, marked("Reg. no.", business.registrationNumber), marked("Tax ID", business.taxId)]);
  rows.push({ text: "" }, { text: "Bill to", bold: true });
  if (client) pdfDetail(rows, [client.name, client.address, client.email, marked("Reg. no.", client.registrationNumber), marked("Tax ID", client.taxId)]);
  else rows.push({ text: "No client yet" });
  rows.push(
    { text: "" },
    { text: `Issued ${formatDate(invoice.issueDate, invoice.dateFormat) || "—"}` },
    { text: `Due ${formatDate(invoice.dueDate, invoice.dateFormat) || "—"}` },
    { text: "" }
  );
  if (lines.length) {
    rows.push({ text: "Lines", bold: true });
    lines.forEach((item) => {
      const detail = [item.unit, hasMark(item.qty) ? `Qty ${item.qty}` : "", hasMark(item.rate) ? money(item.rate) : "", money(lineAmount(item))]
        .filter(Boolean)
        .join("  ");
      rows.push({ text: item.description || "Item" });
      if (detail) rows.push({ text: detail });
    });
    rows.push({ text: "" });
  }
  if (sums.discount) rows.push({ text: `Discount  −${money(sums.discount)}` });
  rows.push({ text: `Subtotal  ${money(sums.subtotal)}` });
  taxRows(lines).forEach((row) => rows.push({ text: `Tax ${row.rate}%  ${money(row.amount)}` }));
  const voided = invoice.status === "cancelled";
  rows.push({ text: `Total  ${money(voided ? 0 : sums.total)}`, bold: true });
  if (invoice.status === "paid") rows.push({ text: "PAID", bold: true });
  if (voided) rows.push({ text: "Cancelled. This invoice is not payable." });
  else if (paymentTerms(invoice)) rows.push({ text: paymentTerms(invoice) });
  if (invoice.notes && !isGeneratedPaymentNote(invoice.notes)) {
    rows.push({ text: "" });
    String(invoice.notes)
      .split("\n")
      .forEach((line) => rows.push({ text: line }));
  }
  return rows.flatMap((row) => wrapPdfRow(row));
}

function pdfDetail(rows, values) {
  values.forEach((value) => {
    if (!hasMark(value)) return;
    String(value)
      .split("\n")
      .forEach((line) => rows.push({ text: line }));
  });
}

function wrapPdfRow(row) {
  const width = row.size > 16 ? 42 : 88;
  const words = String(row.text ?? "").split(/\s+/).filter(Boolean);
  if (!words.length) return [{ text: "", size: row.size || 11, bold: row.bold }];
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else current = next;
  });
  if (current) lines.push(current);
  return lines.map((text, index) => ({ text, size: row.size || 11, bold: row.bold && index === 0 }));
}

function encodeInvoicePdf(rows) {
  const pages = [];
  let commands = [];
  let y = 790;
  rows.forEach((row) => {
    const size = row.size || 11;
    const step = size + 7;
    if (y - step < 48) {
      pages.push(commands);
      commands = [];
      y = 790;
    }
    const font = row.bold ? "F2" : "F1";
    if (row.text) commands.push(`BT /${font} ${size} Tf 48 ${y.toFixed(1)} Td ${pdfLiteral(row.text)} Tj ET`);
    y -= row.text ? step : 8;
  });
  pages.push(commands);
  return pdfBytes(pages.filter((page) => page.length));
}

function pdfLiteral(value) {
  const extra = { "€": 128, "•": 149, "–": 150, "—": 151, "‘": 145, "’": 146, "“": 147, "”": 148, "−": 150 };
  let out = "";
  for (const char of String(value ?? "")) {
    const code = extra[char] || char.codePointAt(0);
    if (code > 255) {
      out += "?";
      continue;
    }
    if (code === 40 || code === 41 || code === 92) out += `\\${String.fromCharCode(code)}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(code);
  }
  return `(${out})`;
}

function pdfBytes(pages) {
  const font1 = 1;
  const font2 = 2;
  const pagesId = 3;
  const catalogId = 4;
  const bodies = new Map();
  bodies.set(font1, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  bodies.set(font2, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  bodies.set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let next = 5;
  const kids = [];
  (pages.length ? pages : [[]]).forEach((commands) => {
    const stream = `${commands.join("\n")}\n`;
    const contentId = next++;
    const pageId = next++;
    bodies.set(contentId, `<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
    bodies.set(
      pageId,
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> >>`
    );
    kids.push(pageId);
  });
  bodies.set(pagesId, `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const chunks = ["%PDF-1.4\n"];
  let cursor = chunks[0].length;
  const offsets = [0];
  const count = Math.max(...bodies.keys());
  for (let id = 1; id <= count; id += 1) {
    offsets[id] = cursor;
    const object = `${id} 0 obj\n${bodies.get(id)}\nendobj\n`;
    chunks.push(object);
    cursor += object.length;
  }
  const xrefAt = cursor;
  let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= count; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${count + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  chunks.push(xref);
  return new TextEncoder().encode(chunks.join(""));
}

function openMailClient(url) {
  const bridge = window.webkit?.messageHandlers?.folio;
  if (bridge) {
    bridge.postMessage({ type: "mailto", url });
    return;
  }
  if (window.__FOLIO_WIN__ && window.pywebview?.api?.openMail) {
    window.pywebview.api.openMail(url);
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function placeInvoicePdf(invoice) {
  const file = invoicePdfFile(invoice);
  let revealed = false;
  try {
    revealed = await revealInvoiceFolder(file, invoice.number);
  } catch {
    revealed = false;
  }
  if (revealed) return "The invoice folder is open. Attach the PDF to the message.";
  try {
    downloadInvoiceFile(file);
  } catch {
    return "Folio opened the message, but could not save the invoice PDF.";
  }
  return `${file.name} is in your Downloads folder. Attach it to the message.`;
}

async function revealInvoiceFolder(file, number) {
  const path = knownInvoicePath(file);
  if (!path) return false;
  const showInFolder = window.electron?.shell?.showItemInFolder;
  if (typeof showInFolder === "function") {
    showInFolder(path);
    return true;
  }
  const webview = window.chrome?.webview;
  const hostShell = webview?.hostObjects?.sync?.shell || webview?.hostObjects?.shell;
  const hostShow = hostShell?.showItemInFolder || hostShell?.ShowItemInFolder;
  if (typeof hostShow === "function") {
    await hostShow(path);
    return true;
  }
  if (webview && typeof webview.postMessage === "function") {
    try {
      webview.postMessage({ type: "reveal", path });
    } catch {
      /* This host cannot open the folder. Another bridge, or the download, still can. */
    }
  }
  const bridge = window.webkit?.messageHandlers?.folio;
  if (bridge) {
    bridge.postMessage({ type: "reveal", path, number });
    return true;
  }
  const reveal = window.pywebview?.api?.revealInvoice;
  if (typeof reveal === "function") {
    const result = await reveal(path);
    return result !== false && !(typeof result === "string" && result.startsWith("error:"));
  }
  return false;
}

function knownInvoicePath(file) {
  const name = file?.name || "";
  const candidates = [window.__FOLIO_INVOICE_PATH__, window.folio?.invoicePath];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate && (!name || candidate.endsWith(name))) return candidate;
  }
  return "";
}

function downloadInvoiceFile(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name || "invoice.pdf";
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function markInvoiceSent(invoice) {
  if (!invoice || invoice.status !== "draft") return false;
  const problems = invoiceProblems(invoice);
  if (problems.length) {
    alert(problems[0]);
    return false;
  }
  const supplier = businessFor(invoice);
  if (supplier) data.business = supplier;
  if (!invoice.issued) confirmNextNumber(indexFromNumber(invoice.number, supplier || data.business));
  invoice.issued = true;
  invoice.status = "sent";
  save();
  render();
  return true;
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
      const expense = invoiceType(invoice) === "expense";
      return `
        <tr class="invoice-row${voided ? " invoice-cancelled" : ""}${expense ? " invoice-expense" : ""}" data-open="${invoice.id}">
          <td class="num"><span class="num-line"><button type="button" class="row-open" data-open="${invoice.id}">${esc(invoice.number)}</button>${expense ? `<span class="kind">Expense</span>` : ""}</span></td>
          <td>${esc(client?.name || "No client")}</td>
          <td>${esc(formatDate(invoice.issueDate, invoice.dateFormat))}</td>
          <td>${esc(formatDate(invoice.dueDate, invoice.dateFormat))}</td>
          <td><span class="status status-${status}">${status}</span></td>
          <td class="amount">${money(voided ? 0 : totals(invoice).total)}</td>
          <td class="row-actions">${invoiceActions(invoice)}</td>
        </tr>
      `;
    })
    .join("");
  rows.querySelectorAll("[data-open]").forEach((row) => {
    row.addEventListener("click", () => openInvoice(row.dataset.open));
  });
  rows.querySelectorAll("[data-send]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      sendInvoice(button.dataset.send);
    });
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
