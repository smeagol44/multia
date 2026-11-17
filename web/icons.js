const paths = {
  brand: '<path d="M3 5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8l-4 3v-3a2 2 0 0 1-1-2Z"/><path d="M19 8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2v2l-4-2h-4a2 2 0 0 1-2-2v-1"/><path d="M7 8h5"/>',
  gpt: '<path d="m12 2 2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5L12 2Z"/><path d="m19 15 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/>',
  claud: '<path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5M8 3l8 18M3 16l18-8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.8-3A7.5 7.5 0 1 1 20 11.5Z"/>',
  palette: '<path d="M21 11.5c0 2-1.5 3.5-3.5 3.5H16c-1 0-1.5 1-1 2 .5 1.5-.5 3-2.5 3A8.5 8.5 0 1 1 21 11.5Z"/><path d="M7.5 11h.01M10 7.5h.01M14 7.5h.01M17 10.5h.01" stroke-width="2.5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 6v1"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M8 4v4m8 2v4m-6 2v4" stroke-width="3"/>',
  gauge: '<path d="M5 18a9 9 0 1 1 14 0H5Zm7-3 3-4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  pulse: '<path d="M2 12h5l3-6 4 12 3-6h5"/>',
  link: '<path d="m10 13 4-4m-5 6-1 1a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0m3 1 1-1a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0"/>',
  send: '<path d="M12 19V5m-6 6 6-6 6 6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5.5 20v-2a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v2"/>',
};

export function icon(name) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
