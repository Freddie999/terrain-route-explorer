import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  distance,
  decodeTerrarium,
  sampleElevation,
  analyzeRoute,
  validateRoute,
} from "../src/terrain.js";
const feature = (coordinates) => ({
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates },
});

test("great-circle distance uses metres and wraps longitude", () => {
  assert.ok(Math.abs(distance([0, 0], [1, 0]) - 111195.08) < 1);
  assert.equal(distance([0, 0], [0, 0]), 0);
  assert.ok(distance([179.9, 0], [-179.9, 0]) < 23000);
});
test("Terrarium decode preserves negative and fractional heights", () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  assert.equal(decodeTerrarium(127, 255, 128), -0.5);
  assert.equal(decodeTerrarium(128, 100, 64), 100.25);
});
test("bilinear interpolation and coverage errors", () => {
  const grid = {
    zoom: 0,
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    elevations: Array(65536).fill(100),
  };
  grid.elevations[127 * 256 + 127] = 0;
  grid.elevations[127 * 256 + 128] = 100;
  grid.elevations[128 * 256 + 127] = 200;
  grid.elevations[128 * 256 + 128] = 300;
  assert.equal(sampleElevation([0, 0], grid), 150);
  assert.throws(() => sampleElevation([180, 0], grid), /coverage/);
  grid.elevations[127 * 256 + 127] = null;
  assert.throws(() => sampleElevation([0, 0], grid), /Missing/);
});
test("flat terrain has no ascent, descent or grade; endpoints retained", () => {
  const grid = {
    zoom: 0,
    x: 0,
    y: 0,
    width: 256,
    height: 256,
    elevations: Array(65536).fill(123),
  };
  const result = analyzeRoute(
    feature([
      [0, 0],
      [0, 0],
      [0.01, 0],
    ]),
    grid,
    100,
  );
  assert.ok(result.length > 1100 && result.length < 1120);
  assert.equal(result.ascent, 0);
  assert.equal(result.descent, 0);
  assert.equal(result.maxGrade, 0);
  assert.deepEqual(result.samples.at(-1).point, [0.01, 0]);
  for (let i = 1; i < result.samples.length; i++)
    assert.ok(
      result.samples[i].distance - result.samples[i - 1].distance <= 100.01,
    );
});
test("reject invalid routes and unbounded sampling", () => {
  for (const points of [
    [],
    [[0, 0]],
    [
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [180, 0],
    ],
    [
      [0, 0],
      [NaN, 1],
    ],
    [
      [0, 0, 5],
      [1, 1, 6],
    ],
  ])
    assert.throws(() => validateRoute(feature(points)));
  assert.throws(
    () =>
      analyzeRoute(
        feature([
          [0, 0],
          [0.01, 0],
        ]),
        {},
        0,
      ),
    /Spacing/,
  );
});
test("bundled data: both routes resolve; reverse swaps ascent and descent", () => {
  const grid = JSON.parse(
    readFileSync(new URL("../public/data/terrain.json", import.meta.url)),
  );
  const routes = JSON.parse(
    readFileSync(new URL("../public/data/routes.json", import.meta.url)),
  ).features;
  assert.equal(grid.elevations.length, 65536);
  for (const route of routes) {
    const result = analyzeRoute(route, grid);
    const reverse = analyzeRoute(
      feature([...route.geometry.coordinates].reverse()),
      grid,
    );
    assert.ok(result.min > 1000 && result.max < 4000);
    assert.ok(Math.abs(result.ascent - reverse.descent) < 0.001);
    assert.ok(Math.abs(result.descent - reverse.ascent) < 0.001);
    assert.ok(result.samples.every((s) => Number.isFinite(s.grade)));
  }
});
