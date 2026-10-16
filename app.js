
"use strict";

// ================================================
// CONFIGURACION DE THINGSPEAK
// ================================================
const CHANNEL_ID = "3151173";
const REFRESH_MS = 30000;
const DEFAULT_RANGE = 1440;

// No se requiere API Key para un canal publico.
const API_URL =
  `https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json`;

const variables = [
  {
    name: "pH",
    unit: "pH",
    field: "field1",
    color: "#ed8b37",
    min: 0,
    max: 14
  },
  {
    name: "Conductividad",
    unit: "µS/cm",
    field: "field2",
    color: "#9462bc",
    min: 0,
    max: 60000
  },
  {
    name: "Oxígeno disuelto",
    unit: "mg/L",
    field: "field3",
    color: "#3989ce",
    min: 0,
    max: 20
  },
  {
    name: "Temperatura",
    unit: "°C",
    field: "field4",
    color: "#009b91",
    min: 0,
    max: 50
  },
  {
    name: "Sólidos disueltos",
    unit: "ppm",
    field: "field5",
    color: "#1766bc",
    min: 0,
    max: 50000
  },
  {
    name: "Salinidad",
    unit: "ppt",
    field: "field6",
    color: "#26966e",
    min: 0,
    max: 50
  },
  {
    name: "Gravedad específica",
    unit: "adimensional",
    field: "field7",
    color: "#00a0ae",
    min: 0,
    max: 2
  },
  {
    name: "Saturación",
    unit: "%",
    field: "field8",
    color: "#345579",
    min: 0,
    max: 150
  }
];

// Zona horaria para presentar las fechas.
const TIME_ZONE = "America/Bogota";

const $ = (selector) => document.querySelector(selector);

const rangeSelect = $("#wd-range");
const refreshButton = $("#wd-refresh");
const csvButton = $("#wd-csv");
const statusBox = $("#wd-status");
const gaugeRoot = $("#wd-gauges");
const chartRoot = $("#wd-charts");

let histories = variables.map(() => []);
let charts = [];
let gauges = [];
let busy = false;
let lastSuccessfulRead = null;

if (
  !rangeSelect ||
  !refreshButton ||
  !csvButton ||
  !statusBox ||
  !gaugeRoot ||
  !chartRoot
) {
  throw new Error("No se encontraron los elementos del dashboard.");
}

// ================================================
// FECHAS Y FORMATO
// ================================================
function formatNumber(value) {
  return new Intl.NumberFormat("es-CO", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "medium",
    hour12: false
  }).format(new Date(timestamp));
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// ================================================
// CONSTRUIR MEDIDORES Y GRAFICAS
// ================================================
function createGauge(variable, index) {
  const card = document.createElement("article");
  card.className = "gauge-card";

  card.innerHTML = `
    <h3>${escapeHTML(variable.name)}</h3>
    <canvas
      class="gauge-canvas"
      role="img"
      aria-label="Medidor de ${escapeHTML(variable.name)}"
    ></canvas>
    <div class="gauge-value">--</div>
    <div class="gauge-unit">${escapeHTML(variable.unit)}</div>
    <div class="gauge-time">Sin lecturas</div>
  `;

  gaugeRoot.appendChild(card);

  return {
    canvas: card.querySelector("canvas"),
    value: card.querySelector(".gauge-value"),
    time: card.querySelector(".gauge-time"),
    variable,
    index
  };
}

function createChart(variable, index) {
  const card = document.createElement("article");
  card.className = "chart-card";

  card.innerHTML = `
    <h3 class="chart-title">${escapeHTML(variable.name)}</h3>
    <p class="chart-subtitle">
      Unidad: ${escapeHTML(variable.unit)}
    </p>
    <div class="chart-wrap">
      <canvas
        role="img"
        aria-label="Historial de ${escapeHTML(variable.name)}"
      ></canvas>
    </div>
  `;

  chartRoot.appendChild(card);

  const canvas = card.querySelector("canvas");

  const chart = new Chart(canvas, {
    type: "line",

    data: {
      datasets: [{
        label: `${variable.name} (${variable.unit})`,
        data: [],
        borderColor: variable.color,
        backgroundColor: variable.color + "20",
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: variable.color,
        fill: true,
        tension: 0.18,
        spanGaps: false
      }]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,

      interaction: {
        mode: "nearest",
        intersect: false
      },

      plugins: {
        legend: {
          display: false
        },

        tooltip: {
          enabled: true,
          displayColors: false,

          callbacks: {
            title(items) {
              if (!items.length) return "";

              return formatDate(items[0].parsed.x);
            },

            label(context) {
              return `${variable.name}: ${
                formatNumber(context.parsed.y)
              } ${variable.unit}`;
            }
          }
        }
      },

      scales: {
        x: {
          type: "linear",

          title: {
            display: true,
            text: "Hora (Colombia)"
          },

          ticks: {
            maxTicksLimit: 6,

            callback(value) {
              return formatTime(Number(value));
            }
          },

          grid: {
            color: "#edf2f7"
          }
        },

        y: {
          title: {
            display: true,
            text: variable.unit
          },

          ticks: {
            maxTicksLimit: 6,

            callback(value) {
              return formatNumber(value);
            }
          },

          grid: {
            color: "#edf2f7"
          }
        }
      }
    }
  });

  return {
    chart,
    variable,
    index
  };
}

function initializeDashboard() {
  variables.forEach((variable, index) => {
    gauges.push(createGauge(variable, index));
    charts.push(createChart(variable, index));
  });
}

// ================================================
// DIBUJAR MEDIDORES SEMICIRCULARES
// ================================================
function drawGauge(gauge, latest) {
  const canvas = gauge.canvas;
  const width = Math.max(canvas.clientWidth, 160);
  const height = 125;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const ctx = canvas.getContext("2d");

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const variable = gauge.variable;
  const cx = width / 2;
  const cy = 91;
  const radius = Math.min(width * 0.34, 49);

  ctx.lineWidth = 10;
  ctx.lineCap = "round";

  // Arco de fondo.
  ctx.beginPath();
  ctx.arc(cx, cy, radius, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = "#e8eef5";
  ctx.stroke();

  // Arco de progreso.
  if (Number.isFinite(latest)) {
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (latest - variable.min) / (variable.max - variable.min)
      )
    );

    ctx.beginPath();
    ctx.arc(
      cx,
      cy,
      radius,
      Math.PI,
      Math.PI + Math.PI * fraction
    );
    ctx.strokeStyle = variable.color;
    ctx.stroke();

    const angle = Math.PI + Math.PI * fraction;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(
      cx + Math.cos(angle) * radius * 0.76,
      cy + Math.sin(angle) * radius * 0.76
    );
    ctx.strokeStyle = "#29465e";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Centro de la aguja.
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, 2 * Math.PI);
  ctx.fillStyle = "#29465e";
  ctx.fill();

  ctx.font = "10px sans-serif";
  ctx.fillStyle = "#718398";

  ctx.textAlign = "left";
  ctx.fillText(String(variable.min), cx - radius, cy + 19);

  ctx.textAlign = "right";
  ctx.fillText(String(variable.max), cx + radius, cy + 19);
}

// ================================================
// ACTUALIZAR LA INTERFAZ
// ================================================
function redraw() {
  gauges.forEach((gauge) => {
    const points = histories[gauge.index];
    const latest = points.length ? points[points.length - 1] : null;

    gauge.value.textContent = latest
      ? formatNumber(latest.value)
      : "--";

    gauge.time.textContent = latest
      ? `Medición: ${formatTime(latest.time)}`
      : "Sin lecturas en el periodo";

    drawGauge(
      gauge,
      latest ? latest.value : NaN
    );
  });

  charts.forEach(({ chart, index }) => {
    chart.data.datasets[0].data = histories[index].map((point) => ({
      x: point.time,
      y: point.value
    }));

    chart.update("none");
  });

  const allPoints = histories.flat();
  $("#record-count").textContent = formatNumber(allPoints.length);

  const latestTimes = histories
    .filter((points) => points.length > 0)
    .map((points) => points[points.length - 1].time);

  $("#last-reading").textContent = latestTimes.length
    ? formatDate(Math.max(...latestTimes))
    : "--";
}

// ================================================
// ESTADO DE LA CONEXION
// ================================================
function setStatus(message, state) {
  statusBox.textContent = message;
  statusBox.className = "status";

  if (state) {
    statusBox.classList.add(state);
  }

  const dot = $("#connection-dot");
  const label = $("#connection-label");

  dot.className = "dot";

  if (state === "success") {
    dot.classList.add("online");
    label.textContent = "Conectado";
  } else if (state === "error") {
    dot.classList.add("offline");
    label.textContent = "Sin conexión";
  } else {
    label.textContent = "Consultando...";
  }
}

// ================================================
// CONSULTAR THINGSPEAK
// ================================================
async function refresh() {
  if (busy) return;

  busy = true;
  refreshButton.disabled = true;
  setStatus("Consultando las mediciones de ThingSpeak...");

  const minutes = Number(rangeSelect.value) || DEFAULT_RANGE;
  const now = Date.now();
  const start = now - minutes * 60 * 1000;

  try {
    const params = new URLSearchParams({
      minutes: String(minutes),
      results: "8000"
    });

    // No se envia api_key porque el canal es publico.
    const url = `${API_URL}?${params.toString()}`;

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`Error HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.feeds)) {
      throw new Error(
        "Respuesta no valida. Verifica que el canal sea publico."
      );
    }

    const nextHistories = variables.map((variable) => {
      return data.feeds
        .map((feed) => {
          const time = Date.parse(feed.created_at);
          const raw = feed[variable.field];

          if (
            raw === null ||
            raw === undefined ||
            String(raw).trim() === ""
          ) {
            return null;
          }

          const value = Number(raw);

          if (!Number.isFinite(time) || !Number.isFinite(value)) {
            return null;
          }

          return { time, value };
        })
        .filter((point) => {
          return point !== null &&
            point.time >= start &&
            point.time <= now;
        })
        .sort((a, b) => a.time - b.time);
    });

    histories = nextHistories;
    lastSuccessfulRead = Date.now();

    redraw();

    const count = data.feeds.length;

    if (count > 0) {
      setStatus(
        `Lectura correcta. ThingSpeak devolvió ${count} registros ` +
        `para el periodo consultado.`,
        "success"
      );
    } else {
      setStatus(
        "La conexión funciona, pero no hay registros en este periodo.",
        "warning"
      );
    }

    $("#last-update").textContent =
      `Última consulta correcta: ${formatDate(lastSuccessfulRead)}`;

  } catch (error) {
    console.error("Error consultando ThingSpeak:", error);

    setStatus(
      `No fue posible consultar ThingSpeak: ${error.message}. ` +
      "Comprueba el canal público y tu conexión a Internet.",
      "error"
    );

    // Conserva las últimas lecturas válidas si falla la conexión.
    $("#last-update").textContent = lastSuccessfulRead
      ? `Última consulta correcta: ${formatDate(lastSuccessfulRead)}`
      : "Todavía no se ha recibido una lectura correcta.";

  } finally {
    busy = false;
    refreshButton.disabled = false;
  }
}

// ================================================
// DESCARGAR HISTORIAL CSV
// ================================================
function downloadCSV() {
  const allTimes = [
    ...new Set(
      histories.flatMap((points) =>
        points.map((point) => point.time)
      )
    )
  ].sort((a, b) => a - b);

  if (!allTimes.length) {
    setStatus(
      "No hay mediciones para exportar. Espera a recibir datos.",
      "warning"
    );
    return;
  }

  const lookup = histories.map((points) => {
    return new Map(points.map((point) => [point.time, point.value]));
  });

  const headers = [
    "fecha_hora",
    ...variables.map((variable) =>
      `${variable.name} (${variable.unit})`
    )
  ];

  const rows = allTimes.map((time) => {
    const values = [
      formatDate(time),
      ...lookup.map((map) => {
        const value = map.get(time);
        return value === undefined ? "" : String(value);
      })
    ];

    return values.map((value) => {
      // Escapado CSV compatible con Excel.
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(",");
  });

  const csv = "\uFEFF" + [
    headers.map((value) => `"${value}"`).join(","),
    ...rows
  ].join("\r\n");

  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;"
  });

  const objectURL = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectURL;
  link.download = `calidad-agua-${CHANNEL_ID}.csv`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
}

// ================================================
// EVENTOS E INICIALIZACION
// ================================================
rangeSelect.addEventListener("change", refresh);
refreshButton.addEventListener("click", refresh);
csvButton.addEventListener("click", downloadCSV);

let refreshTimer = null;

function startAutoRefresh() {
  if (refreshTimer !== null) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(() => {
    // Evita solicitudes innecesarias en pestañas ocultas.
    if (!document.hidden) {
      refresh();
    }
  }, REFRESH_MS);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refresh();
  }
});

window.addEventListener("resize", () => {
  gauges.forEach((gauge) => {
    const points = histories[gauge.index];
    const latest = points.length ? points[points.length - 1] : null;

    drawGauge(gauge, latest ? latest.value : NaN);
  });
});

if (typeof Chart === "undefined") {
  setStatus(
    "No se pudo cargar Chart.js. Comprueba tu conexión a Internet.",
    "error"
  );
} else {
  initializeDashboard();
  redraw();
  refresh();
  startAutoRefresh();
}
