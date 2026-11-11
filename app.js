// Core Application State
let appState = {
  currentProformaId: null, // Tracks if we are editing an existing saved proforma
  rates: {
    material: 0.02,  // per gram
    time: 0.32,      // per hour
    margin: 100      // profit margin (%)
  },
  catalog: [], // Shared pieces catalog
  proforma: {
    clientName: "",
    clientAttention: "Ambar",
    clientPhone: "",
    clientAddress: "",
    clientEmail: "",
    clientOthers: "",
    paymentMethod: "Transferencia",
    deliveryDate: "",
    discount: 0,
    discountType: "fixed",
    notes: "",
    items: []
  },
  history: [],
  sales: [] // List of completed sales
};

// Utility: Escape HTML for safe rendering
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Toast Notifications System
function showToast(message, type = "success") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast-item toast-${type}`;

  let icon = "fa-circle-check";
  if (type === "info") icon = "fa-circle-info";
  if (type === "warning") icon = "fa-triangle-exclamation";
  if (type === "error") icon = "fa-circle-xmark";

  toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add("toast-show"), 10);
  setTimeout(() => {
    toast.classList.remove("toast-show");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Helper: Calculate single piece price with current rates
function calculatePiecePrice(hours, minutes, grams) {
  const h = parseFloat(hours) || 0;
  const m = parseFloat(minutes) || 0;
  const g = parseFloat(grams) || 0;
  const totalHours = h + (m / 60);
  const timeCost = totalHours * (appState.rates?.time || 0.32);
  const materialCost = g * (appState.rates?.material || 0.02);
  const prodCost = timeCost + materialCost;
  return prodCost * (1 + ((appState.rates?.margin || 100) / 100));
}

// Update Active Proforma Status Pill (New vs Editing)
function updateProformaStatusBadge() {
  const badge = document.getElementById("proforma-mode-badge");
  const btnNew = document.getElementById("btn-start-new-proforma");
  const saveBtn = document.getElementById("save-proforma-btn");
  const saveAsNewBtn = document.getElementById("save-as-new-proforma-btn");

  if (appState.currentProformaId) {
    const existing = appState.history.find(h => h.id === appState.currentProformaId);
    const clientName = existing?.client_name || appState.proforma.clientName || "Guardada";
    if (badge) {
      badge.className = "mode-badge editing-mode";
      badge.innerHTML = `<i class="fa-solid fa-pen-to-square"></i> Editando: <strong>${escapeHtml(clientName)}</strong>`;
    }
    if (btnNew) btnNew.classList.remove("hidden");
    if (saveBtn) {
      saveBtn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Actualizar Proforma`;
      saveBtn.title = `Guarda los cambios en la proforma guardada de ${clientName}`;
    }
    if (saveAsNewBtn) saveAsNewBtn.classList.remove("hidden");
  } else {
    if (badge) {
      badge.className = "mode-badge new-mode";
      badge.innerHTML = `<i class="fa-solid fa-sparkles"></i> Nueva Proforma`;
    }
    if (btnNew) btnNew.classList.add("hidden");
    if (saveBtn) {
      saveBtn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Guardar Historial`;
      saveBtn.title = "Guardar esta proforma en el historial y en Supabase";
    }
    if (saveAsNewBtn) saveAsNewBtn.classList.add("hidden");
  }
}

// Supabase Configuration & State
const DEFAULT_SUPABASE_URL = "https://xlprhfkbvcllghlucuhl.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_1c11IYmO_8ezwBw_uyH_tQ_aj0jydqE";

let supabaseClient = null;
let useSupabase = false;
let supabaseChannels = [];

const SQL_INIT_SCRIPT = `-- ==============================================================================
-- SCRIPT DE INICIALIZACIÓN DE SUPABASE - COTIZADOR 3D (AMBAR & DAVO)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.catalog_pieces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hours NUMERIC DEFAULT 0,
    minutes NUMERIC DEFAULT 0,
    grams NUMERIC DEFAULT 0,
    timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.app_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.proformas_history (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    total NUMERIC NOT NULL,
    date_str TEXT,
    timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_log (
    id TEXT PRIMARY KEY,
    client_name TEXT NOT NULL,
    total NUMERIC NOT NULL,
    date_str TEXT,
    timestamp BIGINT DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.catalog_pieces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proformas_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso total a catalog_pieces" ON public.catalog_pieces;
CREATE POLICY "Acceso total a catalog_pieces" ON public.catalog_pieces FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total a app_settings" ON public.app_settings;
CREATE POLICY "Acceso total a app_settings" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total a proformas_history" ON public.proformas_history;
CREATE POLICY "Acceso total a proformas_history" ON public.proformas_history FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Acceso total a sales_log" ON public.sales_log;
CREATE POLICY "Acceso total a sales_log" ON public.sales_log FOR ALL USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.catalog_pieces;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.proformas_history;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_log;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`;

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  setupEventListeners();
  setupSupabaseModal();
  initSupabase();
  
  // Load draft proforma from local storage
  const savedDraft = localStorage.getItem("cotizador_3d_draft");
  const savedCurrentId = localStorage.getItem("cotizador_3d_current_id");
  if (savedCurrentId) {
    appState.currentProformaId = savedCurrentId;
  }
  if (savedDraft) {
    try {
      appState.proforma = JSON.parse(savedDraft);
      populateEditorFields();
    } catch (e) {
      console.warn("Error cargando borrador local:", e);
    }
  } else {
    // If no draft exists, start clean
    populateEditorFields();
  }

  updateProformaStatusBadge();
  runCalculation();
  renderProforma();
  
  // Initialize scale for PDF preview
  setTimeout(adjustPDFPreviewScale, 300);
  window.addEventListener("resize", adjustPDFPreviewScale);
});

// Config helper
function getSupabaseConfig() {
  const savedUrl = localStorage.getItem("cotizador_3d_supabase_url");
  const savedKey = localStorage.getItem("cotizador_3d_supabase_key");
  return {
    url: (savedUrl && savedUrl.trim()) ? savedUrl.trim() : DEFAULT_SUPABASE_URL,
    key: (savedKey && savedKey.trim()) ? savedKey.trim() : DEFAULT_SUPABASE_KEY
  };
}

// Initialize Supabase Client
async function initSupabase() {
  const config = getSupabaseConfig();
  
  const urlInput = document.getElementById("supabase-url-input");
  const keyInput = document.getElementById("supabase-key-input");
  if (urlInput) urlInput.value = config.url;
  if (keyInput) keyInput.value = config.key;

  if (typeof window.supabase === "undefined") {
    console.warn("Supabase SDK no detectado. Ejecutando en Modo Local (LocalStorage).");
    useSupabase = false;
    updateDBBadge(false, "Modo Local");
    updateModalAlert("error", "Librería de Supabase no cargada. Verifica tu conexión a internet.");
    setupLocalBackupListeners();
    return;
  }

  if (!config.url || !config.key) {
    useSupabase = false;
    updateDBBadge(false, "Modo Local");
    updateModalAlert("warning", "Ingresa la URL y la Anon Key de Supabase para activar la nube.");
    setupLocalBackupListeners();
    return;
  }

  try {
    updateDBBadge("pending", "Conectando...");
    updateModalAlert("info", "Comprobando conexión con Supabase...");

    supabaseClient = window.supabase.createClient(config.url, config.key);

    // Test connection by reading catalog_pieces table
    const { data, error } = await supabaseClient.from("catalog_pieces").select("id").limit(1);

    if (error) {
      if (error.code === "PGRST205" || (error.message && error.message.toLowerCase().includes("not find the table"))) {
        console.warn("Supabase respondió: Falta crear las tablas en la base de datos.");
        useSupabase = false;
        updateDBBadge("pending", "Crear Tablas");
        updateModalAlert("warning", "¡Conectado con Supabase! Sin embargo, aún falta crear las tablas. Haz clic en 'Copiar Código SQL' y ejecútalo en el SQL Editor de tu consola Supabase.");
        const sqlGuide = document.getElementById("supabase-sql-guide");
        if (sqlGuide) sqlGuide.classList.remove("hidden");
        setupLocalBackupListeners();
        return;
      }
      throw error;
    }

    // Connection successful and tables exist!
    useSupabase = true;
    updateDBBadge(true, "Modo Nube");
    updateModalAlert("success", "Conexión establecida. Catálogo, tarifas, historial y ventas sincronizados.");
    const sqlGuide = document.getElementById("supabase-sql-guide");
    if (sqlGuide) sqlGuide.classList.add("hidden");

    // Load data from cloud
    await Promise.all([
      loadRatesFromSupabase(),
      loadCatalogFromSupabase(),
      loadHistoryFromSupabase(),
      loadSalesFromSupabase()
    ]);

    setupSupabaseRealtime();
    console.log("Supabase sincronizado correctamente.");

  } catch (err) {
    console.error("Error al conectar con Supabase:", err);
    useSupabase = false;
    updateDBBadge(false, "Modo Local");
    updateModalAlert("error", "No se pudo conectar a Supabase: " + (err.message || err));
    setupLocalBackupListeners();
  }
}

// Update Database Status Badge
function updateDBBadge(status, text) {
  const badge = document.getElementById("db-status-badge");
  const textEl = document.getElementById("db-status-text");
  if (!badge) return;
  
  if (status === true || status === "cloud") {
    badge.className = "status-badge cloud-badge";
    if (textEl) textEl.textContent = text || "Modo Nube";
    badge.title = "Sincronizando en la nube con Supabase en tiempo real (Ambar y Davo). Haz clic para ver opciones.";
  } else if (status === "pending") {
    badge.className = "status-badge pending-badge";
    if (textEl) textEl.textContent = text || "Pendiente";
    badge.title = "Supabase requiere atención: haz clic para ver instrucciones o crear tablas.";
  } else {
    badge.className = "status-badge local-badge";
    if (textEl) textEl.textContent = text || "Modo Local";
    badge.title = "Guardando solo en este navegador. Haz clic para conectar con Supabase.";
  }
}

// Update Modal Alert message
function updateModalAlert(type, message) {
  const alertBox = document.getElementById("supabase-status-alert");
  const msgSpan = document.getElementById("supabase-status-msg");
  if (!alertBox || !msgSpan) return;

  alertBox.className = `status-alert-box ${type}`;
  msgSpan.textContent = message;

  const icon = alertBox.querySelector("i");
  if (icon) {
    if (type === "success") icon.className = "fa-solid fa-circle-check";
    else if (type === "warning") icon.className = "fa-solid fa-triangle-exclamation";
    else if (type === "error") icon.className = "fa-solid fa-circle-xmark";
    else icon.className = "fa-solid fa-circle-info";
  }
}

// Realtime subscriptions across all tabs/devices
function setupSupabaseRealtime() {
  if (!supabaseClient || !useSupabase) return;

  try {
    // Unsubscribe previous channels
    supabaseChannels.forEach(ch => {
      try { supabaseClient.removeChannel(ch); } catch (e) {}
    });
    supabaseChannels = [];

    const channel = supabaseClient.channel("cotizador-3d-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "catalog_pieces" }, () => {
        loadCatalogFromSupabase();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => {
        loadRatesFromSupabase();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "proformas_history" }, () => {
        loadHistoryFromSupabase();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_log" }, () => {
        loadSalesFromSupabase();
      })
      .subscribe();

    supabaseChannels.push(channel);
  } catch (e) {
    console.warn("Realtime error:", e);
  }
}

// Load Rates from Supabase
async function loadRatesFromSupabase() {
  if (!supabaseClient || !useSupabase) return;
  try {
    const { data, error } = await supabaseClient
      .from("app_settings")
      .select("value")
      .eq("key", "rates")
      .maybeSingle();

    if (data && data.value) {
      appState.rates = data.value;
      document.getElementById("rate-time").value = appState.rates.time ?? 0.32;
      document.getElementById("rate-material").value = appState.rates.material ?? 0.02;
      document.getElementById("rate-margin").value = appState.rates.margin ?? 100;
      runCalculation();
      renderProforma();
    } else {
      // Initialize rates in database if not present
      await supabaseClient.from("app_settings").upsert({
        key: "rates",
        value: appState.rates,
        updated_at: new Date().toISOString()
      });
    }
  } catch (e) {
    console.warn("Error cargando tarifas de Supabase:", e);
  }
}

// Load Catalog from Supabase
async function loadCatalogFromSupabase() {
  if (!supabaseClient || !useSupabase) return;
  try {
    const { data, error } = await supabaseClient
      .from("catalog_pieces")
      .select("*")
      .order("timestamp", { ascending: false });

    if (error) throw error;
    if (data && data.length > 0) {
      appState.catalog = data;
    } else {
      // Initialize with default pieces if database empty
      const defaults = [
        { id: "cat-1", name: "Combo: Bandeja + Maceta + León", hours: 2, minutes: 45, grams: 210, timestamp: Date.now() },
        { id: "cat-2", name: "Caja Cartulina", hours: 0, minutes: 5, grams: 0, timestamp: Date.now() - 1000 }
      ];
      for (const item of defaults) {
        await supabaseClient.from("catalog_pieces").upsert(item);
      }
      appState.catalog = defaults;
    }
    localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
    renderCatalog();
  } catch (e) {
    console.warn("Error cargando catálogo de Supabase:", e);
  }
}

// Load Proformas History from Supabase
async function loadHistoryFromSupabase() {
  if (!supabaseClient || !useSupabase) return;
  try {
    const { data, error } = await supabaseClient
      .from("proformas_history")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(50);

    if (error) throw error;
    if (data) {
      appState.history = data;
      localStorage.setItem("cotizador_3d_history", JSON.stringify(appState.history));
      renderHistory();
    }
  } catch (e) {
    console.warn("Error cargando historial de Supabase:", e);
  }
}

// Load Sales Log from Supabase
async function loadSalesFromSupabase() {
  if (!supabaseClient || !useSupabase) return;
  try {
    const { data, error } = await supabaseClient
      .from("sales_log")
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(100);

    if (error) throw error;
    if (data) {
      appState.sales = data;
      localStorage.setItem("cotizador_3d_sales", JSON.stringify(appState.sales));
      renderSales();
    }
  } catch (e) {
    console.warn("Error cargando registro de ventas de Supabase:", e);
  }
}

// Fallback to LocalStorage Data Loading
function setupLocalBackupListeners() {
  // Load local rates
  const savedRates = localStorage.getItem("cotizador_3d_rates");
  if (savedRates) {
    try {
      appState.rates = JSON.parse(savedRates);
      document.getElementById("rate-time").value = appState.rates.time ?? 0.32;
      document.getElementById("rate-material").value = appState.rates.material ?? 0.02;
      document.getElementById("rate-margin").value = appState.rates.margin ?? 100;
    } catch (e) {
      console.warn("Error cargando rates locales:", e);
    }
  }
  runCalculation();

  // Load local catalog
  const savedCatalog = localStorage.getItem("cotizador_3d_catalog");
  if (savedCatalog) {
    try {
      appState.catalog = JSON.parse(savedCatalog);
    } catch (e) {
      console.warn("Error cargando catálogo local:", e);
    }
  } else {
    appState.catalog = [
      { id: "cat-1", name: "Combo: Bandeja + Maceta + León", hours: 2, minutes: 45, grams: 210, timestamp: Date.now() },
      { id: "cat-2", name: "Caja Cartulina", hours: 0, minutes: 5, grams: 0, timestamp: Date.now() - 1000 }
    ];
    localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
  }
  renderCatalog();

  // Load local history
  const savedHistory = localStorage.getItem("cotizador_3d_history");
  if (savedHistory) {
    try {
      appState.history = JSON.parse(savedHistory);
    } catch (e) {
      console.warn("Error cargando historial local:", e);
    }
  }
  renderHistory();

  // Load local sales
  const savedSales = localStorage.getItem("cotizador_3d_sales");
  if (savedSales) {
    try {
      appState.sales = JSON.parse(savedSales);
    } catch (e) {
      console.warn("Error cargando ventas locales:", e);
    }
  }
  renderSales();
}

// Save Current Rates
async function saveRates() {
  localStorage.setItem("cotizador_3d_rates", JSON.stringify(appState.rates));
  if (useSupabase && supabaseClient) {
    try {
      await supabaseClient.from("app_settings").upsert({
        key: "rates",
        value: appState.rates,
        updated_at: new Date().toISOString()
      });
    } catch (err) {
      console.error("Error guardando tarifas en Supabase:", err);
    }
  }
}

// Save Current Proforma Draft
function saveDraft() {
  localStorage.setItem("cotizador_3d_draft", JSON.stringify(appState.proforma));
  if (appState.currentProformaId) {
    localStorage.setItem("cotizador_3d_current_id", appState.currentProformaId);
  } else {
    localStorage.removeItem("cotizador_3d_current_id");
  }
}

// Populate Editor Inputs
function populateEditorFields() {
  document.getElementById("client-name").value = appState.proforma.clientName || "";
  document.getElementById("client-attention").value = appState.proforma.clientAttention || "";
  document.getElementById("client-phone").value = appState.proforma.clientPhone || "";
  document.getElementById("client-address").value = appState.proforma.clientAddress || "";
  document.getElementById("client-email").value = appState.proforma.clientEmail || "";
  document.getElementById("client-others").value = appState.proforma.clientOthers || "";
  document.getElementById("payment-method").value = appState.proforma.paymentMethod || "Transferencia";
  document.getElementById("delivery-date").value = appState.proforma.deliveryDate || "";
  document.getElementById("proforma-discount").value = appState.proforma.discount || 0;
  document.getElementById("discount-type").value = appState.proforma.discountType || "fixed";
  document.getElementById("proforma-notes").value = appState.proforma.notes || "";
}

// Theme Logic
function initTheme() {
  const savedTheme = localStorage.getItem("cotizador_3d_theme") || "light";
  const body = document.body;
  const toggleBtn = document.getElementById("theme-toggle");
  
  if (savedTheme === "dark") {
    body.classList.remove("light-mode");
    body.classList.add("dark-mode");
    toggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
  } else {
    body.classList.remove("dark-mode");
    body.classList.add("light-mode");
    toggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
  }
}

function toggleTheme() {
  const body = document.body;
  const toggleBtn = document.getElementById("theme-toggle");
  
  if (body.classList.contains("light-mode")) {
    body.classList.remove("light-mode");
    body.classList.add("dark-mode");
    toggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i>';
    localStorage.setItem("cotizador_3d_theme", "dark");
  } else {
    body.classList.remove("dark-mode");
    body.classList.add("light-mode");
    toggleBtn.innerHTML = '<i class="fa-solid fa-moon"></i>';
    localStorage.setItem("cotizador_3d_theme", "light");
  }
}

// Format Currency Utility
function formatCurrency(value) {
  const formattedVal = Number(value).toFixed(2).replace('.', ',');
  return `$ ${formattedVal}`;
}

// Cost Calculation
function runCalculation() {
  const hours = Math.max(0, parseInt(document.getElementById("print-hours").value) || 0);
  const minutes = Math.max(0, parseInt(document.getElementById("print-minutes").value) || 0);
  const grams = Math.max(0, parseFloat(document.getElementById("print-grams").value) || 0);
  
  const totalMinutes = (hours * 60) + minutes;
  const timeCost = (totalMinutes / 60) * appState.rates.time;
  const materialCost = grams * appState.rates.material;
  const productionCost = timeCost + materialCost;
  const profitValue = productionCost * (appState.rates.margin / 100);
  const totalCost = productionCost + profitValue;

  // Update DOM displays
  document.getElementById("total-minutes-display").textContent = totalMinutes;
  document.getElementById("time-cost-display").textContent = formatCurrency(timeCost);
  document.getElementById("grams-display").textContent = grams;
  document.getElementById("material-cost-display").textContent = formatCurrency(materialCost);
  document.getElementById("production-cost-display").textContent = formatCurrency(productionCost);
  document.getElementById("margin-percentage-display").textContent = appState.rates.margin;
  document.getElementById("profit-value-display").textContent = formatCurrency(profitValue);
  document.getElementById("total-cost-display").textContent = formatCurrency(totalCost);
}

// Add Item to Proforma
function addItemToProforma() {
  const pieceName = document.getElementById("piece-name").value.trim() || "Pieza 3D";
  const qty = Math.max(1, parseInt(document.getElementById("piece-qty").value) || 1);
  
  const hours = Math.max(0, parseInt(document.getElementById("print-hours").value) || 0);
  const minutes = Math.max(0, parseInt(document.getElementById("print-minutes").value) || 0);
  const grams = Math.max(0, parseFloat(document.getElementById("print-grams").value) || 0);
  const totalMinutes = (hours * 60) + minutes;
  
  const timeCost = (totalMinutes / 60) * appState.rates.time;
  const materialCost = grams * appState.rates.material;
  const productionCost = timeCost + materialCost;
  const unitPrice = productionCost * (1 + appState.rates.margin / 100);

  const existingItemIndex = appState.proforma.items.findIndex(
    item => item.description.toLowerCase() === pieceName.toLowerCase() && Math.abs(item.unitPrice - unitPrice) < 0.01
  );

  if (existingItemIndex > -1) {
    appState.proforma.items[existingItemIndex].qty += qty;
    appState.proforma.items[existingItemIndex].totalPrice = appState.proforma.items[existingItemIndex].qty * appState.proforma.items[existingItemIndex].unitPrice;
  } else {
    appState.proforma.items.push({
      id: "item-" + Date.now(),
      qty: qty,
      description: pieceName,
      unitPrice: unitPrice,
      totalPrice: qty * unitPrice
    });
  }

  document.getElementById("piece-qty").value = 1;
  
  saveDraft();
  renderProforma();
}

// Add Manual Item
function addManualItem() {
  const qtyInput = document.getElementById("manual-qty");
  const descInput = document.getElementById("manual-desc");
  const priceInput = document.getElementById("manual-price");

  const qty = parseInt(qtyInput.value) || 1;
  const description = descInput.value.trim();
  const unitPrice = parseFloat(priceInput.value) || 0;

  if (!description) {
    alert("Por favor ingresa una descripción para el artículo manual.");
    return;
  }

  appState.proforma.items.push({
    id: "item-" + Date.now(),
    qty: qty,
    description: description,
    unitPrice: unitPrice,
    totalPrice: qty * unitPrice
  });

  qtyInput.value = 1;
  descInput.value = "";
  priceInput.value = "";

  saveDraft();
  renderProforma();
}

// Delete Item from Proforma
function deleteItem(itemId) {
  appState.proforma.items = appState.proforma.items.filter(item => item.id !== itemId);
  saveDraft();
  renderProforma();
}

// Save Current Calculator Settings to Pieces Catalog
async function savePieceToCatalog() {
  const pieceName = document.getElementById("piece-name").value.trim();
  const hours = Math.max(0, parseInt(document.getElementById("print-hours").value) || 0);
  const minutes = Math.max(0, parseInt(document.getElementById("print-minutes").value) || 0);
  const grams = Math.max(0, parseFloat(document.getElementById("print-grams").value) || 0);

  if (!pieceName) {
    showToast("Por favor ingresa un nombre para la pieza.", "warning");
    return;
  }

  // Check if piece with same name already exists to update it
  const existingIdx = appState.catalog.findIndex(p => p.name.toLowerCase() === pieceName.toLowerCase());
  let pieceId = "cat-" + Date.now();
  if (existingIdx > -1) {
    pieceId = appState.catalog[existingIdx].id;
  }

  const pieceData = {
    id: pieceId,
    name: pieceName,
    hours: hours,
    minutes: minutes,
    grams: grams,
    timestamp: Date.now()
  };

  if (existingIdx > -1) {
    appState.catalog[existingIdx] = pieceData;
  } else {
    appState.catalog.unshift(pieceData);
  }

  localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
  renderCatalog();

  if (useSupabase && supabaseClient) {
    try {
      const { error } = await supabaseClient.from("catalog_pieces").upsert(pieceData);
      if (error) throw error;
      showToast(`✅ Pieza "${pieceName}" guardada en la nube (Supabase)`, "success");
    } catch (err) {
      console.error("Error guardando pieza en Supabase:", err);
      showToast(`Pieza guardada localmente (Error en nube: ${err.message})`, "warning");
    }
  } else {
    showToast(`Pieza "${pieceName}" guardada en tu catálogo local`, "success");
  }
}

// Directly add a Catalog piece to current proforma line items
function addPieceToProformaDirect(pieceId) {
  const piece = appState.catalog.find(p => p.id === pieceId);
  if (!piece) return;

  const qtyInput = document.getElementById("piece-qty");
  const qty = Math.max(1, parseInt(qtyInput?.value) || 1);
  const unitPrice = calculatePiecePrice(piece.hours, piece.minutes, piece.grams);

  const existingIdx = appState.proforma.items.findIndex(
    item => item.description.toLowerCase() === piece.name.toLowerCase() && Math.abs(item.unitPrice - unitPrice) < 0.02
  );

  if (existingIdx > -1) {
    appState.proforma.items[existingIdx].qty += qty;
    appState.proforma.items[existingIdx].totalPrice = appState.proforma.items[existingIdx].qty * appState.proforma.items[existingIdx].unitPrice;
  } else {
    appState.proforma.items.push({
      id: "item-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      qty: qty,
      description: piece.name,
      unitPrice: unitPrice,
      totalPrice: qty * unitPrice
    });
  }

  saveDraft();
  renderProforma();
  showToast(`➕ "${piece.name}" agregada a la proforma (${qty}x)`, "success");
}

// Load Piece from Catalog into Calculator inputs
function loadPieceFromCatalog(pieceId) {
  const piece = appState.catalog.find(p => p.id === pieceId);
  if (piece) {
    document.getElementById("piece-name").value = piece.name;
    document.getElementById("print-hours").value = piece.hours;
    document.getElementById("print-minutes").value = piece.minutes;
    document.getElementById("print-grams").value = piece.grams;
    runCalculation();
    showToast(`Pieza "${piece.name}" cargada en calculadora`, "info");
  }
}

// Delete Piece from Catalog
async function deletePieceFromCatalog(pieceId) {
  const piece = appState.catalog.find(p => p.id === pieceId);
  const name = piece ? piece.name : "esta pieza";
  if (confirm(`¿Estás seguro de que deseas eliminar "${name}" del catálogo?`)) {
    appState.catalog = appState.catalog.filter(p => p.id !== pieceId);
    localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
    renderCatalog();

    if (useSupabase && supabaseClient) {
      try {
        const { error } = await supabaseClient.from("catalog_pieces").delete().eq("id", pieceId);
        if (error) throw error;
        showToast(`Pieza "${name}" eliminada de la nube`, "info");
      } catch (err) {
        console.error("Error eliminando pieza de Supabase:", err);
        showToast("Error al eliminar en la nube: " + err.message, "error");
      }
    } else {
      showToast(`Pieza eliminada del catálogo`, "info");
    }
  }
}

// Render Pieces Catalog
function renderCatalog() {
  const container = document.getElementById("catalog-list");
  if (!container) return;

  container.innerHTML = "";

  const searchInput = document.getElementById("catalog-search");
  const query = (searchInput?.value || "").toLowerCase().trim();

  let list = appState.catalog;
  if (query) {
    list = list.filter(p => (p.name || "").toLowerCase().includes(query));
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-shapes"></i>
        <p>${query ? 'No se encontraron piezas en el catálogo.' : 'No hay piezas en el catálogo.'}</p>
      </div>
    `;
    return;
  }

  list.forEach(piece => {
    const div = document.createElement("div");
    div.className = "catalog-item";
    
    let timeStr = "";
    if (piece.hours > 0) timeStr += `${piece.hours}h `;
    if (piece.minutes > 0 || piece.hours === 0) timeStr += `${piece.minutes}m`;

    const unitPrice = calculatePiecePrice(piece.hours, piece.minutes, piece.grams);

    div.innerHTML = `
      <div class="cat-info">
        <span class="cat-name" title="${escapeHtml(piece.name)}">${escapeHtml(piece.name)}</span>
        <span class="cat-meta">${timeStr} • ${piece.grams}g <span class="cat-price-badge">${formatCurrency(unitPrice)}</span></span>
      </div>
      <div class="cat-actions">
        <button class="btn-action-icon btn-add-cat-direct" title="➕ Agregar directo a la proforma" data-id="${piece.id}" type="button">
          <i class="fa-solid fa-cart-plus"></i>
        </button>
        <button class="btn-action-icon btn-load-cat" title="Cargar en calculadora para modificar" data-id="${piece.id}" type="button">
          <i class="fa-solid fa-sliders"></i>
        </button>
        <button class="btn-action-icon btn-delete-cat" title="Eliminar del catálogo" data-id="${piece.id}" type="button">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    container.appendChild(div);
  });

  // Attach Catalog Event Listeners
  container.querySelectorAll(".btn-add-cat-direct").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      addPieceToProformaDirect(id);
    });
  });

  container.querySelectorAll(".btn-load-cat").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      loadPieceFromCatalog(id);
    });
  });

  container.querySelectorAll(".btn-delete-cat").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      deletePieceFromCatalog(id);
    });
  });
}

// Render Proforma (sync editor to preview)
function renderProforma() {
  const clientName = document.getElementById("client-name").value.trim();
  const clientAddress = document.getElementById("client-address").value.trim();
  const clientEmail = document.getElementById("client-email").value.trim();
  const clientAttention = document.getElementById("client-attention").value.trim();
  const clientPhone = document.getElementById("client-phone").value.trim();
  const clientOthers = document.getElementById("client-others").value.trim();
  const paymentMethod = document.getElementById("payment-method").value.trim();
  const deliveryDate = document.getElementById("delivery-date").value.trim();
  const notes = document.getElementById("proforma-notes").value.trim();
  const discountVal = Math.max(0, parseFloat(document.getElementById("proforma-discount").value) || 0);
  const discountType = document.getElementById("discount-type").value;

  // Sync Details into internal state cleanly (no placeholders)
  appState.proforma.clientName = clientName;
  appState.proforma.clientAddress = clientAddress;
  appState.proforma.clientEmail = clientEmail;
  appState.proforma.clientAttention = clientAttention;
  appState.proforma.clientPhone = clientPhone;
  appState.proforma.clientOthers = clientOthers;
  appState.proforma.paymentMethod = paymentMethod || "Transferencia";
  appState.proforma.deliveryDate = deliveryDate;
  appState.proforma.notes = notes;
  appState.proforma.discount = discountVal;
  appState.proforma.discountType = discountType;

  // Print PDF Preview fields (display "-" only in view if empty)
  document.getElementById("pdf-client-name").textContent = clientName || "-";
  document.getElementById("pdf-client-address").textContent = clientAddress || "-";
  document.getElementById("pdf-client-email").textContent = clientEmail || "-";
  document.getElementById("pdf-client-attention").textContent = clientAttention || "-";
  document.getElementById("pdf-client-phone").textContent = clientPhone || "-";
  document.getElementById("pdf-client-others").textContent = clientOthers || "-";
  document.getElementById("pdf-payment-method").textContent = paymentMethod || "-";
  document.getElementById("pdf-delivery-date").textContent = deliveryDate || "-";
  document.getElementById("pdf-notes").textContent = notes || "-";

  // Render Table Rows
  const tbody = document.getElementById("pdf-items-body");
  tbody.innerHTML = "";

  let subtotal = 0;

  if (appState.proforma.items.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: #888; padding: 20px 0;">
          Ningún artículo agregado aún.
        </td>
      </tr>
    `;
  } else {
    appState.proforma.items.forEach(item => {
      subtotal += item.totalPrice;
      
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="col-cant">${item.qty}</td>
        <td class="col-description">${item.description}</td>
        <td class="col-unit">${formatCurrency(item.unitPrice)}</td>
        <td class="col-total">
          <div class="total-cell-inner">
            <span class="total-cell-val">${formatCurrency(item.totalPrice)}</span>
            <button class="row-action-btn" title="Eliminar ítem de la proforma" data-id="${item.id}" type="button" aria-label="Eliminar ítem">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Calculate discount amount
  let discountAmount = 0;
  if (discountType === "percent") {
    discountAmount = subtotal * (discountVal / 100);
    document.querySelector(".discount-lbl").textContent = `Descuento (${discountVal}%)`;
  } else {
    discountAmount = discountVal;
    document.querySelector(".discount-lbl").textContent = "Descuento";
  }

  const total = Math.max(0, subtotal - discountAmount);

  // Update Totals Displays
  document.getElementById("pdf-subtotal").textContent = formatCurrency(subtotal);
  document.getElementById("pdf-discount").textContent = formatCurrency(discountAmount);
  document.getElementById("pdf-total").textContent = formatCurrency(total);

  // Attach Table Row Actions
  document.querySelectorAll(".row-action-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const itemId = btn.getAttribute("data-id");
      deleteItem(itemId);
    });
  });

  renderProformaItemsManager();
  saveDraft();
  adjustPDFPreviewScale();
}

// Render Items Manager inside Editor Card
function renderProformaItemsManager() {
  const container = document.getElementById("proforma-items-list");
  const countBadge = document.getElementById("proforma-items-count");
  if (!container) return;

  if (countBadge) {
    countBadge.textContent = appState.proforma.items.length;
  }

  container.innerHTML = "";

  if (appState.proforma.items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 14px; font-size: 12.5px;">
        <i class="fa-solid fa-box-open" style="margin-right: 6px;"></i> No hay artículos agregados todavía.
      </div>
    `;
    return;
  }

  appState.proforma.items.forEach(item => {
    const row = document.createElement("div");
    row.className = "proforma-item-row";
    row.innerHTML = `
      <div class="proforma-item-info">
        <span class="proforma-item-qty">${item.qty}x</span>
        <span class="proforma-item-name" title="${escapeHtml(item.description)}">${escapeHtml(item.description)}</span>
      </div>
      <div class="proforma-item-right">
        <span class="proforma-item-total">${formatCurrency(item.totalPrice)}</span>
        <button class="proforma-item-cat-btn" title="Guardar esta pieza en el catálogo para reutilizarla" data-id="${item.id}" type="button">
          <i class="fa-solid fa-bookmark"></i>
        </button>
        <button class="proforma-item-del-btn" title="Eliminar ítem" data-id="${item.id}" type="button" aria-label="Eliminar ítem">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    container.appendChild(row);
  });

  // Attach delete events
  container.querySelectorAll(".proforma-item-del-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const itemId = btn.getAttribute("data-id");
      deleteItem(itemId);
    });
  });

  // Attach save-to-catalog events
  container.querySelectorAll(".proforma-item-cat-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const itemId = btn.getAttribute("data-id");
      saveItemFromProformaToCatalog(itemId);
    });
  });
}

// Save Item from Proforma Line Items into Catalog
async function saveItemFromProformaToCatalog(itemId) {
  const item = appState.proforma.items.find(it => it.id === itemId);
  if (!item) return;

  const existingIdx = appState.catalog.findIndex(p => p.name.toLowerCase() === item.description.toLowerCase());
  if (existingIdx > -1) {
    showToast(`"${item.description}" ya está registrada en el catálogo.`, "info");
    return;
  }

  // Estimate hours and grams from unit price with current rates
  const unitPrice = item.unitPrice || 0;
  const prodCost = unitPrice / (1 + (appState.rates.margin / 100));
  const estimatedGrams = Math.max(1, Math.round((prodCost * 0.4) / (appState.rates.material || 0.02)));
  const estimatedHoursTotal = (prodCost * 0.6) / (appState.rates.time || 0.32);
  const hours = Math.floor(estimatedHoursTotal);
  const minutes = Math.round((estimatedHoursTotal - hours) * 60);

  const pieceData = {
    id: "cat-" + Date.now(),
    name: item.description,
    hours: hours,
    minutes: minutes,
    grams: estimatedGrams,
    timestamp: Date.now()
  };

  appState.catalog.unshift(pieceData);
  localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
  renderCatalog();

  if (useSupabase && supabaseClient) {
    try {
      const { error } = await supabaseClient.from("catalog_pieces").upsert(pieceData);
      if (error) throw error;
      showToast(`✅ "${item.description}" guardada en el catálogo (Supabase)`, "success");
    } catch (err) {
      console.error("Error guardando en Supabase:", err);
      showToast(`Guardada localmente en catálogo`, "info");
    }
  } else {
    showToast(`"${item.description}" guardada en el catálogo local`, "success");
  }
}

// Start a Fresh Blank Proforma
function startNewProforma() {
  appState.currentProformaId = null;
  appState.proforma = {
    clientName: "",
    clientAttention: "Ambar",
    clientPhone: "",
    clientAddress: "",
    clientEmail: "",
    clientOthers: "",
    paymentMethod: "Transferencia",
    deliveryDate: "",
    discount: 0,
    discountType: "fixed",
    notes: "",
    items: []
  };
  populateEditorFields();
  updateProformaStatusBadge();
  saveDraft();
  renderProforma();
  showToast("Nueva proforma en blanco lista.", "info");
}

// Clear Proforma Builder
function clearProforma() {
  if (confirm("¿Estás seguro de que deseas limpiar la proforma actual? Se borrarán todos los artículos e información.")) {
    startNewProforma();
  }
}

// Save Proforma to History list (handles both UPDATE and SAVE AS NEW)
async function saveProformaToHistory(asNew = false) {
  if (appState.proforma.items.length === 0) {
    showToast("No puedes guardar una proforma sin artículos.", "warning");
    return;
  }

  const client = appState.proforma.clientName.trim() || "Cliente Sin Nombre";
  const subtotal = appState.proforma.items.reduce((sum, item) => sum + item.totalPrice, 0);
  const discountVal = appState.proforma.discount || 0;
  const discountAmount = appState.proforma.discountType === "percent"
    ? subtotal * (discountVal / 100)
    : discountVal;
  const total = Math.max(0, subtotal - discountAmount);
  const timestamp = Date.now();
  const dateStr = new Date().toLocaleDateString('es-EC', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const proformaData = JSON.parse(JSON.stringify(appState.proforma));
  
  let targetId = appState.currentProformaId;
  const isUpdate = Boolean(targetId && !asNew);

  if (!isUpdate) {
    targetId = "prof-" + timestamp;
    appState.currentProformaId = targetId;
  }

  const record = {
    id: targetId,
    client_name: client,
    clientName: client,
    total: total,
    date_str: dateStr,
    date: dateStr,
    timestamp: timestamp,
    data: proformaData
  };

  if (isUpdate) {
    const idx = appState.history.findIndex(h => h.id === targetId);
    if (idx > -1) {
      appState.history[idx] = record;
    } else {
      appState.history.unshift(record);
    }
  } else {
    appState.history.unshift(record);
    if (appState.history.length > 100) appState.history.pop();
  }

  localStorage.setItem("cotizador_3d_history", JSON.stringify(appState.history));
  updateProformaStatusBadge();
  saveDraft();
  renderHistory();

  if (useSupabase && supabaseClient) {
    try {
      const { error } = await supabaseClient.from("proformas_history").upsert({
        id: record.id,
        client_name: client,
        total: total,
        date_str: dateStr,
        timestamp: timestamp,
        data: proformaData
      });
      if (error) throw error;
      showToast(isUpdate ? `✅ Proforma de "${client}" actualizada en Supabase` : `✅ Proforma de "${client}" guardada en Supabase`, "success");
    } catch (err) {
      console.error("Error al guardar proforma en Supabase:", err);
      showToast(`Guardada localmente (Error en nube: ${err.message})`, "warning");
    }
  } else {
    showToast(`Guardada localmente en tu historial`, "info");
  }
}

// Load Proforma from History for full editing
function loadProformaFromHistory(historyId) {
  const record = appState.history.find(item => item.id === historyId);
  if (record && record.data) {
    appState.currentProformaId = record.id;
    appState.proforma = JSON.parse(JSON.stringify(record.data));
    populateEditorFields();
    updateProformaStatusBadge();
    saveDraft();
    renderProforma();
    showToast(`📂 Proforma de "${record.client_name}" cargada para editar`, "info");
  }
}

// Use a saved proforma as template for a NEW client (keeps pieces and prices, resets client data)
function duplicateProformaAsTemplate(historyId) {
  const record = appState.history.find(item => item.id === historyId);
  if (!record || !record.data) return;

  const data = JSON.parse(JSON.stringify(record.data));
  appState.currentProformaId = null; // New proforma ID
  appState.proforma = {
    clientName: "", // Ready for new client
    clientAttention: data.clientAttention || "Ambar",
    clientPhone: "",
    clientAddress: "",
    clientEmail: "",
    clientOthers: "",
    paymentMethod: data.paymentMethod || "Transferencia",
    deliveryDate: data.deliveryDate || "",
    discount: data.discount || 0,
    discountType: data.discountType || "fixed",
    notes: data.notes || "",
    items: (data.items || []).map((it, idx) => ({
      ...it,
      id: "item-" + Date.now() + "-" + idx
    }))
  };

  populateEditorFields();
  updateProformaStatusBadge();
  saveDraft();
  renderProforma();

  const clientInput = document.getElementById("client-name");
  if (clientInput) {
    clientInput.focus();
  }

  showToast(`📋 Plantilla cargada con ${(data.items || []).length} piezas de "${record.client_name}". Ingresa el nuevo cliente.`, "info");
}

// Append pieces from a saved proforma to the current proforma (combines quotes)
function appendItemsFromHistory(historyId) {
  const record = appState.history.find(item => item.id === historyId);
  if (!record || !record.data || !record.data.items || record.data.items.length === 0) {
    showToast("Esta proforma no contiene piezas.", "warning");
    return;
  }

  const itemsToAdd = record.data.items;
  itemsToAdd.forEach((item, idx) => {
    const existingIdx = appState.proforma.items.findIndex(
      it => it.description.toLowerCase() === item.description.toLowerCase() && Math.abs(it.unitPrice - item.unitPrice) < 0.02
    );
    if (existingIdx > -1) {
      appState.proforma.items[existingIdx].qty += item.qty;
      appState.proforma.items[existingIdx].totalPrice = appState.proforma.items[existingIdx].qty * appState.proforma.items[existingIdx].unitPrice;
    } else {
      appState.proforma.items.push({
        id: "item-" + Date.now() + "-" + idx + "-" + Math.floor(Math.random() * 1000),
        qty: item.qty,
        description: item.description,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice
      });
    }
  });

  saveDraft();
  renderProforma();
  showToast(`➕ Se agregaron ${itemsToAdd.length} piezas desde la proforma de "${record.client_name}"`, "success");
}

// Delete Proforma from History
async function deleteProformaFromHistory(historyId) {
  const record = appState.history.find(item => item.id === historyId);
  const name = record ? record.client_name : "esta proforma";

  if (confirm(`¿Seguro que deseas eliminar la proforma de "${name}" del historial?`)) {
    if (appState.currentProformaId === historyId) {
      appState.currentProformaId = null;
      updateProformaStatusBadge();
    }
    appState.history = appState.history.filter(item => item.id !== historyId);
    localStorage.setItem("cotizador_3d_history", JSON.stringify(appState.history));
    renderHistory();

    if (useSupabase && supabaseClient) {
      try {
        const { error } = await supabaseClient.from("proformas_history").delete().eq("id", historyId);
        if (error) throw error;
        showToast(`Proforma de "${name}" eliminada de la nube`, "info");
      } catch (err) {
        console.error("Error al eliminar proforma de Supabase:", err);
        showToast("Error al eliminar en la nube: " + err.message, "error");
      }
    } else {
      showToast(`Proforma eliminada del historial`, "info");
    }
  }
}

// Render History UI list with Search
function renderHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;
  container.innerHTML = "";

  const searchInput = document.getElementById("history-search");
  const query = (searchInput?.value || "").toLowerCase().trim();

  let list = appState.history;
  if (query) {
    list = list.filter(item => {
      const client = (item.client_name || item.clientName || "").toLowerCase();
      const date = (item.date_str || item.date || "").toLowerCase();
      const itemDesc = (item.data?.items || []).map(it => (it.description || "").toLowerCase()).join(" ");
      return client.includes(query) || date.includes(query) || itemDesc.includes(query);
    });
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-receipt"></i>
        <p>${query ? 'No se encontraron proformas coincidentes.' : 'No tienes proformas guardadas aún.'}</p>
      </div>
    `;
    return;
  }

  list.forEach(item => {
    const div = document.createElement("div");
    div.className = "history-item";
    if (appState.currentProformaId === item.id) {
      div.style.borderColor = "var(--primary)";
      div.style.background = "var(--primary-light)";
    }
    const client = item.client_name || item.clientName || "Cliente";
    const date = item.date_str || item.date || "-";
    const itemCount = item.data?.items?.length || 0;

    div.innerHTML = `
      <div class="hist-info">
        <span class="hist-client" title="${escapeHtml(client)}">${escapeHtml(client)}</span>
        <span class="hist-meta">${escapeHtml(date)} • ${itemCount} ${itemCount === 1 ? 'ítem' : 'ítems'}</span>
      </div>
      <div class="hist-actions">
        <span class="hist-total">${formatCurrency(item.total)}</span>
        <button class="btn-action-icon btn-load-hist" title="Cargar y editar proforma completa" data-id="${item.id}" type="button">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
        <button class="btn-action-icon btn-template-hist" title="Usar como plantilla para NUEVO cliente (mantiene piezas y precios)" data-id="${item.id}" type="button">
          <i class="fa-solid fa-user-plus"></i>
        </button>
        <button class="btn-action-icon btn-append-hist" title="➕ Sumar estas piezas a la proforma actual" data-id="${item.id}" type="button">
          <i class="fa-solid fa-plus"></i>
        </button>
        <button class="btn-action-icon btn-delete-hist" title="Eliminar proforma" data-id="${item.id}" type="button">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    container.appendChild(div);
  });

  // Attach History Events
  container.querySelectorAll(".btn-load-hist").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      loadProformaFromHistory(id);
    });
  });

  container.querySelectorAll(".btn-template-hist").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      duplicateProformaAsTemplate(id);
    });
  });

  container.querySelectorAll(".btn-append-hist").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      appendItemsFromHistory(id);
    });
  });

  container.querySelectorAll(".btn-delete-hist").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      deleteProformaFromHistory(id);
    });
  });
}

// Download PDF
function downloadPDF() {
  const element = document.getElementById("proforma-print-area");
  const clientName = document.getElementById("client-name").value.trim() || "Cliente";

  const downloadButton = document.getElementById("download-pdf-btn");
  const originalText = downloadButton.innerHTML;
  downloadButton.disabled = true;
  downloadButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando PDF...';

  // Guardar estilos temporales para capturar a tamaño natural (800px) sin escalas móviles ni sombras
  const origTransform = element.style.transform;
  const origTransformOrigin = element.style.transformOrigin;
  const origBoxShadow = element.style.boxShadow;
  const origTransition = element.style.transition;

  element.style.transform = "none";
  element.style.transformOrigin = "initial";
  element.style.boxShadow = "none";
  element.style.transition = "none";
  document.body.classList.add("is-exporting-pdf");

  const opt = {
    margin: 0,
    filename: `Proforma_${clientName.replace(/\s+/g, '_')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      letterRendering: true,
      scrollX: 0,
      scrollY: 0
    },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
    pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.pdf-footer-layout', '.pdf-header'] }
  };

  const cleanup = () => {
    element.style.transform = origTransform;
    element.style.transformOrigin = origTransformOrigin;
    element.style.boxShadow = origBoxShadow;
    element.style.transition = origTransition;
    document.body.classList.remove("is-exporting-pdf");
    downloadButton.disabled = false;
    downloadButton.innerHTML = originalText;
  };

  html2pdf().set(opt).from(element).save().then(() => {
    cleanup();
    showToast("📄 PDF generado y descargado exitosamente", "success");
  }).catch((err) => {
    console.error("PDF generation error: ", err);
    cleanup();
    showToast("Ocurrió un error al generar el PDF. Por favor intenta de nuevo.", "error");
  });
}

// Setup Event Listeners
function setupEventListeners() {
  // Theme Toggle
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

  // Settings Panel Collapse
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsBody = document.getElementById("settings-body");
  settingsToggle.addEventListener("click", () => {
    settingsToggle.classList.toggle("collapsed");
    settingsBody.classList.toggle("hidden");
  });

  // Rates Inputs
  const rateTimeInput = document.getElementById("rate-time");
  const rateMaterialInput = document.getElementById("rate-material");
  const rateMarginInput = document.getElementById("rate-margin");
  
  rateTimeInput.addEventListener("input", () => {
    appState.rates.time = Math.max(0, parseFloat(rateTimeInput.value) || 0);
    saveRates();
    runCalculation();
  });
  
  rateMaterialInput.addEventListener("input", () => {
    appState.rates.material = Math.max(0, parseFloat(rateMaterialInput.value) || 0);
    saveRates();
    runCalculation();
  });

  rateMarginInput.addEventListener("input", () => {
    appState.rates.margin = Math.max(0, parseInt(rateMarginInput.value) || 0);
    saveRates();
    runCalculation();
  });

  document.getElementById("reset-rates-btn").addEventListener("click", () => {
    appState.rates = { material: 0.02, time: 0.32, margin: 100 };
    rateTimeInput.value = 0.32;
    rateMaterialInput.value = 0.02;
    rateMarginInput.value = 100;
    saveRates();
    runCalculation();
  });

  // Calculator inputs
  document.getElementById("print-hours").addEventListener("input", runCalculation);
  document.getElementById("print-minutes").addEventListener("input", runCalculation);
  document.getElementById("print-grams").addEventListener("input", runCalculation);
  document.getElementById("piece-name").addEventListener("input", runCalculation);

  // Calculator Quantity selectors
  const qtyInput = document.getElementById("piece-qty");
  document.getElementById("qty-minus").addEventListener("click", () => {
    qtyInput.value = Math.max(1, (parseInt(qtyInput.value) || 1) - 1);
  });
  document.getElementById("qty-plus").addEventListener("click", () => {
    qtyInput.value = (parseInt(qtyInput.value) || 1) + 1;
  });

  // Calculator Action buttons
  document.getElementById("add-to-proforma-btn").addEventListener("click", addItemToProforma);
  document.getElementById("save-piece-catalog-btn").addEventListener("click", savePieceToCatalog);

  // Add manual item to proforma
  document.getElementById("add-manual-item-btn").addEventListener("click", addManualItem);

  // Proforma text inputs and options
  const proformaInputs = [
    "client-name", "client-address", "client-email", 
    "client-attention", "client-phone", "client-others",
    "payment-method", "delivery-date", "proforma-discount", 
    "proforma-notes"
  ];
  
  proformaInputs.forEach(id => {
    document.getElementById(id).addEventListener("input", renderProforma);
  });

  document.getElementById("discount-type").addEventListener("change", renderProforma);

  // Proforma Action Buttons
  document.getElementById("clear-proforma-btn").addEventListener("click", clearProforma);
  document.getElementById("btn-start-new-proforma").addEventListener("click", startNewProforma);
  document.getElementById("register-sale-btn").addEventListener("click", registerSale);
  document.getElementById("save-as-new-proforma-btn").addEventListener("click", () => saveProformaToHistory(true));
  document.getElementById("save-proforma-btn").addEventListener("click", () => saveProformaToHistory(false));
  document.getElementById("download-pdf-btn").addEventListener("click", downloadPDF);

  // Search Filters for Catalog and History
  const catalogSearch = document.getElementById("catalog-search");
  if (catalogSearch) {
    catalogSearch.addEventListener("input", renderCatalog);
  }
  const historySearch = document.getElementById("history-search");
  if (historySearch) {
    historySearch.addEventListener("input", renderHistory);
  }
}

// Dynamically scale down the PDF preview sheet to fit mobile screens
function adjustPDFPreviewScale() {
  const container = document.querySelector('.proforma-preview-container');
  const pdf = document.getElementById('proforma-print-area');
  if (!container || !pdf) return;
  
  const containerWidth = container.clientWidth;
  if (containerWidth < 840) {
    const padding = 20; // left + right padding
    const availableWidth = containerWidth - padding;
    const scale = availableWidth / 800;
    
    pdf.style.transform = `scale(${scale})`;
    pdf.style.transformOrigin = 'top center';
    
    // Scale container height proportionally to prevent extra empty space at bottom
    const pdfHeight = pdf.offsetHeight;
    container.style.height = `${(pdfHeight * scale) + 20}px`;
  } else {
    pdf.style.transform = '';
    pdf.style.transformOrigin = '';
    container.style.height = '';
  }
}

// Register Sale (Concretar Venta)
async function registerSale() {
  if (appState.proforma.items.length === 0) {
    alert("No puedes registrar una venta sin artículos.");
    return;
  }

  const client = appState.proforma.clientName.trim() || "Cliente Sin Nombre";
  const subtotal = appState.proforma.items.reduce((sum, item) => sum + item.totalPrice, 0);
  const total = Math.max(0, subtotal - appState.proforma.discount);
  const timestamp = Date.now();
  const dateStr = new Date().toLocaleDateString('es-EC', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  const proformaData = JSON.parse(JSON.stringify(appState.proforma));
  const record = {
    id: "sale-" + timestamp,
    client_name: client,
    clientName: client,
    total: total,
    date_str: dateStr,
    date: dateStr,
    timestamp: timestamp,
    data: proformaData
  };

  appState.sales.unshift(record);
  localStorage.setItem("cotizador_3d_sales", JSON.stringify(appState.sales));
  renderSales();

  if (useSupabase && supabaseClient) {
    try {
      const { error } = await supabaseClient.from("sales_log").insert({
        id: record.id,
        client_name: client,
        total: total,
        date_str: dateStr,
        timestamp: timestamp,
        data: proformaData
      });
      if (error) throw error;
      alert("¡Venta registrada exitosamente en la nube (Supabase)!");
    } catch (err) {
      console.error("Error al registrar venta en Supabase:", err);
      alert("Venta registrada localmente (Error en la nube: " + err.message + ")");
    }
  } else {
    alert("Venta registrada localmente en tu registro de ventas.");
  }
}

// Delete Sale from Log
async function deleteSale(saleId) {
  if (confirm("¿Estás seguro de que deseas eliminar esta venta registrada?")) {
    appState.sales = appState.sales.filter(item => item.id !== saleId);
    localStorage.setItem("cotizador_3d_sales", JSON.stringify(appState.sales));
    renderSales();

    if (useSupabase && supabaseClient) {
      try {
        const { error } = await supabaseClient.from("sales_log").delete().eq("id", saleId);
        if (error) throw error;
      } catch (err) {
        console.error("Error al eliminar venta en Supabase:", err);
        alert("Error al eliminar venta en la nube: " + err.message);
      }
    }
  }
}

// Render Sales UI list
function renderSales() {
  const container = document.getElementById("sales-list");
  if (!container) return;
  container.innerHTML = "";

  if (appState.sales.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-coins"></i>
        <p>No hay ventas concretadas registradas.</p>
      </div>
    `;
    return;
  }

  appState.sales.forEach(item => {
    const div = document.createElement("div");
    div.className = "sales-item";
    const client = item.client_name || item.clientName || "Cliente";
    const date = item.date_str || item.date || "-";
    const itemCount = item.data?.items?.length || 0;

    div.innerHTML = `
      <div class="sale-info">
        <span class="sale-client">${client}</span>
        <span class="sale-meta">${date} • ${itemCount} ítems</span>
      </div>
      <div class="sale-actions">
        <span class="sale-total">${formatCurrency(item.total)}</span>
        <button class="btn-load-sale" title="Cargar proforma de esta venta" data-id="${item.id}">
          <i class="fa-solid fa-file-import"></i>
        </button>
        <button class="btn-delete-sale" title="Eliminar venta" data-id="${item.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
    container.appendChild(div);
  });

  // Attach Sales Events
  document.querySelectorAll(".btn-load-sale").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      loadSaleDetails(id);
    });
  });

  document.querySelectorAll(".btn-delete-sale").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      deleteSale(id);
    });
  });
}

// Load Sale Details
function loadSaleDetails(saleId) {
  const record = appState.sales.find(item => item.id === saleId);
  if (record) {
    appState.proforma = JSON.parse(JSON.stringify(record.data));
    populateEditorFields();
    saveDraft();
    renderProforma();
  }
}

// Setup Supabase Modal & Dialog Handlers
function setupSupabaseModal() {
  const badgeBtn = document.getElementById("db-status-badge");
  const modal = document.getElementById("supabase-modal");
  const closeBtn = document.getElementById("close-supabase-modal");
  const closeLocalBtn = document.getElementById("btn-use-local-only");
  const reconnectBtn = document.getElementById("btn-reconnect-supabase");
  const copySqlBtn = document.getElementById("copy-sql-btn");

  if (!modal) return;

  if (badgeBtn) {
    badgeBtn.addEventListener("click", () => {
      modal.classList.remove("hidden");
    });
  }

  const closeModal = () => modal.classList.add("hidden");
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (closeLocalBtn) closeLocalBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  if (reconnectBtn) {
    reconnectBtn.addEventListener("click", async () => {
      const urlInput = document.getElementById("supabase-url-input");
      const keyInput = document.getElementById("supabase-key-input");
      const newUrl = urlInput ? urlInput.value.trim() : "";
      const newKey = keyInput ? keyInput.value.trim() : "";

      if (!newUrl || !newKey) {
        alert("Por favor ingresa tanto la URL como la Clave de Supabase.");
        return;
      }

      localStorage.setItem("cotizador_3d_supabase_url", newUrl);
      localStorage.setItem("cotizador_3d_supabase_key", newKey);

      reconnectBtn.disabled = true;
      reconnectBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Conectando...';

      await initSupabase();

      reconnectBtn.disabled = false;
      reconnectBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Guardar y Conectar';
    });
  }

  if (copySqlBtn) {
    copySqlBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(SQL_INIT_SCRIPT).then(() => {
        const originalText = copySqlBtn.innerHTML;
        copySqlBtn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Copiado al Portapapeles!';
        copySqlBtn.style.backgroundColor = '#166534';
        copySqlBtn.style.color = '#ffffff';
        setTimeout(() => {
          copySqlBtn.innerHTML = originalText;
          copySqlBtn.style.backgroundColor = '';
          copySqlBtn.style.color = '';
        }, 2500);
      }).catch(err => {
        alert("No se pudo copiar automáticamente. Por favor abre el archivo supabase_schema.sql en el proyecto.");
      });
    });
  }
}
