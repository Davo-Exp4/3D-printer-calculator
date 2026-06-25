// Core Application State
let appState = {
  rates: {
    time: 0.04,      // per minute
    material: 0.02  // per gram
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
  history: []
};

// Firebase Configuration & State
let db = null;
let useFirebase = false;

const firebaseConfig = {
  apiKey: "AIzaSyDWyA2caNjR9rBWnpvsl6qw-Io27PDuTMU",
  authDomain: "davo-print-calc-3d-f89a.firebaseapp.com",
  projectId: "davo-print-calc-3d-f89a",
  storageBucket: "davo-print-calc-3d-f89a.firebasestorage.app",
  messagingSenderId: "1020121501808",
  appId: "1:1020121501808:web:144f67789b58148ad064b5"
};

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  setupEventListeners();
  initFirebase();
  
  // Load draft proforma from local storage
  const savedDraft = localStorage.getItem("cotizador_3d_draft");
  if (savedDraft) {
    appState.proforma = JSON.parse(savedDraft);
    populateEditorFields();
  }

  runCalculation();
  renderProforma();
  
  // Initialize scale for PDF preview
  setTimeout(adjustPDFPreviewScale, 300);
  window.addEventListener("resize", adjustPDFPreviewScale);
});

// Initialize Firebase & Firestore
function initFirebase() {
  if (typeof firebase === 'undefined') {
    console.warn("Firebase SDK no detectado. Ejecutando en Modo Local (LocalStorage).");
    useFirebase = false;
    updateDBBadge(false);
    setupLocalBackupListeners();
    return;
  }

  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    
    // Enable offline persistence for smooth usage
    db.enablePersistence().catch(err => {
      console.warn("Offline persistence failed to enable:", err.code);
    });

    // Test connection by fetching rates document
    db.collection("settings").doc("rates").get()
      .then((doc) => {
        useFirebase = true;
        updateDBBadge(true);
        console.log("Firebase Firestore conectado con éxito. Sincronización en la nube activa.");
        setupFirebaseListeners();
      })
      .catch((err) => {
        console.warn("Firestore no pudo completarse (pendiente de iniciar base de datos en consola Firebase). Fallback a local. Error:", err.message);
        useFirebase = false;
        updateDBBadge(false);
        setupLocalBackupListeners();
      });

  } catch (e) {
    console.error("Error al inicializar Firebase:", e);
    useFirebase = false;
    updateDBBadge(false);
    setupLocalBackupListeners();
  }
}

// Update Database Status Badge
function updateDBBadge(isConnected) {
  const badge = document.getElementById("db-status-badge");
  if (!badge) return;
  
  if (isConnected) {
    badge.className = "status-badge cloud-badge";
    badge.innerHTML = '<i class="fa-solid fa-cloud"></i> Modo Nube';
    badge.title = "Compartiendo datos en la nube con Ambar y Davo en tiempo real.";
  } else {
    badge.className = "status-badge local-badge";
    badge.innerHTML = '<i class="fa-solid fa-database"></i> Modo Local';
    badge.title = "Guardando en tu navegador. Para compartir, inicia Firestore en tu consola Firebase.";
  }
}

// Setup Firebase Realtime Listeners
function setupFirebaseListeners() {
  // 1. Listen to Rates
  db.collection("settings").doc("rates").onSnapshot((doc) => {
    if (doc.exists) {
      appState.rates = doc.data();
      document.getElementById("rate-time").value = appState.rates.time;
      document.getElementById("rate-material").value = appState.rates.material;
      runCalculation();
      renderProforma();
    } else {
      // Prepopulate rates in cloud if empty
      db.collection("settings").doc("rates").set(appState.rates);
    }
  }, (error) => {
    console.warn("Rates snapshot error:", error);
  });

  // 2. Listen to Shared Pieces Catalog
  db.collection("pieces").orderBy("timestamp", "desc").onSnapshot((querySnapshot) => {
    appState.catalog = [];
    querySnapshot.forEach((doc) => {
      appState.catalog.push({
        id: doc.id,
        ...doc.data()
      });
    });
    renderCatalog();
  }, (error) => {
    console.warn("Catalog snapshot error:", error);
  });

  // 3. Listen to Shared Proformas History
  db.collection("proformas").orderBy("timestamp", "desc").onSnapshot((querySnapshot) => {
    appState.history = [];
    querySnapshot.forEach((doc) => {
      appState.history.push({
        id: doc.id,
        ...doc.data()
      });
    });
    renderHistory();
  }, (error) => {
    console.warn("History snapshot error:", error);
  });
}

// Fallback to LocalStorage Data Loading
function setupLocalBackupListeners() {
  // Load local rates
  const savedRates = localStorage.getItem("cotizador_3d_rates");
  if (savedRates) {
    appState.rates = JSON.parse(savedRates);
    document.getElementById("rate-time").value = appState.rates.time;
    document.getElementById("rate-material").value = appState.rates.material;
  }
  runCalculation();

  // Load local catalog
  const savedCatalog = localStorage.getItem("cotizador_3d_catalog");
  if (savedCatalog) {
    appState.catalog = JSON.parse(savedCatalog);
  } else {
    // Default items
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
    appState.history = JSON.parse(savedHistory);
  }
  renderHistory();
}

// Save Current Rates
function saveRates() {
  if (useFirebase && db) {
    db.collection("settings").doc("rates").set(appState.rates)
      .catch(err => console.error("Error saving rates to Firebase:", err));
  } else {
    localStorage.setItem("cotizador_3d_rates", JSON.stringify(appState.rates));
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
  const timeCost = totalMinutes * appState.rates.time;
  const materialCost = grams * appState.rates.material;
  const totalCost = timeCost + materialCost;

  // Update DOM displays
  document.getElementById("total-minutes-display").textContent = totalMinutes;
  document.getElementById("time-cost-display").textContent = formatCurrency(timeCost);
  document.getElementById("grams-display").textContent = grams;
  document.getElementById("material-cost-display").textContent = formatCurrency(materialCost);
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
  const unitPrice = (totalMinutes * appState.rates.time) + (grams * appState.rates.material);

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
function savePieceToCatalog() {
  const pieceName = document.getElementById("piece-name").value.trim();
  const hours = Math.max(0, parseInt(document.getElementById("print-hours").value) || 0);
  const minutes = Math.max(0, parseInt(document.getElementById("print-minutes").value) || 0);
  const grams = Math.max(0, parseFloat(document.getElementById("print-grams").value) || 0);

  if (!pieceName) {
    alert("Por favor ingresa un nombre para la pieza antes de guardarla en el catálogo.");
    return;
  }

  const pieceData = {
    name: pieceName,
    hours: hours,
    minutes: minutes,
    grams: grams,
    timestamp: Date.now()
  };

  if (useFirebase && db) {
    db.collection("pieces").add(pieceData)
      .then(() => alert("Pieza guardada exitosamente en el catálogo compartido."))
      .catch(err => alert("Error al guardar en Firebase: " + err.message));
  } else {
    pieceData.id = "cat-" + Date.now();
    appState.catalog.unshift(pieceData);
    localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
    renderCatalog();
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
function deletePieceFromCatalog(pieceId) {
  if (confirm("¿Estás seguro de que deseas eliminar esta pieza del catálogo?")) {
    if (useFirebase && db) {
      db.collection("pieces").doc(pieceId).delete()
        .catch(err => alert("Error al eliminar de Firebase: " + err.message));
    } else {
      appState.catalog = appState.catalog.filter(p => p.id !== pieceId);
      localStorage.setItem("cotizador_3d_catalog", JSON.stringify(appState.catalog));
      renderCatalog();
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
          ${formatCurrency(item.totalPrice)}
          <button class="row-action-btn" title="Eliminar ítem" data-id="${item.id}">
            <i class="fa-solid fa-times"></i>
          </button>
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

  saveDraft();
  adjustPDFPreviewScale();
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
function saveProformaToHistory() {
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

  if (useFirebase && db) {
    db.collection("proformas").add({
      clientName: client,
      total: total,
      date: dateStr,
      timestamp: timestamp,
      data: proformaData
    })
    .then(() => alert("Proforma guardada exitosamente en la nube."))
    .catch(err => alert("Error al guardar proforma en Firebase: " + err.message));
  } else {
    const record = {
      id: "prof-" + timestamp,
      date: dateStr,
      timestamp: timestamp,
      clientName: client,
      total: total,
      data: proformaData
    };

    appState.history.unshift(record);
    if (appState.history.length > 20) {
      appState.history.pop();
    }

    localStorage.setItem("cotizador_3d_history", JSON.stringify(appState.history));
    renderHistory();
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
function deleteProformaFromHistory(historyId) {
  if (confirm("¿Seguro que deseas eliminar esta proforma del historial?")) {
    if (useFirebase && db) {
      db.collection("proformas").doc(historyId).delete()
        .catch(err => alert("Error al eliminar proforma de Firebase: " + err.message));
    } else {
      appState.history = appState.history.filter(item => item.id !== historyId);
      localStorage.setItem("cotizador_3d_history", JSON.stringify(appState.history));
      renderHistory();
    }
  }
}

// Render History UI list
function renderHistory() {
  const container = document.getElementById("history-list");
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
    div.innerHTML = `
      <div class="hist-info">
        <span class="hist-client">${item.clientName}</span>
        <span class="hist-meta">${item.date} • ${item.data.items.length} ítems</span>
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

  document.getElementById("reset-rates-btn").addEventListener("click", () => {
    appState.rates = { time: 0.04, material: 0.02 };
    rateTimeInput.value = 0.04;
    rateMaterialInput.value = 0.02;
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
