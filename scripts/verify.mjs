import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const { DEMO, normalize, dte, marketDay, ratio, bias, score, scoreParts, matches, DEFAULT_FILTERS, parseCSV, exportCSV } = await import(pathToFileURL(root + '/lib/flow.ts'));
let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const providerRow = { ticker: 'MSFT', type: 'call', expiry: '2023-12-22', strike: '375', created_at: '2023-12-12T16:35:52.168490Z', total_premium: '186705', total_size: 461, price: '4.05', underlying_price: '372.99', volume: 2442, open_interest: 7913, total_ask_side_prem: '151875', total_bid_side_prem: '405', has_sweep: true, has_multileg: false, trade_count: 32, alert_rule: 'RepeatedHits' };
const f = normalize(providerRow);
check('official provider example normalizes', () => { assert.ok(f); assert.equal(f.size, 461); assert.equal(f.premium, 186705); assert.equal(f.sweep, true); assert.equal(f.askShare, 151875 / 186705); });
check('market date uses New York before midnight UTC', () => assert.equal(marketDay('2026-10-02T01:00:00Z'), '2026-10-01'));
check('DTE is measured at alert time', () => assert.equal(dte(f), 10));
check('same-day expiration is zero DTE', () => assert.equal(dte({ ...f, expiry: '2023-12-12' }), 0));
check('zero OI remains unknown', () => assert.equal(ratio({ ...f, oi: 0 }), null));
check('missing volume remains unknown', () => assert.equal(ratio({ ...f, volume: null }), null));
check('put ask dominance is bearish', () => assert.equal(bias({ ...f, type: 'put' }), 'Bearish'));
check('call bid dominance is bearish', () => assert.equal(bias({ ...f, askShare: .1, bidShare: .8 }), 'Bearish'));
check('multi-leg alerts remain neutral', () => assert.equal(bias({ ...f, multileg: true }), 'Neutral'));
check('score is transparent and capped', () => { const big = { ...f, premium: 9999999, volume: 1000000, oi: 1, askShare: 1 }; assert.equal(score(big), 100); assert.equal(scoreParts(big).reduce((s, p) => s + p.points, 0), 100); });
check('invalid type is rejected', () => assert.equal(normalize({ ...providerRow, type: 'stock' }), null));
check('invalid date is rejected', () => assert.equal(normalize({ ...providerRow, expiry: '2026-02-30' }), null));
check('impossible timestamp calendar day is rejected', () => assert.equal(normalize({ ...providerRow, created_at: '2026-02-30T12:00:00Z' }), null));
check('valid leap day and offset timestamps are preserved', () => {
  assert.ok(normalize({ ...providerRow, created_at: '2024-02-29T23:30:00-12:00' }));
  assert.ok(normalize({ ...providerRow, created_at: '2026-01-01T00:30:00+14:00' }));
});
check('timezone-free timestamp is rejected', () => assert.equal(normalize({ ...providerRow, created_at: '2026-10-01T14:00:00' }), null));
check('fractional contract size is rejected', () => assert.equal(normalize({ ...providerRow, total_size: 1.5 }), null));
check('negative premium is rejected', () => assert.equal(normalize({ ...providerRow, total_premium: -1 }), null));
check('impossible share remains unknown', () => assert.equal(normalize({ ...providerRow, total_ask_side_prem: '999999' }).askShare, null));
check('CSV round-trip retains all fields', () => { const out = parseCSV(exportCSV(DEMO)); assert.equal(out.flows.length, 64); assert.equal(out.rejected, 0); assert.equal(out.flows[0].askShare, DEMO[0].askShare); assert.equal(out.flows[0].delta, DEMO[0].delta); });
check('quoted multiline CSV fields round-trip', () => { const out = parseCSV(exportCSV([{ ...DEMO[0], rule: 'A, "quoted"\nrule' }])); assert.equal(out.flows[0].rule, 'A, "quoted"\nrule'); });
check('CSV BOM and CRLF are supported', () => assert.equal(parseCSV('\uFEFF' + exportCSV(DEMO.slice(0, 1))).flows.length, 1));
check('CSV duplicates are skipped', () => { const out = parseCSV(exportCSV([DEMO[0], DEMO[0]])); assert.equal(out.flows.length, 1); assert.equal(out.rejected, 1); });
check('malformed CSV does not load', () => assert.throws(() => parseCSV('ticker,type,strike\n"unclosed'), /unclosed/));
check('CSV row cap applies to CR, LF and CRLF records', () => {
  const header = 'ticker,type,expiry,strike,time,premium,size';
  const row = 'NVDA,call,2026-10-16,190,2026-10-01T18:42:08Z,348000,2400';
  for (const separator of ['\r', '\n', '\r\n']) {
    assert.equal(parseCSV([header, ...Array(10000).fill(row)].join(separator)).flows.length, 1);
    assert.throws(() => parseCSV([header, ...Array(10001).fill(row)].join(separator)), /10,000/);
  }
});
check('quoted line breaks do not consume CSV row allowance', () => {
  const text = exportCSV(Array.from({ length: 10000 }, () => ({ ...DEMO[0], rule: 'line one\nline two' })));
  const result = parseCSV(text);
  assert.equal(result.flows.length, 1);
  assert.equal(result.rejected, 9999);
});
check('missing optional fields stay unknown', () => { const out = parseCSV('ticker,type,expiry,strike,time,premium,size\nNVDA,call,2026-10-16,190,2026-10-01T18:42:08Z,348000,2400'); assert.equal(out.flows[0].spot, null); assert.equal(out.flows[0].askShare, null); assert.equal(ratio(out.flows[0]), null); });
check('spreadsheet formula text is escaped on export', () => assert.ok(exportCSV([{ ...DEMO[0], rule: '=HYPERLINK("x")' }]).includes("'=HYPERLINK")));
check('combined filters have correct rows', () => { const out = DEMO.filter(x => matches(x, { ...DEFAULT_FILTERS, ticker: 'NVDA', type: 'call', maxDte: 7, unusual: true })); assert.equal(out.length, 3); assert.ok(out.every(x => x.type === 'call' && ratio(x) > 1 && dte(x) <= 7)); });
check('empty symbol results are empty', () => assert.equal(DEMO.filter(x => matches(x, { ...DEFAULT_FILTERS, ticker: 'ZZZZ' })).length, 0));


// Exercise the real route code against a mocked provider. No API account is used.
let routeSource = await fs.readFile(root + '/app/api/flow/route.ts', 'utf8');
routeSource = routeSource.replace('"@/lib/flow"', JSON.stringify(pathToFileURL(root + '/lib/flow.ts').href));
const routeDirectory = await fs.mkdtemp(path.join(tmpdir(), 'flowscope-test-'));
const routeFile = path.join(routeDirectory, 'flow-route.mts');
await fs.writeFile(routeFile, routeSource);
const { POST } = await import(pathToFileURL(routeFile).href);
const realFetch = globalThis.fetch;
let called = 0;
const request = (body = { limit: 200 }, origin = 'https://scanner.test', token = 'dummy-test-token') => new Request('https://scanner.test/api/flow', { method: 'POST', headers: { 'origin': origin, 'content-type': 'application/json', 'x-flow-token': token }, body: JSON.stringify(body) });
globalThis.fetch = async (url, options) => { called++; assert.equal(url.origin, 'https://api.unusualwhales.com'); assert.equal(url.pathname, '/api/option-trades/flow-alerts'); assert.equal(url.searchParams.get('limit'), '200'); assert.equal(options.headers.Authorization, 'Bearer dummy-test-token'); return Response.json({ data: [providerRow, providerRow] }); };
let response = await POST(request()); let data = await response.json();
check('real route forwards correctly and deduplicates', () => { assert.equal(response.status, 200); assert.equal(data.flows.length, 1); assert.equal(data.rejected, 1); assert.ok(data.fetchedAt); assert.ok(!JSON.stringify(data).includes('dummy-test-token')); });
response = await POST(request({}, 'https://other.test'));
check('cross-origin request rejected before provider call', () => { assert.equal(response.status, 403); assert.equal(called, 1); });
response = await POST(request({}, 'https://scanner.test', 'bad'));
check('bad token rejected before provider call', () => { assert.equal(response.status, 400); assert.equal(called, 1); });
response = await POST(request({ limit: 999 }));
check('invalid limit rejected before provider call', () => { assert.equal(response.status, 400); assert.equal(called, 1); });
for (const host of ['localhost:3000', '192.168.1.20:3000']) {
  response = await POST(new Request('http://0.0.0.0:3000/api/flow', { method: 'POST', headers: { host, origin: `http://${host}`, 'x-forwarded-proto': 'http', 'content-type': 'application/json', 'x-flow-token': 'bad' }, body: '{}' }));
  check(`browser Host works despite internal URL (${host})`, () => assert.equal(response.status, 400));
}
response = await POST(new Request('http://internal:3000/api/flow', { method: 'POST', headers: { host: 'scanner.test', origin: 'https://scanner.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json', 'x-flow-token': 'bad' }, body: '{}' }));
check('HTTPS proxy origin reaches token validation', () => assert.equal(response.status, 400));
response = await POST(new Request('http://internal:3000/api/flow', { method: 'POST', headers: { host: 'scanner.test', origin: 'https://other.test', 'x-forwarded-proto': 'https', 'content-type': 'application/json', 'x-flow-token': 'dummy-test-token' }, body: '{}' }));
check('Host validation still rejects a different browser origin', () => { assert.equal(response.status, 403); assert.equal(called, 1); });
globalThis.fetch = async () => new Response('', { status: 401 }); response = await POST(request());
check('provider authentication failure is actionable', () => assert.equal(response.status, 401));
globalThis.fetch = async () => new Response('', { status: 429 }); response = await POST(request());
check('provider rate limit is surfaced', () => assert.equal(response.status, 429));
globalThis.fetch = async () => Response.json({ data: [] }); response = await POST(request()); data = await response.json();
check('empty provider feed never inserts samples', () => { assert.equal(response.status, 200); assert.equal(data.flows.length, 0); });
globalThis.fetch = async () => Response.json({ unexpected: [] }); response = await POST(request());
check('malformed provider response becomes an error', () => assert.equal(response.status, 502));
globalThis.fetch = realFetch;
await fs.rm(routeDirectory, { recursive: true, force: true });
console.log(`${checks} substantive checks passed.`);
