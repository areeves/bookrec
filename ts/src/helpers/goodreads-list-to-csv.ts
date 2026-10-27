/**
 * Fetch a public Goodreads Listopia list into a CSV file.
 *
 * Setup (Node 18+):
 *   npm install cheerio
 *   npm install -D tsx typescript @types/node
 *
 * Usage:
 *   npx tsx goodreads-list-to-csv.ts                       # list 88, all pages
 *   npx tsx goodreads-list-to-csv.ts 88 -o fantasy21.csv   # list id / output
 *   npx tsx goodreads-list-to-csv.ts 88 --max-pages 2      # quick test run
 *   npx tsx goodreads-list-to-csv.ts 88 --delay 3          # seconds between requests
 *
 * The list id is the number in https://www.goodreads.com/list/show/88
 * Rows are appended as each page arrives, so an interrupted run keeps its progress.
 * Be polite and check Goodreads' terms of service before heavy or repeated use.
 */

import { createWriteStream } from "node:fs";
import { once } from "node:events";
import * as cheerio from "cheerio";

const BASE = "https://www.goodreads.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const FIELDS = [
  "rank",
  "title",
  "author",
  "avg_rating",
  "num_ratings",
  "score",
  "num_voters",
  "url",
] as const;

type Row = Record<(typeof FIELDS)[number], string | number>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toInt(text: string | undefined): number | "" {
  const digits = (text ?? "").replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : "";
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchPage(url: string, retries = 4): Promise<string | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(30_000),
      });
      if (resp.ok) return await resp.text();
      if (resp.status === 404) return null;
      console.error(`  HTTP ${resp.status} for ${url}`);
    } catch (err) {
      console.error(`  request error: ${(err as Error).message}`);
    }
    await sleep(5000 * 2 ** attempt);
  }
  return null;
}

function parseRows(html: string): Row[] {
  const $ = cheerio.load(html);
  const rows: Row[] = [];

  $("table.tableList tr").each((_, el) => {
    const tr = $(el);
    const titleA = tr.find("a.bookTitle").first();
    if (titleA.length === 0) return;

    const text = tr.text().replace(/\s+/g, " ").trim();
    const avg = text.match(/([\d.]+)\s+avg rating/);
    const nrat = text.match(/([\d,]+)\s+ratings?/);
    const score = text.match(/score:\s*([\d,]+)/);
    const voters = text.match(/([\d,]+)\s+people? voted/);
    const href = (titleA.attr("href") ?? "").split("?")[0];

    rows.push({
      rank: toInt(tr.find("td.number").first().text()),
      title: (titleA.find("span").first().text() || titleA.text()).trim(),
      author: tr.find("a.authorName span").first().text().trim(),
      avg_rating: avg ? avg[1] : "",
      num_ratings: nrat ? toInt(nrat[1]) : "",
      score: score ? toInt(score[1]) : "",
      num_voters: voters ? toInt(voters[1]) : "",
      url: BASE + href,
    });
  });

  return rows;
}

function parseArgs(argv: string[]) {
  const opts = { listId: "88", output: "goodreads_list.csv", maxPages: 0, delay: 2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") opts.output = argv[++i];
    else if (a === "--max-pages") opts.maxPages = parseInt(argv[++i], 10);
    else if (a === "--delay") opts.delay = parseFloat(argv[++i]);
    else if (!a.startsWith("-")) opts.listId = a;
  }
  return opts;
}

async function main() {
  const { listId, output, maxPages, delay } = parseArgs(process.argv.slice(2));

  const out = createWriteStream(output, { encoding: "utf8" });
  out.write(FIELDS.join(",") + "\n");

  const seen = new Set<string>();
  let total = 0;

  for (let page = 1; !maxPages || page <= maxPages; page++) {
    const url = `${BASE}/list/show/${listId}?page=${page}`;
    console.log(`Page ${page}: ${url}`);

    const html = await fetchPage(url);
    if (html === null) {
      console.log("  no more pages (or fetch failed); stopping.");
      break;
    }

    const rows = parseRows(html).filter((r) => !seen.has(String(r.url)));
    if (rows.length === 0) {
      console.log("  no new rows; stopping.");
      break;
    }

    for (const r of rows) {
      seen.add(String(r.url));
      out.write(FIELDS.map((f) => csvCell(r[f])).join(",") + "\n");
    }
    total += rows.length;
    console.log(`  +${rows.length} (total ${total})`);

    await sleep(delay * 1000);
  }

  out.end();
  await once(out, "finish");
  console.log(`Done: ${total} books written to ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
