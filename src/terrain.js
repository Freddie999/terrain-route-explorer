/** Pure math and validation; no map, network or DOM dependencies. */
export const EARTH_RADIUS = 6371008.8;
const radians = (value) => (value * Math.PI) / 180;

export function distance(a, b) {
  const dlat = radians(b[1] - a[1]);
  const dlon = radians(b[0] - a[0]);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(dlon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function worldPixel([lon, lat], zoom) {
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lon) > 180 ||
    Math.abs(lat) > 85.05112878
  ) {
    throw new Error(
      "Coordinates must be finite WGS84 positions within Web Mercator bounds.",
    );
  }
  const scale = 256 * 2 ** zoom;
  return [
    ((lon + 180) / 360) * scale,
    ((1 - Math.asinh(Math.tan(radians(lat))) / Math.PI) / 2) * scale,
  ];
}

export function decodeTerrarium(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

export function sampleElevation(point, grid) {
  const [px, py] = worldPixel(point, grid.zoom);
  const x = px - grid.x * 256 - 0.5;
  const y = py - grid.y * 256 - 0.5;
  // Pixel-center sampling. No invented values beyond the available raster.
  if (x < 0 || y < 0 || x > grid.width - 1 || y > grid.height - 1) {
    throw new Error("Route leaves the bundled elevation coverage.");
  }
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, grid.width - 1),
    y1 = Math.min(y0 + 1, grid.height - 1);
  const values = [
    grid.elevations[y0 * grid.width + x0],
    grid.elevations[y0 * grid.width + x1],
    grid.elevations[y1 * grid.width + x0],
    grid.elevations[y1 * grid.width + x1],
  ];
  if (values.some((v) => !Number.isFinite(v)))
    throw new Error("Missing elevation sample.");
  const dx = x - x0,
    dy = y - y0;
  return (
    values[0] * (1 - dx) * (1 - dy) +
    values[1] * dx * (1 - dy) +
    values[2] * (1 - dx) * dy +
    values[3] * dx * dy
  );
}

export function validateRoute(route) {
  if (
    route?.type !== "Feature" ||
    route.geometry?.type !== "LineString" ||
    "crs" in route ||
    "crs" in route.geometry
  ) {
    throw new Error(
      "Expected a WGS84 GeoJSON LineString Feature without a CRS member.",
    );
  }
  const points = route.geometry.coordinates;
  if (!Array.isArray(points) || points.length < 2 || points.length > 2000)
    throw new Error("Use 2–2,000 route vertices.");
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    if (!Array.isArray(points[i]) || points[i].length !== 2)
      throw new Error("Use 2D longitude/latitude positions.");
    worldPixel(points[i], 0);
    if (i) {
      if (Math.abs(points[i][0] - points[i - 1][0]) > 180)
        throw new Error("Dateline crossings are unsupported.");
      length += distance(points[i - 1], points[i]);
    }
  }
  if (length < 1 || length > 50000)
    throw new Error("Route length must be between 1 m and 50 km.");
  return points;
}

export function analyzeRoute(route, grid, spacing = 100) {
  if (!Number.isFinite(spacing) || spacing < 25 || spacing > 1000)
    throw new Error("Spacing must be 25–1,000 m.");
  const vertices = validateRoute(route);
  const samples = [
    {
      point: vertices[0],
      distance: 0,
      elevation: sampleElevation(vertices[0], grid),
      grade: 0,
    },
  ];
  let cumulative = 0;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1],
      b = vertices[i];
    const length = distance(a, b);
    if (length < 0.01) continue;
    const steps = Math.ceil(length / spacing);
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      const elevation = sampleElevation(point, grid);
      const previous = samples.at(-1);
      const along = cumulative + length * t;
      samples.push({
        point,
        elevation,
        distance: along,
        grade:
          (100 * (elevation - previous.elevation)) /
          (along - previous.distance),
      });
    }
    cumulative += length;
  }
  let ascent = 0,
    descent = 0,
    maxGrade = 0;
  for (let i = 1; i < samples.length; i++) {
    const delta = samples[i].elevation - samples[i - 1].elevation;
    ascent += Math.max(delta, 0);
    descent += Math.max(-delta, 0);
    maxGrade = Math.max(maxGrade, Math.abs(samples[i].grade));
  }
  return {
    samples,
    length: cumulative,
    ascent,
    descent,
    maxGrade,
    min: Math.min(...samples.map((s) => s.elevation)),
    max: Math.max(...samples.map((s) => s.elevation)),
  };
}
