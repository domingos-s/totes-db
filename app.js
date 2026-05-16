const STORAGE_KEY = "totes-db-records-v1";
const APP_URL_BASE = `${location.origin}${location.pathname}`;

const state = {
  totes: [],
  editingId: null,
  deferredPrompt: null,
  modalResolver: null,
  scannerStream: null,
  scannerInterval: null,
};

const $ = (id) => document.getElementById(id);

const els = {
  installBtn: $("installBtn"),
  newToteBtn: $("newToteBtn"),
  emptyNewToteBtn: $("emptyNewToteBtn"),
  printLabelsBtn: $("printLabelsBtn"),
  scanQrBtn: $("scanQrBtn"),
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
  location: $("location"),
  messageDialog: $("messageDialog"),
  messageTitle: $("messageTitle"),
  messageBody: $("messageBody"),
  messageForm: $("messageForm"),
  messageOkBtn: $("messageOkBtn"),
  messageCancelBtn: $("messageCancelBtn"),
  scannerDialog: $("scannerDialog"),
  scannerForm: $("scannerForm"),
  closeScannerBtn: $("closeScannerBtn"),
  scannerCancelBtn: $("scannerCancelBtn"),
  scannerVideo: $("scannerVideo"),
  scannerStatus: $("scannerStatus"),
  printArea: $("printArea"),
};

function showModalMessage({ title = "Notice", message = "", showCancel = false, okLabel = "OK", cancelLabel = "Cancel" }) {
  els.messageTitle.textContent = title;
  els.messageBody.textContent = message;
  els.messageOkBtn.textContent = okLabel;
  els.messageCancelBtn.textContent = cancelLabel;
  els.messageCancelBtn.classList.toggle("hidden", !showCancel);

  return new Promise((resolve) => {
    state.modalResolver = resolve;
    els.messageDialog.showModal();
  });
}

function resolveModal(value) {
  if (state.modalResolver) state.modalResolver(value);
  state.modalResolver = null;
  els.messageDialog.close();
}


function stopScanner() {
  if (state.scannerInterval) {
    clearInterval(state.scannerInterval);
    state.scannerInterval = null;
  }
  if (state.scannerStream) {
    state.scannerStream.getTracks().forEach((track) => track.stop());
    state.scannerStream = null;
  }
  els.scannerVideo.srcObject = null;
  if (els.scannerDialog.open) els.scannerDialog.close();
}

async function startScanner() {
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    await showModalMessage({ title: "Camera unavailable", message: "Your browser does not support camera scanning." });
    return;
  }
  if (!("BarcodeDetector" in window)) {
    await showModalMessage({ title: "Scanner unavailable", message: "QR scanning is not supported in this browser yet. Please open the app on a newer mobile browser." });
    return;
  }

  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  els.scannerStatus.textContent = "Starting camera…";
  els.scannerDialog.showModal();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    state.scannerStream = stream;
    els.scannerVideo.srcObject = stream;
    await els.scannerVideo.play();
    els.scannerStatus.textContent = "Scanning…";

    state.scannerInterval = setInterval(async () => {
      if (!els.scannerDialog.open) return;
      try {
        const barcodes = await detector.detect(els.scannerVideo);
        const qr = barcodes.find((code) => code.rawValue);
        if (!qr) return;

        const scannedText = qr.rawValue;
        let matched = null;

        try {
          const url = new URL(scannedText);
          const code = url.hash.match(/tote=([^&]+)/)?.[1];
          if (code) matched = state.totes.find((t) => t.qrCode === decodeURIComponent(code));
        } catch {
          matched = state.totes.find((t) => t.qrCode === scannedText);
        }

        if (matched) {
          stopScanner();
          openEditDialog(matched.id);
          return;
        }

        els.scannerStatus.textContent = "QR scanned, but no matching local tote record found.";
      } catch {
        els.scannerStatus.textContent = "Scanning…";
      }
    }, 500);
  } catch (error) {
    stopScanner();
    await showModalMessage({ title: "Camera error", message: "Unable to access the camera. Check camera permission and try again." });
  }
}

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
  const size = Math.max(64, Number(width) || 160);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(payload)}`;

  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error("QR code generator failed to load."));
    image.src = qrUrl;
  });

  target.width = size;
  target.height = size;
  const ctx = target.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
}


function filteredTotes() {
  const q = els.searchInput.value.trim().toLowerCase();
  const season = els.seasonFilter.value;

  return state.totes.filter((tote) => {
    const matchesSeason = !season || tote.season === season;
    const haystack = `${tote.qrCode} ${tote.title} ${tote.contents} ${tote.location || ""} ${tote.season}`.toLowerCase();
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
      <div class="qr-id">Location: ${escapeHtml(tote.location || "Unspecified")}</div>
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
  els.location.value = "";
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
  els.location.value = tote.location || "";
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
    location: els.location.value.trim(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  if (!record.title || !record.contents || !record.season || !record.location) return;

  if (existing) {
    Object.assign(existing, record);
  } else {
    state.totes.push(record);
  }

  save();
  closeDialog();
  render();
}

async function deleteCurrent() {
  if (!state.editingId) return;
  const tote = state.totes.find((t) => t.id === state.editingId);
  const ok = await showModalMessage({ title: "Delete tote", message: `Delete "${tote?.title || "this tote"}"?`, showCancel: true, okLabel: "Delete" });
  if (!ok) return;

  state.totes = state.totes.filter((t) => t.id !== state.editingId);
  save();
  closeDialog();
  render();
}

async function printLabels(totes = state.totes) {
  if (!totes.length) {
    await showModalMessage({ title: "No totes", message: "Add at least one tote before printing labels." });
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
        <div class="print-season">Location: ${escapeHtml(tote.location || "Unspecified")}</div>
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
      await showModalMessage({ title: "QR unavailable", message: "QR code generator failed to load. Check your internet connection and refresh." });
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
    await showModalMessage({ title: "QR unavailable", message: "QR code generator failed to load. Check your internet connection and refresh." });
    return;
  }

  const a = document.createElement("a");
  try {
    a.href = canvas.toDataURL("image/png");
  } catch {
    a.href = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&format=png&data=${encodeURIComponent(qrPayload(tote.qrCode))}`;
  }
  a.download = `${tote.qrCode}.png`;
  a.rel = "noopener";
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
      location: String(item.location || "").trim() || "Unspecified",
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })).filter((item) => item.title && item.contents);

    const ok = await showModalMessage({ title: "Import records", message: `Import ${normalized.length} tote records? This will merge with your current records.`, showCancel: true, okLabel: "Import" });
    if (!ok) return;

    const byQr = new Map(state.totes.map((t) => [t.qrCode, t]));
    for (const item of normalized) byQr.set(item.qrCode, item);
    state.totes = Array.from(byQr.values());
    save();
    render();
  } catch (error) {
    await showModalMessage({ title: "Import failed", message: "Could not import that JSON file." });
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
    showModalMessage({ title: "Record not found", message: `No local record found for QR code: ${code}` });
  }
}

function bindEvents() {
  els.newToteBtn.addEventListener("click", openNewDialog);
  els.emptyNewToteBtn.addEventListener("click", openNewDialog);
  els.closeDialogBtn.addEventListener("click", closeDialog);
  els.cancelBtn.addEventListener("click", closeDialog);
  els.messageOkBtn.addEventListener("click", (e) => { e.preventDefault(); resolveModal(true); });
  els.messageCancelBtn.addEventListener("click", (e) => { e.preventDefault(); resolveModal(false); });
  els.messageDialog.addEventListener("cancel", (e) => { e.preventDefault(); resolveModal(false); });
  els.deleteBtn.addEventListener("click", () => { deleteCurrent(); });
  els.scanQrBtn.addEventListener("click", startScanner);
  els.closeScannerBtn.addEventListener("click", stopScanner);
  els.scannerCancelBtn.addEventListener("click", stopScanner);
  els.scannerDialog.addEventListener("cancel", (e) => { e.preventDefault(); stopScanner(); });
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
