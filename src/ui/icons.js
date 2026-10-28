// Minimal line glyphs drawn on a 24×24 grid (white on a coloured rounded square, Settings-app style).
const s = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const icons = {
  virus: s('<circle cx="12" cy="12" r="5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>'),
  drop: s('<path d="M12 3.5c3.5 4.3 5.5 7.4 5.5 10a5.5 5.5 0 0 1-11 0c0-2.6 2-5.7 5.5-10z"/><path d="M9.5 14.5a2.6 2.6 0 0 0 2.5 2.5"/>'),
  bolt: s('<path d="M13 2.5 5.5 13.5h5.5L10 21.5l8-11.5h-5.5z"/>'),
  tooth: s('<path d="M7.5 3.5c-2.4 0-3.6 2-3.4 4.6.2 2.4 1.3 3.6 1.7 5.7.4 2.3.6 6.7 2.4 6.7 1.7 0 1.6-4.6 3.8-4.6s2.1 4.6 3.8 4.6c1.8 0 2-4.4 2.4-6.7.4-2.1 1.5-3.3 1.7-5.7.2-2.6-1-4.6-3.4-4.6-1.8 0-2.7 1-4.5 1s-2.7-1-4.5-1z"/>'),
  blood: s('<path d="M12 3c3.2 4 5.2 7 5.2 9.7A5.2 5.2 0 0 1 12 18a5.2 5.2 0 0 1-5.2-5.3C6.8 10 8.8 7 12 3z"/><path d="M9 21h6"/>'),
  gauge: s('<path d="M4 16a8 8 0 1 1 16 0"/><path d="M12 16l4.5-5"/><circle cx="12" cy="16" r="1.2"/><path d="M4 19.5h16"/>'),
  liver: s('<path d="M3.5 9.5c0-2.5 2.5-4 6-4 4.5 0 8 .4 10 1.8 1.4 1 1.2 2.6-.6 3.6-2.5 1.5-5 4-8.4 6.6-1.3 1-3 .7-4-.9C5 14 3.5 12.3 3.5 9.5z"/>'),
  cells: s('<circle cx="8" cy="9" r="4"/><circle cx="16.5" cy="9.5" r="3.5"/><circle cx="12" cy="16.5" r="4"/>'),
  gum: s('<path d="M8 3.5c-2 0-3 1.7-2.8 3.8.2 2 1.1 3 1.4 4.8"/><path d="M16 3.5c2 0 3 1.7 2.8 3.8-.2 2-1.1 3-1.4 4.8"/><path d="M8 3.5c1.5 0 2.3.8 4 .8s2.5-.8 4-.8"/><path d="M3 12.5c3 1.2 6 1.6 9 1.6s6-.4 9-1.6"/><path d="M8 15v4M16 15v4"/>'),
  hex: s('<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><circle cx="12" cy="12" r="2.4"/>'),
  lungs: s('<path d="M12 3v8"/><path d="M12 9c-1.5 1-2.6 1.4-3 0-.6-2-2.2-3-3.4-1.7C4 9 3.4 13 3.6 17c.1 1.8 1.6 2.6 3.2 2 2-.8 3.7-1.6 4.2-3.3"/><path d="M12 9c1.5 1 2.6 1.4 3 0 .6-2 2.2-3 3.4-1.7 1.6 1.7 2.2 5.7 2 9.7-.1 1.8-1.6 2.6-3.2 2-2-.8-3.7-1.6-4.2-3.3"/>'),
  tube: s('<path d="M9 2.5v8c0 2-2.5 3-2.5 6.5A5.5 5.5 0 0 0 12 22.5c3.5 0 6-2.3 6-5.5 0-3-2.5-4-4-3.2"/><path d="M15 2.5v8"/><circle cx="11.2" cy="6" r=".6" fill="currentColor"/><circle cx="12.6" cy="9" r=".6" fill="currentColor"/>'),
  search: s('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
  tag: s('<path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3a1.4 1.4 0 0 1 0 2l-6.7 6.7a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.4"/>'),
  rotate: s('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/>'),
  reset: s('<path d="M4 9V4h5"/><path d="M4.5 4.5 9 9"/><path d="M20 15v5h-5"/><path d="M19.5 19.5 15 15"/><path d="M20 9V4h-5M4 15v5h5"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
  prev: s('<path d="M15 5l-7 7 7 7"/>'),
  next: s('<path d="M9 5l7 7-7 7"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>'),
  menu: s('<path d="M4 7h16M4 12h16M4 17h16"/>'),
};
