const STORAGE_KEY = "totes-db-records-v1";
const APP_URL_BASE = `${location.origin}${location.pathname}`;

const state = {
  totes: [],
  editingId: null,
  dialogGeo: null,
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
  latitude: $("latitude"),
  longitude: $("longitude"),
  captureLocationBtn: $("captureLocationBtn"),
  locationHelp: $("locationHelp"),
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

function normalizeGeo(value) {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat);
  const lng = Number(value.lng);
  const accuracy = Number(value.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) return null;

  return {
    lat,
    lng,
    accuracy,
    capturedAt: value.capturedAt || new Date().toISOString(),
  };
}

function updateGeoReadout() {
  if (!state.dialogGeo) {
    els.geoReadout.textContent = "No GPS fix captured.";
    return;
  }

  const { lat, lng, accuracy, capturedAt } = state.dialogGeo;
  const captured = new Date(capturedAt).toLocaleString();
  els.geoReadout.textContent = `GPS captured: ${lat.toFixed(6)}, ${lng.toFixed(6)} (±${Math.round(accuracy)}m) at ${captured}`;
}

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

function findMatchingTote(scannedText) {
  try {
    const url = new URL(scannedText);
    const code = url.hash.match(/tote=([^&]+)/)?.[1];
    if (code) return state.totes.find((t) => t.qrCode === decodeURIComponent(code));
  } catch {
    // Not a URL, treat as raw tote code.
  }
  return state.totes.find((t) => t.qrCode === scannedText);
}

async function startScanner() {
  if (!("mediaDevices" in navigator) || !navigator.mediaDevices.getUserMedia) {
    await showModalMessage({ title: "Camera unavailable", message: "Your browser does not support camera scanning." });
    return;
  }

  const supportsBarcodeDetector = "BarcodeDetector" in window;
  const supportsJsQr = typeof window.jsQR === "function";
  if (!supportsBarcodeDetector && !supportsJsQr) {
    await showModalMessage({ title: "Scanner unavailable", message: "QR scanning is unavailable. Please update your browser or use a different one." });
    return;
  }

  const detector = supportsBarcodeDetector ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });

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
        let scannedText = null;

        if (detector) {
          const barcodes = await detector.detect(els.scannerVideo);
          scannedText = barcodes.find((code) => code.rawValue)?.rawValue || null;
        } else if (context && els.scannerVideo.videoWidth && els.scannerVideo.videoHeight) {
          canvas.width = els.scannerVideo.videoWidth;
          canvas.height = els.scannerVideo.videoHeight;
          context.drawImage(els.scannerVideo, 0, 0, canvas.width, canvas.height);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          scannedText = window.jsQR(imageData.data, imageData.width, imageData.height)?.data || null;
        }

        if (!scannedText) return;

        const matched = findMatchingTote(scannedText);
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
  els.latitude.value = "";
  els.longitude.value = "";
  els.locationHelp.textContent = "Optional: type a location label or capture GPS. You can update this later when editing.";
  els.season.value = "";
  state.dialogGeo = null;
  updateGeoReadout();
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
  els.latitude.value = tote.latitude == null ? "" : String(tote.latitude);
  els.longitude.value = tote.longitude == null ? "" : String(tote.longitude);
  els.locationHelp.textContent = "Optional: type a location label or capture GPS. You can update this later when editing.";
  els.season.value = tote.season;
  state.dialogGeo = normalizeGeo(tote.geo);
  updateGeoReadout();
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
    latitude: parseCoordinate(els.latitude.value),
    longitude: parseCoordinate(els.longitude.value),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  const hasGeo = Number.isFinite(record.latitude) && Number.isFinite(record.longitude);
  if (!record.title || !record.contents || !record.season || (!record.location && !hasGeo)) return;
  if (!record.location && hasGeo) record.location = "GPS captured";

  if (existing) {
    Object.assign(existing, record);
  } else {
    state.totes.push(record);
  }

  save();
  closeDialog();
  render();
}

function parseCoordinate(value) {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function captureLocation() {
  if (!("geolocation" in navigator)) {
    await showModalMessage({ title: "Location unavailable", message: "Geolocation is not supported in this browser." });
    return;
  }

  const original = els.captureLocationBtn.textContent;
  els.captureLocationBtn.disabled = true;
  els.captureLocationBtn.textContent = "Capturing…";

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
    });
    els.latitude.value = String(position.coords.latitude);
    els.longitude.value = String(position.coords.longitude);
    if (!els.location.value.trim()) {
      els.location.value = "GPS captured";
    }
    els.locationHelp.textContent = "GPS captured. You can keep this label or replace it with your own location text.";
  } catch {
    await showModalMessage({ title: "Location capture failed", message: "Unable to capture GPS location. Check location permission and try again." });
  } finally {
    els.captureLocationBtn.disabled = false;
    els.captureLocationBtn.textContent = original;
  }
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
      latitude: parseCoordinate(item.latitude),
      longitude: parseCoordinate(item.longitude),
      createdAt: item.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      geo: normalizeGeo(item.geo),
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

async function captureCurrentLocation() {
  if (!("geolocation" in navigator)) {
    await showModalMessage({
      title: "Location unavailable",
      message: "This browser does not support location capture. Enter location text manually instead.",
    });
    return;
  }

  const position = await new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    });
  }).catch((error) => error);

  if (position && typeof position.code === "number") {
    const code = position.code;
    const msg = code === 1
      ? "Location permission was denied. Allow location access in browser settings, then tap \"Use current location\" again."
      : code === 2
        ? "Your position could not be determined. Move to an area with better signal, then try again."
        : "Location request timed out. Try again, or enter location text manually.";
    await showModalMessage({ title: "Location not captured", message: msg });
    return;
  }

  if (!position?.coords) {
    await showModalMessage({ title: "Location error", message: "Unexpected location response. Please try again." });
    return;
  }

  state.dialogGeo = {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy,
    capturedAt: new Date().toISOString(),
  };
  updateGeoReadout();
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
  els.captureLocationBtn.addEventListener("click", captureLocation);

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
