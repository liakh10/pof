/* /link (bots/link.html, served by api/bots.js): link a Telegram or Discord account to a certificate subject.
   Logic by devx; moved out of the page so the site CSP needs no inline script. */
(() => {
  const q = Object.fromEntries(new URLSearchParams(location.search));
  const out = document.getElementById("out");
  const show = (t, cls) => { out.className = cls || ""; out.textContent = t; };
  if (!q.p || !q.u || !q.e || !q.t) { show("This link is incomplete. Ask the bot for a new one.", "bad"); return; }
  document.getElementById("who").textContent = `Linking a ${q.p === "tg" ? "Telegram" : "Discord"} account. Prove that you control the subject your certificate is about. Nothing is sent on chain and nothing is paid.`;

  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const b58 = (bytes) => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = "1" + s; else break; } return s; };

  let message = null;
  const base = location.pathname.replace(/\/$/, "");
  fetch(`${base}?${new URLSearchParams({ ...q, message: "1" })}`).then(r => r.json()).then(j => {
    if (j.error) return show(j.error, "bad");
    message = j.message; document.getElementById("tosign").textContent = message; document.getElementById("tosignx").textContent = message;
  }).catch(() => show("Could not reach the server.", "bad"));

  for (const r of document.querySelectorAll("input[name=kind]")) r.addEventListener("change", () => {
    for (const k of ["0", "1", "2"]) document.getElementById("k" + k).classList.toggle("hide", r.value !== k || !r.checked);
  });

  async function submit(subject, proof) {
    show("Checking…");
    const r = await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...q, subject, proof }) });
    const j = await r.json().catch(() => ({ error: "bad answer" }));
    if (!r.ok || j.error) return show(j.error || "Not linked.", "bad");
    const lines = [`Linked: ${j.linked}.`];
    for (const x of j.results || []) lines.push(x.action === "approved" || x.ok ? "Approved: you are in." : x.text || (x.reason === "not_linked" ? "" : `Not approved: ${x.reason}.`));
    if (q.p === "dc" && !(j.results || []).length) lines.push("Back in Discord, run /pof-verify.");
    if (q.p === "tg" && !(j.results || []).length) lines.push("Now request to join the group again, or send /status to the bot.");
    show(lines.filter(Boolean).join(" "), "ok");
  }

  // wallet picker: every injected Solana wallet that can sign messages
  const found = [];
  const add = (name, p) => { if (p && typeof p.signMessage === "function" && !found.some(f => f.p === p)) found.push({ name, p }); };
  add("Phantom", window.phantom?.solana); add("Solflare", window.solflare); add("Backpack", window.backpack?.solana ?? window.backpack);
  add("Glow", window.glowSolana); add("Wallet", window.solana);
  const sign = async (w) => {
    const res = await w.p.connect();
    const pk = (res?.publicKey ?? w.p.publicKey).toString();
    const signed = await w.p.signMessage(new TextEncoder().encode(message), "utf8");
    return { pk, sig: b58(new Uint8Array(signed?.signature ?? signed)) };
  };
  if (!found.length) document.getElementById("nowallet").classList.remove("hide");
  for (const [boxId, kind] of [["wallets", 0], ["xwallets", 1]]) {
    const box = document.getElementById(boxId);
    for (const w of found) {
      const b = document.createElement("button"); b.textContent = `Sign with ${w.name}`;
      b.onclick = async () => {
        if (!message) return show("Still loading, try again in a moment.");
        try {
          const { pk, sig } = await sign(w);
          await submit(kind === 0 ? { kind: 0, value: pk } : { kind: 1, value: document.getElementById("handle").value }, sig);
        } catch (e) { show(e?.message || "The wallet did not sign.", "bad"); }
      };
      box.appendChild(b);
    }
  }
  document.getElementById("sendx").onclick = () => submit({ kind: 1, value: document.getElementById("handle").value }, document.getElementById("xsig").value.trim());
  document.getElementById("sendb").onclick = () => submit({ kind: 2, value: document.getElementById("badge").value.trim() }, document.getElementById("bsig").value.trim());
})();
