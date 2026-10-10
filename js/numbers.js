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
