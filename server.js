const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const QS = require("./questions");

const PORT = process.env.PORT || 3000;
const MAXP = 44;
const BASE = 0.04;
const UPW = [0.03, 0.05, 0.08, 0.11, 0.15];
const ROOM_TTL = 3 * 3600e3, MAX_BODY = 4096, PUBLIC = path.join(__dirname, "public");
const rooms = new Map();

const rid = () => crypto.randomBytes(8).toString("hex");
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const tierOf = p => { const n = p.lv[0] + p.lv[1] + p.lv[2] + p.lv[3] + p.lv[4]; return n < 4 ? 0 : n < 9 ? 1 : 2; };
const power = p => BASE + p.lv.reduce((a, l, i) => a + l * UPW[i], 0);
const ranking = r => [...r.players.values()].sort((a, b) => b.prog - a.prog || (a.finAt || Infinity) - (b.finAt || Infinity));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const newCode = () => { let c; do { c = Array.from({ length: 4 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ"[crypto.randomInt(23)]).join(""); } while (rooms.has(c)); return c; };
const resetPlayer = p => Object.assign(p, { lv: [0, 0, 0, 0, 0], prog: 0, ac: 0, er: 0, cd: 0, used: [], pending: null, finAt: 0 });

function broadcast(r) {
  const now = Date.now();
  const shared = `event: s\ndata: ${JSON.stringify({
    status: r.status, startAt: r.startAt, duration: r.duration, now, code: r.code, max: MAXP,
    players: ranking(r).map(p => ({ id: p.id, name: p.name, tg: p.tg, prog: +p.prog.toFixed(1), ac: p.ac, er: p.er, t: tierOf(p) })),
  })}\n\n`;
  for (const c of r.clients) {
    const p = c.pid && r.players.get(c.pid);
    if (p) c.res.write(`event: m\ndata: ${JSON.stringify({ id: p.id, name: p.name, tg: p.tg, lv: p.lv, cd: Math.max(0, p.cd - now), power: power(p), tier: tierOf(p), prog: p.prog })}\n\n`);
    c.res.write(shared);
  }
}

let beat = 0;
setInterval(() => {
  const now = Date.now(); beat++;
  for (const [code, r] of rooms) {
    if (now - r.created > ROOM_TTL) { r.clients.forEach(c => c.res.end()); rooms.delete(code); continue; }
    if (r.status !== "running") { if (beat % 30 === 0) r.clients.forEach(c => c.res.write(":ka\n\n")); continue; }
    for (const p of r.players.values()) {
      if (p.finAt) continue;
      p.prog = Math.min(100, p.prog + power(p) * (now - p.last) / 1000); p.last = now;
      if (p.prog >= 100) { p.finAt = now; r.status = "ended"; }
    }
    if (now >= r.startAt + r.duration * 1000) r.status = "ended";
    if (r.status === "ended" || beat % 2 === 0) broadcast(r);
  }
}, 500);

const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const fail = (res, msg, code = 400) => send(res, code, { error: msg });
const readBody = req => new Promise(ok => {
  let d = ""; req.on("data", c => { d += c; if (d.length > MAX_BODY) req.destroy(); });
  req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch { ok({}); } });
});

function events(req, res, q) {
  const r = rooms.get((q.get("code") || "").toUpperCase()), tok = q.get("tok"), pid = q.get("pid") || "";
  const isHost = r && tok === r.hostTok, p = r && r.players.get(pid);
  if (!isHost && !(p && p.tok === tok)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("retry: 2000\n\n");
  const c = { res, pid: isHost ? "" : pid }; r.clients.add(c);
  req.on("close", () => r.clients.delete(c));
  broadcast(r);
}

function hostAction(r, b, res) {
  if (b.action === "start") {
    if (r.status !== "lobby" || !r.players.size) return fail(res, "Não é possível iniciar agora.");
    r.duration = clamp(+b.duration || r.duration, 60, 720); r.status = "running"; r.startAt = Date.now();
    r.players.forEach(p => { p.last = r.startAt; });
  } else if (b.action === "end") { r.status = "ended"; }
  else if (b.action === "reset") { r.status = "lobby"; r.startAt = 0; r.players.forEach(resetPlayer); }
  else return fail(res, "Ação inválida.");
  broadcast(r); send(res, 200, {});
}

function join(r, b, res) {
  const name = String(b.name || "").trim().slice(0, 18);
  if (!name) return fail(res, "Digite seu nome.");
  if (r.status !== "lobby") return fail(res, "A partida já começou.");
  if (r.players.size >= MAXP) return fail(res, "Sala cheia (44/44).");
  if ([...r.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase())) return fail(res, "Esse nome já está em uso.");
  const p = { id: rid(), tok: rid(), name, tg: ["rus", "eua", "ale"].includes(b.target) ? b.target : "rus", last: 0 };
  resetPlayer(p); r.players.set(p.id, p); broadcast(r);
  send(res, 200, { pid: p.id, tok: p.tok, code: r.code });
}

function ask(r, p, b, res) {
  const u = +b.up;
  if (!Number.isInteger(u) || u < 0 || u > 4 || p.lv[u] >= 3 || p.cd > Date.now()) return fail(res, "Melhoria indisponível.");
  const t = tierOf(p), ofTier = QS.map((_, i) => i).filter(i => QS[i][0] === t);
  let pool = ofTier.filter(i => !p.used.includes(i));
  if (!pool.length) { p.used = p.used.filter(i => !ofTier.includes(i)); pool = ofTier; }
  const qi = pool[crypto.randomInt(pool.length)]; p.used.push(qi);
  const order = shuffle([0, 1, 2, 3]); p.pending = { qi, order, u };
  send(res, 200, { tier: t, q: QS[qi][1], opts: order.map(i => QS[qi][2][i]) });
}

function answer(r, p, b, res) {
  if (!p.pending) return fail(res, "Nenhuma pergunta aberta.");
  const { qi, order, u } = p.pending; p.pending = null;
  const right = order.indexOf(QS[qi][3]), ok = +b.choice === right;
  if (ok) { p.lv[u]++; p.ac++; } else { p.er++; p.cd = Date.now() + 4000; }
  broadcast(r); send(res, 200, { ok, right, exp: QS[qi][4] });
}

async function api(req, res, url) {
  if (url.pathname === "/api/events") return events(req, res, url.searchParams);
  if (req.method !== "POST") return fail(res, "Método inválido.", 405);
  const b = await readBody(req), act = url.pathname.slice(5);
  if (act === "create") {
    const code = newCode();
    rooms.set(code, { code, hostTok: rid(), duration: clamp(+b.duration || 720, 60, 720), status: "lobby", startAt: 0, players: new Map(), clients: new Set(), created: Date.now() });
    return send(res, 200, { code, tok: rooms.get(code).hostTok });
  }
  const r = rooms.get(String(b.code || "").toUpperCase());
  if (!r) return fail(res, "Sala não encontrada. Confira o código.", 404);
  if (act === "join") return join(r, b, res);
  if (act === "host") return b.tok === r.hostTok ? hostAction(r, b, res) : fail(res, "Sem permissão.", 403);
  const p = r.players.get(b.pid);
  if (!p || p.tok !== b.tok || r.status !== "running") return fail(res, "Ação não permitida agora.", 403);
  if (act === "ask") return ask(r, p, b, res);
  if (act === "answer") return answer(r, p, b, res);
  fail(res, "Requisição inválida.");
}

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
function serve(res, pathname) {
  let rel; try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.resolve(PUBLIC, "." + (rel === "/" ? "/index.html" : rel));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); return res.end("Não encontrado"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(d);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) return api(req, res, url).catch(() => fail(res, "Erro interno.", 500));
  serve(res, url.pathname);
}).listen(PORT, "0.0.0.0", () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i.family === "IPv4" && !i.internal).map(i => `http://${i.address}:${PORT}`);
  console.log(`\n  Ordem Mundial rodando!\n  Anfitrião (neste PC): http://localhost:${PORT}\n  Alunos (mesma rede):  ${ips.join("  ou  ") || "(sem rede detectada)"}\n`);
});
