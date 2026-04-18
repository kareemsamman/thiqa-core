// One-off: extract the raster image embedded in thiqa-logo-icon.svg
// and emit small PNG + WebP assets. The original "SVG" is a 3750x4096
// base64 PNG wrapped in SVG markup — 3.2 MB over the wire — which is
// why the login logo visibly lags on first paint. A 512px raster is
// plenty for any place the logo renders (biggest use is 104px @2x).

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const svgPath = path.resolve("src/assets/thiqa-logo-icon.svg");
const outPng = path.resolve("src/assets/thiqa-logo-icon.png");
const outWebp = path.resolve("src/assets/thiqa-logo-icon.webp");

const svg = fs.readFileSync(svgPath, "utf8");

// Pull the first data URI out of the SVG (xlink:href="data:image/png;base64,…")
const match = svg.match(/data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/);
if (!match) {
  console.error("No embedded base64 image found in the SVG.");
  process.exit(1);
}

const buf = Buffer.from(match[2], "base64");
console.log(`embedded image: ${match[1]} · ${(buf.byteLength / 1024).toFixed(1)} KB`);

const pipeline = sharp(buf).resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } });

await pipeline.clone().png({ compressionLevel: 9 }).toFile(outPng);
await pipeline.clone().webp({ quality: 90 }).toFile(outWebp);

const png = fs.statSync(outPng);
const webp = fs.statSync(outWebp);
console.log(`out · PNG ${(png.size / 1024).toFixed(1)} KB · WebP ${(webp.size / 1024).toFixed(1)} KB`);
