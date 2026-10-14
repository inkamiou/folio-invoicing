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
  wrap.innerHTML = sheetMarkup(invoice);
  if (!animate) wrap.querySelector(".sheet")?.classList.add("sheet-quiet");
}

function sheetMarkup(invoice) {
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
      : invoice.status === "cancelled"
        ? `<div class="stamp stamp-cancelled">CANCELLED</div>`
        : invoice.status === "draft"
          ? `<div class="stamp stamp-draft">DRAFT</div>`
          : "";
  const voided = invoice.status === "cancelled";
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

  return `
    <article class="sheet">
      ${stamp}
      <header class="sheet-top">
        <div>
          ${logoSrc(business.logo) ? `<img class="sheet-logo" src="${logoSrc(business.logo)}" alt="" />` : ""}
          <p class="sheet-brand">${esc(business.name || "Your business")}</p>
          <p class="sheet-meta">${sheetText(businessLines)}</p>
        </div>
        <div>
          <p class="invoice-word">${invoiceType(invoice) === "expense" ? "Expense" : "Invoice"}</p>
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
        <div class="grand${voided ? " voided" : ""}"><span>Total</span><span>${money(sums.total)}</span></div>
        ${voided ? `<div class="grand"><span>Due</span><span>${money(0)}</span></div>` : ""}
      </div>
      ${
        voided || !accountBlocks.length
          ? ""
          : `<section class="payment"><h3>Payment</h3>${accountBlocks.map((block) => `<p>${esc(block)}</p>`).join("")}</section>`
      }
      ${voided ? `<p class="notes">Cancelled. This invoice is not payable.</p>` : paymentTerms(invoice) ? `<p class="notes">${esc(paymentTerms(invoice))}</p>` : ""}
      ${invoice.notes && !isGeneratedPaymentNote(invoice.notes) ? `<p class="notes">${esc(invoice.notes)}</p>` : ""}
    </article>
  `;
}
