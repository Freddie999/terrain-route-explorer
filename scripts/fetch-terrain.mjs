import { PNG } from "pngjs";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { decodeTerrarium } from "../src/terrain.js";

// Fixed public tile around Boulder, Colorado. No private routes or service credentials.
const zoom = 11,
  x = 424,
  y = 775;
const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${x}/${y}.png`;
const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
if (!response.ok)
  throw new Error(`Terrain download failed: HTTP ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const png = PNG.sync.read(bytes);
if (png.width !== 256 || png.height !== 256)
  throw new Error("Unexpected tile dimensions");
const elevations = [];
for (let i = 0; i < png.data.length; i += 4) {
  if (png.data[i + 3] !== 255)
    throw new Error("Tile contains missing/transparent terrain");
  elevations.push(decodeTerrarium(...png.data.subarray(i, i + 3)));
}
const output = new URL("../public/data/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(
  new URL("terrain.json", output),
  JSON.stringify({ zoom, x, y, width: 256, height: 256, elevations }),
);
await writeFile(
  new URL("provenance.json", output),
  JSON.stringify(
    {
      url,
      retrievedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      encoding: "Terrarium: R*256+G+B/256-32768 metres",
      processing:
        "Decoded 256x256 RGB tile to numeric elevations; no smoothing or vertical datum conversion.",
      attribution:
        "Mapzen Terrain Tiles; USGS 3DEP, GMTED2010 and SRTM; NOAA ETOPO1",
      sources:
        "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
    },
    null,
    2,
  ) + "\n",
);
console.log(`Saved ${elevations.length} elevations from ${url}`);
