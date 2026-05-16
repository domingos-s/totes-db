const STORAGE_KEY = "totes-db-records-v1";
const APP_URL_BASE = `${location.origin}${location.pathname}`;

const state = {
  totes: [],
  editingId: null,
  deferredPrompt: null,
};

const $ = (id) => document.getElementById(id);

const els = {
  installBtn: $("installBtn"),
  newToteBtn: $("newToteBtn"),
  emptyNewToteBtn: $("emptyNewToteBtn"),
  printLabelsBtn: $("printLabelsBtn"),
  exportBtn: $("exportBtn"),
  importInput: $("importInput"),
  searchInput: $("searchInput"),
  seasonFilter: $("seasonFilter"),
  toteGrid: $("toteGrid"),
  emptyState: $("emptyState"),
  toteDialog: $("toteDialog"),
  toteForm: $("toteForm"),
  dialogTitle: $("dialogTitle"),
  closeDialogBtn: $("closeDialogBtn"),
  cancelBtn: $("cancelBtn"),
  deleteBtn: $("deleteBtn"),
  recordId: $("recordId"),
  qrCode: $("qrCode"),
  title: $("title"),
  contents: $("contents"),
  season: $("season"),
  printArea: $("printArea"),
};

function uid() {
  const segment = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TOTE-${segment()}-${segment()}`;
}

function load() {
  try {
    state.totes = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    state.totes = [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.totes));
}

function qrPayload(qrCode) {
  const url = new URL(APP_URL_BASE);
  url.hash = `tote=${encodeURIComponent(qrCode)}`;
  return url.toString();
}

async function renderQRCode(target, payload, width = 160) {
  if (!window.QRCode?.toCanvas) {
    throw new Error("QR code generator failed to load.");
  }

  await QRCode.toCanvas(target, payload, {
    width,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {
      dark: "#0f172a",
      light: "#ffffff",
    },
  });
}

function filteredTotes() {
  const q = els.searchInput.value.trim().toLowerCase();
  const season = els.seasonFilter.value;

  return state.totes.filter((tote) => {
    const matchesSeason = !season || tote.season === season;
    const haystack = `${tote.qrCode} ${tote.title} ${tote.contents} ${tote.season}`.toLowerCase();
    const matchesQuery = !q || haystack.includes(q);
    return matchesSeason && matchesQuery;
  });
}

async function render() {
  const totes = filteredTotes().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  els.emptyState.classList.toggle("hidden", state.totes.length > 0);
  els.toteGrid.innerHTML = "";

  for (const tote of totes) {
    const card = document.createElement("article");
    card.className = "tote-card card";
    card.innerHTML = `
      <header>
        <h3>${escapeHtml(tote.title)}</h3>
        <span class="badge">${escapeHtml(tote.season)}</span>
      </header>
      <div class="qr-wrap">
        <canvas aria-label="QR code for ${escapeHtml(tote.title)}"></canvas>
        <div>
          <div class="qr-id">${escapeHtml(tote.qrCode)}</div>
          <div class="qr-id">Scan opens this record</div>
        </div>
      </div>
      <div class="contents">${escapeHtml(tote.contents)}</div>
      <div class="card-actions">
        <button class="secondary" data-action="edit" data-id="${tote.id}">Edit</button>
        <button data-action="print-one" data-id="${tote.id}">Print</button>
        <button class="secondary" data-action="download-qr" data-id="${tote.id}">Download QR</button>
      </div>
    `;
    els.toteGrid.appendChild(card);
    try {
      await renderQRCode(card.querySelector("canvas"), qrPayload(tote.qrCode), 120);
    } catch (error) {
      console.warn(error);
    }
  }
}

function escapeHtml(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function openNewDialog() {
  state.editingId = null;
  els.dialogTitle.textContent = "New tote";
  els.deleteBtn.classList.add("hidden");
  els.recordId.value = "";
  els.qrCode.value = uid();
  els.title.value = "";
  els.contents.value = "";
  els.season.value = "";
  els.toteDialog.showModal();
  els.title.focus();
}

function openEditDialog(id) {
  const tote = state.totes.find((t) => t.id === id);
  if (!tote) return;

  state.editingId = id;
  els.dialogTitle.textContent = "Edit tote";
  els.deleteBtn.classList.remove("hidden");
  els.recordId.value = tote.id;
  els.qrCode.value = tote.qrCode;
  els.title.value = tote.title;
  els.contents.value = tote.contents;
  els.season.value = tote.season;
  els.toteDialog.showModal();
  els.title.focus();
}

function closeDialog() {
  els.toteDialog.close();
}

function upsertFromForm() {
  const now = new Date().toISOString();
  const existing = state.totes.find((t) => t.id === state.editingId);

  const record = {
    id: existing?.id || crypto.randomUUID(),
    qrCode: els.qrCode.value,
    title: els.title.value.trim(),
    contents: els.contents.value.trim(),
    season: els.season.value,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (!record.title || !record.contents || !record.season) return;

  if (existing) {
    Object.assign(existing, record);
  } else {
    state.totes.push(record);
  }

  save();
  closeDialog();
  render();
}

function deleteCurrent() {
  if (!state.editingId) return;
  const tote = state.totes.find((t) => t.id === state.editingId);
  const ok = confirm(`Delete "${tote?.title || "this tote"}"?`);
  if (!ok) return;

  state.totes = state.totes.filter((t) => t.id !== state.editingId);
  save();
  closeDialog();
  render();
}

async function printLabels(totes = state.totes) {
  if (!totes.length) {
    alert("Add at least one tote before printing labels.");
    return;
  }

  els.printArea.innerHTML = "";

  for (const tote of totes) {
    const label = document.createElement("article");
    label.className = "print-label";
    label.innerHTML = `
      <canvas></canvas>
      <div>
        <div class="print-title">${escapeHtml(tote.title)}</div>
        <div class="print-season">Season: ${escapeHtml(tote.season)}</div>
        <div class="print-code">${escapeHtml(tote.qrCode)}</div>
        <div class="print-contents">${escapeHtml(tote.contents)}</div>
      </div>
    `;
    els.printArea.appendChild(label);
    try {
      await renderQRCode(label.querySelector("canvas"), qrPayload(tote.qrCode), 180);
    } catch (error) {
      console.warn(error);
      alert("QR code generator failed to load. Check your internet connection and refresh.");
      return;
    }
  }

  window.print();
}


async function downloadQRCode(tote) {
  const canvas = document.createElement("canvas");
  try {
    await renderQRCode(canvas, qrPayload(tote.qrCode), 512);
  } catch (error) {
    console.warn(error);
    alert("QR code generator failed to load. Check your internet connection and refresh.");
    return;
  }

  const a = document.createElement("a");
  a.href = canvas.toDataURL("image/png");
  a.download = `${tote.qrCode}.png`;
  a.click();
}

function exportJson() {
  const blob = new Blob([JSON.stringify(state.totes, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `totes-db-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJson(file) {
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!Array.isArray(imported)) throw new Error("Invalid file.");

    const normalized = imported.map((item) => ({
      id: item.id || crypto.randomUUID(),
      qrCode: item.qrCode || uid(),
      title: String(item.title || "").trim(),
      contents: String(item.contents || "").trim(),
      season: item.season || "Year-round",
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).filter((item) => item.title && item.contents);

    const ok = confirm(`Import ${normalized.length} tote records? This will merge with your current records.`);
    if (!ok) return;

    const byQr = new Map(state.totes.map((t) => [t.qrCode, t]));
    for (const item of normalized) byQr.set(item.qrCode, item);
    state.totes = Array.from(byQr.values());
    save();
    render();
  } catch (error) {
    alert("Could not import that JSON file.");
  } finally {
    els.importInput.value = "";
  }
}

function openFromHash() {
  const match = location.hash.match(/tote=([^&]+)/);
  if (!match) return;

  const code = decodeURIComponent(match[1]);
  const tote = state.totes.find((t) => t.qrCode === code);
  if (tote) {
    openEditDialog(tote.id);
  } else {
    alert(`No local record found for QR code: ${code}`);
  }
}

function bindEvents() {
  els.newToteBtn.addEventListener("click", openNewDialog);
  els.emptyNewToteBtn.addEventListener("click", openNewDialog);
  els.closeDialogBtn.addEventListener("click", closeDialog);
  els.cancelBtn.addEventListener("click", closeDialog);
  els.deleteBtn.addEventListener("click", deleteCurrent);
  els.printLabelsBtn.addEventListener("click", () => printLabels(state.totes));
  els.exportBtn.addEventListener("click", exportJson);
  els.importInput.addEventListener("change", (e) => importJson(e.target.files?.[0]));
  els.searchInput.addEventListener("input", render);
  els.seasonFilter.addEventListener("change", render);

  els.toteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    upsertFromForm();
  });

  els.toteGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const id = btn.dataset.id;
    if (btn.dataset.action === "edit") openEditDialog(id);
    if (btn.dataset.action === "print-one") {
      const tote = state.totes.find((t) => t.id === id);
      if (tote) printLabels([tote]);
    }
    if (btn.dataset.action === "download-qr") {
      const tote = state.totes.find((t) => t.id === id);
      if (tote) downloadQRCode(tote);
    }
  });

  window.addEventListener("hashchange", openFromHash);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferredPrompt = e;
    els.installBtn.classList.remove("hidden");
  });

  els.installBtn.addEventListener("click", async () => {
    if (!state.deferredPrompt) return;
    state.deferredPrompt.prompt();
    await state.deferredPrompt.userChoice;
    state.deferredPrompt = null;
    els.installBtn.classList.add("hidden");
  });
}

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register("./service-worker.js");
    } catch (error) {
      console.warn("Service worker registration failed", error);
    }
  }
}

load();
bindEvents();
render().then(openFromHash);
registerServiceWorker();
