/* Obfuscate the free-text columns of an eBird CSV export.

   The export is prose — field notes from a personal journal, naming other
   people — and it is readable by anything that can fetch a URL: the site
   serves it at /static/data/ebird.csv, and the repo is public, so GitHub
   serves the committed copy too. Base64 the two free-text columns so neither
   carries plaintext to scrape; static/js/ebird.js decodes them at parse time,
   the same click-to-reveal bargain as the email addresses in base.njk.

   This is obfuscation, not encryption. It defeats bulk scraping, not a person
   who opens the file and notices the marker.

   Used two ways:
     - eleventy.config.js calls obfuscateCsv() on the build output, so a plain
       CSV dropped in locally still publishes safely.
     - .github/workflows/deploy.yml runs this as a CLI over the committed file
       after an upload, so the repo copy is encoded within a minute of landing.

   Idempotent: already-marked values are left alone, so running it twice (or
   over an already-encoded file) is a no-op. */

import { pathToFileURL } from "url";

export const MARK = "~b64~";
export const COLUMNS = ["Checklist Comments", "Observation Details"];

/* Quote-aware walk, matching parseCSV in static/js/ebird.js — eBird comments
   contain both commas and embedded newlines, so a naive split loses rows. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue; }
        inQuotes = false; continue;
      }
      field += c; continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const quote = v => /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;

/** Returns { text, encoded } — encoded is the number of fields changed, 0 if
 *  the file was already done or has no such columns. */
export function obfuscateCsv(input) {
  let text = input, bom = false;
  if (text.charCodeAt(0) === 0xfeff) { text = text.slice(1); bom = true; }

  const rows = parseCsv(text);
  if (!rows.length) return { text: input, encoded: 0 };

  const head = rows[0].map(h => h.trim());
  const targets = COLUMNS.map(name => head.indexOf(name)).filter(i => i >= 0);
  if (!targets.length) return { text: input, encoded: 0 };

  let encoded = 0;
  for (let r = 1; r < rows.length; r++) {
    for (const c of targets) {
      const v = rows[r][c];
      if (!v || v.startsWith(MARK)) continue;
      rows[r][c] = MARK + Buffer.from(v, "utf8").toString("base64");
      encoded++;
    }
  }
  if (!encoded) return { text: input, encoded: 0 };

  const out = (bom ? "﻿" : "") +
    rows.map(r => r.map(quote).join(",")).join("\r\n") + "\r\n";
  return { text: out, encoded };
}

/* CLI: node scripts/ebird-obfuscate.mjs <file> — rewrites in place. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { readFileSync, writeFileSync } = await import("fs");
  const file = process.argv[2] || "static/data/ebird.csv";
  const { text, encoded } = obfuscateCsv(readFileSync(file, "utf8"));
  if (encoded) {
    writeFileSync(file, text, "utf8");
    console.log(`[ebird-obfuscate] encoded ${encoded} free-text field(s) in ${file}`);
  } else {
    console.log(`[ebird-obfuscate] ${file} already encoded — nothing to do`);
  }
}
