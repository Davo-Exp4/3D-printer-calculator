// Core Application State
let appState = {
  rates: {
    material: 0.02,  // per gram
    time: 0.32,      // per hour
    margin: 100      // profit margin (%)
  },
  catalog: [], // Shared pieces catalog
  proforma: {
    clientName: "Belén Torres",
    clientAttention: "Ambar",
    clientPhone: "0987363300",
    clientAddress: "",
    clientEmail: "",
    clientOthers: "",
    paymentMethod: "Transferencia",
    deliveryDate: "23 de junio",
    discount: 5.00,
    notes: `10 bandejas joyeros, color negro\n10 Leones, color beige\n10 Macetas, color blanco hueso + suculentas\n10 Cajas Cartulina`,
    items: [
      // Pre-populate with items from the user's reference image for a great first impression!
      {
        id: "init-1",
        qty: 10,
        description: "Combo: Bandeja + Maceta + León",
        unitPrice: 10.00,
        totalPrice: 100.00
      },
      {
        id: "init-2",
        qty: 10,
        description: "Cajas cartulina",
        unitPrice: 0.75,
        totalPrice: 7.50
      }
    ]
  },
  history: [],
  sales: [] // List of completed sales
};

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
  if (savedDraft) {
    try {
      appState.proforma = JSON.parse(savedDraft);
      populateEditorFields();
    } catch (e) {
      console.warn("Error cargando borrador local:", e);
    }
  }

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
}

// Populate Editor Inputs
function populateEditorFields() {
  document.getElementById("client-name").value = appState.proforma.clientName;
  document.getElementById("client-attention").value = appState.proforma.clientAttention;
  document.getElementById("client-phone").value = appState.proforma.clientPhone;
  document.getElementById("client-address").value = appState.proforma.clientAddress;
  document.getElementById("client-email").value = appState.proforma.clientEmail;
  document.getElementById("client-others").value = appState.proforma.clientOthers;
  document.getElementById("payment-method").value = appState.proforma.paymentMethod;
  document.getElementById("delivery-date").value = appState.proforma.deliveryDate;
  document.getElementById("proforma-discount").value = appState.proforma.discount;
  document.getElementById("discount-type").value = appState.proforma.discountType || "fixed";
  document.getElementById("proforma-notes").value = appState.proforma.notes;
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
    alert("Por favor ingresa un nombre para la pieza antes de guardarla en el catálogo.");
    return;
  }

  const pieceId = "cat-" + Date.now();
  const pieceData = {
    id: pieceId,
    name: pieceName,
    hours: hours,
    minutes: minutes,
    grams: grams,
    timestamp: Date.now()
  };

  appState.catalog.unshift(pieceData);
  localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
  renderCatalog();

  if (useSupabase && supabaseClient) {
    try {
      const { error } = await supabaseClient.from("catalog_pieces").insert(pieceData);
      if (error) throw error;
      alert("Pieza guardada exitosamente en la nube (Supabase).");
    } catch (err) {
      console.error("Error guardando pieza en Supabase:", err);
      alert("Guardada localmente (Error en la nube: " + err.message + ")");
    }
  } else {
    alert("Pieza guardada localmente en tu catálogo.");
  }
}

// Load Piece from Catalog
function loadPieceFromCatalog(pieceId) {
  const piece = appState.catalog.find(p => p.id === pieceId);
  if (piece) {
    document.getElementById("piece-name").value = piece.name;
    document.getElementById("print-hours").value = piece.hours;
    document.getElementById("print-minutes").value = piece.minutes;
    document.getElementById("print-grams").value = piece.grams;
    runCalculation();
  }
}

// Delete Piece from Catalog
async function deletePieceFromCatalog(pieceId) {
  if (confirm("¿Estás seguro de que deseas eliminar esta pieza del catálogo?")) {
    appState.catalog = appState.catalog.filter(p => p.id !== pieceId);
    localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
    renderCatalog();

    if (useSupabase && supabaseClient) {
      try {
        const { error } = await supabaseClient.from("catalog_pieces").delete().eq("id", pieceId);
        if (error) throw error;
      } catch (err) {
        console.error("Error eliminando pieza de Supabase:", err);
        alert("Error al eliminar en la nube: " + err.message);
      }
    }
  }
}

// Render Pieces Catalog
function renderCatalog() {
  const container = document.getElementById("catalog-list");
  if (!container) return;

  container.innerHTML = "";

  if (appState.catalog.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-shapes"></i>
        <p>No hay piezas en el catálogo.</p>
      </div>
    `;
    return;
  }

  appState.catalog.forEach(piece => {
    const div = document.createElement("div");
    div.className = "catalog-item";
    
    let timeStr = "";
    if (piece.hours > 0) timeStr += `${piece.hours}h `;
    if (piece.minutes > 0 || piece.hours === 0) timeStr += `${piece.minutes}m`;

    div.innerHTML = `
      <div class="cat-info">
        <span class="cat-name">${piece.name}</span>
        <span class="cat-meta">${timeStr} • ${piece.grams}g</span>
      </div>
      <div class="cat-actions">
        <button class="btn-load-cat" title="Cargar en calculadora" data-id="${piece.id}">
          <i class="fa-solid fa-file-import"></i>
        </button>
        <button class="btn-delete-cat" title="Eliminar del catálogo" data-id="${piece.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
    container.appendChild(div);
  });

  // Attach Catalog Event Listeners
  document.querySelectorAll(".btn-load-cat").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      loadPieceFromCatalog(id);
    });
  });

  document.querySelectorAll(".btn-delete-cat").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      deletePieceFromCatalog(id);
    });
  });
}

// Render Proforma (sync editor to preview)
function renderProforma() {
  const clientName = document.getElementById("client-name").value.trim() || "-";
  const clientAddress = document.getElementById("client-address").value.trim() || "-";
  const clientEmail = document.getElementById("client-email").value.trim() || "-";
  const clientAttention = document.getElementById("client-attention").value.trim() || "-";
  const clientPhone = document.getElementById("client-phone").value.trim() || "-";
  const clientOthers = document.getElementById("client-others").value.trim() || "-";
  const paymentMethod = document.getElementById("payment-method").value.trim() || "-";
  const deliveryDate = document.getElementById("delivery-date").value.trim() || "-";
  const notes = document.getElementById("proforma-notes").value.trim() || "-";
  const discountVal = Math.max(0, parseFloat(document.getElementById("proforma-discount").value) || 0);
  const discountType = document.getElementById("discount-type").value;

  // Sync Details
  appState.proforma.clientName = clientName;
  appState.proforma.clientAddress = clientAddress;
  appState.proforma.clientEmail = clientEmail;
  appState.proforma.clientAttention = clientAttention;
  appState.proforma.clientPhone = clientPhone;
  appState.proforma.clientOthers = clientOthers;
  appState.proforma.paymentMethod = paymentMethod;
  appState.proforma.deliveryDate = deliveryDate;
  appState.proforma.notes = notes;
  appState.proforma.discount = discountVal;
  appState.proforma.discountType = discountType;

  // Print PDF Preview fields
  document.getElementById("pdf-client-name").textContent = clientName;
  document.getElementById("pdf-client-address").textContent = clientAddress;
  document.getElementById("pdf-client-email").textContent = clientEmail;
  document.getElementById("pdf-client-attention").textContent = clientAttention;
  document.getElementById("pdf-client-phone").textContent = clientPhone;
  document.getElementById("pdf-client-others").textContent = clientOthers;
  document.getElementById("pdf-payment-method").textContent = paymentMethod;
  document.getElementById("pdf-delivery-date").textContent = deliveryDate;
  document.getElementById("pdf-notes").textContent = notes;

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
        <span class="proforma-item-name" title="${item.description}">${item.description}</span>
      </div>
      <div class="proforma-item-right">
        <span class="proforma-item-total">${formatCurrency(item.totalPrice)}</span>
        <button class="proforma-item-del-btn" title="Eliminar ítem" data-id="${item.id}" type="button" aria-label="Eliminar ítem">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
    `;
    container.appendChild(row);
  });

  // Attach delete events for the manager list
  container.querySelectorAll(".proforma-item-del-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const itemId = btn.getAttribute("data-id");
      deleteItem(itemId);
    });
  });
}

// Clear Proforma Builder
function clearProforma() {
  if (confirm("¿Estás seguro de que deseas limpiar la proforma actual? Se borrarán todos los artículos e información del cliente.")) {
    appState.proforma = {
      clientName: "",
      clientAttention: "",
      clientPhone: "",
      clientAddress: "",
      clientEmail: "",
      clientOthers: "",
      paymentMethod: "Transferencia",
      deliveryDate: "",
      discount: 0,
      notes: "",
      items: []
    };
    populateEditorFields();
    saveDraft();
    renderProforma();
  }
}

// Save Proforma to History list
async function saveProformaToHistory() {
  if (appState.proforma.items.length === 0) {
    alert("No puedes guardar una proforma vacía.");
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
    id: "prof-" + timestamp,
    client_name: client,
    clientName: client,
    total: total,
    date_str: dateStr,
    date: dateStr,
    timestamp: timestamp,
    data: proformaData
  };

  appState.history.unshift(record);
  if (appState.history.length > 50) {
    appState.history.pop();
  }

  localStorage.setItem("cotizador_3d_history", JSON.stringify(appState.history));
  renderHistory();

  if (useSupabase && supabaseClient) {
    try {
      const { error } = await supabaseClient.from("proformas_history").insert({
        id: record.id,
        client_name: client,
        total: total,
        date_str: dateStr,
        timestamp: timestamp,
        data: proformaData
      });
      if (error) throw error;
      alert("Proforma guardada exitosamente en la nube (Supabase).");
    } catch (err) {
      console.error("Error al guardar proforma en Supabase:", err);
      alert("Proforma guardada localmente (Error en la nube: " + err.message + ")");
    }
  } else {
    alert("Proforma guardada localmente en tu historial.");
  }
}

// Load Proforma from History
function loadProformaFromHistory(historyId) {
  const record = appState.history.find(item => item.id === historyId);
  if (record) {
    appState.proforma = JSON.parse(JSON.stringify(record.data));
    populateEditorFields();
    saveDraft();
    renderProforma();
  }
}

// Delete Proforma from History
async function deleteProformaFromHistory(historyId) {
  if (confirm("¿Seguro que deseas eliminar esta proforma del historial?")) {
    appState.history = appState.history.filter(item => item.id !== historyId);
    localStorage.setItem("cotizador_3d_history", JSON.stringify(appState.history));
    renderHistory();

    if (useSupabase && supabaseClient) {
      try {
        const { error } = await supabaseClient.from("proformas_history").delete().eq("id", historyId);
        if (error) throw error;
      } catch (err) {
        console.error("Error al eliminar proforma de Supabase:", err);
        alert("Error al eliminar en la nube: " + err.message);
      }
    }
  }
}

// Render History UI list
function renderHistory() {
  const container = document.getElementById("history-list");
  if (!container) return;
  container.innerHTML = "";

  if (appState.history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-receipt"></i>
        <p>No tienes proformas guardadas aún.</p>
      </div>
    `;
    return;
  }

  appState.history.forEach(item => {
    const div = document.createElement("div");
    div.className = "history-item";
    const client = item.client_name || item.clientName || "Cliente";
    const date = item.date_str || item.date || "-";
    const itemCount = item.data?.items?.length || 0;

    div.innerHTML = `
      <div class="hist-info">
        <span class="hist-client">${client}</span>
        <span class="hist-meta">${date} • ${itemCount} ítems</span>
      </div>
      <div class="hist-actions">
        <span class="hist-total">${formatCurrency(item.total)}</span>
        <button class="btn-load-hist" title="Cargar proforma" data-id="${item.id}">
          <i class="fa-solid fa-file-import"></i>
        </button>
        <button class="btn-delete-hist" title="Eliminar proforma" data-id="${item.id}">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `;
    container.appendChild(div);
  });

  // Attach History Events
  document.querySelectorAll(".btn-load-hist").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      loadProformaFromHistory(id);
    });
  });

  document.querySelectorAll(".btn-delete-hist").forEach(btn => {
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
  
  // Hide delete action buttons on PDF export
  document.querySelectorAll(".row-action-btn").forEach(btn => btn.style.display = "none");

  const opt = {
    margin: [0.3, 0.3, 0.3, 0.3],
    filename: `Proforma_${clientName.replace(/\s+/g, '_')}.pdf`,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { 
      scale: 2.5, 
      useCORS: true,
      logging: false,
      letterRendering: true
    },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
  };

  const downloadButton = document.getElementById("download-pdf-btn");
  const originalText = downloadButton.innerHTML;
  downloadButton.disabled = true;
  downloadButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generando PDF...';

  html2pdf().set(opt).from(element).save().then(() => {
    downloadButton.disabled = false;
    downloadButton.innerHTML = originalText;
    document.querySelectorAll(".row-action-btn").forEach(btn => btn.style.display = "");
  }).catch((err) => {
    console.error("PDF generation error: ", err);
    alert("Ocurrió un error al generar el PDF. Por favor intenta de nuevo.");
    downloadButton.disabled = false;
    downloadButton.innerHTML = originalText;
    document.querySelectorAll(".row-action-btn").forEach(btn => btn.style.display = "");
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
  document.getElementById("register-sale-btn").addEventListener("click", registerSale);
  document.getElementById("save-proforma-btn").addEventListener("click", saveProformaToHistory);
  document.getElementById("download-pdf-btn").addEventListener("click", downloadPDF);
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
