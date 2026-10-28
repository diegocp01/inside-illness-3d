// Tiny "where in the body" figure. Organ hot-spots are in the 100×200 viewBox.
const spots = {
  nose: [[50, 25, 4]],
  brain: [[50, 15, 9]],
  mouth: [[50, 31, 4]],
  gut: [[50, 92, 11]],
  blood: [[50, 66, 4], [27, 88, 3], [73, 88, 3], [44, 150, 3], [56, 150, 3], [50, 22, 3]],
  heart: [[54, 62, 5], [50, 82, 3], [40, 120, 2.5], [60, 120, 2.5]],
  liver: [[43, 78, 7]],
  belly: [[50, 90, 14]],
  pancreas: [[53, 82, 5], [50, 66, 3]],
  lungs: [[43, 63, 6], [57, 63, 6]],
  esophagus: [[50, 50, 3], [50, 58, 3], [51, 66, 3], [55, 76, 5]],
};

export function bodyMap(region, color) {
  const dots = (spots[region] || [])
    .map(([x, y, r], i) => `<circle class="bm-hot" cx="${x}" cy="${y}" r="${r}" fill="${color}" style="animation-delay:${i * 0.15}s"/>
      <circle cx="${x}" cy="${y}" r="${Math.max(1.6, r * 0.45)}" fill="${color}"/>`)
    .join('');
  const path = region === 'esophagus' ? `<path d="M50 34 L50 70 Q51 75 56 76" stroke="${color}" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".9"/>` : '';
  return `<svg class="bodymap" viewBox="0 0 100 200" aria-hidden="true">
    <g class="bm-body">
      <circle cx="50" cy="21" r="12.5"/>
      <rect x="45" y="31" width="10" height="9" rx="3"/>
      <rect x="33" y="38" width="34" height="74" rx="13"/>
      <path d="M36 44 L24 100" stroke-width="9" stroke-linecap="round"/>
      <path d="M64 44 L76 100" stroke-width="9" stroke-linecap="round"/>
      <path d="M43 106 L41 186" stroke-width="11" stroke-linecap="round"/>
      <path d="M57 106 L59 186" stroke-width="11" stroke-linecap="round"/>
    </g>
    ${path}${dots}
  </svg>`;
}
