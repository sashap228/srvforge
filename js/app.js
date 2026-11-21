(() => {
"use strict";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const store = {
  get(k, d){ try { const v = localStorage.getItem("srvforge2:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem("srvforge2:" + k, JSON.stringify(v)); } catch {} },
};

const ALL = {};
Object.keys(CAT_META).forEach(cat => DB[cat].forEach(p => { p.cat = cat; ALL[p.id] = p; }));
const byId = id => ALL[id];

/* ---------- деньги ---------- */
const CUR = { USD:{ s:"$", pre:true, r:1 }, BYN:{ s:" Br", r:3.05 }, RUB:{ s:" ₽", r:80 } };
const S = store.get("state", { kind:"server", task:"virt", tier:1, cur:"USD" });
if (!CUR[S.cur]) S.cur = "USD";
function money(usd){
  const c = CUR[S.cur], v = Math.round(usd * c.r).toLocaleString("ru-RU").replace(/ /g, " ");
  return c.pre ? c.s + v : v + c.s;
}
let tt;
function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 2000); }

/* ---------- модель сборки ---------- */
const ORDER = ["cpu","cooler","mb","ram","gpu","storage","nic","psu","case"];
function fromItems(items){
  const b = { storage:[] };
  items.forEach(([id, qty]) => { const p = byId(id); if (!p) return; p.cat === "storage" ? b.storage.push({ id, qty }) : (b[p.cat] = { id, qty }); });
  return b;
}
function lines(b){
  const out = [];
  ORDER.forEach(c => {
    if (c === "storage") b.storage.forEach((s, i) => out.push({ cat:c, idx:i, p:byId(s.id), qty:s.qty }));
    else if (b[c]) out.push({ cat:c, p:byId(b[c].id), qty:b[c].qty || 1 });
  });
  return out;
}
const total = b => lines(b).reduce((s, l) => s + l.p.price * l.qty, 0);
const g = (b, c) => b[c] ? { p:byId(b[c].id), q:b[c].qty || 1 } : null;

function stats(b){
  const cpu = g(b,"cpu"), ram = g(b,"ram"), gpu = g(b,"gpu"), psu = g(b,"psu"), cs = g(b,"case");
  const tb = b.storage.reduce((s, d) => s + byId(d.id).tb * d.qty, 0);
  const disks = b.storage.reduce((s, d) => s + d.qty, 0);
  const load = (cpu ? cpu.p.tdp * cpu.q : 0) + (gpu ? gpu.p.tdp * gpu.q : 0) + 75 + disks * 8 + (ram ? ram.q * 5 : 0);
  return {
    cores: cpu ? cpu.p.cores * cpu.q : 0, ram: ram ? ram.p.size * ram.q : 0, vram: gpu ? gpu.p.vram * gpu.q : 0,
    tb, disks, load, need: Math.ceil(load * 1.3 / 50) * 50, supply: psu ? psu.p.w : (cs?.p.psu || 0),
  };
}
const fmtTB = tb => tb >= 1000 ? (tb / 1000).toFixed(2).replace(".", ",") + " ПБ" : String(Math.round(tb * 10) / 10).replace(".", ",") + " ТБ";
const fmtGB = gb => gb >= 1024 ? (gb / 1024).toFixed(1).replace(".", ",") + " ТБ" : gb + " ГБ";

/* ---------- проверка совместимости ---------- */
function checks(b){
  const R = [], err = t => R.push({ l:"err", t }), warn = t => R.push({ l:"warn", t });
  const cpu = g(b,"cpu"), mb = g(b,"mb"), ram = g(b,"ram"), gpu = g(b,"gpu"), co = g(b,"cooler"), cs = g(b,"case"), psu = g(b,"psu");
  const st = stats(b);
  if (cpu && mb){
    if (cpu.p.socket !== mb.p.socket) err(`Процессор (${cpu.p.socket}) не встаёт в плату (${mb.p.socket})`);
    if (cpu.q > (mb.p.sockets || 1)) err(`Плата на ${mb.p.sockets || 1} CPU, выбрано ${cpu.q}`);
    if (mb.p.onlyPro && !cpu.p.pro) err("Плата WRX90 работает только с Threadripper PRO");
  }
  if (ram && mb){
    if (!mb.p.mem.includes(ram.p.type)) err("Тип памяти не подходит к плате");
    const mods = ram.p.mods * ram.q;
    if (mods > mb.p.dimm) err(`Модулей памяти ${mods}, слотов ${mb.p.dimm}`);
    else if (cpu && cpu.p.socket === mb.p.socket){
      const ch = (CHANNELS[cpu.p.socket] || 2) * cpu.q;
      if (mods < ch && mb.p.dimm >= ch) warn(`Заняты не все каналы памяти (${mods} из ${ch}) — скорость памяти ниже возможной`);
    }
  }
  if (co && cpu){
    if (!co.p.sockets.includes(cpu.p.socket)) err("Кулер не подходит к сокету процессора");
    else if (co.p.tdp < cpu.p.tdp) warn(`Кулер слабоват: ${co.p.tdp} Вт против ${cpu.p.tdp} Вт у CPU`);
    if (cs && /rack1u|rack2u/.test(cs.p.kind) && co.p.tall) err("Башенный кулер не влезет в стоечный корпус 1U/2U");
  }
  if (cs && mb && !cs.p.ff.includes(mb.p.ff)) err(`Плата ${mb.p.ff} не влезет в корпус`);
  if (gpu){
    if (mb && gpu.q > mb.p.pcie) err(`Видеокарт ${gpu.q}, слотов PCIe ${mb.p.pcie}`);
    if (cs && gpu.q > cs.p.gpuMax) err(`Корпус вмещает до ${cs.p.gpuMax} видеокарт`);
    if (cs && gpu.p.slots > cs.p.gpuSlots) err("Видеокарта слишком толстая для корпуса");
    if (cs && gpu.p.passive && !/rack/.test(cs.p.kind)) err("Пассивной серверной карте нужен стоечный корпус с обдувом");
  } else if (cpu && mb && !mb.p.ipmi && (cpu.p.seg !== "desktop" || /F$/.test(cpu.p.name))) err("Нет видеовыхода — нужна видеокарта");
  const hdd = b.storage.filter(s => /hdd|sata/.test(byId(s.id).kind)).reduce((a, s) => a + s.qty, 0);
  if (cs && hdd > cs.p.bays) err(`Дисков ${hdd}, отсеков в корпусе ${cs.p.bays}`);
  if (st.supply && st.supply < st.need) err(`Не хватает мощности БП: нужно ≈${st.need} Вт, есть ${st.supply} Вт`);
  return R;
}

/* совместимые альтернативы для замены детали */
function alternatives(b, cat, curId){
  const cpu = g(b,"cpu")?.p, mb = g(b,"mb")?.p, cs = g(b,"case")?.p, ram = g(b,"ram")?.p;
  const cur = byId(curId);
  return DB[cat].filter(p => {
    switch (cat){
      case "cpu": return !mb || (p.socket === mb.socket && (!mb.onlyPro || p.pro));
      case "mb": return (!cpu || p.socket === cpu.socket) && (!cs || cs.ff.includes(p.ff)) && (!ram || p.mem.includes(ram.type));
      case "ram": return (!mb || mb.mem.includes(p.type)) && p.type === cur.type;
      case "cooler": return !cpu || (p.sockets.includes(cpu.socket) && !(cs && /rack1u|rack2u/.test(cs.kind) && p.tall));
      case "case": return !mb || p.ff.includes(mb.ff);
      case "gpu": return (!cs || (p.slots <= cs.gpuSlots && (!p.passive || /rack/.test(cs.kind)))) && (cur.seg === "desktop" ? p.seg === "desktop" : p.seg !== "desktop");
      case "storage": return (cur.kind === "hdd") === (p.kind === "hdd");
      default: return true;
    }
  });
}

/* ---------- рендер шагов ---------- */
const task = () => TASKS.find(t => t.id === S.task);
let build = null;
function resetBuild(){ build = fromItems(task().tiers[S.tier].items); }

function renderKinds(){
  const K = [
    ["server","Сервер","Виртуализация, сайты, базы, NAS, игровые и AI-серверы."],
    ["pc","ПК","Игры, монтаж, разработка, локальные нейросети."],
  ];
  $("#kinds").innerHTML = K.map(([k, t, d]) => `<button class="kind ${S.kind === k ? "on" : ""}" data-k="${k}"><div><b>${t}</b><span>${d}</span></div><em>Выбрано</em></button>`).join("");
}
function renderTasks(){
  $("#tasks").innerHTML = TASKS.filter(t => t.kind === S.kind).map((t, i) =>
    `<button class="task ${t.id === S.task ? "on" : ""}" data-t="${t.id}"><span class="n">${String(i + 1).padStart(2, "0")}</span><b>${esc(t.title)}</b><span class="d">${esc(t.sub)}</span><i class="arr">→</i></button>`).join("");
}
function renderTiers(){
  $("#tiers").innerHTML = task().tiers.map((tr, i) => {
    const sum = tr.items.reduce((s, [id, q]) => s + byId(id).price * q, 0);
    return `<button class="tier ${i === S.tier ? "on" : ""}" data-i="${i}"><div class="top"><span class="lvl">${esc(tr.name)}</span><span class="circ">${i + 1}</span></div><div class="price">${money(sum)}</div><div class="tgt">${esc(tr.target)}</div></button>`;
  }).join("");
}

const SPLIT = [["gpu","GPU","#111"],["cpu","CPU","#555"],["ram","Память","#8a8780"],["storage","Диски","#bdb9b0"],["other","Прочее","#eceae5"]];
function splitHTML(b){
  const t = total(b) || 1, m = {};
  lines(b).forEach(l => { const k = ["cpu","gpu","ram","storage"].includes(l.cat) ? l.cat : "other"; m[k] = (m[k] || 0) + l.p.price * l.qty; });
  const arr = SPLIT.filter(([k]) => m[k]).map(([k, n, c]) => [n, c, m[k] / t * 100]);
  return `<div class="split">${arr.map(([n, c, v]) => `<div style="flex:${v};background:${c};color:${["#111","#555"].includes(c) ? "#fff" : "#111"}">${v > 12 ? Math.round(v) + "%" : ""}</div>`).join("")}</div>
    <div class="split-l">${arr.map(([n, c, v]) => `<span><i style="background:${c}"></i>${n} ${Math.round(v)}%</span>`).join("")}</div>`;
}

function meta(p){
  switch (p.cat){
    case "cpu": return `${p.cores} ядер · ${p.socket}`;
    case "mb": return `${p.socket} · ${p.ff}${p.ipmi ? " · IPMI" : ""}`;
    case "ram": return p.type === "RDIMM" ? "серверная ECC" : p.type === "ECC" ? "с коррекцией ошибок" : "DDR5";
    case "gpu": return `${p.vram} ГБ видеопамяти`;
    case "storage": return ({ nvme:"NVMe SSD", sata:"SATA SSD", u2:"серверный NVMe, защита от сбоя питания", hdd:"жёсткий диск" })[p.kind];
    case "case": return p.psu ? `блоки питания ${p.psu} Вт в комплекте` : "";
    case "psu": return "";
    case "cooler": return `отводит до ${p.tdp} Вт`;
    case "nic": return `${p.gbit} Гбит/с`;
  }
  return "";
}

function benchHTML(b){
  const cpu = g(b,"cpu")?.p, gpu = g(b,"gpu")?.p;
  const block = (title, note, list, me, val, unit = "") => {
    let arr = list.slice().sort((a, b) => val(b) - val(a));
    const i = arr.indexOf(me);
    arr = arr.slice(Math.max(0, Math.min(i - 2, arr.length - 6)), Math.max(0, Math.min(i - 2, arr.length - 6)) + 6);
    const max = Math.max(...arr.map(val));
    return `<div><h3>${title}</h3><p>${note}</p>${arr.map(p => `<div class="bar ${p === me ? "me" : ""}"><span class="bn">${esc(p.name.replace(/^(AMD|Intel|NVIDIA) /, ""))}</span><div class="bt"><div style="width:${val(p) / max * 100}%"></div></div><span class="bv">${Math.round(val(p)).toLocaleString("ru-RU")}${unit}</span></div>`).join("")}</div>`;
  };
  const out = [];
  if (cpu){
    const game = S.task === "gaming" && cpu.game;
    out.push(game
      ? block("Процессор в играх", "Средний FPS в CPU-зависимых играх, Ryzen 7 9800X3D = 100. Чёрным — ваш.", DB.cpu.filter(p => p.game), cpu, p => p.game)
      : block("Процессор", "Многопоточная производительность (ориентир — Cinebench 2024 Multi). Чёрным — ваш.", DB.cpu.filter(p => (p.seg === "desktop") === (cpu.seg === "desktop")), cpu, p => p.mt));
  }
  if (gpu){
    const game = gpu.game && /gaming|creator/.test(S.task);
    out.push(game
      ? block("Видеокарта в играх", "Индекс FPS в 1440p, RTX 5070 = 100.", DB.gpu.filter(p => p.game), gpu, p => p.game)
      : block("Видеокарта для нейросетей", "Объём видеопамяти — главное для LLM. Чёрным — ваша.", DB.gpu, gpu, p => p.vram, " ГБ"));
  } else {
    if (cpu) out.push(block("Скорость одного ядра", "Однопоточная производительность, Ryzen 9 9950X = 100. Важна для игровых серверов, 1С и баз данных.", DB.cpu.filter(p => (p.seg === "desktop") === (cpu.seg === "desktop") || p.seg === "server"), cpu, p => p.st));
  }
  return out.join("");
}

function renderResult(){
  const t = task(), tr = t.tiers[S.tier], st = stats(build), ch = checks(build), sum = total(build);
  const errs = ch.filter(c => c.l === "err").length, warns = ch.length - errs;
  const first = t.title.split(" ")[0];
  const kv = [["Ядра", st.cores || "—"], ["Память", fmtGB(st.ram)]];
  kv.push(st.vram ? ["Видеопамять", st.vram + " ГБ"] : ["Диски", fmtTB(st.tb)]);
  kv.push(st.vram ? ["Диски", fmtTB(st.tb)] : ["Потребление", "≈" + st.load + " Вт"]);

  $("#resultIn").innerHTML = `
    <div class="res-kicker">Ваша сборка</div>
    <h2 class="res-title">${esc(first)} <span class="o">${esc(tr.name)}</span></h2>
    <div class="res-sub">
      <span>${esc(t.title)} · ${esc(tr.target)}</span>
      <span class="status ${errs ? "bad" : warns ? "warn" : ""}"><i></i>${errs ? "Есть несовместимость" : warns ? "Совместимо, есть замечания" : "Всё совместимо"}</span>
    </div>
    <div class="res-grid">
      <div class="parts">${lines(build).map(l => `
        <div class="part" data-cat="${l.cat}" ${l.idx != null ? `data-idx="${l.idx}"` : ""}>
          <small>${CAT_META[l.cat].short}</small>
          <div class="nm">${l.qty > 1 ? l.qty + " × " : ""}${esc(l.p.name)}<em>${esc(meta(l.p))}</em>
            ${alternatives(build, l.cat, l.p.id).length > 1 ? `<button class="sw">Заменить</button>` : ""}</div>
          <div class="pr">${money(l.p.price * l.qty)}</div>
          <select>${alternatives(build, l.cat, l.p.id).sort((a, b) => a.price - b.price).map(p => `<option value="${p.id}" ${p.id === l.p.id ? "selected" : ""}>${esc(p.name)} — ${money(p.price * l.qty)}</option>`).join("")}</select>
        </div>`).join("")}
      </div>
      <div class="side">
        <div class="total"><small>Итого</small><b>${money(sum)}</b></div>
        <div class="kv">${kv.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join("")}</div>
        <div class="blk"><div class="blk-h">Что получите</div><ul class="good">${tr.perf.map(p => `<li>${esc(p)}</li>`).join("")}</ul></div>
        <div class="blk"><div class="blk-h">Куда уходят деньги</div>${splitHTML(build)}</div>
        ${ch.length ? `<div class="blk"><div class="blk-h">Проверка</div><ul class="warns">${ch.map(c => `<li class="${c.l}"><b>${c.l === "err" ? "×" : "!"}</b>${esc(c.t)}</li>`).join("")}</ul></div>` : ""}
        <div class="blk"><div class="blk-h">Совет</div><ul class="good"><li>${esc(t.tips[0])}</li></ul></div>
        <div class="actions"><button class="btn" id="copy">Скопировать список</button><button class="btn ghost" id="reset">Сбросить замены</button></div>
      </div>
    </div>
    <div class="tests">${benchHTML(build)}</div>`;
}

function renderGuide(){
  $("#acc").innerHTML = GUIDES.map((gd, i) => `<details><summary><span class="n">${String(i + 1).padStart(2, "0")}</span><b>${esc(gd.title)}</b><span class="pl">+</span></summary>
    <div class="body"><div>${gd.body.map(p => `<p>${p}</p>`).join("")}</div><div class="verdict"><small>Вывод</small>${esc(gd.verdict)}</div></div></details>`).join("");
}

function save(){ store.set("state", S); }
function renderAll(){
  $$("#cur button").forEach(b => b.classList.toggle("on", b.dataset.c === S.cur));
  renderKinds(); renderTasks(); renderTiers(); renderResult();
}

/* ---------- события ---------- */
function init(){
  $("#upd").textContent = DB.updated;
  resetBuild(); renderGuide(); renderAll();

  $("#cur").onclick = e => { const c = e.target.dataset.c; if (!c) return; S.cur = c; save(); renderAll(); };
  $("#kinds").onclick = e => {
    const k = e.target.closest("[data-k]"); if (!k) return;
    S.kind = k.dataset.k; S.task = TASKS.find(t => t.kind === S.kind).id; S.tier = 1; save(); resetBuild(); renderAll();
    document.getElementById("step2").scrollIntoView({ behavior:"smooth" });
  };
  $("#tasks").onclick = e => {
    const t = e.target.closest("[data-t]"); if (!t) return;
    S.task = t.dataset.t; S.tier = 1; save(); resetBuild(); renderAll();
    document.getElementById("step3").scrollIntoView({ behavior:"smooth" });
  };
  $("#tiers").onclick = e => {
    const t = e.target.closest("[data-i]"); if (!t) return;
    S.tier = +t.dataset.i; save(); resetBuild(); renderAll();
    document.getElementById("result").scrollIntoView({ behavior:"smooth" });
  };
  $("#resultIn").addEventListener("click", async e => {
    if (e.target.classList.contains("sw")){ e.target.closest(".part").classList.toggle("edit"); return; }
    if (e.target.id === "reset"){ resetBuild(); renderResult(); toast("Сборка сброшена"); return; }
    if (e.target.id === "copy"){
      const txt = `SRVFORGE — ${task().title}, ${task().tiers[S.tier].name}\n` + lines(build).map(l => `${CAT_META[l.cat].short}: ${l.qty > 1 ? l.qty + "× " : ""}${l.p.name} — ${money(l.p.price * l.qty)}`).join("\n") + `\nИтого: ${money(total(build))}`;
      try { await navigator.clipboard.writeText(txt); toast("Список скопирован"); } catch { toast("Браузер не дал скопировать"); }
    }
  });
  $("#resultIn").addEventListener("change", e => {
    const sel = e.target.closest(".part select"); if (!sel) return;
    const row = sel.closest(".part"), cat = row.dataset.cat;
    if (cat === "storage") build.storage[+row.dataset.idx].id = sel.value;
    else build[cat].id = sel.value;
    renderResult(); toast("Деталь заменена");
  });
}
init();
})();
