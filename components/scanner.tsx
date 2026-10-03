"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Activity, ArrowDownUp, Bookmark, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Download, FileUp, Filter, Layers, ListFilter, LoaderCircle, Plug, Radar, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Star, X, Zap } from "lucide-react";
import { bias, CSV_HEADERS, DEFAULT_FILTERS, DEMO, dte, exportCSV, Filters, Flow, marketDay, matches, money, number, otm, parseCSV, ratio, score, scoreParts } from "@/lib/flow";

type Preset = { name: string; filters: Filters };
type Source = "demo" | "csv" | "uw";
type Modal = "connect" | "import" | "save" | "guide" | null;
const DEFAULT_PRESETS: Preset[] = [
  { name: "Unusual sweeps", filters: { ...DEFAULT_FILTERS, sweep: true, unusual: true } },
  { name: "Whale activity", filters: { ...DEFAULT_FILTERS, minPremium: 1000000 } },
  { name: "Short-dated calls", filters: { ...DEFAULT_FILTERS, type: "call", maxDte: 7 } },
];
const timeET = (t: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(t));
const shortDate = (t: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(t + "T00:00:00Z"));
const priceLabel = (n: number | null) => n == null ? "—" : "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const percent = (n: number | null) => n == null ? "—" : (n * 100).toFixed(0) + "%";
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function validFilters(f: unknown): f is Filters {
  if (!f || typeof f !== "object") return false;
  const v = f as Filters;
  return typeof v.ticker === "string" && ["all", "call", "put"].includes(v.type) && Number.isFinite(v.minPremium) && v.minPremium >= 0 && Number.isFinite(v.maxDte) && v.maxDte >= 0 && [v.sweep, v.otm, v.unusual].every(x => typeof x === "boolean");
}
function MiniChart({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data, 1);
  return <svg className="mini-chart" viewBox="0 0 104 37" aria-hidden="true"><polyline points={data.map((v, i) => `${i * 104 / Math.max(1, data.length - 1)},${34 - v / max * 29}`).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function ModalShell({ title, description, children, open, onClose, drawer = false }: { title: string; description: string; children: React.ReactNode; open: boolean; onClose: () => void; drawer?: boolean }) {
  return <Dialog.Root open={open} onOpenChange={v => !v && onClose()}><Dialog.Portal><Dialog.Overlay className="modal-overlay" /><Dialog.Content className={drawer ? "detail-drawer" : "modal-content"}>
    <Dialog.Close className="icon-button modal-close" aria-label="Close dialog"><X size={20} /></Dialog.Close>
    <Dialog.Title className="modal-title">{title}</Dialog.Title><Dialog.Description className="modal-description">{description}</Dialog.Description>{children}
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export default function Scanner() {
  const [flows, setFlows] = useState<Flow[]>(DEMO);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [source, setSource] = useState<Source>("demo");
  const [view, setView] = useState<"scanner" | "watchlist">("scanner");
  const [watchlist, setWatchlist] = useState<string[]>(["NVDA", "SPY", "TSLA"]);
  const [presets, setPresets] = useState<Preset[]>(DEFAULT_PRESETS);
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<Flow | null>(null);
  const [presetName, setPresetName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [csvText, setCsvText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [updated, setUpdated] = useState<string | null>(null);
  const [sort, setSort] = useState<"time" | "premium" | "score">("time");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(1);
  const [ready, setReady] = useState(false);
  const key = useRef("");
  const busy = useRef(false);
  const generation = useRef(0);
  const aborter = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("flowscope-preferences-v1") ?? "null");
      if (saved) {
        if (validFilters(saved.filters)) setFilters(saved.filters);
        if (Array.isArray(saved.watchlist)) setWatchlist(saved.watchlist.filter((s: unknown) => typeof s === "string" && /^[A-Z0-9.\-]{1,12}$/.test(s)));
        if (Array.isArray(saved.presets)) setPresets(saved.presets.filter((p: Preset) => typeof p.name === "string" && validFilters(p.filters)).slice(0, 15));
      }
    } catch { /* Device preferences are optional. */ }
    setReady(true);
    return () => { aborter.current?.abort(); key.current = ""; };
  }, []);
  useEffect(() => {
    if (ready) try { localStorage.setItem("flowscope-preferences-v1", JSON.stringify({ filters, watchlist, presets })); } catch { /* Storage may be unavailable. */ }
  }, [filters, watchlist, presets, ready]);
  useEffect(() => { setPage(1); }, [filters, view, sort, descending]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); } }, [toast]);

  const fetchFeed = useCallback(async (token: string, connecting = false) => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError("");
    const current = ++generation.current;
    const controller = new AbortController(); aborter.current = controller;
    try {
      const response = await fetch("/api/flow", { method: "POST", headers: { "Content-Type": "application/json", "X-Flow-Token": token }, body: JSON.stringify({ limit: 200 }), signal: controller.signal });
      const data = await response.json() as { flows?: Flow[]; fetchedAt: string; rejected?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load the data feed.");
      if (current !== generation.current) return;
      if (!Array.isArray(data.flows)) throw new Error("The feed returned an unexpected response.");
      setFlows(data.flows); setSource("uw"); setUpdated(data.fetchedAt); setSourceName("Unusual Whales");
      if (connecting) { key.current = token; setApiKey(""); setModal(null); setToast("Feed connected. Latest alerts loaded."); }
      if (data.rejected) setToast(`${data.rejected} incomplete or duplicate provider alerts were skipped.`);
    } catch (e) {
      if (current === generation.current && !(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : "Connection failed. Try again.");
    } finally { if (current === generation.current) { busy.current = false; setLoading(false); } }
  }, []);
  useEffect(() => {
    if (source === "uw" && auto) { const timer = setInterval(() => { if (!document.hidden && key.current) void fetchFeed(key.current); }, 60000); return () => clearInterval(timer); }
  }, [source, auto, fetchFeed]);

  const changeSource = (next: Source, data: Flow[], name = "") => {
    generation.current++; aborter.current?.abort(); busy.current = false; key.current = "";
    setApiKey(""); setLoading(false); setError(""); setSource(next); setFlows(data); setSourceName(name); setUpdated(next === "csv" ? new Date().toISOString() : null); setPage(1); setSelected(null);
  };
  const filtered = useMemo(() => flows.filter(f => matches(f, filters) && (view !== "watchlist" || watchlist.includes(f.ticker))).sort((a, b) => {
    const result = sort === "time" ? Date.parse(a.time) - Date.parse(b.time) : sort === "premium" ? a.premium - b.premium : score(a) - score(b);
    return descending ? -result : result;
  }), [flows, filters, view, watchlist, sort, descending]);
  const stats = useMemo(() => {
    const calls = filtered.filter(f => f.type === "call").reduce((s, f) => s + f.premium, 0);
    const puts = filtered.filter(f => f.type === "put").reduce((s, f) => s + f.premium, 0);
    const symbols = [...new Set(filtered.map(f => f.ticker))].map(ticker => {
      const rows = filtered.filter(f => f.ticker === ticker);
      return { ticker, premium: rows.reduce((s, f) => s + f.premium, 0), calls: rows.filter(f => f.type === "call").reduce((s, f) => s + f.premium, 0), count: rows.length };
    }).sort((a, b) => b.premium - a.premium).slice(0, 5);
    const chronological = [...filtered].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const buckets = Array.from({ length: 20 }, (_, i) => {
      const lo = Date.parse(chronological[0]?.time ?? "2026-10-01T13:30:00Z"), hi = Date.parse(chronological.at(-1)?.time ?? "2026-10-01T20:00:00Z");
      const width = Math.max((hi - lo + 1) / 20, 1);
      const rows = chronological.filter(f => Math.min(19, Math.floor((Date.parse(f.time) - lo) / width)) === i);
      return { calls: rows.filter(f => f.type === "call").reduce((s, f) => s + f.premium, 0), puts: rows.filter(f => f.type === "put").reduce((s, f) => s + f.premium, 0), time: new Date(lo + i * width).toISOString() };
    });
    return { calls, puts, symbols, buckets, sweeps: filtered.filter(f => f.sweep).length, unusual: filtered.filter(f => (ratio(f) ?? 0) > 1).length };
  }, [filtered]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pageCount);
  const rows = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  const biggest = [...filtered].sort((a, b) => b.premium - a.premium)[0];
  const total = stats.calls + stats.puts;
  const callPercent = total ? stats.calls / total * 100 : 0;
  const setFilter = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(prev => ({ ...prev, [k]: v }));
  const star = (ticker: string) => setWatchlist(prev => prev.includes(ticker) ? prev.filter(t => t !== ticker) : [...prev, ticker]);
  const sortBy = (by: typeof sort) => { if (sort === by) setDescending(v => !v); else { setSort(by); setDescending(true); } };
  const importData = (text: string, name: string) => {
    try {
      if (new TextEncoder().encode(text).byteLength > 5000000) throw new Error("Use a CSV smaller than 5 MB.");
      const result = parseCSV(text); changeSource("csv", result.flows, name); setModal(null); setCsvText("");
      setToast(`Imported ${result.flows.length} alerts${result.rejected ? `; ${result.rejected} invalid or duplicate rows skipped` : ""}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to read CSV."); }
  };
  const openModal = (m: Modal) => { setError(""); setModal(m); };
  const sourceLabel = source === "demo" ? "Sample data" : source === "csv" ? "CSV snapshot" : error ? "Feed needs attention" : "Connected feed";

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand" aria-label="FlowScope home"><span className="brand-mark"><Activity size={24} /></span>FlowScope<span className="brand-period">.</span></a>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Workspace navigation">
        <button className={view === "scanner" ? "nav-item active" : "nav-item"} onClick={() => setView("scanner")}><Radar size={19} />Flow scanner<span className="nav-pill">{flows.length}</span></button>
        <button className={view === "watchlist" ? "nav-item active" : "nav-item"} onClick={() => setView("watchlist")}><Star size={18} />Watchlist<span className="nav-count">{watchlist.length}</span></button>
      </nav>
      <div className="workspace-label saved-label">SAVED SCANNERS<button className="sidebar-plus" aria-label="Save current scanner" onClick={() => openModal("save")}>+</button></div>
      <div className="preset-list">{presets.map((p, i) => <div className="preset-row" key={p.name + i}><button onClick={() => { setFilters(p.filters); setView("scanner"); }}><Bookmark size={15} />{p.name}</button><button className="delete-preset" aria-label={`Remove ${p.name} preset`} onClick={() => setPresets(prev => prev.filter((_, index) => index !== i))}><X size={12} /></button></div>)}</div>
      <div className="sidebar-bottom">
        <div className="feed-card"><div className="feed-card-icon"><Plug size={18} /></div><strong>{source === "uw" ? "Your feed is connected" : "Your market. Your feed."}</strong><p>{source === "uw" ? "Latest 200 flow alerts, refreshed every minute." : "Connect a data provider to scan real options activity."}</p><button onClick={() => openModal("connect")}>{source === "uw" ? "Manage connection" : "Connect data feed"}<Plug size={14} /></button></div>
        <button className="help-link" onClick={() => openModal("guide")}><CircleHelp size={17} />Scanner guide</button>
        <div className="profile"><div className="avatar">L</div><div><strong>Personal workspace</strong><span>Private scanner</span></div><ShieldCheck size={16} /></div>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={14} /><strong>{view === "scanner" ? "Flow scanner" : "Watchlist"}</strong></div><div className="topbar-right"><span className={`source-status ${source === "uw" && !error ? "connected" : ""}`}><span />{sourceLabel}</span><button className="icon-button" aria-label="Scanner guide" onClick={() => openModal("guide")}><CircleHelp size={19} /></button><div className="top-avatar">L</div></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">OPTIONS INTELLIGENCE</div><h1>{view === "scanner" ? "Follow the flow." : "Your watchlist."}</h1><p>{view === "scanner" ? "Find unusual activity. Inspect the details. Build your own view." : "Options activity for the symbols you’re following."}</p></div><div className="heading-actions"><button className="button" onClick={() => openModal("import")}><FileUp size={16} />Import CSV</button><button className="button primary" onClick={() => openModal("save")}><Bookmark size={16} />Save scanner</button></div></div>
        <div className={`data-notice ${source === "demo" ? "demo-notice" : ""}`}><div><Layers size={16} /><span>{source === "demo" ? <><strong>Demo workspace</strong><span className="notice-separator">/</span>Synthetic alerts · October 1, 2026 · not live market data</> : source === "csv" ? <><strong>Imported snapshot</strong><span className="notice-separator">/</span>{sourceName} · {flows.length} alerts</> : <><strong>Unusual Whales</strong><span className="notice-separator">/</span>Latest 200 aggregated alerts · feed timing depends on your plan</>}</span></div><button onClick={() => openModal("connect")}>{source === "uw" ? "Manage feed" : "Connect a feed"}<Plug size={14} /></button></div>
        {error && !modal && <div role="alert" className="error-banner"><strong>{source === "uw" ? "Refresh failed. Displaying the last successful snapshot. " : ""}</strong>{error}<button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}

        <section className="metric-grid" aria-label="Filtered activity summary">
          <div className="metric-card"><div className="metric-label">Alert premium<Layers size={16} /></div><div className="metric-value">{money(total)}<MiniChart data={stats.buckets.map(b => b.calls + b.puts)} color="#6a7d87" /></div><div className="metric-foot">Across <strong>{filtered.length}</strong> matching alerts</div></div>
          <div className="metric-card"><div className="metric-label">Call premium<span className="type-dot call-dot" /></div><div className="metric-value">{money(stats.calls)}<MiniChart data={stats.buckets.map(b => b.calls)} color="#168868" /></div><div className="metric-foot"><span className="green-text">{callPercent.toFixed(0)}%</span> of matching premium</div></div>
          <div className="metric-card"><div className="metric-label">Put premium<span className="type-dot put-dot" /></div><div className="metric-value">{money(stats.puts)}<MiniChart data={stats.buckets.map(b => b.puts)} color="#cb6774" /></div><div className="metric-foot"><span className="red-text">{total ? (100 - callPercent).toFixed(0) : "0"}%</span> of matching premium</div></div>
          <div className="metric-card"><div className="metric-label">Unusual volume<Zap size={16} /></div><div className="metric-value">{stats.unusual}<span className="metric-unit">alerts</span><div className="unusual-bars">{stats.buckets.slice(0, 10).map((b, i) => <i key={i} style={{ height: `${8 + Math.min(28, (b.calls + b.puts) / Math.max(...stats.buckets.map(x => x.calls + x.puts), 1) * 28)}px` }} />)}</div></div><div className="metric-foot">Contract volume exceeds open interest</div></div>
        </section>

        <section className="filters-panel" aria-label="Scanner filters"><div className="filter-heading"><strong><SlidersHorizontal size={17} />Scanner filters</strong><button onClick={() => setFilters(DEFAULT_FILTERS)}>Reset filters</button></div>
          <div className="filter-controls"><label className="symbol-field"><span>Symbol</span><div><Search size={17} /><input aria-label="Filter symbols" placeholder="All symbols" value={filters.ticker} onChange={e => setFilter("ticker", e.target.value.toUpperCase())} /><span className="keyboard-hint">⌕</span></div></label>
            <label><span>Minimum premium</span><div className="select-wrap"><select aria-label="Minimum premium" value={filters.minPremium} onChange={e => setFilter("minPremium", Number(e.target.value))}>{[0, 25000, 50000, 100000, 250000, 500000, 1000000].map(n => <option key={n} value={n}>{n ? money(n) + "+" : "Any premium"}</option>)}</select><ChevronDown size={14} /></div></label>
            <label><span>Days to expiration</span><div className="select-wrap"><select aria-label="Maximum days to expiration" value={filters.maxDte} onChange={e => setFilter("maxDte", Number(e.target.value))}>{[0, 7, 30, 60, 90, 365, 3650].map(n => <option key={n} value={n}>{n === 0 ? "0 DTE" : n === 3650 ? "Any expiration" : `Within ${n} days`}</option>)}</select><ChevronDown size={14} /></div></label>
            <div className="type-control"><span>Contract type</span><div className="segmented" role="group" aria-label="Contract type">{(["all", "call", "put"] as const).map(t => <button key={t} aria-pressed={filters.type === t} className={filters.type === t ? "selected" : ""} onClick={() => setFilter("type", t)}>{t === "all" ? "All" : t === "call" ? "Calls" : "Puts"}</button>)}</div></div>
          </div><div className="filter-chips"><span className="chip-caption"><Filter size={14} />Quick filters</span>{([{ key: "sweep", name: "Sweeps only", icon: Zap }, { key: "unusual", name: "Volume > OI", icon: Activity }, { key: "otm", name: "Out of the money", icon: ListFilter }] as const).map(c => <button className={`filter-chip ${filters[c.key] ? "enabled" : ""}`} aria-pressed={filters[c.key]} key={c.key} onClick={() => setFilter(c.key, !filters[c.key])}><c.icon size={14} />{c.name}{filters[c.key] && <Check size={13} />}</button>)}<span className="result-count"><strong>{filtered.length}</strong> matching alerts</span></div>
        </section>

        <div className="analysis-grid"><section className="chart-panel"><div className="panel-heading"><h2>Premium pulse</h2><div className="chart-legend"><span><i className="call-dot" />Calls</span><span><i className="put-dot" />Puts</span><span className="small-muted">ET</span></div></div><div className="pulse-summary"><span className="green-text">{callPercent.toFixed(0)}% calls</span><span>within the filtered alerts</span></div><div className="pulse-chart" role="img" aria-label="Call and put alert premiums grouped by alert time"><div className="chart-grid"><i /><i /><i /></div>{stats.buckets.map((b, i) => { const max = Math.max(...stats.buckets.map(x => x.calls + x.puts), 1); return <div className="chart-bucket" key={i} title={filtered.length ? `${timeET(b.time)} ET · Calls ${money(b.calls)} · Puts ${money(b.puts)}` : "No matching activity"}><span style={{ height: `${b.calls / max * 100}%` }} className="call-bar" /><span style={{ height: `${b.puts / max * 100}%` }} className="put-bar" /></div>; })}</div><div className="chart-axis"><span>{filtered.length ? timeET(stats.buckets[0].time).slice(0, 5) : "No matching activity"}</span><span>{filtered.length ? timeET(stats.buckets[6].time).slice(0, 5) : ""}</span><span>{filtered.length ? timeET(stats.buckets[13].time).slice(0, 5) : ""}</span><span>{filtered.length ? timeET(stats.buckets[19].time).slice(0, 5) : ""}</span></div></section>
          <section className="radar-panel"><div className="panel-heading"><h2>Activity radar</h2><span className="small-muted">By premium</span></div><div className="radar-list">{stats.symbols.map((s, i) => <button className="radar-row" key={s.ticker} onClick={() => setFilter("ticker", s.ticker)} aria-label={`Filter ${s.ticker}`}><span className="radar-rank">0{i + 1}</span><strong>{s.ticker}</strong><div className="radar-track"><span className="call-bar" style={{ width: `${s.calls / Math.max(stats.symbols[0].premium, 1) * 100}%` }} /><span className="put-bar" style={{ width: `${(s.premium - s.calls) / Math.max(stats.symbols[0].premium, 1) * 100}%` }} /></div><b>{money(s.premium)}</b></button>)}{!stats.symbols.length && <div className="small-empty">No activity matches these filters.</div>}</div></section></div>

        <section className="feed-panel" aria-label="Options flow alerts"><div className="feed-heading"><div><h2>{view === "scanner" ? "Options flow" : "Watchlist flow"}<span className="count-badge">{filtered.length}</span></h2><span className="small-muted">{source === "demo" ? "Sample session · Oct 1, 2026" : updated ? `Updated ${timeET(updated)} ET` : ""} · Aggregated alerts</span></div><div className="feed-actions">{source === "uw" && <><label className="auto-label"><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />Auto · 60s</label><button className="icon-button" disabled={loading} aria-label="Refresh flow" onClick={() => void fetchFeed(key.current)}><RefreshCw className={loading ? "spin" : ""} size={17} /></button></>}<button className="button export-button" disabled={!filtered.length} onClick={() => download(`flowscope-${source}-${new Date().toISOString().slice(0, 10)}.csv`, exportCSV(filtered))}><Download size={15} />Export</button></div></div>
          <div className="table-scroll"><table><thead><tr><th aria-sort={sort === "time" ? descending ? "descending" : "ascending" : "none"}><button onClick={() => sortBy("time")}>Time (ET)<ArrowDownUp size={12} /></button></th><th>Symbol / contract</th><th>Activity</th><th>Bias</th><th className="numeric" aria-sort={sort === "premium" ? descending ? "descending" : "ascending" : "none"}><button onClick={() => sortBy("premium")}>Premium<ArrowDownUp size={12} /></button></th><th className="numeric">Size</th><th className="numeric">Vol / OI</th><th aria-sort={sort === "score" ? descending ? "descending" : "ascending" : "none"}><button onClick={() => sortBy("score")}>Unusual<ArrowDownUp size={12} /></button></th><th><span className="sr-only">Watchlist</span></th></tr></thead><tbody>{rows.map(f => <tr key={f.id}><td className="time-cell"><time dateTime={f.time}>{timeET(f.time)}</time>{source !== "demo" && <small>{marketDay(f.time)}</small>}</td><td><button className="contract-button" aria-label={`Inspect ${f.ticker} ${f.type} ${f.strike} expiring ${f.expiry}`} onClick={() => setSelected(f)}><span className="contract-first"><strong>{f.ticker}</strong><span className={`contract-type ${f.type}`}>{f.type === "call" ? "CALL" : "PUT"}</span><span className="strike">{priceLabel(f.strike)}</span></span><span className="contract-secondary">{shortDate(f.expiry)} · {dte(f)} DTE{otm(f) === true ? " · OTM" : ""}</span></button></td><td><span className={`activity-tag ${f.sweep ? "sweep" : ""}`}>{f.sweep && <Zap size={12} />}{f.sweep ? "SWEEP" : f.floor ? "FLOOR" : "ALERT"}</span>{f.multileg && <small className="multi-tag">Multi-leg</small>}</td><td><span className={`bias ${bias(f).toLowerCase()}`}>{bias(f)}</span></td><td className="numeric premium-cell">{money(f.premium)}</td><td className="numeric size-cell">{number(f.size)}</td><td className={`numeric ratio-cell ${(ratio(f) ?? 0) > 1 ? "green-text" : ""}`}>{ratio(f) == null ? "—" : ratio(f)!.toFixed(1) + "×"}</td><td><button className="score-button" onClick={() => setSelected(f)} aria-label={`Explain unusual score ${score(f)} for ${f.ticker}`}><span className={score(f) >= 70 ? "high-score" : ""}>{score(f)}</span><div className="score-track"><i style={{ width: `${score(f)}%` }} /></div></button></td><td><button className={`icon-button star-button ${watchlist.includes(f.ticker) ? "starred" : ""}`} aria-label={`${watchlist.includes(f.ticker) ? "Remove" : "Add"} ${f.ticker} ${watchlist.includes(f.ticker) ? "from" : "to"} watchlist`} onClick={() => star(f.ticker)}><Star size={16} fill={watchlist.includes(f.ticker) ? "currentColor" : "none"} /></button></td></tr>)}</tbody></table></div>
          {!rows.length && <div className="empty-state"><Radar size={32} /><h3>{view === "watchlist" && !watchlist.length ? "Your watchlist is empty" : "No alerts match your filters"}</h3><p>{view === "watchlist" && !watchlist.length ? "Star a symbol in the flow scanner to follow its activity." : "Try another symbol, lower the premium, or widen the expiration range."}</p><button className="button" onClick={() => { setFilters(DEFAULT_FILTERS); if (view === "watchlist" && !watchlist.length) setView("scanner"); }}>Reset view</button></div>}
          <div className="table-footer"><span>{filtered.length ? `${(currentPage - 1) * 12 + 1}–${Math.min(currentPage * 12, filtered.length)} of ${filtered.length} alerts` : "0 alerts"}<span className="footer-divider">·</span>All amounts in USD</span><div className="pagination"><button className="icon-button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></button><span>{currentPage} / {pageCount}</span><button className="icon-button" aria-label="Next page" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></button></div></div>
        </section>
        {view === "watchlist" && <div className="watchlist-chips"><span>Following</span>{watchlist.map(t => <button key={t} onClick={() => star(t)} aria-label={`Remove ${t} from watchlist`}>{t}<X size={12} /></button>)}</div>}
        {biggest && <div className="highlight-strip"><span className="highlight-icon"><Zap size={18} /></span><div><strong>Largest matching alert</strong><span>{biggest.ticker} {priceLabel(biggest.strike)} {biggest.type} · {shortDate(biggest.expiry)} · {number(biggest.size)} contracts</span></div><strong className="highlight-premium">{money(biggest.premium)}</strong><button onClick={() => setSelected(biggest)}>Inspect alert<ChevronRight size={15} /></button></div>}
        <footer className="page-footer"><span>Alert totals may overlap; they are not full-market volume. Bias is inferred, and multi-leg intent may differ.</span><button onClick={() => openModal("guide")}>How scoring works<CircleHelp size={13} /></button></footer>
      </main>
    </div>

    <ModalShell title="Connect your data feed" description="Replace sample data with your own Unusual Whales flow alerts." open={modal === "connect"} onClose={() => { setModal(null); setApiKey(""); }}>
      <div className="provider-card"><span className="provider-icon"><Activity size={23} /></span><div><strong>Unusual Whales</strong><p>Flow alerts API · U.S. options</p></div><span className="tag">SUPPORTED</span></div>
      <p className="modal-copy">You’ll need an API subscription and token from <a href="https://unusualwhales.com/public-api" target="_blank" rel="noreferrer">Unusual Whales</a>. The scanner reads the latest 200 aggregated alerts, then refreshes every 60 seconds while this tab is visible.</p>
      <form onSubmit={e => { e.preventDefault(); if (apiKey.trim()) void fetchFeed(apiKey.trim(), true); }}><label className="form-label" htmlFor="api-key">API token</label><input className="form-input" id="api-key" type="password" autoComplete="off" placeholder="Paste your API token" value={apiKey} onChange={e => setApiKey(e.target.value)} required maxLength={512} />
        <div className="privacy-note"><ShieldCheck size={17} /><span>Your token stays in this tab’s memory and is sent through the scanner’s server to Unusual Whales. It is not saved in browser storage. Reconnect after reloading. On a shared local network, use sample data; enter your token on your own localhost or an HTTPS deployment.</span></div>
        {error && <p role="alert" className="form-error">{error}</p>}<button className="button primary wide-button" disabled={loading || !apiKey.trim()}>{loading ? <><LoaderCircle size={16} className="spin" />Connecting…</> : <><Plug size={16} />Connect and load alerts</>}</button>
      </form><div className="modal-secondary">{source !== "demo" && <button className="button" onClick={() => { changeSource("demo", DEMO); setModal(null); setToast("Disconnected. Sample data restored."); }}>Disconnect and use demo</button>}<button className="text-button" onClick={() => openModal("import")}>Import a CSV instead</button></div>
    </ModalShell>

    <ModalShell title="Import options flow" description="Scan a CSV snapshot using the same filters and scoring." open={modal === "import"} onClose={() => setModal(null)}>
      <input ref={fileInput} type="file" accept=".csv,text/csv" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) { if (f.size > 5000000) setError("Use a file smaller than 5 MB."); else { try { importData(await f.text(), f.name); } catch { setError("Could not read the file."); } } e.target.value = ""; } }} />
      <button className="upload-zone" onClick={() => fileInput.current?.click()}><FileUp size={30} /><strong>Choose a CSV file</strong><span>Up to 5 MB · 10,000 rows</span></button><div className="import-or">or paste CSV data</div><textarea aria-label="CSV data" className="csv-input" placeholder={CSV_HEADERS.slice(0, 7).join(",") + "\nNVDA,call,2026-10-16,190,2026-10-01T18:42:08Z,348000,2400"} value={csvText} onChange={e => setCsvText(e.target.value)} />
      <p className="modal-copy">Required: symbol, call/put, expiration, strike, timestamp with timezone, premium, and contract size. Invalid and duplicate rows are skipped. Imported data remains in this tab.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button" onClick={() => download("flowscope-template.csv", exportCSV(DEMO.slice(0, 2)))}><Download size={15} />Sample template</button><button className="button primary" disabled={!csvText.trim()} onClick={() => importData(csvText, "Pasted CSV")}><FileUp size={15} />Load snapshot</button></div>
    </ModalShell>

    <ModalShell title="Save this scanner" description="Keep these filters handy on this device." open={modal === "save"} onClose={() => setModal(null)}>
      <form onSubmit={e => { e.preventDefault(); const name = presetName.trim(); if (!name) return; setPresets(prev => [...prev.filter(p => p.name !== name), { name, filters: { ...filters } }].slice(-15)); setPresetName(""); setModal(null); setToast("Scanner saved on this device."); }}><label htmlFor="preset-name" className="form-label">Scanner name</label><input className="form-input" id="preset-name" value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="e.g. NVDA weekly sweeps" maxLength={36} required /><div className="saved-summary"><span>{filters.ticker || "All symbols"}</span><span>{filters.type === "all" ? "Calls & puts" : filters.type + "s"}</span><span>{money(filters.minPremium)}+ premium</span><span>≤ {filters.maxDte} DTE</span>{filters.sweep && <span>Sweeps</span>}{filters.unusual && <span>Volume &gt; OI</span>}{filters.otm && <span>OTM</span>}</div><button className="button primary wide-button" disabled={!presetName.trim()}><Bookmark size={15} />Save scanner</button></form>
    </ModalShell>

    <ModalShell title="A closer look at the flow" description="What this scanner measures, and what the numbers mean." open={modal === "guide"} onClose={() => setModal(null)}>
      <div className="guide-content"><h3>Start with a question</h3><p>Search symbols, choose a minimum premium and expiration range, then use quick filters to narrow the feed. Click any contract to inspect its alert. Star symbols to build a watchlist.</p><h3>The unusual score: 0–100</h3><p>A transparent activity score: premium (up to 30), volume / open interest (up to 30), sweep flag (20), and ask-side concentration (up to 20). It is an activity ranking, not a probability or return forecast. Missing fields contribute zero.</p><h3>Bias is an inference</h3><p>At least 60% ask-side call premium is labeled bullish, and ask-side put premium bearish. Bid-dominant alerts reverse that mapping. Mixed and multi-leg alerts are neutral. Execution side does not establish a trader’s intent.</p><h3>Data boundaries</h3><p>Connected mode scans the latest 200 provider alerts, not the full tape. Aggregated alerts can overlap; adding their premiums can double count transactions. Volume / OI compares cumulative contract volume with open interest; it does not prove a position was opened. DTE is measured from the alert’s New York market date.</p><h3>Your workspace</h3><p>Saved filters and watchlists are stored on this device. CSV snapshots and API tokens are kept only in the current tab. Demo mode always contains synthetic data. Feed delays and coverage depend on your provider’s API plan.</p><a href="https://api.unusualwhales.com/docs/operations/PublicApi.OptionTradeController.flow_alerts" target="_blank" rel="noreferrer">Read the provider’s flow-alert documentation</a></div>
    </ModalShell>

    <ModalShell title={selected ? `${selected.ticker} · ${priceLabel(selected.strike)} ${selected.type.toUpperCase()}` : "Alert details"} description={selected ? `${shortDate(selected.expiry)}, ${selected.expiry.slice(0, 4)} expiration · ${dte(selected)} DTE · ${marketDay(selected.time)} at ${timeET(selected.time)} ET` : ""} open={!!selected} onClose={() => setSelected(null)} drawer>
      {selected && <><div className="detail-source"><span className="tag">{source === "demo" ? "SYNTHETIC ALERT" : source === "csv" ? "CSV SNAPSHOT" : "PROVIDER ALERT"}</span><span className={`bias ${bias(selected).toLowerCase()}`}>{bias(selected)} bias</span></div><div className="detail-premium"><span>Alert premium</span><strong>{money(selected.premium, false)}</strong><small>{number(selected.size)} contracts · {number(selected.trades)} transactions</small></div><div className="detail-grid">{[{ label: "Underlying price", value: priceLabel(selected.spot) }, { label: "Option price", value: priceLabel(selected.price) }, { label: "Contract volume", value: number(selected.volume) }, { label: "Open interest", value: number(selected.oi) }, { label: "Volume / OI", value: ratio(selected) == null ? "—" : ratio(selected)!.toFixed(2) + "×" }, { label: "Moneyness", value: otm(selected) == null ? "Unknown" : otm(selected) ? "Out of the money" : selected.strike === selected.spot ? "At the money" : "In the money" }, { label: "Implied volatility", value: percent(selected.iv) }, { label: "Delta", value: selected.delta?.toFixed(2) ?? "—" }].map(d => <div key={d.label}><span>{d.label}</span><strong>{d.value}</strong></div>)}</div><div className="execution-panel"><h3>Execution mix</h3><div className="mix-labels"><span>Ask {percent(selected.askShare)}</span><span>Bid {percent(selected.bidShare)}</span></div><div className="execution-track"><i className="call-bar" style={{ width: `${(selected.askShare ?? 0) * 100}%` }} /><i className="put-bar" style={{ width: `${(selected.bidShare ?? 0) * 100}%` }} /></div><div className="detail-tags">{selected.sweep && <span>Sweep</span>}{selected.floor && <span>Floor trade</span>}{selected.multileg && <span>Multi-leg</span>}{selected.opening && <span>Provider opening flag</span>}</div></div><div className="scoring-panel"><div className="panel-heading"><h3>Unusual score</h3><strong>{score(selected)}<span> / 100</span></strong></div>{scoreParts(selected).map(p => <div className="score-explanation" key={p.label} title={p.detail}><span>{p.label}</span><div><i style={{ width: `${p.points / p.max * 100}%` }} /></div><b>{p.points}/{p.max}</b><small>{p.detail}</small></div>)}<p>Activity ranking only. Missing data contributes zero. This score does not predict a trade’s outcome.</p></div><div className="alert-rule"><span>Provider rule</span><strong>{selected.rule}</strong></div><button className="button primary wide-button" onClick={() => star(selected.ticker)}><Star size={16} />{watchlist.includes(selected.ticker) ? "Remove from watchlist" : "Add to watchlist"}</button></>}
    </ModalShell>
    {toast && <div className="toast" role="status"><Check size={17} />{toast}<button aria-label="Dismiss notification" onClick={() => setToast("")}><X size={15} /></button></div>}
  </div>;
}
