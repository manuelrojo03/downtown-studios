/* Downtown Studios — hub de ventas: precio, estado, consultas y panel del equipo.
   Datos: si window.HUB_CFG = {url, key} apunta a un proyecto Supabase se usa esa base (compartida por todos);
   si no, MODO DEMO: todo se guarda solo en este navegador (localStorage). */
(function () {
  'use strict';
  var CFG = window.HUB_CFG || {}, LIVE = !!(CFG.url && CFG.key);
  var UNITS = []; for (var f = 1; f <= 4; f++) for (var k = 1; k <= 13; k++) UNITS.push(f * 100 + k);
  var ST = { disponible: 'Disponible', reservada: 'Reservada', vendida: 'Vendida', bloqueada: 'No disponible' };
  // Embebido en la web de Greenville (?embed=greenville, o dentro de un iframe en GitHub Pages): los datos y los formularios
  // son de la web padre. El visor no guarda nada: recibe estados y precios por postMessage y avisa cuando piden reservar o consultar.
  var EMBED = /[?&]embed=greenville\b/.test(location.search) || (window.parent !== window && /github\.io$/.test(location.hostname));
  var $ = function (id) { return document.getElementById(id); };
  function h(tag, at, kids) {
    var e = document.createElement(tag); at = at || {};
    for (var a in at) { if (a === 'text') e.textContent = at[a]; else if (a.slice(0, 2) === 'on') e.addEventListener(a.slice(2), at[a]); else if (at[a] !== false && at[a] != null) e.setAttribute(a, at[a] === true ? '' : at[a]); }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var money = function (p) { return 'USD ' + Math.round(p).toLocaleString('es-AR'); };
  var when = function (t) { var d = new Date(t); return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); };
  function ss(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { } return null; }
  var SID = ss('ds_sid') || (Math.random().toString(36).slice(2) + Date.now().toString(36)); ss('ds_sid', SID);

  // ---------------------------------------------------------------- store: demo (este navegador)
  var Demo = (function () {
    var KEY = 'ds_hub_v1';
    function rd() { var d; try { d = JSON.parse(localStorage.getItem(KEY)); } catch (e) { } d = d || {}; d.units = d.units || {}; d.inquiries = d.inquiries || []; d.events = d.events || []; d.settings = d.settings || { showCount: true, whatsapp: '' }; return d; }
    function wr(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { } }
    function sha(s) { return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }); }
    return {
      needsSetup: function () { return !rd().pass; },
      load: function () {
        var d = rd(), u = {}, c = {}; d.inquiries.forEach(function (q) { c[q.unit] = (c[q.unit] || 0) + 1; });
        UNITS.forEach(function (n) { var x = d.units[n] || {}; u[n] = { price: x.price || null, status: x.status || 'disponible', count: d.settings.showCount ? (c[n] || 0) : null }; });
        return Promise.resolve({ units: u, settings: d.settings });
      },
      inquire: function (q) { var d = rd(); d.inquiries.push({ unit: q.unit, name: q.name, phone: q.phone, msg: q.msg || '', at: Date.now() }); wr(d); return Promise.resolve(); },
      track: function (type, unit) { var d = rd(); d.events.push({ type: type, unit: unit || null, sid: SID, at: Date.now() }); if (d.events.length > 6000) d.events = d.events.slice(-5000); wr(d); return Promise.resolve(); },
      isAdmin: function () { return ss('ds_adm') === '1'; },
      login: function (c) {
        var d = rd(); return sha(c.pass).then(function (x) {
          if (!d.pass) { if (c.pass.length < 6) throw new Error('La clave tiene que tener al menos 6 caracteres.'); d.pass = x; wr(d); }
          else if (d.pass !== x) throw new Error('Clave incorrecta.');
          ss('ds_adm', '1');
        });
      },
      logout: function () { ss('ds_adm', null); return Promise.resolve(); },
      all: function () { var d = rd(); return Promise.resolve({ units: d.units, inquiries: d.inquiries, events: d.events, settings: d.settings }); },
      setUnit: function (n, p) { var d = rd(); d.units[n] = Object.assign(d.units[n] || {}, p); wr(d); return Promise.resolve(); },
      setPrices: function (m) { var d = rd(); for (var n in m) d.units[n] = Object.assign(d.units[n] || {}, { price: m[n] }); wr(d); return Promise.resolve(); },
      setSettings: function (p) { var d = rd(); Object.assign(d.settings, p); wr(d); return Promise.resolve(); }
    };
  })();

  // ---------------------------------------------------------------- store: Supabase (ver hub_schema.sql)
  var Live = (function () {
    var tok = ss('ds_tok');
    function rq(path, o) {
      o = o || {}; var hd = { apikey: CFG.key, Authorization: 'Bearer ' + ((o.auth !== false && tok) || CFG.key), 'Content-Type': 'application/json' }; if (o.prefer) hd.Prefer = o.prefer;
      return fetch(CFG.url + path, { method: o.method || 'GET', headers: hd, body: o.body ? JSON.stringify(o.body) : undefined }).then(function (r) {
        if (r.status === 401 && tok) { tok = null; ss('ds_tok', null); }
        if (!r.ok) throw new Error('No se pudo conectar (' + r.status + ').');
        return r.text().then(function (t) { return t ? JSON.parse(t) : null; });
      });
    }
    var map = function (r) { return { price: r.price, status: r.status, holder: r.holder_name, holderPhone: r.holder_phone, holderNote: r.holder_note, reservedAt: r.reserved_at }; };
    return {
      needsSetup: function () { return false; },
      load: function () {
        return Promise.all([rq('/rest/v1/units_public?select=*', { auth: false }), rq('/rest/v1/settings?select=*&id=eq.1', { auth: false })]).then(function (r) {
          var u = {}, s = (r[1] && r[1][0]) || {}; UNITS.forEach(function (n) { u[n] = { price: null, status: 'disponible', count: s.show_count ? 0 : null }; });
          (r[0] || []).forEach(function (x) { if (u[x.num]) u[x.num] = { price: x.price, status: x.status, count: s.show_count ? (x.inquiries || 0) : null }; });
          return { units: u, settings: { showCount: !!s.show_count, whatsapp: s.whatsapp || '' } };
        });
      },
      inquire: function (q) { return rq('/rest/v1/inquiries', { method: 'POST', auth: false, body: { unit: q.unit, name: q.name, phone: q.phone, msg: q.msg || '' } }); },
      track: function (type, unit) { return rq('/rest/v1/events', { method: 'POST', auth: false, body: { type: type, unit: unit || null, session: SID } }).catch(function () { }); },
      isAdmin: function () { return !!tok; },
      login: function (c) {
        return fetch(CFG.url + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: CFG.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: c.email, password: c.pass }) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.access_token) throw new Error('Mail o clave incorrectos.'); tok = j.access_token; ss('ds_tok', tok); }); });
      },
      logout: function () { tok = null; ss('ds_tok', null); return Promise.resolve(); },
      all: function () {
        return Promise.all([rq('/rest/v1/units?select=*'), rq('/rest/v1/inquiries?select=*&order=created_at.asc&limit=5000'), rq('/rest/v1/events?select=*&order=created_at.desc&limit=5000'), rq('/rest/v1/settings?select=*&id=eq.1')]).then(function (r) {
          var u = {}; (r[0] || []).forEach(function (x) { u[x.num] = map(x); }); var s = (r[3] && r[3][0]) || {};
          return { units: u, inquiries: (r[1] || []).map(function (q) { return { unit: q.unit, name: q.name, phone: q.phone, msg: q.msg, at: +new Date(q.created_at) }; }),
            events: (r[2] || []).reverse().map(function (e) { return { type: e.type, unit: e.unit, sid: e.session, at: +new Date(e.created_at) }; }), settings: { showCount: !!s.show_count, whatsapp: s.whatsapp || '' } };
        });
      },
      setUnit: function (n, p) {
        var b = { num: +n }; if ('price' in p) b.price = p.price; if ('status' in p) b.status = p.status; if ('holder' in p) b.holder_name = p.holder; if ('holderPhone' in p) b.holder_phone = p.holderPhone; if ('holderNote' in p) b.holder_note = p.holderNote; if ('reservedAt' in p) b.reserved_at = p.reservedAt ? new Date(p.reservedAt).toISOString() : null;
        return rq('/rest/v1/units?on_conflict=num', { method: 'POST', prefer: 'resolution=merge-duplicates', body: b });
      },
      setPrices: function (m) { return rq('/rest/v1/units?on_conflict=num', { method: 'POST', prefer: 'resolution=merge-duplicates', body: Object.keys(m).map(function (n) { return { num: +n, price: m[n] }; }) }); },
      setSettings: function (p) { var b = { id: 1 }; if ('showCount' in p) b.show_count = p.showCount; if ('whatsapp' in p) b.whatsapp = p.whatsapp; return rq('/rest/v1/settings?on_conflict=id', { method: 'POST', prefer: 'resolution=merge-duplicates', body: b }); }
    };
  })();
  var Embed = (function () {
    var st = {}, pr = {};
    return {
      needsSetup: function () { return false; },
      load: function () { var u = {}; UNITS.forEach(function (n) { u[n] = { price: pr[n] || null, status: st[n] || 'disponible', count: null }; }); return Promise.resolve({ units: u, settings: { showCount: false, whatsapp: '' } }); },
      setStatuses: function (m) { st = {}; for (var k in m) if (ST[m[k]] && m[k] !== 'disponible') st[+k] = m[k]; },
      setPrices: function (m) { pr = {}; for (var k in m) { var v = +m[k]; if (v > 0) pr[+k] = v; } },
      inquire: function () { return Promise.resolve(); }, track: function () { return Promise.resolve(); },
      isAdmin: function () { return false; }, login: function () { return Promise.reject(new Error('No disponible.')); }, logout: function () { return Promise.resolve(); }
    };
  })();
  var S = EMBED ? Embed : LIVE ? Live : Demo;

  // ---------------------------------------------------------------- estilos
  var css = '\
#hub-card{display:flex;flex-direction:column;gap:6px}\
.hub-price{display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--pchip);border-radius:12px;padding:10px 12px}\
.hub-price small{display:block;font-size:11px;color:var(--pmut)}\
.hub-price b{display:block;margin-top:2px;font:700 20px var(--display);font-variant-numeric:tabular-nums;color:var(--ptx)}\
.hub-price b.ask{font:600 14px var(--body);color:var(--pmut)}\
.hub-st{flex:0 0 auto;font:700 12px var(--body);padding:6px 10px;border-radius:999px;background:#dff3e4;color:#17603a}\
.hub-st.reservada{background:#fde9c8;color:#8a5200}.hub-st.vendida,.hub-st.bloqueada{background:#e6e6ea;color:#55555e}\
.hub-count{font-size:12.5px;color:var(--pmut)}@media (max-width:760px){.hub-price{padding:7px 12px}.hub-price b{font-size:17px}}\
.hub-ask{width:100%}.hub-acts2{display:flex;gap:8px;width:100%}.hub-acts2 .act{flex:1 1 0;min-width:0}.hub-acts2 .act:disabled{opacity:.45;cursor:default}\
.u.hub-off{opacity:.55}.u.hub-off::after{display:block;font:600 9px var(--body);margin-top:1px;content:attr(data-st)}\
.tag.hub-off{opacity:.8}.tag.hub-off::after{content:" · " attr(data-st);font-weight:500}\
#hub-modal,#hub-admin{position:fixed;inset:0;z-index:40;font-family:var(--body);color:#1d1c24;color-scheme:light}\
#hub-modal{display:grid;place-items:center;background:rgba(20,12,40,.55);padding:16px}\
.hub-box{width:min(420px,100%);max-height:100%;overflow:auto;background:#fff;border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}\
.hub-box h3{margin:0;font:400 28px/1 var(--anton);text-transform:uppercase;color:var(--lila)}\
.hub-box p{margin:0;font-size:14px;line-height:1.45;color:#55545f}\
.hub-f{display:flex;flex-direction:column;gap:5px;font:600 12.5px var(--body);color:#55545f}\
.hub-f input,.hub-f textarea,.hub-f select,.hub-in{font:500 16px var(--body);padding:11px 12px;border-radius:11px;border:1px solid #d5d3de;background:#fff;color:#1d1c24;width:100%;box-sizing:border-box}\
.hub-f input:focus,.hub-f textarea:focus,.hub-in:focus{outline:2px solid var(--lila);outline-offset:1px}\
.hub-ph{display:flex;gap:6px}.hub-ph select{flex:0 0 auto;width:auto;max-width:42%;padding-left:8px;padding-right:4px}.hub-ph input{flex:1 1 0;min-width:0}.hub-row{display:flex;gap:8px;flex-wrap:wrap}.hub-row>*{flex:1 1 120px}\
.hub-b{min-height:46px;border-radius:12px;border:0;font:700 14.5px var(--body);cursor:pointer;background:var(--lila);color:#fff;padding:0 16px;text-decoration:none;display:inline-grid;place-items:center;box-sizing:border-box}\
.hub-b.alt{background:#eeedf3;color:#2a2933}.hub-b.wa{background:#1fa855}.hub-b.sm{min-height:34px;font-size:13px;padding:0 12px;border-radius:9px}\
.hub-b:disabled{opacity:.5;cursor:default}\
.hub-err{color:#b3261e;font-size:13px;min-height:1em}\
#hub-admin{background:#f4f3f8;display:flex;flex-direction:column}\
.hub-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px max(16px,env(safe-area-inset-left,0px));padding-top:calc(12px + env(safe-area-inset-top,0px));background:var(--lila);color:#fff}\
.hub-top b{font:400 22px/1 var(--anton);text-transform:uppercase;margin-right:auto}\
.hub-top em{font:600 11px var(--body);font-style:normal;background:rgba(255,255,255,.2);padding:4px 8px;border-radius:999px}\
.hub-tabs{display:flex;gap:6px;padding:10px max(16px,env(safe-area-inset-left,0px));overflow-x:auto;background:#fff;border-bottom:1px solid #e3e1ea}\
.hub-tabs button{flex:0 0 auto;border:0;background:#eeedf3;color:#2a2933;font:700 13.5px var(--body);padding:9px 14px;border-radius:999px;cursor:pointer}\
.hub-tabs button[aria-selected="true"]{background:var(--lila);color:#fff}\
.hub-body{flex:1;overflow:auto;padding:16px max(16px,env(safe-area-inset-left,0px));padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))}\
.hub-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:14px}\
.hub-kpis div{background:#fff;border-radius:14px;padding:12px 14px}.hub-kpis small{display:block;font-size:12px;color:#6b6a76}.hub-kpis b{font:700 24px var(--display);font-variant-numeric:tabular-nums}\
.hub-tw{overflow-x:auto;background:#fff;border-radius:14px}\
.hub-t{border-collapse:collapse;width:100%;font-size:13.5px}\
.hub-t th{text-align:left;font:700 11.5px var(--body);color:#6b6a76;padding:10px 12px;border-bottom:1px solid #e3e1ea;white-space:nowrap;position:sticky;top:0;background:#fff}\
.hub-t td{padding:8px 12px;border-bottom:1px solid #f0eff4;vertical-align:middle;white-space:nowrap}\
.hub-t td.wrap{white-space:normal;min-width:180px}.hub-t td.n{font-variant-numeric:tabular-nums;text-align:right}.hub-t th.n{text-align:right}\
.hub-t input.p{background:#fff;color:#1d1c24;width:120px;font:600 14px var(--body);padding:7px 9px;border-radius:9px;border:1px solid #d5d3de;font-variant-numeric:tabular-nums}\
.hub-t select{color:#1d1c24;font:600 13px var(--body);padding:7px 8px;border-radius:9px;border:1px solid #d5d3de;background:#fff}\
.hub-sec{background:#fff;border-radius:14px;padding:16px;margin-bottom:12px;display:flex;flex-direction:column;gap:10px;max-width:640px}\
.hub-sec h4{margin:0;font:700 15px var(--body)}.hub-sec p{margin:0;font-size:13.5px;line-height:1.45;color:#55545f}\
.hub-sw{display:flex;align-items:center;gap:10px;font:600 14px var(--body);cursor:pointer}.hub-sw input{width:20px;height:20px;accent-color:var(--lila)}\
.hub-muted{color:#6b6a76;font-size:13px}.hub-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}';
  document.head.appendChild(h('style', { text: css }));

  // ---------------------------------------------------------------- app pública
  var pub = { units: {}, settings: { showCount: true, whatsapp: '' } }, last = { unit: 0, mode: '' }, cur = null;
  function refresh() { return S.load().then(function (d) { pub = d; paint(); }).catch(function () { }); }
  function track(t, u) { if (!S.isAdmin()) S.track(t, u); }

  var cardEl, askEl, resEl, stampKey = '';
  // ---------------------------------------------------------------- mensajes con la web padre (contrato v1)
  function payload(n) {
    n = +n; var a = (window.UNIT_AREAS || {})[n] || [0, 0, 0], pos = n % 100, d = window.__d2 && window.__d2.state;
    var mode = d && d.deco && d.deco !== 'none' ? d.deco : 'ofi';
    return { id: String(n), number: n, floor: Math.floor(n / 100), position: pos, view: pos <= 6 ? 'greenville' : 'abril', corner: [1, 6, 7, 13].indexOf(pos) >= 0,
      areas: { covered: +a[0] || 0, semicovered: +a[1] || 0, total: +a[2] || 0 }, mode: mode };
  }
  function emit(type, extra) {
    if (!EMBED || window.parent === window) return;
    var m = { source: 'downtown-studios', v: 1, type: type }; for (var k in extra || {}) m[k] = extra[k];
    try { window.parent.postMessage(m, '*'); } catch (e) { }           // datos públicos de la unidad: nada sensible viaja en estos mensajes
  }
  if (EMBED) window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;                              // solo la ventana que nos embebe
    var m = e.data; if (!m || m.source !== 'greenville' || m.v !== 1) return;
    if (m.type === 'SET_UNIT_STATUSES' && m.statuses && typeof m.statuses === 'object') { Embed.setStatuses(m.statuses); refresh(); }
    else if (m.type === 'SET_UNIT_PRICES' && m.prices && typeof m.prices === 'object') { Embed.setPrices(m.prices); refresh(); }
    else if (m.type === 'SELECT_UNIT' && window.__d2 && UNITS.indexOf(+m.number) >= 0) window.__d2.selectUnit(+m.number);
  });
  function ensure() {
    if (cardEl || !$('card')) return;
    cardEl = h('div', { id: 'hub-card' }); askEl = h('button', { type: 'button', class: 'act hub-ask', text: 'Consultar por esta unidad', onclick: function () { if (cur) openAsk(cur); } });
    var ar = $('areas'); ar.parentNode.insertBefore(cardEl, ar.nextSibling);
    var acts = document.querySelector('#card .acts');
    if (EMBED) {
      resEl = h('button', { type: 'button', class: 'act', text: 'Reservar unidad', onclick: function () { if (cur) emit('REQUEST_RESERVATION', { unit: payload(cur) }); } });
      askEl = h('button', { type: 'button', class: 'act alt', text: 'Consultar', onclick: function () { if (cur) emit('REQUEST_INQUIRY', { unit: payload(cur) }); } });
      acts.parentNode.insertBefore(h('div', { class: 'hub-acts2' }, [resEl, askEl]), acts.nextSibling);
    } else acts.parentNode.insertBefore(askEl, acts.nextSibling);
  }
  function mark(el) { var u = pub.units[+el.textContent.trim().slice(0, 3)] || pub.units[+el.dataset.num]; var off = u && u.status !== 'disponible'; el.classList.toggle('hub-off', !!off); if (off) el.dataset.st = ST[u.status].toLowerCase(); else delete el.dataset.st; }
  function paint() {
    ensure(); if (!cardEl) return;
    if (window.__d2 && window.__d2.setStamps) { var sm = {}; for (var n in pub.units) if (pub.units[n].status !== 'disponible') sm[n] = pub.units[n].status; var key = JSON.stringify(sm); if (key !== stampKey) { stampKey = key; window.__d2.setStamps(sm); } }
    document.querySelectorAll('#grid .u, #labels .tag').forEach(function (el) { if (!el.dataset.num) el.dataset.num = el.textContent.trim(); mark(el); });
    if (!cur) return;
    var u = pub.units[cur] || { status: 'disponible' }; cardEl.textContent = '';
    cardEl.appendChild(h('div', { class: 'hub-price' }, [h('div', {}, [h('small', { text: 'Precio' }), u.price ? h('b', { text: money(u.price) }) : h('b', { class: 'ask', text: 'Consultar precio' })]), h('span', { class: 'hub-st ' + u.status, text: ST[u.status] })]));
    if (u.count) cardEl.appendChild(h('div', { class: 'hub-count', text: u.count === 1 ? '1 persona consultó por esta unidad' : u.count + ' personas consultaron por esta unidad' }));
    if (EMBED) { resEl.disabled = u.status !== 'disponible'; resEl.title = resEl.disabled ? ST[u.status] : ''; }
    else askEl.textContent = u.status === 'disponible' ? 'Consultar por esta unidad' : 'Consultar igual';
  }
  function render(state) {
    if (EMBED) {
      if ((state.unit || 0) !== last.unit) emit(state.unit ? 'UNIT_SELECTED' : 'UNIT_CLEARED', state.unit ? { unit: payload(state.unit) } : {});
      if (state.mode !== last.mode) emit('VIEW_MODE', { unit: state.unit ? payload(state.unit) : null, mode: state.mode });
    }
    cur = state.unit || null;
    if (cur && cur !== last.unit) track('unit', cur);
    if (state.mode !== last.mode && (state.mode === 'walk' || state.mode === 'view')) track(state.mode, cur);
    last = { unit: cur || 0, mode: state.mode }; paint();
  }

  function closeModal() { var m = $('hub-modal'); if (m) m.remove(); }
  function modal(kids) { closeModal(); var box = h('div', { class: 'hub-box', role: 'dialog', 'aria-modal': 'true' }, kids); var m = h('div', { id: 'hub-modal', onclick: function (e) { if (e.target === m) closeModal(); } }, [box]); document.body.appendChild(m); return box; }
  function field(label, at) { var i = h(at.rows ? 'textarea' : 'input', at); return { el: h('label', { class: 'hub-f' }, [label, i]), in: i }; }

  var CODES = [['+54', 'Argentina'], ['+598', 'Uruguay'], ['+55', 'Brasil'], ['+56', 'Chile'], ['+595', 'Paraguay'], ['+591', 'Bolivia'], ['+51', 'Perú'], ['+57', 'Colombia'], ['+52', 'México'], ['+1', 'EE. UU. / Canadá'], ['+34', 'España'], ['+39', 'Italia'], ['+33', 'Francia'], ['+49', 'Alemania'], ['+44', 'Reino Unido'], ['+41', 'Suiza'], ['+972', 'Israel']];
  // teléfono: característica de país (por defecto +54, se puede elegir otra) + número; read() devuelve {value} o {err}
  function phoneField(label, val) {
    var sel = h('select', { 'aria-label': 'Característica del país' }, CODES.map(function (c) { return h('option', { value: c[0], text: c[0] + '  ' + c[1] }); }).concat([h('option', { value: '', text: 'Otra…' })]));
    var inp = h('input', { type: 'tel', inputmode: 'tel', autocomplete: 'tel-national', maxlength: 24, 'aria-label': label });
    var ph = function () { inp.placeholder = sel.value === '+54' ? '9 11 2345 6789' : sel.value ? 'Número' : '+código y número'; };
    val = String(val || '').trim(); sel.value = '+54';
    if (val.charAt(0) === '+') { var hit = CODES.slice().sort(function (a, b) { return b[0].length - a[0].length; }).filter(function (c) { return val.indexOf(c[0]) === 0; })[0]; if (hit) { sel.value = hit[0]; inp.value = val.slice(hit[0].length).trim(); } else { sel.value = ''; inp.value = val; } } else inp.value = val;
    ph(); sel.addEventListener('change', function () { ph(); inp.focus(); });
    return { el: h('div', { class: 'hub-f' }, [label, h('div', { class: 'hub-ph' }, [sel, inp])]), in: inp, read: function () {
      var raw = inp.value.trim().replace(/\s+/g, ' '), code = sel.value, dig = raw.replace(/\D/g, '');
      if (!raw) return { err: 'Falta el teléfono.' };
      if (!/^[0-9 ()+.\-]+$/.test(raw)) return { err: 'El teléfono solo puede tener números.' };
      if (code) { if (raw.indexOf('+') >= 0) return { err: 'La característica ya está elegida a la izquierda: escribí solo el número.' }; if (dig.length < 6 || dig.length > 13) return { err: 'Revisá el teléfono: no parece un número completo.' }; return { value: code + ' ' + raw }; }
      if (!/^\+\d/.test(raw)) return { err: 'Empezá con + y la característica del país.' };
      if (dig.length < 8 || dig.length > 15) return { err: 'Revisá el teléfono: no parece un número completo.' };
      return { value: raw };
    } };
  }

  function openAsk(n) {
    track('ask', n);
    var nm = field('Nombre y apellido', { type: 'text', autocomplete: 'name', required: true, maxlength: 80 }), ph = phoneField('Teléfono (WhatsApp)'),
      ms = field('Mensaje (opcional)', { rows: 2, maxlength: 400 }), err = h('div', { class: 'hub-err' }), ok = h('button', { type: 'submit', class: 'hub-b', text: 'Enviar consulta' });
    var form = h('form', { style: 'display:flex;flex-direction:column;gap:12px', onsubmit: function (e) {
      e.preventDefault(); var name = nm.in.value.trim(), pr = ph.read(), phone = pr.value;
      if (name.length < 3) { err.textContent = 'Escribí tu nombre.'; nm.in.focus(); return; }
      if (pr.err) { err.textContent = pr.err; ph.in.focus(); return; }
      ok.disabled = true; err.textContent = '';
      S.inquire({ unit: n, name: name, phone: phone, msg: ms.in.value.trim() }).then(function () { done(n); refresh(); }, function () { ok.disabled = false; err.textContent = 'No pudimos enviar la consulta. Probá de nuevo.'; });
    } }, [nm.el, ph.el, ms.el, err, h('div', { class: 'hub-row' }, [h('button', { type: 'button', class: 'hub-b alt', text: 'Cancelar', onclick: closeModal }), ok])]);
    modal([h('h3', { text: 'Unidad ' + n + '.' }), h('p', { text: 'Dejanos tus datos y un asesor te contacta por esta unidad.' }), form]); nm.in.focus();
  }
  function done(n) {
    var wa = (pub.settings.whatsapp || '').replace(/\D/g, ''), kids = [h('h3', { text: '¡Listo!' }), h('p', { text: 'Recibimos tu consulta por la unidad ' + n + '. Te vamos a contactar a la brevedad.' })];
    if (wa) kids.push(h('a', { class: 'hub-b wa', target: '_blank', rel: 'noopener', href: 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Hola, quiero consultar por la unidad ' + n + ' de Downtown Studios.'), text: 'Seguir por WhatsApp' }));
    kids.push(h('button', { type: 'button', class: 'hub-b alt', text: 'Cerrar', onclick: closeModal })); modal(kids);
  }

  // ---------------------------------------------------------------- panel del equipo
  var adm = null, tab = 'unidades', D = null;
  function openAdmin() { if (EMBED || $('hub-admin')) return; adm = h('div', { id: 'hub-admin' }); document.body.appendChild(adm); S.isAdmin() ? loadAdmin() : loginView(); }
  function closeAdmin() { if (adm) adm.remove(); adm = null; if (location.hash === '#equipo') { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { } } refresh(); }
  function loginView() {
    var setup = S.needsSetup(), em = LIVE ? field('Mail', { type: 'email', autocomplete: 'username', required: true }) : null, pw = field(setup ? 'Elegí una clave (mínimo 6 caracteres)' : 'Clave', { type: 'password', autocomplete: setup ? 'new-password' : 'current-password', required: true }),
      err = h('div', { class: 'hub-err' }), ok = h('button', { type: 'submit', class: 'hub-b', text: 'Entrar' });
    var form = h('form', { class: 'hub-box', style: 'margin:auto', onsubmit: function (e) { e.preventDefault(); ok.disabled = true; err.textContent = ''; S.login({ email: em && em.in.value.trim(), pass: pw.in.value }).then(loadAdmin, function (x) { ok.disabled = false; err.textContent = x.message || 'No se pudo entrar.'; }); } },
      [h('h3', { text: 'Acceso equipo.' }), h('p', { text: LIVE ? 'Entrá con tu usuario del equipo de ventas.' : (setup ? 'Modo demo: los datos se guardan solo en este navegador. Creá una clave para el panel.' : 'Modo demo: los datos se guardan solo en este navegador.') }), em && em.el, pw.el, err, h('div', { class: 'hub-row' }, [h('button', { type: 'button', class: 'hub-b alt', text: 'Volver', onclick: closeAdmin }), ok])]);
    adm.textContent = ''; adm.style.overflow = 'auto'; adm.appendChild(h('div', { style: 'min-height:100%;display:grid;padding:16px;box-sizing:border-box' }, [form])); (em || pw).in.focus();
  }
  function loadAdmin() { return S.all().then(function (d) { D = d; drawAdmin(); }, function (x) { if (!S.isAdmin()) loginView(); else { adm.textContent = ''; adm.appendChild(h('div', { class: 'hub-body', text: x.message || 'No se pudieron cargar los datos.' })); } }); }
  function unit(n) { var u = D.units[n] || {}; return { price: u.price || null, status: u.status || 'disponible', holder: u.holder || '', holderPhone: u.holderPhone || '', holderNote: u.holderNote || '', reservedAt: u.reservedAt || null }; }
  function save(p) { return p.then(loadAdmin, function (x) { modal([h('h3', { text: 'Error.' }), h('p', { text: (x && x.message) || 'No se pudo guardar.' }), h('button', { class: 'hub-b alt', type: 'button', text: 'Cerrar', onclick: closeModal })]); }); }
  function drawAdmin() {
    var body = h('div', { class: 'hub-body' }), tabs = h('div', { class: 'hub-tabs', role: 'tablist' });
    [['unidades', 'Unidades'], ['consultas', 'Consultas (' + D.inquiries.length + ')'], ['actividad', 'Actividad'], ['ajustes', 'Ajustes']].forEach(function (t) { tabs.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': tab === t[0] ? 'true' : 'false', text: t[1], onclick: function () { tab = t[0]; drawAdmin(); } })); });
    adm.textContent = ''; adm.style.overflow = '';
    adm.appendChild(h('div', { class: 'hub-top' }, [h('b', { text: 'Panel de ventas.' }), !LIVE && h('em', { text: 'Modo demo · solo este navegador' }), h('button', { type: 'button', class: 'hub-b sm alt', text: 'Actualizar', onclick: loadAdmin }), h('button', { type: 'button', class: 'hub-b sm alt', text: 'Volver a la app', onclick: closeAdmin })]));
    adm.appendChild(tabs); adm.appendChild(body);
    ({ unidades: tUnits, consultas: tInq, actividad: tAct, ajustes: tSet })[tab](body);
  }
  function kpis(list) { return h('div', { class: 'hub-kpis' }, list.map(function (k) { return h('div', {}, [h('small', { text: k[0] }), h('b', { text: String(k[1]) })]); })); }
  function table(heads, rows) { return h('div', { class: 'hub-tw' }, [h('table', { class: 'hub-t' }, [h('thead', {}, [h('tr', {}, heads.map(function (x) { return h('th', { class: x[1] || null, text: x[0] }); }))]), h('tbody', {}, rows)])]); }
  function counts() { var q = {}, v = {}, w = {}, s = {}; D.inquiries.forEach(function (x) { q[x.unit] = (q[x.unit] || 0) + 1; }); D.events.forEach(function (e) { var m = e.type === 'unit' ? v : e.type === 'walk' ? w : e.type === 'view' ? s : null; if (m && e.unit) m[e.unit] = (m[e.unit] || 0) + 1; }); return { q: q, v: v, w: w, s: s }; }

  function tUnits(body) {
    var c = counts(), n = { disponible: 0, reservada: 0, vendida: 0 }; UNITS.forEach(function (x) { n[unit(x).status]++; });
    body.appendChild(kpis([['Disponibles', n.disponible], ['Reservadas', n.reservada], ['Vendidas', n.vendida], ['Consultas', D.inquiries.length]]));
    body.appendChild(table([['Unidad'], ['Precio USD'], ['Estado'], ['Reservada / vendida a'], ['Consultas', 'n'], ['Vistas', 'n']], UNITS.map(function (x) {
      var u = unit(x), pr = h('input', { class: 'p', type: 'text', inputmode: 'numeric', value: u.price ? Math.round(u.price).toLocaleString('es-AR') : '', placeholder: 'sin precio', 'aria-label': 'Precio de la unidad ' + x });
      pr.addEventListener('change', function () { var v = parsePrice(pr.value); if (pr.value.trim() && !v) { pr.value = u.price ? Math.round(u.price).toLocaleString('es-AR') : ''; return; } save(S.setUnit(x, { price: v })); });
      var sel = h('select', { 'aria-label': 'Estado de la unidad ' + x }, Object.keys(ST).map(function (k) { return h('option', { value: k, selected: k === u.status, text: ST[k] }); }));
      sel.addEventListener('change', function () { var v = sel.value; if (v === 'disponible') save(S.setUnit(x, { status: v, holder: '', holderPhone: '', holderNote: '', reservedAt: null })); else reserveForm(x, v, u, function () { sel.value = u.status; }); });
      var who = u.status === 'disponible' ? '' : [u.holder, u.holderPhone, u.holderNote].filter(Boolean).join(' · ') + (u.reservedAt ? ' (' + when(u.reservedAt) + ')' : '');
      return h('tr', {}, [h('td', {}, [h('b', { text: String(x) })]), h('td', {}, [pr]), h('td', {}, [sel]), h('td', { class: 'wrap', text: who }), h('td', { class: 'n', text: String(c.q[x] || 0) }), h('td', { class: 'n', text: String(c.v[x] || 0) })]);
    })));
  }
  function reserveForm(x, st, u, cancel) {
    var nm = field('Nombre y apellido', { type: 'text', value: u.holder, maxlength: 80 }), ph = phoneField('Teléfono', u.holderPhone), nt = field('Nota (opcional)', { type: 'text', value: u.holderNote, maxlength: 200 }), err = h('div', { class: 'hub-err' });
    var form = h('form', { style: 'display:flex;flex-direction:column;gap:12px', onsubmit: function (e) {
      e.preventDefault(); var name = nm.in.value.trim(), pr = ph.read();
      if (name.length < 3) { err.textContent = 'Escribí el nombre y apellido.'; nm.in.focus(); return; }
      if (pr.err) { err.textContent = pr.err; ph.in.focus(); return; }
      closeModal(); save(S.setUnit(x, { status: st, holder: name, holderPhone: pr.value, holderNote: nt.in.value.trim(), reservedAt: u.reservedAt || Date.now() }));
    } }, [nm.el, ph.el, nt.el, err, h('div', { class: 'hub-row' }, [h('button', { type: 'button', class: 'hub-b alt', text: 'Cancelar', onclick: function () { closeModal(); cancel(); } }), h('button', { type: 'submit', class: 'hub-b', text: 'Confirmar' })])]);
    modal([h('h3', { text: (st === 'vendida' ? 'Vender ' : 'Reservar ') + x + '.' }), h('p', { text: 'En la app la unidad va a aparecer como ' + ST[st].toLowerCase() + '. Estos datos solo los ve el equipo.' }), form]);
    nm.in.focus();
  }
  function tInq(body) {
    var list = D.inquiries.slice().reverse(), msg = h('span', { class: 'hub-muted' });
    body.appendChild(h('div', { class: 'hub-bar' }, [h('button', { type: 'button', class: 'hub-b sm', text: 'Copiar todas (para pegar en Excel)', disabled: !list.length, onclick: function () {
      var t = 'Fecha\tUnidad\tNombre\tTeléfono\tMensaje\n' + list.map(function (q) { return [when(q.at), q.unit, q.name, q.phone, (q.msg || '').replace(/\s+/g, ' ')].join('\t'); }).join('\n');
      navigator.clipboard.writeText(t).then(function () { msg.textContent = 'Copiado.'; }, function () { msg.textContent = 'No se pudo copiar desde este navegador.'; });
    } }), msg]));
    if (!list.length) { body.appendChild(h('p', { class: 'hub-muted', text: 'Todavía no hay consultas.' })); return; }
    body.appendChild(table([['Fecha'], ['Unidad'], ['Nombre'], ['Teléfono'], ['Mensaje']], list.map(function (q) { return h('tr', {}, [h('td', { text: when(q.at) }), h('td', {}, [h('b', { text: String(q.unit) })]), h('td', { text: q.name }), h('td', { text: q.phone }), h('td', { class: 'wrap', text: q.msg || '' })]); })));
  }
  function tAct(body) {
    var c = counts(), now = Date.now(), day = 864e5, ses = {}, s1 = {}, s7 = {};
    D.events.forEach(function (e) { ses[e.sid] = 1; if (now - e.at < day) s1[e.sid] = 1; if (now - e.at < 7 * day) s7[e.sid] = 1; });
    var sum = function (m) { var t = 0; for (var k in m) t += m[k]; return t; };
    body.appendChild(kpis([['Visitas últimas 24 h', Object.keys(s1).length], ['Visitas 7 días', Object.keys(s7).length], ['Visitas totales', Object.keys(ses).length], ['Fichas vistas', sum(c.v)], ['Recorridos', sum(c.w)], ['Consultas', D.inquiries.length]]));
    var rows = UNITS.map(function (x) { return [x, c.v[x] || 0, c.w[x] || 0, c.s[x] || 0, c.q[x] || 0]; }).sort(function (a, b) { return (b[1] + b[2] * 2 + b[4] * 5) - (a[1] + a[2] * 2 + a[4] * 5) || a[0] - b[0]; });
    body.appendChild(table([['Unidad'], ['Fichas vistas', 'n'], ['Recorridos', 'n'], ['Ver la vista', 'n'], ['Consultas', 'n']], rows.map(function (r) { return h('tr', {}, r.map(function (v, i) { return i ? h('td', { class: 'n', text: String(v) }) : h('td', {}, [h('b', { text: String(v) })]); })); })));
    body.appendChild(h('p', { class: 'hub-muted', style: 'margin-top:10px', text: 'Ordenado por interés. No se cuenta la actividad hecha con el panel del equipo abierto en esta sesión.' }));
  }
  function parsePrice(v) {
    if (typeof v === 'number') return v > 0 ? v : null; var s = String(v || '').replace(/[^\d.,]/g, ''); if (!s) return null;
    if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(s)) { var m = s.match(/^(.*\d{3})[.,](\d{1,2})$/); s = (m ? m[1] : s).replace(/[.,]/g, '') + (m ? '.' + m[2] : ''); } else s = s.replace(',', '.');
    var n = parseFloat(s); return n > 0 ? n : null;
  }
  function loadXLSX() { return window.XLSX ? Promise.resolve() : new Promise(function (ok, no) { var s = h('script', { src: 'xlsx.js' }); s.onload = ok; s.onerror = function () { no(new Error('No se pudo cargar el lector de Excel.')); }; document.head.appendChild(s); }); }
  function readPrices(file) {
    return loadXLSX().then(function () { return file.arrayBuffer(); }).then(function (buf) {
      var wb = window.XLSX.read(buf, { type: 'array' }), best = null;
      wb.SheetNames.forEach(function (sn) {
        var rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' }), cu = -1, cp = -1, got = {};
        for (var i = 0; i < Math.min(rows.length, 25) && cu < 0; i++) { var r = rows[i].map(function (x) { return String(x).toLowerCase(); }), a = r.findIndex(function (x) { return /unid|depto|u\.?f/.test(x); }), b = r.findIndex(function (x) { return /precio|valor|usd|u\$s|lista/.test(x); }); if (a >= 0 && b >= 0 && a !== b) { cu = a; cp = b; } }
        if (cu < 0) { cu = 0; cp = 1; }
        rows.forEach(function (r) { var n = parseInt(String(r[cu]).replace(/\D/g, ''), 10), p = parsePrice(r[cp]); if (UNITS.indexOf(n) >= 0 && p) got[n] = p; });
        if (!best || Object.keys(got).length > Object.keys(best).length) best = got;
      });
      return best || {};
    });
  }
  function tSet(body) {
    var sw = h('input', { type: 'checkbox', checked: D.settings.showCount }); sw.addEventListener('change', function () { save(S.setSettings({ showCount: sw.checked })); });
    body.appendChild(h('div', { class: 'hub-sec' }, [h('h4', { text: 'Contador de consultas' }), h('label', { class: 'hub-sw' }, [sw, 'Mostrar al público cuántas personas consultaron por cada unidad'])]));
    var wa = h('input', { class: 'hub-in', type: 'tel', value: D.settings.whatsapp, placeholder: '+54 9 11 2345 6789' });
    body.appendChild(h('div', { class: 'hub-sec' }, [h('h4', { text: 'WhatsApp de ventas' }), h('p', { text: 'Después de dejar sus datos, la persona ve un botón para seguir la consulta por WhatsApp con este número. Si lo dejás vacío, el botón no aparece.' }), h('div', { class: 'hub-row' }, [wa, h('button', { type: 'button', class: 'hub-b', style: 'flex:0 0 auto', text: 'Guardar', onclick: function () { save(S.setSettings({ whatsapp: wa.value.trim() })); } })])]));
    var out = h('div', {}), fi = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', class: 'hub-in' });
    fi.addEventListener('change', function () {
      var f = fi.files[0]; if (!f) return; out.textContent = 'Leyendo…';
      readPrices(f).then(function (m) {
        var ks = Object.keys(m).map(Number).sort(function (a, b) { return a - b; }), miss = UNITS.filter(function (u) { return !(u in m); }); out.textContent = '';
        if (!ks.length) { out.appendChild(h('p', { class: 'hub-err', text: 'No encontré precios. La planilla necesita una columna "Unidad" y una columna "Precio".' })); return; }
        out.appendChild(h('p', { text: 'Leí ' + ks.length + ' precios. Por ejemplo: ' + ks.slice(0, 3).map(function (u) { return u + ' → ' + money(m[u]); }).join(', ') + '.' + (miss.length ? ' Sin precio en la planilla (no se tocan): ' + miss.join(', ') + '.' : '') }));
        out.appendChild(h('div', { class: 'hub-row', style: 'margin-top:8px' }, [h('button', { type: 'button', class: 'hub-b alt', text: 'Cancelar', onclick: function () { out.textContent = ''; fi.value = ''; } }), h('button', { type: 'button', class: 'hub-b', text: 'Aplicar ' + ks.length + ' precios', onclick: function () { tab = 'unidades'; save(S.setPrices(m)); } })]));
      }, function (x) { out.textContent = ''; out.appendChild(h('p', { class: 'hub-err', text: x.message || 'No se pudo leer el archivo.' })); });
    });
    body.appendChild(h('div', { class: 'hub-sec' }, [h('h4', { text: 'Subir lista de precios (Excel)' }), h('p', { text: 'Un archivo .xlsx o .csv con una columna "Unidad" (101, 102…) y una columna "Precio" en dólares. Antes de aplicar te muestro qué leí. También podés cambiar cada precio a mano en la pestaña Unidades.' }), fi, out]));
    body.appendChild(h('div', { class: 'hub-sec' }, [h('h4', { text: 'Sesión' }), !LIVE && h('p', { text: 'Modo demo: precios, reservas, consultas y actividad se guardan únicamente en este navegador. Cuando conectemos la base de datos pasan a ser compartidos por todos.' }), h('button', { type: 'button', class: 'hub-b alt', style: 'align-self:flex-start', text: 'Cerrar sesión', onclick: function () { S.logout().then(closeAdmin); } })]));
  }

  // ---------------------------------------------------------------- arranque y acceso escondido (#equipo, o 5 toques seguidos en el logo)
  function hash() { if (location.hash === '#equipo') openAdmin(); }
  window.addEventListener('hashchange', hash);
  var taps = [];
  document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.brand .logos')) return; var t = Date.now(); taps = taps.filter(function (x) { return t - x < 2500; }); taps.push(t); if (taps.length >= 5) { taps = []; openAdmin(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  window.HUB = { render: render, refresh: refresh, openAdmin: openAdmin, live: LIVE, embed: EMBED };
  if (EMBED) {
    refresh();
    (function ready() { var st = $('stage'); if (st && st.classList.contains('ready') && window.__d2) emit('VIEWER_READY'); else setTimeout(ready, 250); })();
  } else { track('visit'); refresh(); setInterval(function () { if (!document.hidden && !adm) refresh(); }, 60000); hash(); }
})();
