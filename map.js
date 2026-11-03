const LAND = [
  [[14,18],[21,26],[32,34],[38,40]], [[12,18],[20,27],[38,41],[45,49]], [[0,1],[2,19],[21,26],[32,59]], [[0,0],[1,19],[22,27],[31,59]],
  [[3,12],[17,20],[28,29],[31,59]], [[6,21],[28,29],[30,58]], [[9,21],[29,33],[37,57]], [[10,19],[29,33],[35,56]],
  [[10,19],[29,53]], [[10,12],[16,17],[27,53]], [[11,13],[16,17],[27,39],[42,52]], [[12,14],[18,18],[27,38],[42,43],[46,49],[52,52]],
  [[13,20],[27,38],[43,43],[47,48],[50,52]], [[18,24],[28,37],[46,47],[49,51],[53,55]], [[17,24],[31,38],[46,47],[49,50],[53,56]],
  [[17,24],[31,38],[47,49],[55,56]], [[17,24],[32,38],[52,54]], [[18,24],[32,38],[50,56]], [[19,23],[32,37],[49,57]],
  [[18,21],[32,35],[50,57]], [[17,20],[54,56],[58,59]], [[17,19],[55,55],[58,59]], [[17,18]], [[18,18]],
];
const REGION = {
  rus: (c, r) => r >= 2 && r <= 5 && c >= 36 && (r < 5 || c <= 52),
  eua: (c, r) => r >= 6 && r <= 8 && c >= 10 && c <= 19,
  ale: (c, r) => (r === 5 || r === 6) && (c === 31 || c === 32),
};
const LABEL_POS = { rus: [455, 50], eua: [135, 110], ale: [318, 22] };
const WHITE = "#fff6dd";

function buildMap(withCounts) {
  let s = '<svg class="map" viewBox="0 0 600 240" role="img" aria-label="Mapa-múndi em pontos">';
  LAND.forEach((ranges, r) => ranges.forEach(([a, b]) => {
    for (let c = a; c <= b; c++) {
      const k = Object.keys(REGION).find(k => REGION[k](c, r));
      s += `<circle class="d${k ? " t" : ""}" cx="${c * 10 + 5}" cy="${r * 10 + 5}" r="3.3"` + (k ? ` data-g="${k}" data-c="${c}" style="fill:${TG[k][1]}"` : "") + "/>";
    }
  }));
  for (const k in TG) s += `<text class="lbl" data-k="${k}" x="${LABEL_POS[k][0]}" y="${LABEL_POS[k][1]}" text-anchor="middle" fill="${TG[k][1]}">${TG[k][0]}${withCounts ? " · 0" : ""}</text>`;
  return s + "</svg>";
}

function setMapCounts(root, counts) {
  root.querySelectorAll("text[data-k]").forEach(t => { t.textContent = `${TG[t.dataset.k][0]} · ${counts[t.dataset.k] || 0}`; });
}

let paintCache = { root: null, tg: "", cells: [] };
function paintMap(root, tg, prog) {
  if (paintCache.root !== root || paintCache.tg !== tg) {
    paintCache = { root, tg, cells: [...root.querySelectorAll(`.d[data-g="${tg}"]`)].sort((a, b) => a.dataset.c - b.dataset.c) };
  }
  const cells = paintCache.cells, n = cells.length;
  cells.forEach((el, i) => {
    const f = prog / 100 * n - i;
    el.style.fillOpacity = Math.min(1, Math.max(0.38, f + 0.38)).toFixed(2);
    el.style.fill = f > 0 ? WHITE : TG[tg][1];
  });
}
