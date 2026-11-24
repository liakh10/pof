// A k6-style closed-loop load generator: `vus` virtual users, each sends its next request as soon as the last one
// answered, for `seconds` (or until `total` requests). Every latency is recorded, so percentiles are exact.
export async function load({ vus = 10, seconds = 10, total = Infinity, make, base, timeoutMs = 30_000 }) {
  const lat = [];
  const statuses = {};
  let sent = 0;
  let errors = 0;
  const end = performance.now() + seconds * 1000;
  const t0 = performance.now();
  const worker = async (vu) => {
    while (performance.now() < end && sent < total) {
      const i = sent++;
      const r = make(i, vu);
      const s = performance.now();
      try {
        const res = await fetch(base + r.path, { method: r.method ?? "GET", headers: r.headers, body: r.body, signal: AbortSignal.timeout(timeoutMs) });
        await res.arrayBuffer();
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
      } catch {
        errors++;
      }
      lat.push(performance.now() - s);
    }
  };
  await Promise.all(Array.from({ length: vus }, (_, v) => worker(v)));
  const wall = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const q = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : 0);
  return {
    requests: lat.length, rps: lat.length / wall, errors, statuses,
    p50: q(50), p95: q(95), p99: q(99), max: lat.at(-1) ?? 0, mean: lat.reduce((a, b) => a + b, 0) / (lat.length || 1),
  };
}
