export type Flow = {
  id: string; ticker: string; type: "call" | "put"; expiry: string; strike: number;
  time: string; premium: number; size: number; price: number | null; spot: number | null;
  volume: number | null; oi: number | null; askShare: number | null; bidShare: number | null;
  sweep: boolean; floor: boolean; multileg: boolean; opening: boolean; trades: number | null;
  rule: string; iv: number | null; delta: number | null;
};
export type Filters = { ticker: string; type: "all" | "call" | "put"; minPremium: number; maxDte: number; sweep: boolean; otm: boolean; unusual: boolean };
export const DEFAULT_FILTERS: Filters = { ticker: "", type: "all", minPremium: 50000, maxDte: 365, sweep: false, otm: false, unusual: false };
export const money = (n: number, compact = true) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 2 : 0 }).format(n);
export const number = (n: number | null) => n == null ? "—" : new Intl.NumberFormat("en-US").format(n);
export const marketDay = (time: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
export const dte = (f: Flow) => Math.round((Date.parse(f.expiry + "T00:00:00Z") - Date.parse(marketDay(f.time) + "T00:00:00Z")) / 86400000);
export const ratio = (f: Flow) => f.oi != null && f.oi > 0 && f.volume != null ? f.volume / f.oi : null;
export const otm = (f: Flow) => f.spot == null ? null : f.type === "call" ? f.strike > f.spot : f.strike < f.spot;
export function scoreParts(f: Flow) {
  const r = ratio(f);
  return [
    { label: "Premium", points: Math.min(30, Math.round(f.premium / 50000)), max: 30, detail: "$50k per point, capped at 30" },
    { label: "Volume / OI", points: r == null ? 0 : Math.min(30, Math.round(r * 6)), max: 30, detail: "6 points per 1× volume / OI, capped at 30" },
    { label: "Sweep", points: f.sweep ? 20 : 0, max: 20, detail: "20 points when the provider flags a sweep" },
    { label: "Ask concentration", points: f.askShare == null ? 0 : Math.min(20, Math.round(f.askShare * 20)), max: 20, detail: "Ask-side share × 20" },
  ];
}
export const score = (f: Flow) => scoreParts(f).reduce((s, p) => s + p.points, 0);
export const bias = (f: Flow) => f.multileg ? "Neutral" : f.askShare != null && f.askShare >= .6 ? (f.type === "call" ? "Bullish" : "Bearish") : f.bidShare != null && f.bidShare >= .6 ? (f.type === "call" ? "Bearish" : "Bullish") : "Neutral";
export function matches(f: Flow, filters: Filters) {
  const tickers = filters.ticker.toUpperCase().split(/[\s,]+/).filter(Boolean);
  return (!tickers.length || tickers.some(t => f.ticker.includes(t))) &&
    (filters.type === "all" || filters.type === f.type) && f.premium >= filters.minPremium &&
    dte(f) >= 0 && dte(f) <= filters.maxDte && (!filters.sweep || f.sweep) &&
    (!filters.otm || otm(f) === true) && (!filters.unusual || (ratio(f) ?? 0) > 1);
}
function numeric(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
const truth = (v: unknown) => v === true || v === "true" || v === "1" || v === 1;
const dateValid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export function normalize(row: Record<string, unknown>): Flow | null {
  const ticker = String(row.ticker ?? row.symbol ?? "").trim().toUpperCase();
  const type = String(row.type ?? "").toLowerCase();
  const expiry = String(row.expiry ?? row.expiration ?? "");
  const time = String(row.created_at ?? row.time ?? row.timestamp ?? "");
  const strike = numeric(row.strike), premium = numeric(row.total_premium ?? row.premium), size = numeric(row.total_size ?? row.size);
  if (!/^[A-Z0-9.\-]{1,12}$/.test(ticker) || !["call", "put"].includes(type) || !dateValid(expiry) ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(time) || !dateValid(time.slice(0, 10)) || Number.isNaN(Date.parse(time)) ||
      strike == null || strike <= 0 || premium == null || premium < 0 || size == null || size < 1 || !Number.isInteger(size)) return null;
  const validNonnegative = (v: unknown) => { const n = numeric(v); return n != null && n >= 0 ? n : null; };
  const share = (v: unknown, total: unknown) => {
    const n = numeric(v), t = numeric(total); return n != null && t != null && t > 0 && n >= 0 && n <= t ? n / t : null;
  };
  const directShare = (v: unknown) => { const n = numeric(v); return n != null && n >= 0 && n <= 1 ? n : null; };
  return {
    id: String(row.id ?? `${ticker}-${expiry}-${strike}-${type}-${time}-${premium}-${size}`), ticker, type: type as Flow["type"], expiry, strike, time,
    premium, size, price: validNonnegative(row.price), spot: validNonnegative(row.underlying_price ?? row.spot),
    volume: validNonnegative(row.volume), oi: validNonnegative(row.open_interest ?? row.oi),
    askShare: row.ask_share != null ? directShare(row.ask_share) : share(row.total_ask_side_prem, premium),
    bidShare: row.bid_share != null ? directShare(row.bid_share) : share(row.total_bid_side_prem, premium),
    sweep: truth(row.has_sweep ?? row.sweep), floor: truth(row.has_floor ?? row.floor), multileg: truth(row.has_multileg ?? row.multileg),
    opening: truth(row.all_opening_trades ?? row.opening), trades: validNonnegative(row.trade_count ?? row.trades),
    rule: String(row.alert_rule ?? row.rule ?? "Imported alert"), iv: validNonnegative(row.iv), delta: numeric(row.delta),
  };
}
export const CSV_HEADERS = ["ticker", "type", "expiry", "strike", "time", "premium", "size", "price", "spot", "volume", "oi", "ask_share", "bid_share", "sweep", "floor", "multileg", "opening", "trades", "rule", "iv", "delta"];
export function parseCSV(text: string): { flows: Flow[]; rejected: number } {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  const appendRow = () => {
    if (row.some(v => v.trim())) {
      // Count records, including rejected records, rather than physical lines.
      // The first record is the header; quoted line breaks stay within a cell.
      if (rows.length >= 10001) throw new Error("Use a CSV with at most 10,000 data rows.");
      rows.push(row);
    }
    row = [];
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (quoted || cell.length === 0) quoted = !quoted; else throw new Error("Unexpected quote in CSV."); }
    else if (!quoted && c === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (c === "\n" || c === "\r")) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); appendRow(); cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(cell); appendRow();
  const headers = rows.shift()?.map(h => h.trim().toLowerCase()) ?? [];
  if (!headers.includes("ticker") || !headers.includes("type") || !headers.includes("strike")) throw new Error("Missing CSV headers. Use the downloadable template.");
  if (new Set(headers).size !== headers.length) throw new Error("CSV has duplicate column names.");
  const flows: Flow[] = []; let rejected = 0; const seen = new Set<string>();
  for (const values of rows) {
    const f = values.length === headers.length ? normalize(Object.fromEntries(headers.map((h, i) => [h, values[i]]))) : null;
    if (!f || seen.has(f.id)) rejected++; else { flows.push(f); seen.add(f.id); }
  }
  if (!flows.length) throw new Error("No valid rows. Required: ticker, type (call/put), expiry, strike, time with timezone, premium, size.");
  return { flows, rejected };
}
const csvCell = (v: unknown) => {
  const text = String(v ?? "");
  // Avoid spreadsheet formulas in free-text provider/import fields.
  const safe = typeof v === "string" && /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return `"${safe.replaceAll('"', '""')}"`;
};
export const exportCSV = (flows: Flow[]) => [CSV_HEADERS.join(","), ...flows.map(f => CSV_HEADERS.map(k => csvCell(({ ...f, ask_share: f.askShare, bid_share: f.bidShare } as Record<string, unknown>)[k])).join(","))].join("\r\n");

// Deterministic synthetic alerts. These are never mixed into connected data.
const stocks: [string, number][] = [["NVDA", 184.52], ["SPY", 668.24], ["TSLA", 438.80], ["AAPL", 258.20], ["QQQ", 602.40], ["AMD", 164.10], ["META", 742.50], ["AMZN", 232.15], ["PLTR", 180.40], ["MSFT", 532.90], ["GOOGL", 248.20], ["IWM", 246.50]];
export const DEMO: Flow[] = Array.from({ length: 64 }, (_, i) => {
  const [ticker, spot] = stocks[i % stocks.length];
  const type = i % 5 === 1 || i % 7 === 3 ? "put" : "call";
  const price = Number((1.45 + (i * 1.37) % 12).toFixed(2));
  const size = i === 0 ? 2400 : 150 + (i * 173) % 3900;
  const premium = Math.round(size * price * 100);
  const askShare = i % 6 === 4 ? .12 : .61 + (i % 5) * .07;
  const expiry = ["2026-10-02", "2026-10-09", "2026-10-16", "2026-11-20", "2026-12-18", "2027-01-15"][i % 6];
  return { id: `demo-${i}`, ticker, spot, type, expiry, strike: Math.round((spot * (type === "call" ? 1.025 + i % 3 * .01 : .96 - i % 3 * .01)) / 5) * 5,
    time: new Date(Date.parse("2026-10-01T18:42:08Z") - i * 252000).toISOString(), premium, price, size,
    volume: 450 + (i * 257) % 14800, oi: 100 + (i * 113) % 4400, askShare, bidShare: .94 - askShare,
    sweep: i % 3 !== 1, floor: i % 9 === 4, multileg: i % 11 === 7, opening: i % 4 === 0, trades: 2 + i % 23,
    rule: i % 3 === 0 ? "RepeatedHitsAscendingFill" : "RepeatedHits", iv: .25 + i % 8 * .06, delta: (type === "call" ? 1 : -1) * (.2 + i % 5 * .1) };
});
