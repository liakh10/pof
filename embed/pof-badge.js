// <pof-badge subject="@handle"> : a live Proof of Funds status badge. No framework, shadow DOM, no dependencies.
//
//   <script type="module" src="https://<site>/embed/pof-badge.js"></script>
//   <pof-badge subject="@anon" asset="SOL" min-tier="4"></pof-badge>
//
// Attributes: subject (required), asset (SOL|USDC), min-tier (1-5), api (default: the /v1 next to this script),
// refresh (seconds, default 30, 0 = never), href (where a click goes; default the site's /verify page), compact.
// Theme with CSS custom properties on the element or any ancestor:
//   --pof-bg --pof-fg --pof-muted --pof-border --pof-live --pof-revoked --pof-font --pof-mono --pof-radius --pof-pad
// and parts: ::part(card) ::part(label) ::part(subject) ::part(tier) ::part(status) ::part(slot).
// Fires `pof-status` with { state, subject, certificate, slot } whenever the state changes.

const SCRIPT_URL = import.meta.url;

const CSS = `
:host { display: inline-block; font-family: var(--pof-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif); color: var(--pof-fg, #15161a); max-width: 100%; }
a { color: inherit; text-decoration: none; }
.card { display: inline-flex; align-items: center; gap: .6em; flex-wrap: wrap; max-width: 100%; box-sizing: border-box;
  padding: var(--pof-pad, .5em .8em); background: var(--pof-bg, #f6f5f1); border: 1px solid var(--pof-border, #d9d7cf);
  border-radius: var(--pof-radius, 8px); font-size: 14px; line-height: 1.3; }
.label { font-size: .72em; letter-spacing: .08em; text-transform: uppercase; color: var(--pof-muted, #5d6068); }
.subject { font-weight: 600; overflow-wrap: anywhere; }
.tier { font-variant-numeric: tabular-nums; }
.status { display: inline-flex; align-items: center; gap: .35em; font-weight: 700; letter-spacing: .04em; }
.dot { width: .55em; height: .55em; border-radius: 50%; background: currentColor; }
.slot { font-family: var(--pof-mono, ui-monospace, Menlo, monospace); font-size: .78em; color: var(--pof-muted, #5d6068); }
:host([data-state="live"]) .status { color: var(--pof-live, #0f6b3a); }
:host([data-state="revoked"]) .status, :host([data-state="expired"]) .status, :host([data-state="below"]) .status { color: var(--pof-revoked, #9b1c1c); }
:host([data-state="none"]) .status, :host([data-state="error"]) .status, :host([data-state="checking"]) .status { color: var(--pof-muted, #5d6068); }
:host([data-state="checking"]) .dot { animation: pof-pulse 1.2s ease-in-out infinite; }
:host([compact]) .label, :host([compact]) .slot { display: none; }
@keyframes pof-pulse { 50% { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { :host([data-state="checking"]) .dot { animation: none; } }
`;

const STATE_TEXT = { live: "LIVE", revoked: "REVOKED", expired: "EXPIRED", below: "BELOW TIER", none: "NO CERTIFICATE", error: "UNAVAILABLE", checking: "CHECKING" };
const ASSET_ID = { SOL: 0, USDC: 1, 0: 0, 1: 1 };

export class PofBadge extends HTMLElement {
  static get observedAttributes() {
    return ["subject", "asset", "min-tier", "api", "refresh", "href"];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style><a part="link"><span class="card" part="card"><span class="label" part="label">Proof of Funds</span><span class="subject" part="subject"></span><span class="tier" part="tier"></span><span class="status" part="status" role="status" aria-live="polite"><span class="dot"></span><span class="st"></span></span><span class="slot" part="slot"></span></span></a>`;
    this.$ = (s) => root.querySelector(s);
    this.timer = null;
    this.gen = 0;
    this.onVis = () => document.visibilityState === "visible" && this.load();
  }

  connectedCallback() {
    document.addEventListener("visibilitychange", this.onVis);
    this.load();
  }
  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this.onVis);
    clearTimeout(this.timer);
  }
  attributeChangedCallback() {
    if (this.isConnected) this.load();
  }

  get apiBase() {
    const a = this.getAttribute("api");
    return (a ? new URL(a, location.href) : new URL("../v1", SCRIPT_URL)).href.replace(/\/$/, "");
  }

  render(state, { subject, tierLabel = "", slot = null, revokedSlot = null } = {}) {
    if (this.dataset.state !== state) {
      this.dataset.state = state;
      this.setAttribute("data-state", state);
    }
    this.$(".subject").textContent = subject ?? "";
    this.$(".tier").textContent = tierLabel ?? "";
    this.$(".st").textContent = state === "revoked" && revokedSlot ? `REVOKED · slot ${revokedSlot}` : STATE_TEXT[state];
    this.$(".slot").textContent = slot ? `as of slot ${slot}` : "";
    const site = new URL("..", this.apiBase + "/").href.replace(/\/$/, "");
    const href = this.getAttribute("href") ?? `${site}/verify?subject=${encodeURIComponent(subject ?? "")}`;
    const a = this.$("a");
    a.setAttribute("href", href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener");
    a.setAttribute("aria-label", `Proof of Funds: ${subject ?? ""} ${tierLabel ?? ""} ${this.$(".st").textContent}`.trim());
  }

  async load() {
    clearTimeout(this.timer);
    const subject = (this.getAttribute("subject") ?? "").trim();
    const my = ++this.gen;
    if (!subject) return this.render("none", { subject: "no subject" });
    if (!this.dataset.state) this.render("checking", { subject });
    const asset = this.getAttribute("asset");
    const minTier = this.getAttribute("min-tier");
    const qs = new URLSearchParams();
    if (asset) qs.set("asset", asset);
    if (minTier && asset) qs.set("minTier", minTier);
    let state = "error";
    let detail = { subject };
    try {
      const r = await fetch(`${this.apiBase}/certificates/${encodeURIComponent(subject)}${qs.size ? `?${qs}` : ""}`, { headers: { accept: "application/json" } });
      const j = await r.json();
      if (my !== this.gen) return; // a newer load is on its way
      if (!r.ok) throw new Error(j?.error?.message ?? r.status);
      let certs = j.certificates ?? [];
      if (asset && ASSET_ID[asset.toUpperCase?.() ?? asset] !== undefined) certs = certs.filter((c) => c.assetId === ASSET_ID[asset.toUpperCase()]);
      const c = certs[0] ?? null;
      const shown = c?.subject ? (c.kind === "x" ? `@${c.subject}` : c.subject) : subject;
      detail = { subject: shown, tierLabel: c?.tierLabel ?? "", slot: j.slot, revokedSlot: c?.revokedSlot ?? null, certificate: c };
      if (!c) state = "none";
      else if (c.status === "revoked_spent" || c.status === "revoked_by_holder") state = "revoked";
      else if (c.status === "expired") state = "expired";
      else if (j.check && !j.check.ok) state = "below";
      else state = "live";
    } catch (e) {
      if (my !== this.gen) return;
      detail = { subject, error: String(e?.message ?? e) };
    }
    const changed = this.dataset.state !== state;
    this.render(state, detail);
    if (changed) this.dispatchEvent(new CustomEvent("pof-status", { detail: { state, subject: detail.subject, certificate: detail.certificate ?? null, slot: detail.slot ?? null }, bubbles: true, composed: true }));
    const every = Number(this.getAttribute("refresh") ?? 30);
    if (every > 0) this.timer = setTimeout(() => document.visibilityState !== "hidden" && this.load(), Math.max(1, every) * 1000);
  }
}

if (!customElements.get("pof-badge")) customElements.define("pof-badge", PofBadge);
