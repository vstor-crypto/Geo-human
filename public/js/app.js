const $ = s => document.querySelector(s);
const app = $("#app"), modal = $("#modal");
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = s => { s = Math.max(0, Math.ceil(s)); return (s / 60 | 0) + ":" + String(s % 60).padStart(2, "0"); };

async function post(path, body) {
  const r = await fetch("/api/" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Erro de conexão");
  return j;
}
let toastTimer;
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("on"), 3500); }

let SES = null; try { SES = JSON.parse(sessionStorage.getItem("dudh")); } catch {}
let S = null,
    M = null,
    offset = 0,
    rcv = 0,
    cdUntil = 0,
    es = null, kind = "", upSig = "", hostKey = "", asking = false;

function saveSession(s) { SES = s; sessionStorage.setItem("dudh", JSON.stringify(s)); connect(); }
function leave() { sessionStorage.removeItem("dudh"); SES = S = M = null; es && es.close(); kind = ""; modal.innerHTML = ""; render(); }

function connect() {
  es && es.close();
  es = new EventSource(`/api/events?code=${SES.code}&tok=${SES.tok}&pid=${SES.pid || ""}`);
  es.addEventListener("m", e => { M = JSON.parse(e.data); cdUntil = Date.now() + M.cd; });
  es.addEventListener("s", e => { S = JSON.parse(e.data); offset = S.now - Date.now(); rcv = Date.now(); render(); });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { toast("Sala encerrada ou não encontrada."); leave(); } };
}

const head = sub => `<div class="top"><div><h1>Ordem Mundial</h1><div class="mu">Simulador estratégico sobre a Declaração Universal dos Direitos Humanos</div></div><div class="mu">${sub || ""}</div></div>`;
function go(k, html) { if (kind === k) return false; kind = k; upSig = hostKey = ""; app.innerHTML = html; return true; }

function render() {
  if (!SES) return home();
  if (!S) return;
  if (S.status !== "running") modal.innerHTML = "";
  if (SES.role === "host") return host();
  if (!M) return;
  (S.status === "lobby" ? lobby : S.status === "running" ? play : end)();
}

function home() {
  if (!go("home", head() + `<div class="two">
    <div class="card"><h2>Sou o anfitrião</h2><p class="mu">Crie a sala, passe o código para a turma e acompanhe tudo pelo painel. Você não joga.</p>
      <select id="du"><option value="300">Duração: 5 minutos</option><option value="480">Duração: 8 minutos</option><option value="600">Duração: 10 minutos</option><option value="720" selected>Duração: 12 minutos</option></select>
      <button class="pri full" id="cr">Criar sala</button><div class="err" id="er1"></div></div>
    <div class="card"><h2>Sou jogador</h2>
      <input id="cd" class="up-case" maxlength="4" placeholder="Código da sala (4 letras)" autocomplete="off">
      <input id="nm" maxlength="18" placeholder="Seu nome de comandante" autocomplete="off">
      <select id="tg">${Object.entries(TG).map(([k, v]) => `<option value="${k}">Objetivo: conquistar ${v[0]}</option>`).join("")}</select>
      <button class="pri full" id="jn">Entrar na sala</button><div class="err" id="er2"></div></div></div>`)) return;
  const tryDo = (btn, errId, fn) => btn.onclick = async () => { btn.disabled = true; try { saveSession(await fn()); } catch (e) { $(errId).textContent = e.message; } btn.disabled = false; };
  tryDo($("#cr"), "#er1", async () => { const r = await post("create", { duration: +$("#du").value }); return { code: r.code, tok: r.tok, role: "host" }; });
  tryDo($("#jn"), "#er2", async () => { const r = await post("join", { code: $("#cd").value, name: $("#nm").value, target: $("#tg").value }); return { code: r.code, tok: r.tok, pid: r.pid, role: "player" }; });
  $("#nm").onkeydown = e => { if (e.key === "Enter") $("#jn").click(); };
}

function host() {
  go("host", head("Painel do anfitrião") + `
    <div class="card row between"><div><div class="mu">Código da sala</div><div class="code">${S.code}</div></div>
      <div class="right"><div class="mu" id="hs"></div><div class="serif" style="font-size:44px" id="tm"></div><div class="row right" id="hb"></div></div></div>
    <div class="grid" id="st"></div><div class="mapbox" id="mp">${buildMap(true)}</div>
    <div class="card"><h2>Ranking ao vivo</h2><div class="wrap" id="rk"></div></div>`);
  const n = S.players.length, run = S.status === "running", ended = S.status === "ended";
  $("#hs").textContent = run ? "Partida em andamento" : ended ? "Partida encerrada" : "Aguardando jogadores";

  const key = S.status + (n > 0);
  if (key !== hostKey) {
    hostKey = key;
    $("#hb").innerHTML = run ? `<button class="dg" id="b">Encerrar agora</button>`
      : ended ? `<button class="pri" id="b">Nova partida</button>`
      : `<select id="hd" aria-label="Duração">${[5, 8, 10, 12].map(m => `<option value="${m * 60}" ${S.duration === m * 60 ? "selected" : ""}>${m} min</option>`).join("")}</select><button class="pri" id="b" ${n ? "" : "disabled"}>Iniciar partida</button>`;
    $("#b").onclick = () => post("host", { code: S.code, tok: SES.tok, action: run ? "end" : ended ? "reset" : "start", duration: $("#hd") && +$("#hd").value }).catch(e => toast(e.message));
  }
  const ac = S.players.reduce((a, p) => a + p.ac, 0), er = S.players.reduce((a, p) => a + p.er, 0), cnt = {};
  S.players.forEach(p => { cnt[p.tg] = (cnt[p.tg] || 0) + 1; });
  $("#st").innerHTML = [[n + "/" + S.max, "Jogadores na sala"], [ac, "Acertos totais"], [er, "Erros totais"], [ac + er ? Math.round(ac / (ac + er) * 100) + "%" : "—", "Aproveitamento"]]
    .map(x => `<div class="stat"><b>${x[0]}</b><span>${x[1]}</span></div>`).join("");
  setMapCounts($("#mp"), cnt);
  $("#rk").innerHTML = `<table><tr><th>#</th><th>Jogador</th><th>Objetivo</th><th>Patente</th><th>Acertos</th><th>Erros</th><th style="width:25%">Conquista</th></tr>` +
    (S.players.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td style="color:${TG[p.tg][1]}">${TG[p.tg][0]}</td><td>${TN[p.t]}</td><td class="t0">${p.ac}</td><td class="t2">${p.er}</td><td><div class="bar" style="--tc:${TG[p.tg][1]}"><i style="width:${p.prog}%"></i></div></td></tr>`).join("")
      || `<tr><td colspan="7" class="mu">Ninguém entrou ainda. Passe o código ${S.code} para a turma.</td></tr>`) + "</table>";
}

function lobby() {
  go("lobby", head(esc(M.name)) + `<div class="card center"><h2>Sala ${S.code}</h2><div class="serif" style="font-size:42px" id="ln"></div>
    <p class="mu">comandantes na sala. Seu objetivo: <b style="color:${TG[M.tg][1]}">conquistar ${TG[M.tg][0]}</b>.<br>Aguarde o anfitrião iniciar a partida.</p></div>`);
  $("#ln").textContent = S.players.length + "/" + S.max;
}

function play() {
  const c = TG[M.tg][1];
  go("play", head("Comandante " + esc(M.name)) + `
    <div class="card" style="--tc:${c}"><div class="row between"><div><div class="mu">Objetivo</div><b class="serif" style="color:${c};font-size:19px">Conquistar ${TG[M.tg][0]}</b></div>
      <div class="right"><div class="mu">Tempo</div><span class="serif" style="font-size:36px" id="tm"></span></div></div>
      <div class="mapbox" id="pm" style="margin:12px 0">${buildMap(false)}</div>
      <div class="bar big"><i id="pg"></i></div>
      <div class="row between mu" style="margin-top:6px"><span id="pc"></span><span id="pw"></span><span id="po"></span></div></div>
    <div class="two"><div class="card"><h2>Melhorias militares</h2><div id="ups"></div><div class="mu" id="tn"></div></div>
      <div class="card"><h2>Classificação</h2><div id="top"></div></div></div>`);
  $("#tn").innerHTML = `Próximas perguntas: <b class="t${M.tier}">${TIER_TXT[M.tier]}</b>`;
  $("#pw").textContent = "Poder: " + (M.power * 60).toFixed(1) + " por minuto";
  $("#po").textContent = (S.players.findIndex(p => p.id === M.id) + 1) + "º de " + S.players.length;
  $("#top").innerHTML = "<table>" + S.players.slice(0, 6).map((p, i) => `<tr><td>${i + 1}º</td><td>${esc(p.name)}${p.id === M.id ? " (você)" : ""}</td><td>${p.prog.toFixed(0)}%</td></tr>`).join("") + "</table>";
  upSig = ""; refreshUps(); tick();
}

function refreshUps() {
  if (kind !== "play" || !M) return;
  const lock = Date.now() < cdUntil, sig = M.lv.join() + lock;
  if (sig === upSig) return; upSig = sig;
  $("#ups").innerHTML = UPS.map((u, i) => `<button class="up" data-i="${i}" ${M.lv[i] >= 3 || lock ? "disabled" : ""}><span><b>${u}</b><br><span class="mu">+${(UPW[i] * 60).toFixed(1)} de poder/min por nível</span></span><span class="pips">${[0, 1, 2].map(k => `<span class="${k < M.lv[i] ? "on" : ""}"></span>`).join("")}</span></button>`).join("");
  $("#ups").querySelectorAll(".up").forEach(b => b.onclick = () => ask(+b.dataset.i));
}

async function ask(i) {
  if (asking) return; asking = true;
  try {
    const q = await post("ask", { code: S.code, pid: SES.pid, tok: SES.tok, up: i });
    modal.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="card"><h2>Pergunta <span class="t${q.tier}">${TN[q.tier]}</span> · desbloquear ${UPS[i]}</h2>
      <p style="font-size:17px;margin:0 0 14px">${esc(q.q)}</p><div id="os">${q.opts.map((o, j) => `<button class="opt" data-j="${j}">${esc(o)}</button>`).join("")}</div><div id="fb"></div></div></div>`;
    modal.querySelectorAll(".opt").forEach(b => b.onclick = () => answer(b, +b.dataset.j));
  } catch (e) { toast(e.message); }
  asking = false;
}

async function answer(btn, choice) {
  const opts = [...modal.querySelectorAll(".opt")]; opts.forEach(x => x.disabled = true);
  try {
    const r = await post("answer", { code: S.code, pid: SES.pid, tok: SES.tok, choice });
    opts[r.right].classList.add("ok"); if (!r.ok) btn.classList.add("no");
    $("#fb").innerHTML = `<p class="${r.ok ? "t0" : "t2"}"><b>${r.ok ? "Melhoria liberada!" : "Resposta incorreta. Reforços bloqueados por 4 segundos."}</b><br><span class="mu">${esc(r.exp)}</span></p><button class="pri" id="ct">Continuar</button>`;
    $("#ct").onclick = () => { modal.innerHTML = ""; }; $("#ct").focus();
  } catch (e) { modal.innerHTML = ""; toast(e.message); }
}

function end() {
  const l = S.players, w = l[0], won = w && w.id === M.id;
  go("end", head("Fim da operação") + `<div class="card center" style="padding:20px"><h2>${won ? "Vitória" : "Operação encerrada"}</h2><div class="serif" style="font-size:40px;color:var(--paper)">${w ? esc(w.name) : "—"}</div>
    <p class="mu">${w ? `venceu conquistando ${TG[w.tg][0]} (${w.prog.toFixed(0)}%)` : ""}</p></div>
    <div class="card"><h2>Classificação final</h2><table>${l.slice(0, 8).map((p, i) => `<tr><td>${i + 1}º</td><td>${esc(p.name)}${p.id === M.id ? " (você)" : ""}</td><td class="t0">${p.ac} acertos</td><td>${p.prog.toFixed(0)}%</td></tr>`).join("")}</table></div>
    <div class="card" style="border-color:var(--paper)"><h2>Para refletir</h2><p style="margin:0">Neste jogo, vencer significava dominar outros povos. Na vida real, a Declaração Universal dos Direitos Humanos foi escrita em 1948 para que a força jamais se sobreponha à dignidade humana e para que o Holocausto nunca se repita. Quais artigos da Declaração seriam violados numa guerra de conquista real?</p></div>`);
}

function tick() {
  if (!S || !SES) return;
  const tm = $("#tm");
  if (tm) tm.textContent = S.status === "running" ? fmt((S.startAt + S.duration * 1000 - (Date.now() + offset)) / 1000) : S.status === "ended" ? "0:00" : fmt(S.duration);
  if (kind === "play" && M) {
    const p = Math.min(100, M.prog + M.power * (Date.now() - rcv) / 1000);
    $("#pg").style.width = p + "%"; $("#pc").textContent = p.toFixed(1) + "% conquistado"; paintMap($("#pm"), M.tg, p);
    refreshUps();
  }
}
setInterval(tick, 250);

SES ? connect() : render();
