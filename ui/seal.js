/* The POF seal: concentric rings (the Privacy Rings) on one even module, a black disc with the check cut out of it.
   Pure functions that return SVG markup, so the same seal is drawn by the page, the share card, the build and the film.
   Colours are CSS variables in the page and literals on the server (pass `colors`).

   Geometry (viewBox units): module M = 18. The disc is 7M, the segmented ring sits at 8M, then one ring every M from 9M to
   25M. Three weights only: hair 2, mid 6, band 14. Two rings carry the signal colour: the band at 10M and the mid at 14M.
   States: live (signal rings whole), revoked (the band at 10M opens with one clean 36° break at the upper right and turns to
   ink; the mid signal ring goes to ink), expired (signal rings and disc go quiet). Motion: ui/site.css (.seal .rg draw,
   .seal .spin rotate, .seal.breaking opens the break). */

const PAGE = { paper: 'var(--paper)', ink: 'var(--ink)', signal: 'var(--signal)', quiet: 'var(--ink-3)' };
export const LITERAL = { paper: '#f3efe6', ink: '#1b1916', signal: '#f2611d', quiet: '#8a857b' };

export const M = 18;
export const W = { hair: 2, mid: 6, band: 14 };
/** the rings outside the segmented ring: [radius, weight, role]; role: ink | signal | break (the signal band that breaks) */
export const PLAN = (() => {
  const out = [];
  for (let k = 9; k <= 25; k++) {
    const r = k * M;
    if (k === 10) out.push([r, W.band, 'break']);
    else if (k === 12) out.push([r, W.mid, 'ink']);
    else if (k === 14) out.push([r, W.mid, 'signal']);
    else out.push([r, W.hair, 'ink']);
  }
  return out;
})();
export const BREAK = { at: 315, deg: 36 };   // the break: centred at 315° (upper right), 36° wide
/** stroke-dasharray / stroke-dashoffset in real lengths (no pathLength: every renderer agrees) for a ring of radius r with
    one clean gap of `deg` centred at `at` degrees (0 = 3 o'clock, clockwise) */
export function gapDash(r, deg = BREAK.deg, at = BREAK.at) {
  const C = 2 * Math.PI * r, g = C * deg / 360, start = C * (((at + deg / 2) % 360) / 360);
  return { dasharray: `${(C - g).toFixed(2)} ${g.toFixed(2)}`, dashoffset: (-start).toFixed(2), C: +C.toFixed(2), closed: (-(C * at / 360)).toFixed(2) };
}

/** The full seal. opts: { size, state, rings (how many of PLAN), crosshair, colors, check, title } */
export function sealSVG(opts = {}) {
  const c = opts.colors || PAGE;
  const state = opts.state || 'live';
  const dead = state === 'revoked', faded = state === 'expired';
  const plan = PLAN.slice(0, opts.rings ?? PLAN.length);
  const R = plan[plan.length - 1][0] + M;
  const parts = [];
  if (opts.crosshair !== false) parts.push(`<g class="xh" stroke="${c.ink}" stroke-width="1.5"${faded ? ' opacity=".4"' : ''}><line x1="${-R}" y1="0" x2="${R}" y2="0"/><line x1="0" y1="${-R}" x2="0" y2="${R}"/></g>`);
  plan.forEach(([r, w, role], i) => {
    const sig = role === 'signal' || role === 'break';
    const stroke = sig ? (dead ? c.ink : faded ? c.quiet : c.signal) : c.ink;
    let extra = '', cls = 'rg' + (sig ? ' sig' : '');
    let pl = ' pathLength="1000"';
    if (role === 'break') { cls += ' brk'; if (dead) { const d = gapDash(r); extra = ` stroke-dasharray="${d.dasharray}" stroke-dashoffset="${d.dashoffset}"`; cls += ' broken'; pl = ''; } }
    parts.push(`<circle class="${cls}" style="--i:${i}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${w}"${pl}${extra}${faded && !sig ? ' opacity=".5"' : ''}/>`);
  });
  // the segmented ring at 8M: twelve equal segments, equal gaps, turning slowly
  const seg = 2 * Math.PI * 8 * M / 12;
  parts.push(`<g class="spin"><circle r="${8 * M}" fill="none" stroke="${c.ink}" stroke-width="${W.mid + 4}" stroke-dasharray="${(seg * 0.8).toFixed(2)} ${(seg * 0.2).toFixed(2)}" stroke-dashoffset="${(seg * 0.1).toFixed(2)}"/></g>`);
  parts.push(`<circle class="disc" r="${7 * M}" fill="${faded ? c.quiet : c.ink}"/>`);
  if (opts.check !== false) parts.push(`<path class="check" d="M -54 -2 L -16 36 L 60 -40" stroke="${c.paper}" stroke-width="30" fill="none" stroke-linecap="square" stroke-linejoin="miter" pathLength="1000"/>`);
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  return `<svg class="seal seal-${state}" viewBox="${-R} ${-R} ${2 * R} ${2 * R}"${size} xmlns="http://www.w3.org/2000/svg" role="img"${opts.title ? '' : ' aria-hidden="true"'}>${title}${parts.join('')}</svg>`;
}

/** The small mark (logo, favicon, card icons): a hair ring, the signal ring, the disc, the check; revoked = one clean break. */
export function markSVG(opts = {}) {
  const c = opts.colors || PAGE;
  const state = opts.state || 'live';
  const ring = state === 'revoked' ? c.ink : state === 'expired' ? c.quiet : c.signal;
  const d = gapDash(37, 40);
  const broken = state === 'revoked' ? ` stroke-dasharray="${d.dasharray}" stroke-dashoffset="${d.dashoffset}"` : '';
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  return `<svg class="mark mark-${state}" viewBox="-50 -50 100 100"${size} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<circle r="46" fill="none" stroke="${c.ink}" stroke-width="2.5"/>`
    + `<circle r="37" fill="none" stroke="${ring}" stroke-width="8"${broken}/>`
    + `<circle r="26" fill="${state === 'expired' ? c.quiet : c.ink}"/>`
    + `<path d="M -11 0 L -3 8 L 12 -7" stroke="${c.paper}" stroke-width="7" fill="none" stroke-linecap="square" stroke-linejoin="miter"/></svg>`;
}

/** The certificate card as poster art (bars, a small seal, a corner of rings): no text, no figures. */
export function cardArtSVG(opts = {}) {
  const c = opts.colors || PAGE;
  const bar = (x, y, w, h, col) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${col}"/>`;
  const rings = [10, 18, 26, 34].map((r, i) => `<circle cx="372" cy="44" r="${r}" fill="none" stroke="${i === 1 ? c.signal : c.ink}" stroke-width="${i === 1 ? 6 : 3}"/>`).join('');
  return `<svg class="cardart" viewBox="0 0 420 270" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<rect x="3" y="3" width="414" height="264" fill="${c.paper}" stroke="${c.ink}" stroke-width="6"/>`
    + `<rect x="3" y="3" width="414" height="264" fill="none" stroke="${c.ink}" stroke-width="1.5" transform="translate(9 9) scale(.957 .933)"/>`
    + `<clipPath id="ca-clip"><rect x="330" y="10" width="80" height="70"/></clipPath><g clip-path="url(#ca-clip)">${rings}</g>`
    + bar(36, 40, 150, 12, c.ink) + bar(36, 62, 220, 5, c.ink)
    + bar(36, 98, 96, 26, c.signal) + bar(144, 98, 150, 26, c.signal)
    + bar(36, 140, 180, 8, c.ink) + bar(228, 140, 70, 8, c.ink) + bar(310, 132, 26, 26, c.signal) + bar(342, 132, 26, 26, c.ink) + bar(374, 132, 26, 26, c.signal)
    + bar(36, 164, 240, 8, c.ink) + bar(36, 186, 120, 6, c.signal) + bar(170, 186, 40, 6, c.ink)
    + `<g transform="translate(60 228)"><circle r="20" fill="${c.ink}"/><path d="M -8 0 L -2 6 L 9 -6" stroke="${c.paper}" stroke-width="5" fill="none" stroke-linecap="square"/></g>`
    + bar(96, 214, 22, 22, c.ink) + bar(124, 214, 22, 22, c.signal) + bar(152, 214, 22, 22, c.ink) + bar(240, 222, 150, 6, c.ink) + bar(240, 236, 110, 4, c.ink)
    + `</svg>`;
}

/** The favicon as a standalone SVG document. */
export const faviconSVG = () => markSVG({ colors: LITERAL });

function esc(s) { return String(s).replace(/[<>&"]/g, ch => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" }[ch])); }
