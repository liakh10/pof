/* The POF seal: many thin concentric rings (the Privacy Rings), a few of them in the signal colour, a black disc with the
   check cut out of it. Pure functions that return SVG markup, so the same seal is drawn by the page, by the share-card
   function and by the build. Colours are CSS variables in the page and literals on the server (pass `colors`).

   States: live (orange rings whole), revoked (the orange ring breaks open and turns to ink), expired (rings faded),
   idle (the hero, rings only). Motion lives in ui/site.css (.seal .rg draw, .seal .spin rotate, .seal.breaking). */

const PAGE = { paper: 'var(--paper)', ink: 'var(--ink)', signal: 'var(--signal)', quiet: 'var(--ink-3)' };
export const LITERAL = { paper: '#f3efe6', ink: '#1b1916', signal: '#f2611d', quiet: '#8a857b' };

/* the ring plan, from the disc outwards: [radius, stroke, role]; roles: ink | band | signal | signal-thin | seg (segmented) */
const PLAN = [
  [168, 4, 'ink'], [186, 14, 'band'], [208, 3, 'ink'], [226, 18, 'signal'], [250, 3, 'ink'], [266, 9, 'band'],
  [286, 2.5, 'ink'], [304, 5, 'signal-thin'], [322, 2.5, 'ink'], [340, 2.5, 'ink'], [358, 2.5, 'ink'], [376, 2.5, 'ink'],
  [394, 2.5, 'ink'], [412, 2.5, 'ink'], [430, 2.5, 'ink'], [448, 2.5, 'ink'], [466, 2.5, 'ink'], [484, 2.5, 'ink'],
];

const f = n => +n.toFixed(2);

/** The full seal. opts: { size, state, rings (how many of PLAN to draw), crosshair, colors, id, check (bool), title } */
export function sealSVG(opts = {}) {
  const c = opts.colors || PAGE;
  const state = opts.state || 'live';
  const n = Math.min(PLAN.length, opts.rings ?? PLAN.length);
  const dead = state === 'revoked';
  const faded = state === 'expired';
  const R = PLAN[n - 1][0] + 12;
  const vb = opts.square === false ? `-${R} -${R} ${2 * R} ${2 * R}` : `-${R} -${R} ${2 * R} ${2 * R}`;
  const parts = [];
  if (opts.crosshair !== false) {
    parts.push(`<g class="xh" stroke="${c.ink}" stroke-width="1.2" opacity="${faded ? .35 : 1}"><line x1="${-R}" y1="0" x2="${R}" y2="0"/><line x1="0" y1="${-R}" x2="0" y2="${R}"/></g>`);
  }
  PLAN.slice(0, n).forEach(([r, w, role], i) => {
    let stroke = c.ink, extra = '', cls = 'rg';
    if (role === 'signal' || role === 'signal-thin') { stroke = dead || faded ? c.ink : c.signal; cls += ' sig'; }
    if (faded) stroke = role.startsWith('signal') ? c.quiet : c.ink;
    if (role === 'signal' && dead) {
      // the break: the ring opens at the upper right, two short shards pushed outwards
      const C = 2 * Math.PI * r, gap = C * 0.085;
      extra = ` stroke-dasharray="${f(C - gap)} ${f(gap)}" stroke-dashoffset="${f(C * 0.11)}"`;
      cls += ' broken';
    }
    parts.push(`<circle class="${cls}" style="--i:${i}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${w}" pathLength="1000"${extra}${faded ? ' opacity=".55"' : ''}/>`);
  });
  if (dead) {
    // the shards of the broken ring, displaced
    const r = 226, a0 = -0.11 * 2 * Math.PI, a1 = a0 + 0.085 * 2 * Math.PI;
    const p = (a, rr) => `${f(Math.cos(a) * rr)} ${f(Math.sin(a) * rr)}`;
    parts.push(`<path class="shard" d="M ${p(a0 + .012, r + 26)} A ${r + 26} ${r + 26} 0 0 1 ${p(a0 + .05, r + 26)}" stroke="${c.ink}" stroke-width="18" fill="none"/>`);
    parts.push(`<path class="shard" d="M ${p(a1 - .05, r + 44)} A ${r + 44} ${r + 44} 0 0 1 ${p(a1 - .014, r + 44)}" stroke="${c.ink}" stroke-width="18" fill="none"/>`);
  }
  // the segmented ring that turns slowly (the spin group)
  parts.push(`<g class="spin"><circle r="140" fill="none" stroke="${c.ink}" stroke-width="12" pathLength="1000" stroke-dasharray="210 40 120 40 300 40 50 40 120 40"/></g>`);
  // the disc and the cut-out check
  parts.push(`<circle class="disc" r="124" fill="${faded ? c.quiet : c.ink}"/>`);
  parts.push(`<path class="arc" d="M -103 30 A 107 107 0 0 0 103 30" stroke="${c.paper}" stroke-width="3" fill="none"/>`);
  if (opts.check !== false) {
    parts.push(`<path class="check" d="M -58 -4 L -16 38 L 64 -42" stroke="${c.paper}" stroke-width="34" fill="none" stroke-linecap="square" stroke-linejoin="miter" pathLength="1000"/>`);
  }
  if (dead) parts.push(`<path class="cross" d="M -52 -52 L 52 52 M 52 -52 L -52 52" stroke="${c.signal}" stroke-width="10" fill="none" opacity="0"/>`);
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  return `<svg class="seal seal-${state}" viewBox="${vb}"${size} xmlns="http://www.w3.org/2000/svg" role="img"${opts.title ? '' : ' aria-hidden="true"'}>${title}${parts.join('')}</svg>`;
}

/** The small mark (logo, favicon, list icons): three rings, the disc, the check. */
export function markSVG(opts = {}) {
  const c = opts.colors || PAGE;
  const state = opts.state || 'live';
  const ring = state === 'revoked' ? c.ink : state === 'expired' ? c.quiet : c.signal;
  const broken = state === 'revoked' ? ' stroke-dasharray="250 22" stroke-dashoffset="40" pathLength="272"' : '';
  const size = opts.size ? ` width="${opts.size}" height="${opts.size}"` : '';
  return `<svg class="mark mark-${state}" viewBox="-50 -50 100 100"${size} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
    + `<circle r="46" fill="none" stroke="${c.ink}" stroke-width="3"/>`
    + `<circle r="38" fill="none" stroke="${ring}" stroke-width="7"${broken}/>`
    + `<circle r="27" fill="${state === 'expired' ? c.quiet : c.ink}"/>`
    + `<path d="M -12 0 L -3 9 L 14 -9" stroke="${c.paper}" stroke-width="7.5" fill="none" stroke-linecap="square"/></svg>`;
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
export const faviconSVG = () => markSVG({ colors: LITERAL }).replace('<svg ', '<svg ');

function esc(s) { return String(s).replace(/[<>&"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch])); }
