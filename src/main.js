import L from "leaflet";
import "./style.css";
import { analyzeRoute } from "./terrain.js";

const $ = (id) => document.getElementById(id);
let analysis, grid, routes, marker;
const map = L.map("map").setView([40.022, -105.305], 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const latLng = (point) => [point[1], point[0]];

function backdrop() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d"),
    img = ctx.createImageData(256, 256);
  const lo = Math.min(...grid.elevations),
    hi = Math.max(...grid.elevations);
  grid.elevations.forEach((e, i) => {
    const t = (e - lo) / (hi - lo || 1);
    img.data.set([95 + 120 * t, 133 + 73 * t, 103 + 50 * t, 255], i * 4);
  });
  ctx.putImageData(img, 0, 0);
  const lon = (x) => (x / 2 ** grid.zoom) * 360 - 180;
  const lat = (y) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** grid.zoom))) * 180) /
    Math.PI;
  const bounds = [
    [lat(grid.y + 1), lon(grid.x)],
    [lat(grid.y), lon(grid.x + 1)],
  ];
  L.imageOverlay(canvas.toDataURL(), bounds, {
    opacity: 0.6,
    attribution: "Elevation: Mapzen / USGS / NOAA",
  }).addTo(map);
  L.rectangle(bounds, {
    color: "#597967",
    weight: 1,
    fill: false,
    dashArray: "4 4",
  }).addTo(map);
}

function update(fit = false) {
  try {
    const route = routes[Number($("route").value)];
    analysis = analyzeRoute(route, grid, Number($("spacing").value));
    $("route-description").textContent =
      route.properties?.description ||
      "User-supplied route. No navigation suitability checks.";
    const threshold = Number($("threshold").value);
    $("threshold-value").textContent = `${threshold}%`;
    routeLayer.clearLayers();
    const points = analysis.samples.map((s) => latLng(s.point));
    L.polyline(points, { color: "#ffffff", weight: 8 }).addTo(routeLayer);
    for (let i = 1; i < analysis.samples.length; i++)
      L.polyline([points[i - 1], points[i]], {
        color:
          Math.abs(analysis.samples[i].grade) > threshold
            ? "#c55e3e"
            : "#145d49",
        weight: 5,
      }).addTo(routeLayer);
    if (fit) map.fitBounds(L.latLngBounds(points), { padding: [40, 40] });
    const metrics = [
      [(analysis.length / 1000).toFixed(2) + " km", "Horizontal distance"],
      [Math.round(analysis.ascent) + " m", "Sampled ascent"],
      [Math.round(analysis.descent) + " m", "Sampled descent"],
      [analysis.maxGrade.toFixed(1) + "%", "Max |grade|"],
    ];
    $("stats").replaceChildren(
      ...metrics.map(([value, label]) => {
        const box = document.createElement("div");
        const strong = document.createElement("strong");
        strong.textContent = value;
        const small = document.createElement("small");
        small.textContent = label;
        box.append(strong, small);
        return box;
      }),
    );
    const x = (s) => 55 + (s.distance / analysis.length) * 720;
    const y = (s) =>
      140 -
      ((s.elevation - analysis.min) /
        Math.max(analysis.max - analysis.min, 1)) *
        115;
    const path = analysis.samples
      .map((s, i) => `${i ? "L" : "M"}${x(s).toFixed(2)},${y(s).toFixed(2)}`)
      .join(" ");
    $("chart").innerHTML =
      `<title>Elevation from ${Math.round(analysis.min)} to ${Math.round(analysis.max)} metres over ${(analysis.length / 1000).toFixed(2)} kilometres</title><path d="${path} L775,145 L55,145 Z" fill="#e0eee4"/><path d="${path}" fill="none" stroke="#24664f" stroke-width="2.5"/><text x="0" y="30" font-size="12" fill="#526b5c">${Math.round(analysis.max)}</text><text x="0" y="143" font-size="12" fill="#526b5c">${Math.round(analysis.min)}</text><text x="55" y="172" font-size="12">0 km</text><text x="700" y="172" font-size="12">${(analysis.length / 1000).toFixed(2)} km</text>`;
    $("status").textContent =
      `${analysis.samples.length} samples · bundled public DEM · no live elevation requests`;
    $("download").disabled = false;
  } catch (error) {
    $("status").textContent = error.message;
    $("download").disabled = true;
  }
}

$("chart").addEventListener("pointermove", (event) => {
  if (!analysis) return;
  const rect = $("chart").getBoundingClientRect();
  const fraction = Math.max(
    0,
    Math.min(1, (((event.clientX - rect.left) / rect.width) * 800 - 55) / 720),
  );
  const sample = analysis.samples.reduce((best, s) =>
    Math.abs(s.distance - fraction * analysis.length) <
    Math.abs(best.distance - fraction * analysis.length)
      ? s
      : best,
  );
  if (!marker)
    marker = L.circleMarker(latLng(sample.point), {
      radius: 6,
      color: "#172e35",
      fillColor: "white",
      fillOpacity: 1,
    }).addTo(map);
  marker.setLatLng(latLng(sample.point));
  $("sample-detail").textContent =
    `${(sample.distance / 1000).toFixed(2)} km · ${sample.elevation.toFixed(1)} m elevation · ${sample.grade.toFixed(1)}% segment grade`;
});
$("route").onchange = () => update(true);
$("spacing").onchange = () => update();
$("threshold").oninput = () => update();
$("upload").onchange = async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 500000)
      throw new Error("Maximum route file size is 500 KB.");
    const route = JSON.parse(await file.text());
    analyzeRoute(route, grid, Number($("spacing").value));
    routes.push(route);
    const option = new Option(
      route.properties?.name || "Uploaded route",
      String(routes.length - 1),
    );
    $("route").add(option);
    $("route").value = String(routes.length - 1);
    update(true);
  } catch (error) {
    $("status").textContent = error.message;
  }
};
$("download").onclick = () => {
  if (!analysis) return;
  const csv =
    "distance_m,elevation_m,grade_percent,longitude,latitude\n" +
    analysis.samples
      .map((s) =>
        [s.distance, s.elevation, s.grade, ...s.point]
          .map((v) => v.toFixed(6))
          .join(","),
      )
      .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "terrain-profile.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
try {
  const load = async (path) => {
    const response = await fetch(import.meta.env.BASE_URL + path);
    if (!response.ok) throw new Error(`Cannot load ${path}`);
    return response.json();
  };
  [grid, { features: routes }] = await Promise.all([
    load("data/terrain.json"),
    load("data/routes.json"),
  ]);
  routes.forEach((r, i) =>
    $("route").add(new Option(r.properties.name, String(i))),
  );
  backdrop();
  update(true);
} catch (error) {
  $("status").textContent = error.message;
}
