(() => {
"use strict";

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const store = {
  get(k, d){ try { const v = localStorage.getItem("srvforge:" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem("srvforge:" + k, JSON.stringify(v)); } catch {} },
};

const ALL = {};
Object.keys(CAT_META).forEach(cat => (DB[cat] || []).forEach(p => { p.cat = cat; ALL[p.id] = p; }));
const byId = id => ALL[id];

const CUR = {
  USD:{ sym:"$", pre:true, rate:1 },
  BYN:{ sym:" Br", pre:false, rate:3.05 },
  RUB:{ sym:" ₽", pre:false, rate:80 },
};
const state = {
  kind: "server",
  task: "virt",
  budgetUSD: null,
  cur: store.get("cur", "USD"),
  rates: store.get("rates", { BYN:CUR.BYN.rate, RUB:CUR.RUB.rate }),
  build: store.get("build", null),
  onlyCompat: true,
  catTab: "cpu",
  benchTab: "gpu-game",
  benchMode: "abs",
};
if (!CUR[state.cur]) state.cur = "USD";

function money(usd){
  const c = CUR[state.cur];
  const rate = state.cur === "USD" ? 1 : (state.rates[state.cur] || c.rate);
  const v = Math.round(usd * rate);
  const s = v.toLocaleString("ru-RU").replace(/ /g, " ");
  return c.pre ? c.sym + s : s + c.sym;
}
function moneyShort(usd){
  const rate = state.cur === "USD" ? 1 : (state.rates[state.cur] || CUR[state.cur].rate);
  const v = usd * rate, c = CUR[state.cur];
  const s = v >= 1e6 ? (v/1e6).toFixed(v >= 1e7 ? 0 : 1).replace(".", ",") + " млн" : v >= 1e3 ? Math.round(v/1e3) + " тыс" : Math.round(v) + "";
  return c.pre ? c.sym + s : s + c.sym;
}
let toastT;
function toast(msg){
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- icons ---------- */
const ICONS = {
  gamepad:'<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="6"/>',
  film:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4"/>',
  code:'<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  brain:'<path d="M12 5a3 3 0 0 0-5.9-.8A3 3 0 0 0 4 9.5a3 3 0 0 0 .5 5.5A3 3 0 0 0 8 19.5 3 3 0 0 0 12 18zM12 5a3 3 0 0 1 5.9-.8A3 3 0 0 1 20 9.5a3 3 0 0 1-.5 5.5 3 3 0 0 1-3.5 4.5A3 3 0 0 1 12 18z"/>',
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  layers:'<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5M2 17l10 5 10-5"/>',
  globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  server:'<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  cpu:'<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
  bolt:'<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
};
const icon = n => `<svg viewBox="0 0 24 24">${ICONS[n] || ICONS.server}</svg>`;

/* ---------- build model ---------- */
const SINGLE = ["cpu","mb","ram","gpu","cooler","psu","case","nic"];
const emptyBuild = () => ({ cpu:null, mb:null, ram:null, gpu:null, cooler:null, psu:null, case:null, nic:null, storage:[] });
function buildFromItems(items){
  const b = emptyBuild();
  items.forEach(([id, qty]) => {
    const p = byId(id); if (!p) return;
    if (p.cat === "storage") b.storage.push({ id, qty });
    else b[p.cat] = { id, qty };
  });
  return b;
}
function lines(b){
  const out = [];
  SINGLE.forEach(c => { if (b[c] && byId(b[c].id)) out.push({ cat:c, p:byId(b[c].id), qty:b[c].qty || 1 }); });
  b.storage.forEach(s => { if (byId(s.id)) out.push({ cat:"storage", p:byId(s.id), qty:s.qty || 1 }); });
  return out;
}
const total = b => lines(b).reduce((s, l) => s + l.p.price * l.qty, 0);
const itemsTotal = items => items.reduce((s, [id, q]) => s + (byId(id)?.price || 0) * q, 0);

function stats(b){
  const g = c => b[c] ? { p:byId(b[c].id), q:b[c].qty || 1 } : null;
  const cpu = g("cpu"), ram = g("ram"), gpu = g("gpu"), psu = g("psu"), cs = g("case");
  const disks = b.storage.map(s => ({ p:byId(s.id), q:s.qty }));
  const cores = cpu ? cpu.p.cores * cpu.q : 0;
  const ramGB = ram ? ram.p.size * ram.q : 0;
  const vram = gpu ? gpu.p.vram * gpu.q : 0;
  const tb = disks.reduce((s, d) => s + d.p.tb * d.q, 0);
  const diskN = disks.reduce((s, d) => s + d.q, 0);
  const load = (cpu ? cpu.p.tdp * cpu.q : 0) + (gpu ? gpu.p.tdp * gpu.q : 0) + 75 + diskN * 8 + (ram ? ram.q * (ram.p.type === "RDIMM" ? 6 : 3) : 0);
  const need = Math.ceil(load * 1.3 / 50) * 50;
  const supply = psu ? psu.p.w : (cs && cs.p.psu ? cs.p.psu : 0);
  return { cores, ramGB, vram, tb, diskN, load, need, supply };
}

function checks(b){
  const R = [];
  const ok = t => R.push({ l:"ok", t }), warn = t => R.push({ l:"warn", t }), err = t => R.push({ l:"err", t });
  const g = c => b[c] ? { p:byId(b[c].id), q:b[c].qty || 1 } : null;
  const cpu = g("cpu"), mb = g("mb"), ram = g("ram"), gpu = g("gpu"), co = g("cooler"), psu = g("psu"), cs = g("case");
  const st = stats(b);
  const bad = {};

  if (!cpu) err("Не выбран процессор"); if (!mb) err("Не выбрана материнская плата");
  if (cpu && mb){
    if (cpu.p.socket !== mb.p.socket){ err(`Сокет не совпадает: ${cpu.p.name} — ${cpu.p.socket}, плата — ${mb.p.socket}`); bad.cpu = bad.mb = "err"; }
    else ok(`Сокет ${cpu.p.socket} совпадает`);
    const sockets = mb.p.sockets || 1;
    if (cpu.q > sockets){ err(`Плата рассчитана на ${sockets} CPU, выбрано ${cpu.q}`); bad.cpu = "err"; }
    else if (sockets > 1 && cpu.q < sockets) warn(`Двухсокетная плата с одним CPU: половина слотов памяти и PCIe не работает`);
    if (mb.p.onlyPro && !cpu.p.pro){ err(`${mb.p.name} работает только с Threadripper PRO`); bad.cpu = bad.mb = "err"; }
    if (cpu.p.seg === "server" && !mb.p.server && cpu.p.socket === "AM5") warn("EPYC 4005 лучше ставить в серверную плату AM5 (ASRock Rack / Supermicro) — там валидирован ECC и есть IPMI");
  }
  if (ram && mb){
    if (!mb.p.mem.includes(ram.p.type)){ err(`Память ${ram.p.type === "RDIMM" ? "RDIMM" : ram.p.type === "ECC" ? "ECC UDIMM" : "обычная DDR5"} не подходит к плате (нужна: ${mb.p.mem.map(m => m === "RDIMM" ? "RDIMM" : m === "ECC" ? "ECC UDIMM" : "DDR5").join(" / ")})`); bad.ram = "err"; }
    const mods = ram.p.mods * ram.q;
    if (mods > mb.p.dimm){ err(`Модулей памяти ${mods}, а слотов на плате ${mb.p.dimm}`); bad.ram = "err"; }
    else if (cpu && cpu.p.socket === mb.p.socket){
      const ch = (CHANNELS[cpu.p.socket] || 2) * (cpu.p.pro && cpu.p.socket === "sTR5" ? 2 : 1) * cpu.q;
      if (mods < ch && mb.p.dimm >= ch){ warn(`Занято ${mods} из ${ch} каналов памяти — пропускная способность ниже максимума. Лучше поставить модули во все ${ch} каналов`); bad.ram = bad.ram || "warn"; }
      else if (mods > 2 && ram.p.type === "DDR5") warn("4 модуля обычной DDR5 снизят частоту — лучше 2 модуля большего объёма");
      else ok(`Память: ${st.ramGB} ГБ, ${mods} мод.`);
    }
  } else if (!ram) err("Не выбрана память");

  if (!co && cpu) err("Нужно охлаждение процессора (серверные и боксовые без кулера в комплекте)");
  if (co && cpu){
    if (!co.p.sockets.includes(cpu.p.socket)){ err(`Кулер не поддерживает сокет ${cpu.p.socket}`); bad.cooler = "err"; }
    else if (co.p.tdp < cpu.p.tdp){ warn(`Кулер рассчитан на ${co.p.tdp} Вт, а CPU выделяет до ${cpu.p.tdp} Вт — возможен троттлинг`); bad.cooler = "warn"; }
    if (co.q < cpu.q){ err(`Кулеров ${co.q}, процессоров ${cpu.q}`); bad.cooler = "err"; }
    if (cs && /rack1u|rack2u/.test(cs.p.kind) && co.p.tall){ err("Башенный кулер не влезет в стоечное шасси 1U/2U — нужен низкопрофильный радиатор"); bad.cooler = "err"; }
  }
  if (cs && mb){
    if (!cs.p.ff.includes(mb.p.ff)){ err(`Плата ${mb.p.ff} не влезет в корпус (поддержка: ${cs.p.ff.join(", ")})`); bad.case = bad.mb = "err"; }
  } else if (!cs) warn("Не выбран корпус");

  if (gpu){
    if (mb && gpu.q > mb.p.pcie){ err(`Видеокарт ${gpu.q}, а слотов PCIe x16 на плате ${mb.p.pcie}`); bad.gpu = "err"; }
    if (cs){
      if (gpu.q > cs.p.gpuMax){ err(`Корпус вмещает до ${cs.p.gpuMax} GPU`); bad.gpu = "err"; }
      if (gpu.p.slots > cs.p.gpuSlots){ err(`Карта толщиной ${gpu.p.slots} слота не влезет (макс. ${cs.p.gpuSlots})`); bad.gpu = "err"; }
      if (gpu.p.passive && !/rack/.test(cs.p.kind)){ err(`${gpu.p.name} пассивная — нужен серверный обдув в стоечном шасси`); bad.gpu = "err"; }
    }
    if (gpu.q > 1 && gpu.p.seg === "desktop" && gpu.p.tdp > 300) warn("Несколько игровых карт с осевыми вентиляторами будут греть друг друга — для multi-GPU лучше RTX PRO / серверные");
  } else if (cpu && mb && !mb.p.ipmi && (cpu.p.seg !== "desktop" || /F$/.test(cpu.p.name))){ err("Нет видеовыхода: процессор без встроенной графики — нужна видеокарта или плата с IPMI"); bad.gpu = "err"; }

  const nvme = b.storage.filter(s => byId(s.id)?.kind === "nvme").reduce((a, s) => a + s.qty, 0);
  const u2 = b.storage.filter(s => byId(s.id)?.kind === "u2").reduce((a, s) => a + s.qty, 0);
  const hdd = b.storage.filter(s => /hdd|sata/.test(byId(s.id)?.kind)).reduce((a, s) => a + s.qty, 0);
  if (!b.storage.length) err("Нет накопителя под систему");
  if (mb && nvme > mb.p.m2) { warn(`M.2-накопителей ${nvme}, слотов M.2 на плате ${mb.p.m2} — понадобится адаптер PCIe`); bad.storage = "warn"; }
  if (u2){
    const bays = cs?.p.u2bays || 0;
    if (mb && !mb.p.u2) { warn("У платы нет нативных портов U.2/MCIO — понадобится HBA/переходник"); bad.storage = "warn"; }
    if (cs && u2 > bays && u2 > 2) { warn(`U.2-дисков ${u2}, а NVMe-отсеков в шасси ${bays}`); bad.storage = "warn"; }
  }
  if (cs && hdd > cs.p.bays){ err(`Дисков 3.5"/2.5" — ${hdd}, а отсеков ${cs.p.bays}`); bad.storage = "err"; }
  if (cpu && cpu.p.seg === "server" && nvme && !u2 && !hdd)
    warn("Потребительские NVMe в сервере — без защиты от потери питания (PLP). Для БД/ZFS берите enterprise U.2");
  if (cpu && cpu.p.seg === "server" && ram && ram.p.type === "DDR5") warn("Серверу лучше память с ECC");

  if (st.supply){
    if (st.supply < st.need){ err(`Блоку питания не хватает мощности: нужно ≈${st.need} Вт, есть ${st.supply} Вт`); bad.psu = "err"; }
    else ok(`Питание: нагрузка ≈${st.load} Вт, запас до ${st.supply} Вт`);
  } else if (cs) err("Не выбран блок питания");
  if (psu && cs && cs.p.psu) warn("В шасси уже есть резервируемые БП — отдельный ATX-блок не нужен");

  if (gpu && gpu.p.game && cpu && cpu.p.game && gpu.p.game > 140 && cpu.p.game < 82)
    warn("Процессор будет ограничивать топовую видеокарту в играх — рассмотрите X3D");
  if (gpu && cpu && cpu.p.seg === "server" && gpu.p.seg === "desktop" && gpu.q > 1) warn("Игровые GPU в сервере: лицензия драйвера NVIDIA не разрешает их в датацентрах");

  return { list:R, bad };
}

/* ---------- PICKER ---------- */
const BMIN = 400, BMAX = 400000;
const sliderToUSD = v => Math.round(BMIN * Math.pow(BMAX / BMIN, v / 1000));
const usdToSlider = u => Math.round(1000 * Math.log(Math.max(BMIN, Math.min(BMAX, u)) / BMIN) / Math.log(BMAX / BMIN));

function curTask(){ return TASKS.find(t => t.id === state.task); }

function renderTasks(){
  $$("#kindSeg button").forEach(b => b.classList.toggle("on", b.dataset.kind === state.kind));
  $("#tasks").innerHTML = TASKS.filter(t => t.kind === state.kind).map(t =>
    `<button class="task ${t.id === state.task ? "on" : ""}" data-task="${t.id}">${icon(t.icon)}<div><b>${esc(t.title)}</b><span>${esc(t.sub)}</span></div></button>`
  ).join("");
}

function tierSpecs(items){
  const b = buildFromItems(items), s = stats(b), cpu = b.cpu && byId(b.cpu.id), gpu = b.gpu && byId(b.gpu.id);
  const out = [
    ["CPU", cpu ? `${b.cpu.qty > 1 ? b.cpu.qty + "× " : ""}${cpu.name.replace(/^(AMD|Intel) /, "")}` : "—"],
    ["Ядра", s.cores ? `${s.cores}` : "—"],
    ["RAM", s.ramGB >= 1024 ? (s.ramGB / 1024).toFixed(1).replace(".", ",") + " ТБ" : s.ramGB + " ГБ"],
    [gpu ? "GPU" : "Диски", gpu ? `${b.gpu.qty > 1 ? b.gpu.qty + "× " : ""}${gpu.name.replace(/^(NVIDIA|AMD|Intel) (Radeon |GeForce |Arc )?/, "")}` : fmtTB(s.tb)],
  ];
  if (gpu) out.push(["Диски", fmtTB(s.tb)], ["Питание", `≈${s.load} Вт`]);
  return out;
}
const fmtTB = tb => tb >= 1000 ? (tb / 1000).toFixed(2).replace(".", ",") + " ПБ" : (Math.round(tb * 10) / 10).toString().replace(".", ",") + " ТБ";

function renderTiers(){
  const t = curTask();
  const totals = t.tiers.map(x => itemsTotal(x.items));
  if (state.budgetUSD == null) state.budgetUSD = totals[1];
  const B = state.budgetUSD;
  let fit = -1; totals.forEach((v, i) => { if (v <= B * 1.03) fit = i; });

  const sl = $("#budget"); sl.value = usdToSlider(B); sl.style.setProperty("--p", sl.value / 10 + "%");
  $("#budgetVal").textContent = money(B);
  $("#budgetHint").innerHTML = fit < 0
    ? `Минимальная разумная сборка для «${esc(t.title)}» — от <b class="mono">${money(totals[0])}</b>`
    : fit === 2 && B > totals[2] * 1.5 ? `Бюджета хватает с запасом — можно удвоить узлы или взять следующий класс задачи`
    : `Подходит уровень «${t.tiers[fit].name}»`;
  $("#budgetScale").innerHTML = [400, 2000, 10000, 50000, 400000].map(v => `<span>${moneyShort(v)}</span>`).join("");

  $("#tiers").innerHTML = t.tiers.map((tier, i) => {
    const sum = totals[i], over = sum > B * 1.03;
    const badge = i === fit ? `<span class="badge">Под ваш бюджет</span>` : over ? `<span class="badge gap">+${money(sum - B)}</span>` : "";
    const parts = tier.items.map(([id, q]) => { const p = byId(id); return `<div><span>${q > 1 ? q + "× " : ""}${esc(p.name)}</span><span>${money(p.price * q)}</span></div>`; }).join("");
    return `<article class="tier ${i === fit ? "fit" : ""} ${over ? "over" : ""}">
      ${badge}
      <div class="tier-h"><h3>${esc(tier.name)}</h3><div class="tier-price">${money(sum)}</div></div>
      <div class="tier-target">${esc(tier.target)}</div>
      <div class="specs">${tierSpecs(tier.items).map(([k, v]) => `<div class="spec"><small>${k}</small><b>${esc(v)}</b></div>`).join("")}</div>
      <ul class="perf">${tier.perf.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
      <details class="parts"><summary>Состав сборки (${tier.items.length} поз.)</summary><div class="parts-list">${parts}</div></details>
      <button class="btn ${i === fit ? "btn-primary" : "btn-ghost"}" data-load="${i}">Открыть в конструкторе</button>
    </article>`;
  }).join("");
  renderPicture(fit < 0 ? 0 : fit);
}

const SPLIT_COL = { cpu:"#ff7a59", gpu:"#86d93a", ram:"#5be3ff", storage:"#c6ff4a", mb:"#b48cff", case:"#ffcf5c", cooler:"#7aa2ff", psu:"#ff9fd0", nic:"#4fe0b6", other:"#7c859a" };
const SPLIT_LBL = { cpu:"CPU", gpu:"GPU", ram:"Память", storage:"Диски", mb:"Плата", case:"Корпус", cooler:"Охлаждение", psu:"БП", nic:"Сеть", other:"Прочее" };
function splitOf(b){
  const t = total(b) || 1, m = {};
  lines(b).forEach(l => { const k = ["cpu","gpu","ram","storage","mb"].includes(l.cat) ? l.cat : "other"; m[k] = (m[k] || 0) + l.p.price * l.qty; });
  return Object.entries(m).map(([k, v]) => [k, v / t * 100]).sort((a, b) => b[1] - a[1]);
}
const splitBar = arr => `<div class="splitbar">${arr.map(([k, v]) => `<div style="flex:${v};background:${SPLIT_COL[k]}" title="${SPLIT_LBL[k]} ${Math.round(v)}%">${v > 13 ? SPLIT_LBL[k] + " " + Math.round(v) + "%" : v > 6 ? Math.round(v) + "%" : ""}</div>`).join("")}</div>`;

function renderPicture(idx){
  const t = curTask(), tier = t.tiers[idx], b = buildFromItems(tier.items);
  const rec = Object.entries(t.split).sort((a, b) => b[1] - a[1]);
  const act = splitOf(b);
  const keys = [...new Set([...rec.map(r => r[0]), ...act.map(a => a[0])])];
  $("#picture").innerHTML = `
    <div>
      <h3>Картина бюджета: ${esc(t.title.toLowerCase())}</h3>
      <div class="cmp-label">Рекомендуемое распределение</div>${splitBar(rec)}
      <div class="cmp-label">Сборка «${esc(tier.name)}» — ${money(total(b))}</div>${splitBar(act)}
      <div class="legend">${keys.map(k => `<span><i style="background:${SPLIT_COL[k]}"></i>${SPLIT_LBL[k]}</span>`).join("")}</div>
    </div>
    <div><h3>На что обратить внимание</h3><ul class="tips">${t.tips.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
}

/* ---------- BUILDER ---------- */
function compatible(cat, p, b){
  const g = c => b[c] && byId(b[c].id);
  const cpu = g("cpu"), mb = g("mb"), cs = g("case");
  switch (cat){
    case "cpu": return !mb || (p.socket === mb.socket && (!mb.onlyPro || p.pro));
    case "mb": return (!cpu || (p.socket === cpu.socket && (!p.onlyPro || cpu.pro))) && (!cs || cs.ff.includes(p.ff)) && (!g("ram") || p.mem.includes(g("ram").type));
    case "ram": return !mb || mb.mem.includes(p.type);
    case "cooler": return !cpu || (p.sockets.includes(cpu.socket) && !(cs && /rack1u|rack2u/.test(cs.kind) && p.tall));
    case "case": return !mb || p.ff.includes(mb.ff);
    case "gpu": return !cs || (p.slots <= cs.gpuSlots && (!p.passive || /rack/.test(cs.kind)));
    default: return true;
  }
}
const QTY_CATS = { cpu:2, ram:32, gpu:8, cooler:2, nic:4 };

function optionList(cat, selId, b){
  let list = DB[cat].slice();
  if (state.onlyCompat) list = list.filter(p => p.id === selId || compatible(cat, p, b));
  const groups = {};
  list.forEach(p => {
    const gname = cat === "cpu" ? ({ desktop:"Десктоп", hedt:"Рабочие станции", server:"Серверные" }[p.seg])
      : cat === "gpu" ? ({ desktop:"Игровые", pro:"Профессиональные", server:"Серверные ускорители" }[p.seg])
      : cat === "storage" ? ({ nvme:"NVMe M.2", sata:"SATA SSD", u2:"Enterprise NVMe (PLP)", hdd:"HDD" }[p.kind])
      : cat === "ram" ? ({ DDR5:"Обычная DDR5", ECC:"ECC UDIMM", RDIMM:"Серверная RDIMM" }[p.type])
      : cat === "mb" ? (p.server ? "Серверные" : "Десктоп / WS") : "";
    (groups[gname] = groups[gname] || []).push(p);
  });
  const opt = p => `<option value="${p.id}" ${p.id === selId ? "selected" : ""}>${esc(p.name)} — ${money(p.price)}</option>`;
  return `<option value="">— не выбрано —</option>` + Object.entries(groups).map(([g, ps]) => g ? `<optgroup label="${g}">${ps.map(opt).join("")}</optgroup>` : ps.map(opt).join("")).join("");
}

function slotMeta(cat, p, b){
  if (!p) return "";
  if (cat === "cpu") return `${p.socket} · ${p.cores}C/${p.threads}T · ${p.tdp} Вт`;
  if (cat === "mb") return `${p.socket} · ${p.ff} · ${p.dimm} DIMM`;
  if (cat === "ram") return `${p.type} · ${p.size * (b.ram?.qty || 1)} ГБ`;
  if (cat === "gpu") return `${p.vram} ГБ · ${p.tdp} Вт`;
  if (cat === "case") return p.psu ? `БП ${p.psu} Вт в комплекте` : p.kind;
  if (cat === "psu") return `${p.w} Вт`;
  if (cat === "cooler") return `до ${p.tdp} Вт`;
  if (cat === "nic") return `${p.gbit} Гбит`;
  return "";
}

function renderBuilder(){
  const b = state.build, { bad } = checks(b);
  const qtyBox = (cat, q, idx) => `<div class="qty" data-cat="${cat}" ${idx != null ? `data-idx="${idx}"` : ""}><button data-d="-1">−</button><span>${q}</span><button data-d="1">+</button></div>`;
  let html = "";
  ["cpu","cooler","mb","ram","gpu","storage","psu","case","nic"].forEach(cat => {
    if (cat === "storage"){
      html += `<div class="slot ${bad.storage || ""}"><div class="slot-l">${CAT_META.storage.label}<small>${b.storage.length ? fmtTB(stats(b).tb) : ""}</small></div>
        <div class="sub-rows">${b.storage.map((s, i) => `<div class="sub-row"><select data-cat="storage" data-idx="${i}">${optionList("storage", s.id, b)}</select>${qtyBox("storage", s.qty, i)}<div class="slot-p">${money(byId(s.id).price * s.qty)}</div><button class="icon-btn" data-del="${i}" title="Убрать">×</button></div>`).join("")}
        <button class="add-link" id="addDisk">+ добавить накопитель</button></div></div>`;
      return;
    }
    const sel = b[cat], p = sel && byId(sel.id), q = sel?.qty || 1;
    html += `<div class="slot ${bad[cat] || ""}">
      <div class="slot-l">${CAT_META[cat].label}<small>${esc(slotMeta(cat, p, b))}</small></div>
      <select data-cat="${cat}">${optionList(cat, sel?.id, b)}</select>
      ${QTY_CATS[cat] && p ? qtyBox(cat, q) : `<div class="qty ph"><button>−</button><span>1</span><button>+</button></div>`}
      <div class="slot-p">${p ? money(p.price * q) : "—"}</div></div>`;
  });
  $("#slots").innerHTML = html;
  renderSummary();
  store.set("build", b);
}

function renderSummary(){
  const b = state.build, s = stats(b), { list } = checks(b), sum = total(b);
  const errs = list.filter(x => x.l === "err").length, warns = list.filter(x => x.l === "warn").length;
  const pwPct = s.supply ? Math.min(100, s.need / s.supply * 100) : 0;
  const pwCol = !s.supply ? "var(--line2)" : s.need > s.supply ? "var(--err)" : pwPct > 85 ? "var(--warn)" : "var(--ok)";
  const sorted = [...list.filter(x => x.l === "err"), ...list.filter(x => x.l === "warn"), ...list.filter(x => x.l === "ok")];
  $("#summary").innerHTML = `
    <div class="sum-total"><span class="muted">Итого</span><b>${money(sum)}</b></div>
    <div class="sum-grid">
      <div class="spec"><small>Ядра</small><b>${s.cores || "—"}</b></div>
      <div class="spec"><small>RAM</small><b>${s.ramGB ? s.ramGB + " ГБ" : "—"}</b></div>
      <div class="spec"><small>VRAM</small><b>${s.vram ? s.vram + " ГБ" : "—"}</b></div>
      <div class="spec"><small>Диски</small><b>${s.tb ? fmtTB(s.tb) : "—"}</b></div>
    </div>
    <div>
      <div class="row" style="justify-content:space-between;margin-bottom:6px"><span class="small muted">Питание: нужно ≈${s.need} Вт</span><span class="small mono">${s.supply ? s.supply + " Вт" : "нет БП"}</span></div>
      <div class="pw"><div style="width:${pwPct}%;background:${pwCol}"></div></div>
    </div>
    ${sum ? `<div><div class="cmp-label" style="margin-top:0">Куда уходят деньги</div>${splitBar(splitOf(b))}</div>` : ""}
    <div>
      <div class="cmp-label" style="margin-top:0">Проверка: ${errs ? `<span style="color:var(--err)">${errs} ошиб.</span>` : `<span style="color:var(--ok)">совместимо</span>`}${warns ? ` · <span style="color:var(--warn)">${warns} замеч.</span>` : ""}</div>
      <div class="checks">${sorted.map(c => `<div class="chkline ${c.l}"><i>${c.l === "ok" ? "✓" : c.l === "warn" ? "!" : "×"}</i><span>${esc(c.t)}</span></div>`).join("")}</div>
    </div>
    <div class="sum-actions"><button class="btn btn-primary sm" id="copyBuild">Скопировать список</button></div>`;
}

function buildText(){
  const b = state.build;
  return "Сборка SRVFORGE\n" + lines(b).map(l => `${CAT_META[l.cat].short}: ${l.qty > 1 ? l.qty + "× " : ""}${l.p.name} — ${money(l.p.price * l.qty)}`).join("\n") + `\nИтого: ${money(total(b))}`;
}

/* ---------- CATALOG ---------- */
const CAT_COLS = {
  cpu:[["Ядра/потоки", p => `${p.cores}/${p.threads}`], ["Сокет", p => p.socket], ["TDP", p => p.tdp + " Вт"], ["Многопоток", p => mini(p.mt, 16000) + p.mt.toLocaleString("ru-RU")]],
  mb:[["Сокет", p => p.socket + (p.sockets > 1 ? " ×2" : "")], ["Формат", p => p.ff], ["Память", p => `${p.dimm}× ${p.mem.join("/")}`], ["Фичи", p => [p.ipmi && "IPMI", p.u2 && "U.2", `${p.m2}×M.2`].filter(Boolean).join(" · ")]],
  ram:[["Тип", p => p.type], ["Объём", p => p.size + " ГБ"], ["Модулей", p => p.mods], ["$/ГБ", p => money(p.price / p.size)]],
  gpu:[["VRAM", p => p.vram + " ГБ"], ["TDP", p => p.tdp + " Вт"], ["Игры", p => p.game ? mini(p.game, 205) + p.game : "—"], ["AI", p => mini(p.ai, 250) + p.ai]],
  storage:[["Тип", p => ({ nvme:"NVMe M.2", sata:"SATA", u2:"U.2 PLP", hdd:"HDD" }[p.kind])], ["Объём", p => fmtTB(p.tb)], ["Чтение", p => p.read.toLocaleString("ru-RU") + " МБ/с"], ["$/ТБ", p => money(p.price / p.tb)]],
  cooler:[["Сокеты", p => p.sockets.join(", ")], ["Отвод", p => p.tdp + " Вт"], ["Формат", p => p.tall ? "башня" : "низкий / СЖО"]],
  psu:[["Мощность", p => p.w + " Вт"], ["$/Вт", p => money(p.price / p.w * 100) + " /100Вт"]],
  case:[["Тип", p => p.kind], ["Платы", p => p.ff.join(", ")], ["Отсеки", p => `${p.bays}×3.5"${p.u2bays ? ` · ${p.u2bays}×U.2` : ""}`], ["БП", p => p.psu ? p.psu + " Вт" : "—"]],
  nic:[["Скорость", p => p.gbit + " Гбит/с"]],
};
const mini = (v, max) => `<span class="mini"><i style="width:${Math.min(100, v / max * 100)}%"></i></span>`;
const perfOf = p => p.cat === "cpu" ? p.mt : p.cat === "gpu" ? (p.game || p.ai) : p.cat === "storage" ? p.tb : p.cat === "ram" ? p.size : p.cat === "psu" ? p.w : p.cat === "nic" ? p.gbit : p.tdp || 0;

function renderCatalog(){
  $("#catTabs").innerHTML = Object.keys(CAT_META).map(c => `<button class="tab ${c === state.catTab ? "on" : ""}" data-tab="${c}">${CAT_META[c].label}<em>${DB[c].length}</em></button>`).join("");
  const q = $("#catSearch").value.trim().toLowerCase(), sort = $("#catSort").value;
  let list = DB[state.catTab].filter(p => !q || (p.name + " " + (p.note || "") + " " + (p.socket || "") + " " + (p.type || "") + " " + (p.kind || "")).toLowerCase().includes(q));
  const k = { price: p => p.price, "-price": p => -p.price, perf: p => -perfOf(p), value: p => -perfOf(p) / p.price }[sort];
  list.sort((a, b) => k(a) - k(b));
  const cols = CAT_COLS[state.catTab];
  const chips = p => [p.brand && `<span class="chip ${p.brand.toLowerCase()}">${p.brand}</span>`, (p.seg === "server" || p.server) && `<span class="chip srv">сервер</span>`, p.plp && `<span class="chip srv">PLP</span>`, p.passive && `<span class="chip">пассив</span>`].filter(Boolean).join("");
  $("#catTable").innerHTML = `<thead><tr><th>Модель</th>${cols.map(c => `<th>${c[0]}</th>`).join("")}<th>Цена</th><th></th></tr></thead><tbody>` +
    (list.length ? list.map(p => `<tr><td class="nm"><b>${esc(p.name)}</b>${chips(p)}${p.note ? `<small>${esc(p.note)}</small>` : ""}</td>${cols.map(c => `<td class="num">${c[1](p)}</td>`).join("")}<td class="num"><b>${money(p.price)}</b></td><td><button class="btn btn-ghost sm" data-add="${p.id}">В сборку</button></td></tr>`).join("")
      : `<tr><td colspan="9" class="muted" style="text-align:center;padding:30px">Ничего не найдено</td></tr>`) + "</tbody>";
}

function addToBuild(id){
  const p = byId(id), b = state.build;
  if (p.cat === "storage"){ const ex = b.storage.find(s => s.id === id); ex ? ex.qty++ : b.storage.push({ id, qty:1 }); }
  else b[p.cat] = { id, qty: b[p.cat]?.qty && QTY_CATS[p.cat] ? b[p.cat].qty : 1 };
  renderBuilder();
  const { bad } = checks(b);
  toast(bad[p.cat] === "err" ? `Добавлено, но есть конфликт — проверьте конструктор` : `${p.name} добавлен в сборку`);
}

/* ---------- BENCH ---------- */
const BENCH = {
  "gpu-game":{ label:"GPU: игры 1440p", list:() => DB.gpu.filter(p => p.game), v:p => p.game, unit:"", note:"Индекс производительности в растеризации 1440p, RTX 5070 = 100. Сводная оценка по публичным обзорам." },
  "gpu-ai":{ label:"GPU: нейросети", list:() => DB.gpu, v:p => p.ai, unit:"", extra:p => p.vram + " ГБ", note:"Относительная AI-производительность (инференс FP16/FP8), RTX 5090 = 100. Справа — объём видеопамяти: для LLM он важнее скорости." },
  "cpu-mt":{ label:"CPU: многопоток", list:() => DB.cpu, v:p => p.mt, unit:"", note:"Многопоточная производительность, ориентир — Cinebench 2024 Multi; для серверных CPU — оценка по масштабированию. Реальные серверные нагрузки сильнее зависят от памяти и I/O." },
  "cpu-st":{ label:"CPU: однопоток", list:() => DB.cpu, v:p => p.st, unit:"", note:"Однопоточная производительность, Ryzen 9 9950X = 100. Важно для игровых серверов, 1С и отзывчивости." },
  "cpu-game":{ label:"CPU: игры", list:() => DB.cpu.filter(p => p.game), v:p => p.game, unit:"", note:"Средний FPS в CPU-зависимых сценах (1080p, топовая видеокарта), Ryzen 7 9800X3D = 100." },
  "ram-gb":{ label:"Память: цена за ГБ", list:() => DB.ram, v:p => p.price / p.size, unit:"$/ГБ", lowBetter:true, note:"Стоимость гигабайта в ноябре 2026. Дефицит DRAM поднял цены в 4–6 раз к середине 2025 года." },
  "disk-tb":{ label:"Диски: цена за ТБ", list:() => DB.storage, v:p => p.price / p.tb, unit:"$/ТБ", lowBetter:true, note:"Стоимость терабайта. HDD остаются самым дешёвым хранением, enterprise QLC NVMe — самым плотным." },
};

function renderBench(){
  $("#benchTabs").innerHTML = Object.entries(BENCH).map(([k, v]) => `<button class="tab ${k === state.benchTab ? "on" : ""}" data-b="${k}">${v.label}</button>`).join("");
  $$("#benchMode button").forEach(b => b.classList.toggle("on", b.dataset.m === state.benchMode));
  const B = BENCH[state.benchTab];
  const valMode = state.benchMode === "val" && !B.lowBetter;
  const rows = B.list().map(p => ({ p, v: valMode ? B.v(p) / p.price * 100 : B.v(p) }));
  rows.sort((a, b) => B.lowBetter ? a.v - b.v : b.v - a.v);
  const max = Math.max(...rows.map(r => r.v));
  const col = p => p.brand === "AMD" || /AMD/.test(p.name) ? "var(--amd)" : p.brand === "Intel" || /Intel/.test(p.name) ? "var(--intel)" : /NVIDIA/.test(p.name) ? "var(--nv)" : "var(--acc2)";
  $("#benchNote").textContent = (valMode ? "Режим «за каждые $100»: индекс, делённый на цену. " : "") + B.note;
  const fmt = v => B.unit ? (state.cur === "USD" ? "$" + v.toFixed(v < 10 ? 1 : 0) : money(v)) + (B.unit.includes("ГБ") ? "/ГБ" : "/ТБ") : valMode ? v.toFixed(v < 10 ? 2 : 1) : Math.round(v).toLocaleString("ru-RU");
  $("#bars").innerHTML = rows.map(({ p, v }) => {
    const w = B.lowBetter ? Math.max(4, (rows[0].v / v) * 100) : v / max * 100;
    return `<div class="bar"><div class="bar-n" title="${esc(p.name)}">${esc(p.name)}</div><div class="bar-t"><div style="width:${w}%;background:${col(p)}">${B.extra ? B.extra(p) : ""}</div></div><div class="bar-v">${fmt(v)}</div></div>`;
  }).join("");
}

/* ---------- GUIDES ---------- */
function renderGuides(){
  $("#guidesGrid").innerHTML = GUIDES.map(g => `<article class="card guide"><span class="chip">${esc(g.tag)}</span><h3>${esc(g.title)}</h3>${g.body.map(p => `<p>${p}</p>`).join("")}<div class="verdict">${esc(g.verdict)}</div></article>`).join("");
}

/* ---------- global render ---------- */
function renderMoney(){
  renderTiers(); renderBuilder(); renderCatalog(); renderBench();
}

function init(){
  $("#updLbl").textContent = "цены на " + DB.updated;
  $$(".updLbl2").forEach(e => e.textContent = DB.updated);
  const nParts = Object.keys(CAT_META).reduce((s, c) => s + DB[c].length, 0);
  $("#heroStats").innerHTML = `<div><b>${nParts}</b><span>комплектующих</span></div><div><b>${TASKS.length * 3}</b><span>готовых сборок</span></div><div><b>${TASKS.length}</b><span>сценариев</span></div><div><b>20+</b><span>проверок совместимости</span></div>`;

  $("#curSel").value = state.cur;
  const syncRate = () => { const w = $("#rateWrap"); w.hidden = state.cur === "USD"; if (state.cur !== "USD") $("#rateIn").value = state.rates[state.cur]; };
  syncRate();
  $("#curSel").onchange = e => { state.cur = e.target.value; store.set("cur", state.cur); syncRate(); renderMoney(); };
  $("#rateIn").oninput = e => { const v = parseFloat(e.target.value); if (v > 0){ state.rates[state.cur] = v; store.set("rates", state.rates); renderMoney(); } };

  // picker
  $("#kindSeg").onclick = e => { const k = e.target.dataset.kind; if (!k) return; state.kind = k; state.task = TASKS.find(t => t.kind === k).id; state.budgetUSD = null; renderTasks(); renderTiers(); };
  $("#tasks").onclick = e => { const b = e.target.closest("[data-task]"); if (!b) return; state.task = b.dataset.task; state.budgetUSD = null; renderTasks(); renderTiers(); };
  $("#budget").oninput = e => { state.budgetUSD = sliderToUSD(+e.target.value); renderTiers(); };
  $("#tiers").onclick = e => {
    const b = e.target.closest("[data-load]"); if (!b) return;
    const tier = curTask().tiers[+b.dataset.load];
    state.build = buildFromItems(tier.items); renderBuilder();
    document.getElementById("builder").scrollIntoView({ behavior:"smooth" });
    toast(`Сборка «${tier.name}» загружена в конструктор`);
  };

  // builder
  if (!state.build) state.build = buildFromItems(TASKS.find(t => t.id === "virt").tiers[1].items);
  $("#onlyCompat").onchange = e => { state.onlyCompat = e.target.checked; renderBuilder(); };
  $("#clearBuild").onclick = () => { state.build = emptyBuild(); renderBuilder(); };
  $("#slots").addEventListener("change", e => {
    const s = e.target.closest("select"); if (!s) return;
    const cat = s.dataset.cat, id = s.value, b = state.build;
    if (cat === "storage"){ const i = +s.dataset.idx; if (id) b.storage[i].id = id; else b.storage.splice(i, 1); }
    else b[cat] = id ? { id, qty: b[cat]?.qty || 1 } : null;
    if (cat === "mb" && id && b.cpu){ const mb = byId(id); if ((mb.sockets || 1) < b.cpu.qty) b.cpu.qty = 1; }
    renderBuilder();
  });
  $("#slots").addEventListener("click", e => {
    const b = state.build;
    const btn = e.target.closest(".qty button");
    if (btn){
      const box = btn.parentElement, cat = box.dataset.cat, d = +btn.dataset.d;
      if (!cat) return;
      if (cat === "storage"){ const s = b.storage[+box.dataset.idx]; s.qty = Math.max(1, Math.min(48, s.qty + d)); }
      else { const sel = b[cat]; sel.qty = Math.max(1, Math.min(QTY_CATS[cat], (sel.qty || 1) + d)); }
      renderBuilder(); return;
    }
    const del = e.target.closest("[data-del]"); if (del){ b.storage.splice(+del.dataset.del, 1); renderBuilder(); return; }
    if (e.target.id === "addDisk"){ b.storage.push({ id: b.cpu && byId(b.cpu.id).seg === "server" ? "s-u2-384" : "s-nv2", qty:1 }); renderBuilder(); }
  });
  $("#summary").addEventListener("click", async e => {
    if (e.target.id !== "copyBuild") return;
    try { await navigator.clipboard.writeText(buildText()); toast("Список сборки скопирован"); }
    catch { toast("Не удалось скопировать — браузер запретил доступ к буферу"); }
  });

  // catalog
  $("#catTabs").onclick = e => { const t = e.target.closest("[data-tab]"); if (!t) return; state.catTab = t.dataset.tab; renderCatalog(); };
  $("#catSearch").oninput = renderCatalog; $("#catSort").onchange = renderCatalog;
  $("#catTable").onclick = e => { const a = e.target.closest("[data-add]"); if (a) addToBuild(a.dataset.add); };

  // bench
  $("#benchTabs").onclick = e => { const t = e.target.closest("[data-b]"); if (!t) return; state.benchTab = t.dataset.b; renderBench(); };
  $("#benchMode").onclick = e => { const m = e.target.dataset.m; if (!m) return; state.benchMode = m; renderBench(); };

  // nav highlight
  const secs = ["picker","builder","catalog","bench","guides"].map(id => document.getElementById(id));
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) $$("#nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + en.target.id)); }), { rootMargin:"-45% 0px -50% 0px" });
  secs.forEach(s => io.observe(s));

  renderTasks(); renderGuides(); renderMoney();
}
init();
})();
