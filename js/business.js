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
