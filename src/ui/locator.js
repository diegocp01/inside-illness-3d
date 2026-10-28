// "Where in the body?" — a front-view figure with simple organs, and a magnifier that zooms
// into the region an illness affects. Coordinates use a 100 × 200 body space.

const ORGANS = {
  brain: '<path d="M50 9.6c-4.6 0-8.6 2.5-8.9 6.4-.2 2.9 1.6 5.2 4.2 5.9 1.4.4 3.3.4 4.7.4s3.3 0 4.7-.4c2.6-.7 4.4-3 4.2-5.9-.3-3.9-4.3-6.4-8.9-6.4z"/><path class="lf-line" d="M50 10v11.4M45 13.2c1.2.9 1.4 2.3.8 3.6M55 13.2c-1.2.9-1.4 2.3-.8 3.6"/>',
  nose: '<path d="M50 18.4c-.7 2.1-1.9 4.3-3 5.8.8 1.1 2 1.5 3 1.5s2.2-.4 3-1.5c-1.1-1.5-2.3-3.7-3-5.8z"/>',
  teeth: '<rect x="46" y="27.4" width="8" height="2.6" rx="1.1"/>',
  esophagus: '<path d="M48.7 31h2.6l.4 34.5-2.6.2z"/>',
  lungs: '<path d="M47.5 52c-3.8-.6-8.6 4-8.9 11.6-.2 4 1.6 6.2 4.2 5.5 2.6-.7 4.7-2.6 4.7-6.6z"/><path d="M52.5 52c3.8-.6 8.6 4 8.9 11.6.2 4-1.6 6.2-4.2 5.5-2.6-.7-4.7-2.6-4.7-6.6z"/>',
  heart: '<path d="M53.4 68.4c-4-2.8-5.6-5.2-5.2-7.1.3-1.6 2.2-2.4 3.6-1.2l1.6 1.3 1.6-1.3c1.4-1.2 3.3-.4 3.6 1.2.4 1.9-1.2 4.3-5.2 7.1z"/>',
  vessels: '<path class="lf-vessel" d="M51.5 66 50 104l-7 78M50 104l7 78M50 47 38 60 27 98M50 47l12 13 11 38M50 47V31"/>',
  liver: '<path d="M37.6 73.4c3.8-2.6 11.6-3 17.4-1.4 1.6.5 1.4 2-.2 2.8-3.6 1.8-7.4 4.2-10.6 5.2-3.2 1-6.4-.2-7.2-2.8-.4-1.3-.2-3 .6-3.8z"/>',
  stomach: '<path d="M54.6 72.6c3.6-1.4 7.2.6 7 4.8-.2 3.8-3.6 6.2-7.4 5.4-1.6-.3-1.4-1.6 0-2.2 1.8-.8 2.8-2.4 2.2-4.2-.4-1.2-1.6-1.6-2.4-2.2-.6-.6-.2-1.4.6-1.6z"/>',
  pancreas: '<path d="M44.4 83.2c3-1.4 8.6-1.6 12.4-.6 1.2.3 1 1.6-.2 1.8-3.8.6-8.6.8-12 .2-.9-.2-1-1-.2-1.4z"/>',
  gut: '<path d="M43 87.4h14c1.9 0 3 1.4 3 3.2v6.8c0 1.8-1.1 3.2-3 3.2H43c-1.9 0-3-1.4-3-3.2v-6.8c0-1.8 1.1-3.2 3-3.2z"/><path class="lf-line" d="M43.5 91h13M43.5 94h13M43.5 97h13"/>',
  fat: '<path d="M33.6 82c-1.2 6.6-.6 14.2 2 20.6 3.6 1.6 9 2.4 14.4 2.4s10.8-.8 14.4-2.4c2.6-6.4 3.2-14 2-20.6-4 1.6-10 2.4-16.4 2.4S37.6 83.6 33.6 82z"/>',
};

// region -> organs to highlight, magnifier centre and zoom
const REGIONS = {
  nose: { organs: ['nose'], c: [50, 22.6], z: 5.2 },
  brain: { organs: ['brain'], c: [50, 16.5], z: 3.6 },
  mouth: { organs: ['teeth'], c: [50, 27.8], z: 5.4 },
  gut: { organs: ['gut'], c: [50, 93], z: 3.4 },
  blood: { organs: ['vessels', 'heart'], c: [50, 62], z: 2.3 },
  heart: { organs: ['heart', 'vessels'], c: [53, 63], z: 3.4 },
  liver: { organs: ['liver'], c: [47, 76], z: 3.4 },
  belly: { organs: ['fat'], c: [50, 92], z: 2.4 },
  pancreas: { organs: ['pancreas', 'vessels'], c: [51, 80], z: 3.4 },
  lungs: { organs: ['lungs'], c: [50, 61], z: 2.7 },
  esophagus: { organs: ['esophagus', 'stomach'], c: [51, 54], z: 2.0 },
};

const BODY = `
  <circle cx="50" cy="21" r="12.5"/>
  <ellipse class="lf-eye" cx="45.6" cy="19.6" rx="1.7" ry="1.1"/>
  <ellipse class="lf-eye" cx="54.4" cy="19.6" rx="1.7" ry="1.1"/>
  <rect x="45" y="31" width="10" height="9" rx="3"/>
  <rect x="33" y="38" width="34" height="74" rx="13"/>
  <path class="lf-limb" d="M36 44 24 100M64 44l12 56"/>
  <path class="lf-limb lf-leg" d="M43 106l-2 80M57 106l2 80"/>`;

function anatomy(region, color, uid) {
  const hl = new Set(REGIONS[region]?.organs || []);
  const organs = Object.entries(ORGANS)
    .map(([k, d]) => `<g class="${hl.has(k) ? 'lf-hl' : 'lf-organ'}"${hl.has(k) ? ` style="--hl:${color}"` : ''}>${d}</g>`)
    .join('');
  return `<g class="lf-body">${BODY}</g>${organs}`;
}

/** Small figure for the sidebar (no magnifier). */
export function bodyFigure(region, color) {
  return `<svg class="lf lf-small" viewBox="20 2 60 188" aria-hidden="true">${anatomy(region, color)}</svg>`;
}

let seq = 0;
/** Figure plus a magnifier that zooms into the affected region. */
export function locator(region, color) {
  const R = REGIONS[region] || REGIONS.gut;
  const id = `lf${seq++}`;
  // Figure occupies x 0..64, y 4..196 (scale 0.96 of the 100x200 space, cropped to the body).
  const fs = 0.96, fx = -19, fy = 2;
  const mx = fx + R.c[0] * fs, my = fy + R.c[1] * fs;
  const L = { x: 150, y: 74, r: 54 };
  // Tangent-ish connector lines from the marker to the loupe.
  const ang = Math.atan2(my - L.y, mx - L.x);
  const p1 = [L.x + Math.cos(ang - 1.05) * L.r, L.y + Math.sin(ang - 1.05) * L.r];
  const p2 = [L.x + Math.cos(ang + 1.05) * L.r, L.y + Math.sin(ang + 1.05) * L.r];
  const mr = Math.max(3, 30 / R.z);
  const inner = `translate(${L.x} ${L.y}) scale(${R.z}) translate(${-R.c[0]} ${-R.c[1]})`;
  return `<svg class="lf lf-loupe" viewBox="0 0 210 200" aria-hidden="true">
    <defs><clipPath id="${id}"><circle cx="${L.x}" cy="${L.y}" r="${L.r}"/></clipPath></defs>
    <g transform="translate(${fx} ${fy}) scale(${fs})">${anatomy(region, color)}</g>
    <circle class="lf-mark" cx="${mx}" cy="${my}" r="${mr}" style="--hl:${color}"/>
    <path class="lf-conn" d="M${mx} ${my - mr}L${p1[0]} ${p1[1]}M${mx} ${my + mr}L${p2[0]} ${p2[1]}"/>
    <circle class="lf-lens-bg" cx="${L.x}" cy="${L.y}" r="${L.r}"/>
    <g clip-path="url(#${id})"><g transform="${inner}">${anatomy(region, color)}</g></g>
    <circle class="lf-lens" cx="${L.x}" cy="${L.y}" r="${L.r}"/>
  </svg>`;
}
