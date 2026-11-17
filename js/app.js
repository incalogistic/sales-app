/* INCA Go Sales — แอปพนักงานขาย (แวนเซลล์ / พรีเซลล์) เชื่อมกับระบบ DMS
 * ทุกข้อมูลอ่าน/เขียนผ่าน Web App ของ DMS (POST {fn, args})
 * ไฟล์เดียว ไม่ใช้ไลบรารีภายนอก */
(function () {
  'use strict';

  // ---------------------------------------------------------------- state
  var S = {
    url: '', token: '', boot: null, cat: null, catMap: {}, parties: null, lookups: null, geo: null,
    stack: [], view: null, cart: null
  };
  var LS = {
    get: function (k) { try { return localStorage.getItem('ks.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('ks.' + k, v); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem('ks.' + k); } catch (e) { } }
  };

  // ---------------------------------------------------------------- helpers
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function r2(n) { return Math.round((num(n) + 1e-9) * 100) / 100; }
  function money0(n) { return Math.round(num(n)).toLocaleString('th-TH'); }
  function money(n) { return num(n).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function qfmt(n) { n = num(n); return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function today() { return (S.boot && S.boot.today) || ymd(); }
  function monthStart() { return today().substring(0, 8) + '01'; }
  function thDate(s) {
    if (!s) return '';
    var p = String(s).substring(0, 10).split('-');
    return p.length === 3 ? (+p[2]) + '/' + (+p[1]) + '/' + (+p[0] + 543) : s;
  }
  function thDateTime(s) { return thDate(s) + (String(s).length > 10 ? ' ' + String(s).substring(11, 16) : ''); }
  function role() { return S.boot ? S.boot.user.RoleCode : ''; }
  function isVan() { return role() === 'VAN'; }
  function vatRate() { return num(S.boot && S.boot.settings && S.boot.settings.VAT_RATE) || 7; }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }

  function toast(msg, isErr) {
    var d = document.createElement('div');
    if (isErr) d.className = 'e';
    d.textContent = msg;
    $('#toast').appendChild(d);
    setTimeout(function () { d.remove(); }, isErr ? 4500 : 2600);
  }
  var busyN = 0;
  function busy(on) { busyN += on ? 1 : -1; if (busyN < 0) busyN = 0; $('#busy').classList.toggle('hidden', busyN === 0); }

  var ERR = {
    ERR_LOGIN_FAILED: 'User หรือ PIN ไม่ถูกต้อง', ERR_LOCKED: 'บัญชีถูกล็อกชั่วคราว ลองใหม่ภายหลังหรือติดต่อแอดมิน',
    ERR_SESSION_EXPIRED: 'หมดเวลาการใช้งาน กรุณาเข้าระบบใหม่', ERR_NO_PERMISSION: 'ไม่มีสิทธิ์ทำรายการนี้',
    ERR_CHANNEL_WEB_ONLY: 'ตำแหน่งนี้ใช้ได้เฉพาะเว็บหลังบ้าน', ERR_MUST_CHANGE_PIN: 'กรุณาตั้ง PIN ใหม่ก่อนใช้งาน',
    ERR_PIN_RULE: 'PIN ต้องเป็นตัวเลข 6 หลัก', ERR_PIN_WEAK: 'PIN ง่ายเกินไป (เช่น 111111, 123456) กรุณาตั้งใหม่',
    ERR_OLD_PIN: 'PIN เดิมไม่ถูกต้อง', ERR_PIN_SAME: 'PIN ใหม่ต้องไม่ซ้ำ PIN เดิม',
    ERR_REPRINT_LIMIT: 'พิมพ์ใบเสร็จซ้ำครบจำนวนแล้ว กรุณาติดต่อแอดมิน', ERR_NETWORK: 'เชื่อมต่อระบบไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่',
    ERR_NOT_ALLOWED: 'ระบบ DMS ยังไม่เปิดคำสั่งนี้ให้แอป (อัปเดต DMS เป็นเวอร์ชันล่าสุด)', ERR_BAD_REQUEST: 'คำขอไม่ถูกต้อง',
    ERR_COLLECT_FIRST: 'ต้องรับชำระบิลก่อนหน้าให้เรียบร้อยก่อนขายร้านถัดไป', ERR_REQUIRED: 'กรอกข้อมูลไม่ครบ',
    ERR_CREDIT_LIMIT: 'เกินวงเงินเครดิตของลูกค้า', ERR_STOCK_SHORT: 'สินค้าในสต็อกไม่พอ', ERR_CUSTOMER_BLOCKED: 'ร้านนี้ถูกระงับการขาย'
  };
  function errText(e) {
    if (!e) return 'เกิดข้อผิดพลาด';
    var code = e.code || e.message || String(e);
    var t = ERR[code];
    if (t && e.params && e.params.max !== undefined) t += ' (' + e.params.max + ' ครั้ง)';
    if (!t && code === 'ERR_REQUIRED' && e.params && e.params.field) t = 'กรุณากรอก ' + e.params.field;
    return t || ('เกิดข้อผิดพลาด (' + code + ')');
  }

  // ---------------------------------------------------------------- API
  function api(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (fn !== 'apiLogin' && fn !== 'apiPing' && fn !== 'apiLogo' && fn !== 'apiAppFind') args.unshift(S.token);
    busy(true);
    return fetch(S.url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // ไม่ทำ preflight → ใช้กับ Apps Script ได้
      body: JSON.stringify({ fn: fn, args: args })
    }).then(function (r) { return r.json(); }, function () { throw { code: 'ERR_NETWORK' }; })
      .then(function (j) {
        busy(false);
        if (!j || j.ok !== true) {
          var err = { code: (j && j.code) || 'ERR_BAD_REQUEST', params: (j && j.params) || {} };
          if (err.code === 'ERR_SESSION_EXPIRED') { logout(true); }
          throw err;
        }
        return j.data;
      }, function (e) { busy(false); throw e && e.code ? e : { code: 'ERR_NETWORK' }; });
  }
  function fail(e) { toast(errText(e), true); }

  // ---------------------------------------------------------------- หาแบรนด์ของ User (ไม่ต้องใส่ลิงก์เอง)
  function brands() { return (window.DMS_BRANDS || []).filter(function (b) { return b && /^(https:\/\/|http:\/\/localhost)/.test(b.url || ''); }); }
  function urlMap() { try { return JSON.parse(LS.get('urlmap') || '{}'); } catch (e) { return {}; } }
  function ask(url, fn, args) {
    return fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args || [] }) })
      .then(function (r) { return r.json(); }).then(function (j) { return j && j.ok ? j.data : null; }).catch(function () { return null; });
  }
  // คืนลิงก์ระบบของแบรนด์ที่มี User นี้ (ส่งไปแค่ชื่อ User ไม่ส่ง PIN)
  function findBrand(un) {
    var list = brands();
    if (!list.length) return Promise.resolve(S.url || '');          // แบบเก่า: ใช้ลิงก์ที่ตั้งไว้
    if (list.length === 1) return Promise.resolve(list[0].url);     // มีแบรนด์เดียว ไม่ต้องถาม
    var known = urlMap()[un];
    if (known && list.some(function (b) { return b.url === known; })) return Promise.resolve(known);
    busy(true);
    return Promise.all(list.map(function (b) { return ask(b.url, 'apiAppFind', [un]); })).then(function (rs) {
      busy(false);
      var hits = list.map(function (b, i) { return { b: b, r: rs[i] }; }).filter(function (x) { return x.r && x.r.found; });
      if (!hits.length) {
        if (rs.every(function (r) { return !r; })) throw { code: 'ERR_NETWORK' };
        throw { code: 'ERR_LOGIN_FAILED' };
      }
      if (hits.length === 1) return hits[0].b.url;
      return pickBrand(hits);
    });
  }
  function pickBrand(hits) {     // User ซ้ำกันหลายแบรนด์ (ไม่ควรเกิด) → ให้เลือก
    return new Promise(function (ok, no) {
      var m = document.createElement('div');
      m.className = 'sheet-mask';
      m.innerHTML = '<div class="sheet"><h3 style="margin:0 0 10px">เลือกแบรนด์ที่จะเข้า</h3>' +
        hits.map(function (x, i) { return '<button class="btn block" data-i="' + i + '" style="margin-bottom:8px">' + esc(x.r.salesAppName || x.b.name) + '<div class="muted small">' + esc(x.r.company || x.b.name) + '</div></button>'; }).join('') +
        '<button class="btn block" data-i="-1">ยกเลิก</button></div>';
      document.body.appendChild(m);
      m.onclick = function (e) {
        var t = e.target.closest('[data-i]'); if (!t) return;
        m.remove(); var i = +t.getAttribute('data-i');
        if (i < 0) no({ code: 'ERR_CANCEL' }); else ok(hits[i].b.url);
      };
    });
  }

  // ---------------------------------------------------------------- shell / router
  var VIEWS = {};
  function go(name, params, replace) {
    if (S.view && !replace) S.stack.push(S.view);
    S.view = { name: name, params: params || {} };
    render();
  }
  function back() {
    var prev = S.stack.pop();
    if (!prev) prev = { name: 'home', params: {} };
    S.view = prev;
    render();
  }
  function home() { S.stack = []; S.view = { name: 'home', params: {} }; render(); }
  function render() {
    var v = VIEWS[S.view.name];
    var main = $('#main');
    main.innerHTML = '';
    window.scrollTo(0, 0);
    var shell = !!v.shell;
    $('#top').classList.toggle('hidden', !shell);
    $('#tabs').classList.toggle('hidden', !shell);
    if (shell) {
      $('#title').textContent = typeof v.title === 'function' ? v.title(S.view.params) : v.title;
      var tabRoot = S.stack.length === 1 && S.stack[0].name === 'home' && ['customers', 'sell', 'stock', 'bills', 'orders'].indexOf(S.view.name) >= 0 && !(S.view.params || {}).pick;
      $('#back').classList.toggle('hidden', !S.stack.length || tabRoot);
      var u0 = S.boot.user;
      $('#sub').textContent = [u0.FullName, u0.VanName || ''].filter(Boolean).join(' · ');
      $('#who').textContent = isVan() ? 'แวน ' + u0.Username : (u0.RoleCode === 'PRE' ? 'พรีเซลล์' : (u0.RoleNameTh || u0.Username));
      drawTabs();
    }
    Promise.resolve(v.render(main, S.view.params)).catch(function (e) {
      main.innerHTML = '<div class="warn">' + esc(errText(e)) + '</div><div style="height:10px"></div><button class="btn block" id="retry">ลองใหม่</button>';
      var b = $('#retry'); if (b) b.onclick = render;
    });
  }
  var IC = {
    home: '<path d="M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    shop: '<path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.4 11.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6"/>',
    truck: '<path d="M1 5h13v11H1z"/><path d="M14 9h4l4 4v3h-8z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="17.5" cy="18.5" r="2"/>',
    bill: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
    chev: '<path d="M9 18l6-6-6-6"/>', pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', down: '<path d="M6 9l6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
    nav: '<path d="M3 11l18-8-8 18-2-8z"/>',
    repeat: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    print: '<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>'
  };
  function ic(n, sz) { return '<svg width="' + (sz || 22) + '" height="' + (sz || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>'; }
  function drawTabs() {
    var tabs = isVan()
      ? [['home', 'home', 'หน้าแรก'], ['customers', 'shop', 'ลูกค้า'], ['sell', 'cart', 'ขาย'], ['stock', 'truck', 'สต็อกรถ'], ['bills', 'bill', 'บิล']]
      : [['home', 'home', 'หน้าแรก'], ['customers', 'shop', 'ลูกค้า'], ['sell', 'cart', 'สั่งขาย'], ['orders', 'bill', 'ออเดอร์']];
    var cur = S.stack.length ? (S.stack[0].name === 'home' && S.stack[1] ? S.stack[1].name : S.view.name) : S.view.name;
    if (cur === 'customer') cur = 'customers';
    $('#tabs').innerHTML = '<div class="tabs-in">' + tabs.map(function (t) {
      var isTab = tabs.some(function (x) { return x[0] === S.view.name; });
      var on = isTab ? t[0] === S.view.name : t[0] === cur;
      return '<button type="button" data-tab="' + t[0] + '" class="' + (on ? 'on' : '') + (t[0] === 'sell' ? ' mid' : '') + '">' +
        (t[0] === 'sell' ? '<span class="fab">' + ic(t[1]) + '</span>' : ic(t[1])) + '<span>' + t[2] + '</span></button>';
    }).join('') + '</div>';
    $$('[data-tab]').forEach(function (b) {
      b.onclick = function () { var n = b.getAttribute('data-tab'); S.stack = n === 'home' ? [] : [{ name: 'home', params: {} }]; S.view = { name: n, params: {} }; render(); };
    });
  }
  function modal(html, onReady) {
    var bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = '<div class="modal">' + html + '</div>';
    document.body.appendChild(bg);
    var close = function () { bg.remove(); };
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    $$('[data-close]', bg).forEach(function (b) { b.onclick = close; });
    if (onReady) onReady(bg, close);
    return close;
  }
  function confirmBox(title, text, okLabel) {
    return new Promise(function (res) {
      modal('<h3>' + esc(title) + '</h3><div class="muted" style="margin-bottom:14px">' + text + '</div>' +
        '<div class="btns"><button class="btn" data-close type="button">ยกเลิก</button><button class="btn pri" id="cfOk" type="button">' + esc(okLabel || 'ยืนยัน') + '</button></div>',
        function (bg, close) { $('#cfOk', bg).onclick = function () { close(); res(true); }; $$('[data-close]', bg).forEach(function (b) { b.addEventListener('click', function () { res(false); }); }); });
    });
  }

  // ---------------------------------------------------------------- data loaders
  function loadCatalog(force) {
    if (S.cat && !force) return Promise.resolve(S.cat);
    return api('apiProductCatalog', today()).then(function (c) {
      S.cat = c.products || [];
      S.catMap = {};
      S.cat.forEach(function (p) {
        p.units = (p.units || []).slice().sort(function (a, b) { return num(b.Factor) - num(a.Factor); });
        S.catMap[p.ProductCode] = p;
      });
      return S.cat;
    });
  }
  function loadParties(force) {
    if (S.parties && !force) return Promise.resolve(S.parties);
    return api('apiPartyList', 'C', '').then(function (l) { S.parties = l || []; return S.parties; });
  }
  function loadLookups() {
    if (S.lookups) return Promise.resolve(S.lookups);
    return api('apiLookups').then(function (l) { S.lookups = l; return l; });
  }
  function loadGeo() {
    if (S.geo) return Promise.resolve(S.geo);
    return api('apiGeo').then(function (g) { S.geo = g; return g; });
  }
  function docs(f) { return api('apiDocList', Object.assign({ page: 1, pageSize: 500 }, f)).then(function (p) { return p.items || []; }); }

  // ---------------------------------------------------------------- unit helpers (ลัง / กล่อง / ชิ้น)
  function unitsOf(code) {
    var p = S.catMap[code];
    if (!p) return [];
    var u = (p.units && p.units.length ? p.units : [{ Unit: p.CaseUnit, Factor: p.CaseQty }, { Unit: p.BaseUnit, Factor: 1 }]);
    return u.map(function (x) { return { unit: x.Unit, f: num(x.Factor) || 1 }; }).sort(function (a, b) { return b.f - a.f; });
  }
  /** แยกจำนวนหน่วยฐานเป็นหน่วยใหญ่→เล็ก (ดีดเป็นลัง/กล่องอัตโนมัติ) */
  function splitBase(code, base) {
    var out = [];
    unitsOf(code).forEach(function (u) {
      var q = Math.floor(base / u.f + 1e-9);
      if (q > 0) { out.push({ unit: u.unit, qty: q }); base -= q * u.f; }
    });
    return out;
  }
  function baseOf(code, unit, qty) {
    var u = unitsOf(code).filter(function (x) { return x.unit === unit; })[0];
    return num(qty) * (u ? u.f : 1);
  }
  function qtyText(code, base) {
    var parts = splitBase(code, base);
    return parts.length ? parts.map(function (p) { return p.qty + ' ' + p.unit; }).join(' + ') : '0';
  }

  // ================================================================= VIEWS
  // ---------------------------------------------------------------- แบรนด์ (ชื่อ/โลโก้/สี มาจากหน้าตั้งค่าของ DMS)
  function brand() { try { return JSON.parse(LS.get('brand') || '{}'); } catch (e) { return {}; } }
  function shade(hex, k) {   // k<0 เข้มขึ้น, k>0 อ่อนลง
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    var f = function (c) { return Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k); };
    return '#' + [f(r), f(g), f(b)].map(function (c) { return (c < 16 ? '0' : '') + c.toString(16); }).join('');
  }
  function applyBrand() {
    var b = brand(), c = /^#[0-9A-Fa-f]{6}$/.test(b.color || '') ? b.color : '#1D4ED8';
    var st = document.documentElement.style;
    st.setProperty('--brown', c); st.setProperty('--dark', shade(c, -0.34)); st.setProperty('--soft', shade(c, 0.86));
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', shade(c, -0.34));
    document.title = b.salesAppName || 'INCA Go Sales';
  }
  function logoHtml() {
    var b = brand();
    var bg = '<div class="login-bg"></div>';
    if (b.url) return bg + '<img class="logo" style="object-fit:contain;background:#fff;padding:6px" src="' + esc(b.url) + '" alt="">';
    return bg + '<img class="logo mark" src="icons/icon-192.png" alt="">';   // ไอคอน INCA Go
  }
  function taglineHtml() { var t = brand().tagline; return t ? '<div class="tagline">' + esc(t) + '</div>' : ''; }
  function loadBrand() {
    return api('apiLogo').then(function (b) {
      LS.set('brand', JSON.stringify({ url: b.url && b.url.length < 300000 ? b.url : '', salesAppName: b.salesAppName, company: b.company, color: b.color, tagline: b.tagline || '' }));
      applyBrand();
    }).catch(function () { });
  }

  // ---------------------------------------------------------------- setup
  VIEWS.setup = {
    render: function (el) {
      el.innerHTML = '<div class="login">' + logoHtml() + '<h2 style="margin:0 0 2px">' + esc(brand().salesAppName || 'INCA Go Sales') + '</h2>' + taglineHtml() + '<h3 style="margin:6px 0 0">ตั้งค่าการเชื่อมต่อ</h3>' +
        '<p class="muted small">วางลิงก์ Web App ของระบบ DMS (ลงท้ายด้วย /exec)<br>ขอลิงก์ได้จาก System Support</p>' +
        '<label class="f" style="text-align:left"><span>ลิงก์ DMS</span><input class="input" id="u" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="' + esc(S.url) + '"></label>' +
        '<button class="btn pri block" id="ok" type="button">เชื่อมต่อ</button></div>';
      $('#ok').onclick = function () {
        var u = $('#u').value.trim();
        if (!/^https:\/\/.+/.test(u)) { toast('ลิงก์ไม่ถูกต้อง', true); return; }
        S.url = u;
        api('apiPing').then(function (r) {
          LS.set('url', u);
          toast('เชื่อมต่อ DMS ได้แล้ว (เวอร์ชัน ' + r.version + ')');
          loadBrand().then(function () { S.view = { name: 'login', params: {} }; render(); });
        }).catch(fail);
      };
    }
  };

  // ---------------------------------------------------------------- login (User + PIN)
  VIEWS.login = {
    render: function (el) {
      var user = LS.get('username') || '', pin = '';
      el.innerHTML = '<div class="login">' + logoHtml() + '<h2 style="margin:0 0 4px">' + esc(brand().salesAppName || 'INCA Go Sales') + '</h2>' + taglineHtml() +
        '<div class="muted small" style="margin-bottom:14px">' + esc(brand().company || '') + (brand().company ? ' · ' : '') + 'เข้าระบบด้วย User และ PIN</div>' +
        '<input class="input c" id="un" placeholder="User เช่น V01, PS01" autocapitalize="characters" autocomplete="username" value="' + esc(user) + '">' +
        '<div class="dots">' + [0, 1, 2, 3, 4, 5].map(function () { return '<span></span>'; }).join('') + '</div>' +
        '<div class="pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button type="button" data-k="' + n + '">' + n + '</button>'; }).join('') +
        (brands().length ? '<span></span>' : '<button type="button" class="x" data-k="set">ตั้งค่า</button>') + '<button type="button" data-k="0">0</button><button type="button" class="x" data-k="del">ลบ</button></div>' +
        '<p class="muted small" style="margin-top:16px">ลืม PIN? ติดต่อแอดมินเพื่อรีเซ็ต</p></div>';
      var dots = function () { $$('.dots span').forEach(function (d, i) { d.classList.toggle('on', i < pin.length); }); };
      var submit = function () {
        var un = $('#un').value.trim().toUpperCase();
        if (!un) { toast('กรุณากรอก User', true); pin = ''; dots(); return; }
        findBrand(un).then(function (url) {
          if (!url) throw { code: 'ERR_NETWORK' };
          if (url !== S.url) { S.url = url; LS.set('url', url); }
          return api('apiLogin', un, pin, 'APP');
        }).then(function (r) {
          LS.set('username', un);
          var mp = urlMap(); mp[un] = S.url; LS.set('urlmap', JSON.stringify(mp));
          loadBrand();
          S.token = r.token; S.boot = r.boot;
          LS.set('token', r.token);
          if (r.boot.user.MustChangePwd) { S.view = { name: 'changePin', params: { forced: true } }; render(); return; }
          start();
        }).catch(function (e) { pin = ''; dots(); if (e && e.code !== 'ERR_CANCEL') fail(e); });
      };
      $$('[data-k]').forEach(function (b) {
        b.onclick = function () {
          var k = b.getAttribute('data-k');
          if (k === 'del') pin = pin.slice(0, -1);
          else if (k === 'set') { S.view = { name: 'setup', params: {} }; render(); return; }
          else if (pin.length < 6) pin += k;
          dots();
          if (pin.length === 6) setTimeout(submit, 120);
        };
      });
    }
  };

  // ---------------------------------------------------------------- change PIN
  VIEWS.changePin = {
    shell: false,
    render: function (el, p) {
      el.innerHTML = '<div class="login" style="text-align:left"><h2 class="c">ตั้ง PIN ใหม่</h2>' +
        (p.forced ? '<div class="hint">เข้าระบบครั้งแรกด้วย PIN ชั่วคราว กรุณาตั้ง PIN ของคุณเอง</div><div style="height:10px"></div>' : '') +
        '<label class="f"><span>PIN เดิม</span><input class="input" id="p0" type="password" inputmode="numeric" maxlength="6"></label>' +
        '<label class="f"><span>PIN ใหม่ (ตัวเลข 6 หลัก)</span><input class="input" id="p1" type="password" inputmode="numeric" maxlength="6"></label>' +
        '<label class="f"><span>ยืนยัน PIN ใหม่</span><input class="input" id="p2" type="password" inputmode="numeric" maxlength="6"></label>' +
        '<button class="btn pri block" id="ok" type="button">บันทึก PIN</button>' +
        (p.forced ? '' : '<div style="height:8px"></div><button class="btn block" id="cc" type="button">ยกเลิก</button>') + '</div>';
      if ($('#cc')) $('#cc').onclick = back;
      $('#ok').onclick = function () {
        var a = $('#p0').value, b = $('#p1').value, c = $('#p2').value;
        if (!/^\d{6}$/.test(b)) { toast(ERR.ERR_PIN_RULE, true); return; }
        if (b !== c) { toast('PIN ใหม่ทั้งสองช่องไม่ตรงกัน', true); return; }
        api('apiChangePin', a, b).then(function () {
          toast('ตั้ง PIN ใหม่เรียบร้อย');
          return api('apiMe');
        }).then(function (boot) { S.boot = boot; if (p.forced) start(); else back(); }).catch(fail);
      };
    }
  };

  // ---------------------------------------------------------------- home
  VIEWS.home = {
    shell: true, title: function () { return brand().salesAppName || 'INCA Go Sales'; },
    render: function (el) {
      var u = S.boot.user;
      var quick = isVan()
        ? [['sell', 'ขายสินค้า', 'ออกบิล + รับชำระ'], ['customers', 'ลูกค้า', 'ร้านในสายวิ่ง'], ['loadReq', 'ขอโหลดสินค้า', 'เติมของขึ้นรถ'], ['daySummary', 'ปิดรถวันนี้', 'ส่งเงิน + นับสต็อก']]
        : [['sell', 'สั่งขาย', 'ส่งใบสั่งขาย + เช็กโปร'], ['customers', 'ลูกค้า', 'ร้านที่ดูแล'], ['newCustomer', 'ขอเปิดร้านใหม่', 'รอแอดมินอนุมัติ'], ['orders', 'ออเดอร์ของฉัน', 'สถานะการอนุมัติ']];
      el.innerHTML = '<div class="stack"><div class="hello">สวัสดี <b>' + esc(u.FullName) + '</b></div><div id="alert"></div>' +
        '<div class="hero"><div class="lbl">ยอดขายวันนี้</div><div class="amt" id="hToday">฿—</div><div class="lbl" id="hBills"></div></div>' +
        '<div class="card target" id="hTarget"></div>' +
        '<div class="quick">' + quick.map(function (q) { return '<button type="button" class="qk" data-go="' + q[0] + '"><b>' + q[1] + '</b><span>' + q[2] + '</span></button>'; }).join('') + '</div>' +
        '<div class="sec">ร้านที่ต้องเยี่ยมวันนี้</div><div id="visits"><div class="muted small">กำลังโหลด…</div></div></div>';
      $$('[data-go]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
      return Promise.all([api('apiAppHome'), isVan() ? api('apiCollectPending') : Promise.resolve([]), loadParties().catch(function () { return []; })]).then(function (r) {
        var h = r[0], pend = r[1];
        $('#hToday').textContent = '฿' + money0(h.today.total);
        $('#hBills').textContent = h.today.count + (isVan() ? ' บิล' : ' ใบสั่งขาย') + ' วันนี้';
        var al = [];
        if (isVan() && pend.length) al.push('<button type="button" class="alert" id="goCol">มีบิล ' + pend.length + ' ใบที่ยังไม่ได้รับชำระ — แตะเพื่อรับชำระ</button>');
        if (!isVan() && h.pendingOrders) al.push('<div class="alert">มีใบสั่งขาย ' + h.pendingOrders + ' ใบรอแอดมินอนุมัติ</div>');
        $('#alert').innerHTML = al.join('');
        if ($('#goCol')) $('#goCol').onclick = function () { go('collectList'); };
        var m = h.month;
        $('#hTarget').innerHTML = m.target
          ? '<div class="between"><span>ยอดเดือนนี้ เทียบเป้า</span><b>' + m.pct + '%</b></div><div class="bar"><i style="width:' + Math.min(m.pct, 100) + '%"></i></div>' +
            '<div class="between muted small"><span>ทำได้ ฿' + money0(m.total) + '</span><span>เป้า ฿' + money0(m.target) + '</span></div>' +
            (m.total < m.target ? '<div class="muted small" style="margin-top:4px">ต้องขายอีกวันละ ฿' + money0(m.perDay) + ' (' + m.daysLeft + ' วันทำงาน)</div>' : '<div class="small" style="margin-top:4px;color:var(--green)">ถึงเป้าเดือนนี้แล้ว</div>')
          : '<div class="between"><span>ยอดเดือนนี้</span><b>฿' + money0(m.total) + '</b></div><div class="muted small">' + m.count + (isVan() ? ' บิล' : ' ใบสั่งขาย') + ' · ยังไม่ได้ตั้งเป้า</div>';
        var pos = TRK.pos;
        var vs = h.visits.map(function (v) {
          v.d = pos && v.lat ? distKm(pos.lat, pos.lng, +v.lat, +v.lng) : null;
          return v;
        }).sort(function (a, b) { return (a.visitedAt ? 1 : 0) - (b.visitedAt ? 1 : 0) || (a.d === null ? 1e9 : a.d) - (b.d === null ? 1e9 : b.d); });
        $('#visits').innerHTML = vs.length ? vs.map(function (v) {
          var pt = (S.parties || []).filter(function (x) { return x.id === v.id; })[0] || {};
          return '<div class="li vrow"><button type="button" class="grow vmain" data-c="' + esc(v.id) + '"><b>' + esc(v.name) + '</b><div class="muted small">' + esc(v.id) + (v.place ? ' · ' + esc(v.place) : '') + (v.d !== null ? ' · ' + distText(v.d) : '') + '</div>' +
            (v.visitedAt || v.sold ? '<div class="chips">' + (v.visitedAt ? '<span class="chip g">เยี่ยมแล้ว ' + esc(v.visitedAt) + '</span>' : '') + (v.sold ? '<span class="chip">มีบิลวันนี้</span>' : '') + '</div>' : '') + '</button>' +
            (pt.phone ? '<a class="ibtn" aria-label="โทรหาร้าน" href="' + esc(telUrl(pt.phone)) + '">' + ic('phone', 18) + '</a>' : '') +
            (v.lat ? '<a class="ibtn" aria-label="นำทางไปร้าน" target="_blank" rel="noopener" href="' + esc(mapsUrl(v.lat, v.lng)) + '">' + ic('nav', 18) + '</a>' : '') + '</div>';
        }).join('') : '<div class="empty-note">วันนี้ไม่มีร้านในสายวิ่ง' + (h.weekday === 0 ? ' (วันอาทิตย์)' : '') + '<br><span class="small">แอดมินกำหนดวันเยี่ยมร้านได้ที่ข้อมูลลูกค้าในหลังบ้าน</span></div>';
        $$('[data-c]', $('#visits')).forEach(function (b) { b.onclick = function () { go('customer', { id: b.getAttribute('data-c') }); }; });
      });
    }
  };
  function distKm(a1, o1, a2, o2) {
    var R = 6371, r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
    var x = Math.sin(dA / 2) * Math.sin(dA / 2) + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) * Math.sin(dO / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }

  // ---------------------------------------------------------------- more menu
  VIEWS.more = {
    shell: true, title: 'เมนู',
    render: function (el) {
      var items = isVan()
        ? [['loadReq', 'ขอโหลดสินค้าขึ้นรถ'], ['returnReq', 'ขอคืนสินค้าจากรถ'], ['daySummary', 'สรุปยอดขายวันนี้'], ['collectList', 'รับชำระเงิน'], ['newCustomer', 'เปิดร้านค้าใหม่'], ['customers', 'ลูกค้า']]
        : [['newCustomer', 'เปิดร้านค้าใหม่'], ['customers', 'ลูกค้าที่ดูแล']];
      el.innerHTML = '<div class="list">' + items.map(function (i) { return '<div class="it" data-go="' + i[0] + '">' + esc(i[1]) + '</div>'; }).join('') +
        '<div class="it" data-go="changePin">เปลี่ยน PIN</div><div class="it" id="refresh">โหลดข้อมูลสินค้า/ลูกค้าใหม่</div>' +
        '<div class="it" id="out" style="color:var(--red)">ออกจากระบบ</div></div>' +
        '<p class="muted small c">' + esc(brand().salesAppName || 'INCA Go Sales') + ' · เชื่อมต่อ INCA Go</p>';
      $$('[data-go]').forEach(function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; });
      $('#refresh').onclick = function () { Promise.all([loadCatalog(true), loadParties(true)]).then(function () { toast('อัปเดตข้อมูลแล้ว'); }).catch(fail); };
      $('#out').onclick = function () { confirmBox('ออกจากระบบ', 'ต้องการออกจากระบบใช่ไหม', 'ออกจากระบบ').then(function (y) { if (y) logout(); }); };
    }
  };

  // ---------------------------------------------------------------- customers
  VIEWS.customers = {
    shell: true, title: 'ลูกค้า',
    render: function (el, p) {
      el.innerHTML = '<div class="sticky"><div class="row" style="gap:8px"><div class="sbox grow">' + ic('search', 18) + '<input class="input" id="q" placeholder="ค้นหาชื่อร้าน / รหัส / เบอร์โทร"></div>' +
        (p.pick ? '' : '<button class="btn pri" id="nc" type="button">+ ร้านใหม่</button>') + '</div></div>' +
        '<div id="pend"></div><div class="sec" id="cnt"></div><div class="rows" id="l"></div>';
      if ($('#nc')) $('#nc').onclick = function () { go('newCustomer'); };
      var orders = {};
      var draw = function () {
        var q = $('#q').value.trim().toLowerCase();
        var l = S.parties.filter(function (c) { return !q || (c.id + ' ' + c.name + ' ' + (c.altName || '') + ' ' + (c.phone || '')).toLowerCase().indexOf(q) >= 0; });
        $('#cnt').textContent = (p.pick ? 'เลือกร้านค้า · ' : 'ร้านที่ดูแล ') + l.length + ' ร้าน';
        $('#l').innerHTML = l.slice(0, 200).map(function (c) {
          return '<button type="button" class="li" data-c="' + esc(c.id) + '"><div class="grow"><b>' + esc(c.name) + '</b>' +
            '<div class="muted small">' + esc(c.id) + (c.subdistrict || c.district ? ' · ' + esc([c.subdistrict, c.district].filter(Boolean).join(' ')) : '') + '</div>' +
            '<div class="small" style="margin-top:2px">' + (c.blocked ? '<span class="t-r">ระงับการขาย</span>' : c.unpaid > 0 ? '<span class="t-r">ค้างชำระ ' + money(c.unpaid) + '</span>' : '<span class="t-g">ไม่มียอดค้าง</span>') + '</div></div>' +
            (orders[c.id] ? '<span class="chip">' + orders[c.id] + ' ออเดอร์</span>' : '') + '<span class="chev">' + ic('chev', 18) + '</span></button>';
        }).join('') || '<div class="empty-note">ไม่พบลูกค้า</div>';
        $$('[data-c]').forEach(function (b) {
          b.onclick = function () {
            var id = b.getAttribute('data-c');
            if (p.pick) { S.stack.pop(); S.view = { name: 'sell', params: { party: id } }; render(); } else go('customer', { id: id });
          };
        });
      };
      $('#q').oninput = debounce(draw, 150);
      if (!p.pick) api('apiCustomerList', { status: 'PENDING', pageSize: 50 }).then(function (pg) {
        var l = (pg.items || []).filter(function (c) { return c.CreatedBy === S.boot.user.UserId; });
        if (!l.length || !$('#pend')) return;
        $('#pend').innerHTML = '<div class="sec">คำขอเปิดร้านของฉัน · รอแอดมินอนุมัติ ' + l.length + ' ร้าน</div><div class="rows">' + l.map(function (c) {
          return '<button type="button" class="li" data-pc="' + esc(c.CustomerId) + '"><div class="grow"><b>' + esc(c.Name) + '</b><div class="muted small">รหัสร่าง ' + esc(c.CustomerId) +
            (c.Subdistrict ? ' · ' + esc(c.Subdistrict) : '') + '</div></div><span class="chip a">รออนุมัติ</span></button>';
        }).join('') + '</div>';
        $$('[data-pc]').forEach(function (b) { b.onclick = function () { go('customer', { id: b.getAttribute('data-pc') }); }; });
      }).catch(function () { });
      return loadParties().then(function () {
        draw();
        if (!isVan()) return docs({ docType: 'SO', dateFrom: monthStart(), dateTo: today() }).then(function (l) {
          l.forEach(function (d) { if (d.Status !== 'CANCELLED') orders[d.PartyId] = (orders[d.PartyId] || 0) + 1; });
          draw();
        });
      });
    }
  };

  function mapsUrl(lat, lng) { return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(lat + ',' + lng); }
  function telUrl(ph) { return 'tel:' + String(ph || '').replace(/[^0-9+]/g, ''); }
  function distText(km) { return km === null || km === undefined ? '' : (km < 1 ? Math.round(km * 1000) + ' ม.' : km.toFixed(1) + ' กม.'); }
  VIEWS.customer = {
    shell: true, title: 'ข้อมูลร้าน',
    render: function (el, p) {
      return api('apiCustomerGet', p.id).then(function (c) {
        var place = [c.Subdistrict && 'ต.' + c.Subdistrict, c.District && 'อ.' + c.District].filter(Boolean).join(' ');
        var addr = [c.Address, place, c.Province && 'จ.' + c.Province].filter(Boolean).join(' ');
        var pos = TRK.pos, d = pos && c.Lat ? distKm(pos.lat, pos.lng, +c.Lat, +c.Lng) : null;
        el.innerHTML = '<div class="stack"><div class="card"><div class="between" style="align-items:flex-start"><div class="grow"><div class="b" style="font-size:17px">' + esc(c.Name) + '</div>' +
          '<div class="muted small">' + esc(c.CustomerId) + (c.Status === 'PENDING' ? ' · <span class="chip a">รออนุมัติ</span>' : '') + (d !== null ? ' · ห่าง ' + distText(d) : '') + '</div></div></div>' +
          '<div class="small" style="margin-top:6px">' + esc(addr || '-') + '</div>' +
          '<div class="chips" style="margin-top:8px">' + (c.Unpaid > 0 ? '<span class="chip r">ค้างชำระ ฿' + money(c.Unpaid) + '</span>' : '<span class="chip g">ไม่มียอดค้าง</span>') +
          '<span class="chip">' + (c.PaymentType === 'CREDIT' ? 'เครดิต ' + esc(c.CreditDays || 0) + ' วัน' : 'เงินสด') + '</span></div>' +
          '<div class="acts">' + (c.Phone ? '<a class="btn" href="' + esc(telUrl(c.Phone)) + '">' + ic('phone', 18) + ' โทร</a>' : '<span class="btn" aria-disabled="true">ไม่มีเบอร์</span>') +
          (c.Lat ? '<a class="btn" target="_blank" rel="noopener" href="' + esc(mapsUrl(c.Lat, c.Lng)) + '">' + ic('nav', 18) + ' นำทาง</a>' : '<span class="btn" aria-disabled="true">ยังไม่มีพิกัด</span>') + '</div></div>' +
          '<div id="visitBox"></div>' +
          (c.Status === 'PENDING' ? '<div class="alert">ร้านนี้รอแอดมินอนุมัติ — อนุมัติแล้วจะได้รหัสร้านจริงและเริ่มขายได้</div>' :
          '<button class="btn pri block" id="sell" type="button">' + (isVan() ? 'ขายร้านนี้' : 'สั่งขายร้านนี้') + '</button>' +
          '<button class="btn block" id="rep" type="button">' + ic('repeat', 18) + ' สั่งเหมือนครั้งก่อน</button>') +
          '<div class="card"><div class="sec" style="margin-top:0">' + (isVan() ? 'บิลวันนี้' : 'ออเดอร์เดือนนี้') + '</div><div id="h" class="small muted">กำลังโหลด…</div></div>' +
          '<details class="card more"><summary>ตัวเลือกเพิ่มเติม</summary><div class="muted small" style="margin:8px 0">พิกัดร้าน: ' + (c.Lat ? esc(c.Lat + ', ' + c.Lng) : 'ยังไม่มี') +
          '<br>ใช้ปุ่มนี้เฉพาะตอนยืนอยู่หน้าร้านเท่านั้น</div><button class="btn block" id="gps" type="button">' + ic('pin', 18) + ' บันทึกพิกัดร้านจากตำแหน่งตอนนี้</button></details></div>';
        var drawVisit = function () {
          var v = curVisit(), here = v && v.cid === c.CustomerId;
          $('#visitBox').innerHTML = here
            ? '<div class="card visit on"><div class="between"><div><div class="b t-g">กำลังเยี่ยมร้านนี้</div><div class="muted small">เช็คอิน ' + esc(String(v.at).substring(11, 16)) + ' น. · ' + visitMin(v) + ' นาที</div></div>' +
              '<button class="btn" id="vOut" type="button">เช็คเอาท์</button></div></div>'
            : '<div class="card visit"><div class="between"><div><div class="b">เยี่ยมร้าน</div><div class="muted small">' + (v ? 'ตอนนี้อยู่ที่ ' + esc(v.name) + ' (จะเช็คเอาท์ให้อัตโนมัติ)' : 'กดเช็คอินเมื่อถึงร้าน') + '</div></div>' +
              '<button class="btn grn" id="vIn" type="button">' + ic('check', 18) + ' เช็คอิน</button></div></div>';
          if ($('#vIn')) $('#vIn').onclick = function () { visitIn(c.CustomerId, c.Name, false); toast('เช็คอินร้าน ' + c.Name); drawVisit(); };
          if ($('#vOut')) $('#vOut').onclick = function () { visitOut(); toast('เช็คเอาท์แล้ว'); drawVisit(); };
        };
        drawVisit();
        if (c.Status === 'PENDING') { $('#visitBox').innerHTML = ''; }
        if ($('#sell')) $('#sell').onclick = function () { go('sell', { party: c.CustomerId }); };
        if ($('#rep')) $('#rep').onclick = function () { go('sell', { party: c.CustomerId, repeat: true }); };
        $('#gps').onclick = function () {
          getGps().then(function (g) {
            var dd = c.Lat ? distKm(+g.lat, +g.lng, +c.Lat, +c.Lng) : null;
            return confirmBox('บันทึกพิกัดร้าน', 'บันทึกพิกัดร้าน <b>' + esc(c.Name) + '</b> เป็น ' + esc(g.lat + ', ' + g.lng) + '?' +
              (dd !== null ? '<br>ห่างจากพิกัดเดิม <b>' + distText(dd) + '</b>' : '') + '<br><span style="color:var(--red)">ต้องยืนอยู่หน้าร้านเท่านั้น</span>', 'บันทึก')
              .then(function (y) { if (y) return api('apiCustomerSetGps', c.CustomerId, g.lat, g.lng).then(function () { toast('บันทึกพิกัดแล้ว'); }); });
          }).catch(function (e) { fail(e.code ? e : { code: e.message || e }); });
        };
        return docs({ partyId: c.CustomerId, docType: isVan() ? 'INV' : 'SO', dateFrom: isVan() ? today() : monthStart(), dateTo: today() }).then(function (l) {
          $('#h').innerHTML = l.length ? l.slice(0, 20).map(docRow).join('') : 'ยังไม่มีรายการ';
          bindDocRows();
        });
      });
    }
  };

  // ---------------------------------------------------------------- new customer
  function taxIdOk(t) {
    if (!/^\d{13}$/.test(t)) return false;
    var s = 0;
    for (var i = 0; i < 12; i++) s += (+t[i]) * (13 - i);
    return (11 - s % 11) % 10 === +t[12];
  }
  function getGps() {
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) { rej(new Error('มือถือนี้ไม่รองรับ GPS')); return; }
      busy(true);
      navigator.geolocation.getCurrentPosition(function (p) { busy(false); res({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }); },
        function () { busy(false); rej(new Error('อ่านตำแหน่งไม่ได้ — เปิด GPS และอนุญาตตำแหน่งให้แอป')); }, { enableHighAccuracy: true, timeout: 20000 });
    });
  }
  function shrinkImage(file, maxW) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, maxW / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { rej(new Error('อ่านรูปไม่ได้')); };
      img.src = url;
    });
  }
  function pickPhoto() {
    return new Promise(function (res) {
      var i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.capture = 'environment';
      i.onchange = function () { if (i.files[0]) res(i.files[0]); };
      i.click();
    });
  }
  function opts(list, val, ph) {
    return '<option value="">' + esc(ph || '— เลือก —') + '</option>' + list.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o;
      return '<option value="' + esc(v) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }
  VIEWS.newCustomer = {
    shell: true, title: 'เปิดร้านค้าใหม่',
    render: function (el) {
      var st = { gps: null, photo: null };
      return Promise.all([loadLookups(), loadGeo()]).then(function (r) {
        var lk = r[0], tree = {};
        // geo.p = [[จังหวัด, [[อำเภอ, [[ตำบล, รหัสไปรษณีย์], ...]], ...]], ...]
        (r[1].p || []).forEach(function (pv) { var d = tree[pv[0]] = {}; (pv[1] || []).forEach(function (x) { d[x[0]] = x[1] || []; }); });
        var provinces = Object.keys(tree);
        var shopTypes = ((lk.lists || {}).SHOP_TYPE || []).map(function (o) { return [o.code, o.nameTh]; });
        el.innerHTML = '<div class="card">' +
          '<label class="f"><span>ชื่อร้าน <i>*</i></span><input class="input" id="Name"></label>' +
          '<label class="f"><span>ประเภทร้าน <i>*</i></span><select class="input" id="ShopType">' + opts(shopTypes) + '</select></label>' +
          '<label class="f"><span>เบอร์โทร <i>*</i></span><input class="input" id="Phone" inputmode="tel" placeholder="08x-xxx-xxxx"></label>' +
          '<label class="f"><span>เลขประจำตัวผู้เสียภาษี (13 หลัก ถ้ามี)</span><input class="input" id="TaxId" inputmode="numeric" maxlength="13"><div class="err hidden" id="taxErr">เลขผู้เสียภาษีไม่ถูกต้อง</div></label>' +
          '<label class="f"><span>บ้านเลขที่ / หมู่ / ถนน <i>*</i></span><input class="input" id="Address"></label>' +
          '<label class="f"><span>จังหวัด <i>*</i></span><select class="input" id="Province">' + opts(provinces) + '</select></label>' +
          '<label class="f"><span>อำเภอ / เขต <i>*</i></span><select class="input" id="District" disabled>' + opts([]) + '</select></label>' +
          '<label class="f"><span>ตำบล / แขวง <i>*</i></span><select class="input" id="Subdistrict" disabled>' + opts([]) + '</select></label>' +
          '<label class="f"><span>รหัสไปรษณีย์</span><input class="input" id="Postcode" inputmode="numeric" maxlength="5"></label></div>' +
          '<div class="card"><h3>ตำแหน่งร้าน <span class="small" style="color:var(--red)">*</span></h3><div id="gpsTxt" class="muted small">ยังไม่ได้ปักหมุด</div>' +
          '<button class="btn block" id="gps" type="button" style="margin-top:8px">' + ic('pin', 18) + ' ปักหมุดตำแหน่งปัจจุบัน (ยืนหน้าร้าน)</button></div>' +
          '<div class="card"><h3>รูปหน้าร้าน <span class="small" style="color:var(--red)">*</span></h3><div id="ph"></div>' +
          '<button class="btn block" id="cam" type="button" style="margin-top:8px">ถ่ายรูปหน้าร้าน</button></div>' +
          '<button class="btn pri block" id="save" type="button">ส่งขอเปิดร้าน</button><p class="muted small c">ร้านใหม่จะใช้งานได้หลังแอดมินอนุมัติ</p>';
        var dSel = $('#District'), sSel = $('#Subdistrict');
        var dist = function () { var pv = tree[$('#Province').value] || {}; return pv; };
        $('#Province').onchange = function () {
          var ds = Object.keys(dist());
          dSel.innerHTML = opts(ds); dSel.disabled = !ds.length; sSel.innerHTML = opts([]); sSel.disabled = true; $('#Postcode').value = '';
        };
        dSel.onchange = function () {
          var ss = (dist()[dSel.value] || []);
          sSel.innerHTML = opts(ss.map(function (x) { return [x[0], x[0]]; })); sSel.disabled = !ss.length;
        };
        sSel.onchange = function () {
          var hit = (dist()[dSel.value] || []).filter(function (x) { return x[0] === sSel.value; })[0];
          if (hit) $('#Postcode').value = hit[1];
        };
        $('#TaxId').oninput = function () { var v = this.value.replace(/\D/g, ''); this.value = v; $('#taxErr').classList.toggle('hidden', !v || v.length < 13 || taxIdOk(v)); };
        $('#gps').onclick = function () {
          getGps().then(function (g) { st.gps = g; $('#gpsTxt').innerHTML = '<span class="t-g">ปักหมุดแล้ว</span> ' + g.lat + ', ' + g.lng + ' <a target="_blank" rel="noopener" href="https://maps.google.com/?q=' + g.lat + ',' + g.lng + '">ดูแผนที่</a>'; })
            .catch(function (e) { toast(e.message, true); });
        };
        $('#cam').onclick = function () {
          pickPhoto().then(function (f) { return shrinkImage(f, 1280); }).then(function (d) { st.photo = d; $('#ph').innerHTML = '<img class="photo" src="' + d + '">'; $('#cam').textContent = 'ถ่ายใหม่'; })
            .catch(function (e) { toast(e.message, true); });
        };
        $('#save').onclick = function () {
          var v = {}; ['Name', 'ShopType', 'Phone', 'TaxId', 'Address', 'Province', 'District', 'Subdistrict', 'Postcode'].forEach(function (k) { v[k] = $('#' + k).value.trim(); });
          var miss = [['Name', 'ชื่อร้าน'], ['ShopType', 'ประเภทร้าน'], ['Phone', 'เบอร์โทร'], ['Address', 'ที่อยู่'], ['Province', 'จังหวัด'], ['District', 'อำเภอ'], ['Subdistrict', 'ตำบล']]
            .filter(function (k) { return !v[k[0]]; });
          if (miss.length) { toast('กรุณากรอก ' + miss.map(function (m) { return m[1]; }).join(', '), true); return; }
          if (!/^0\d{8,9}$/.test(v.Phone.replace(/\D/g, ''))) { toast('เบอร์โทรไม่ถูกต้อง', true); return; }
          if (v.TaxId && !taxIdOk(v.TaxId)) { toast('เลขผู้เสียภาษีไม่ถูกต้อง', true); return; }
          if (!st.gps) { toast('กรุณาปักหมุดตำแหน่งร้าน', true); return; }
          if (!st.photo) { toast('กรุณาถ่ายรูปหน้าร้าน', true); return; }
          v.Lat = st.gps.lat; v.Lng = st.gps.lng; v.BranchType = 'HQ';
          var cid;
          api('apiCustomerSave', v, {}).then(function (r) {
            cid = r.CustomerId || (r.customer && r.customer.CustomerId) || r.id || r;
            return api('apiCustomerPhotoUpload', cid, st.photo.split(',')[1], 'image/jpeg', st.gps.lat, st.gps.lng, 'หน้าร้าน (เปิดร้านใหม่)');
          }).then(function () {
            toast('ส่งขอเปิดร้านแล้ว รอแอดมินอนุมัติ');
            S.parties = null;
            back();
          }).catch(fail);
        };
      });
    }
  };

  // ---------------------------------------------------------------- sell (van INV / pre SO)
  function newCart(party) { return { party: party, items: [], preview: null, pay: 'CASH', delivery: '', note: '' }; }
  VIEWS.sell = {
    shell: true, title: function () { return isVan() ? 'ขายสินค้า' : 'สั่งขาย'; },
    render: function (el, p) {
      var pre = isVan() ? api('apiCollectPending') : Promise.resolve([]);
      return Promise.all([loadCatalog(), loadParties(), pre, isVan() ? api('apiStockOnHand', S.boot.user.VanWarehouseId) : Promise.resolve(null)]).then(function (r) {
        if (r[2].length) {   // แวน: ต้องรับชำระบิลก่อนหน้าก่อน
          el.innerHTML = '<div class="warn">ต้องรับชำระบิลด้านล่างให้เรียบร้อยก่อนขายร้านถัดไป</div><div style="height:10px"></div>' +
            r[2].map(function (d) { return '<div class="card"><div class="between"><div><div class="b">' + esc(d.DocNo) + '</div><div class="muted small">' + esc(d.PartyName) + '</div></div>' +
              '<div class="r"><div class="b">' + money(d.NetTotal) + '</div><button class="btn grn" data-col="' + esc(d.DocId) + '" type="button">รับชำระ</button></div></div></div>'; }).join('');
          $$('[data-col]').forEach(function (b) { b.onclick = function () { go('collect', { invId: b.getAttribute('data-col') }); }; });
          return;
        }
        var stock = r[3] && r[3].visible ? r[3].qty : null;
        if (!S.cart || (p.party && S.cart.party !== p.party)) {
          if (S.cart && S.cart.party && S.cart.started) trk('ORDER_CANCEL', { cid: S.cart.party });
          S.cart = newCart(p.party || '');
        }
        var cart = S.cart;
        var party = S.parties.filter(function (c) { return c.id === cart.party; })[0];
        if (!party) {
          el.innerHTML = '<div class="hint">เลือกร้านค้าก่อนเริ่มขาย</div><div style="height:10px"></div><button class="btn pri block" id="pick" type="button">เลือกร้านค้า</button>';
          $('#pick').onclick = function () { go('customers', { pick: true }); };
          return;
        }
        if (party.blocked) { el.innerHTML = '<div class="warn">ร้าน ' + esc(party.name) + ' ถูกระงับการขาย กรุณาติดต่อแอดมิน</div>'; return; }
        if (!cart.started) { cart.started = stamp(); visitIn(party.id, party.name, true); trk('ORDER_START', { cid: party.id }); }
        el.innerHTML = '<div class="sell-pad"><div class="card party"><div class="between"><div><div class="muted small">ร้านค้า</div><div class="b">' + esc(party.name) + '</div>' +
          '<div class="muted small">' + esc(party.id) + (party.unpaid > 0 ? ' · <span class="t-r">ค้างชำระ ' + money(party.unpaid) + '</span>' : '') + '</div></div>' +
          '<button class="btn sm" id="chg" type="button">เปลี่ยน</button></div></div>' +
          '<div class="sticky"><div class="search"><div class="sbox">' + ic('search', 18) + '<input class="input" id="ps" placeholder="พิมพ์รหัส หรือชื่อสินค้า"><button type="button" class="ddbtn" id="psAll" aria-label="ดูสินค้าทั้งหมด">' + ic('down', 18) + '</button></div><div class="drop hidden" id="dd"></div></div></div>' +
          '<div id="groups"></div><div id="lines"></div><div class="card tot" id="tot"></div><div id="foot"></div></div>' +
          '<div class="sellbar"><div class="grow"><div class="muted small" id="sbInfo">0 รายการ</div><div class="sbTot" id="sbTot">฿0.00</div></div>' +
          '<button class="btn pri" id="go" type="button">' + (isVan() ? 'ยืนยันขาย / ออกบิล' : 'ยืนยันออเดอร์') + '</button></div>';
        $('#chg').onclick = function () { go('customers', { pick: true }); };
        var ps = $('#ps'), dd = $('#dd');
        var showAll = false;
        $('#psAll').onclick = function () { showAll = dd.classList.contains('hidden'); ps.oninput(); };
        ps.oninput = debounce(function () {
          var q = ps.value.trim().toLowerCase();
          if (!q && !showAll) { dd.classList.add('hidden'); return; }
          var l = S.cat.filter(function (x) { return !q || (x.ProductCode + ' ' + x.NameTh).toLowerCase().indexOf(q) >= 0; }).slice(0, q ? 30 : 80);
          dd.innerHTML = l.map(function (x) {
            return '<div data-p="' + esc(x.ProductCode) + '"><div class="b small">' + esc(x.ProductCode) + '</div>' + esc(x.NameTh) +
              (stock ? '<div class="muted small">บนรถ ' + esc(qtyText(x.ProductCode, (stock[x.ProductCode] || [0])[0])) + '</div>' : '') + '</div>';
          }).join('') || '<div class="muted">ไม่พบสินค้า</div>';
          dd.classList.remove('hidden');
          $$('[data-p]', dd).forEach(function (d) {
            d.onclick = function () {
              var code = d.getAttribute('data-p');
              if (!cart.items.some(function (i) { return i.code === code; })) cart.items.push({ code: code, base: unitsOf(code)[0].f });
              ps.value = ''; showAll = false; dd.classList.add('hidden'); draw(); price();
            };
          });
        }, 60);
        var draw = function () {
          $('#lines').innerHTML = cart.items.length ? cart.items.map(function (it, idx) {
            var pr = S.catMap[it.code] || {}, us = unitsOf(it.code), parts = splitBase(it.code, it.base);
            var pv = (cart.preview && cart.preview.lines || []).filter(function (l) { return l.ProductCode === it.code; });
            var lineTot = pv.reduce(function (s, l) { return s + num(l.LineTotal); }, 0), disc = pv[0] ? num(pv[0].DiscountValue) : 0;
            var onHand = stock ? (stock[it.code] || [0])[0] : null;
            var big = us[0] || { unit: pr.BaseUnit, f: 1 };
            return '<div class="card item"><div class="between"><div class="muted small">' + esc(it.code) + '</div><button class="rm" data-rm="' + idx + '" type="button" aria-label="ลบ">' + ic('x', 16) + '</button></div>' +
              '<div class="b">' + esc(pr.NameTh) + '</div>' +
              '<div class="muted small">' + (num(pr.PricePerCase) ? '฿' + money(pr.PricePerCase) + ' / ' + esc(pr.CaseUnit || big.unit) + (disc ? ' → สุทธิ ฿' + money(num(pr.PricePerCase) * (1 - disc / 100)) : '') : '') + (disc ? ' (ลด ' + disc + '%)' : '') + '</div>' +
              (onHand !== null ? '<div class="small ' + (it.base > onHand ? 't-r' : 't-g') + '">บนรถตอนนี้ ' + esc(qtyText(it.code, onHand)) + (it.base > onHand ? ' — ไม่พอ' : '') + '</div>' : '') +
              '<div class="ucols">' + us.map(function (u) {
                var q = (parts.filter(function (x) { return x.unit === u.unit; })[0] || { qty: 0 }).qty;
                return '<div class="ucol"><div class="muted small">' + esc(u.unit) + (u.f > 1 ? ' (' + u.f + ')' : '') + '</div>' +
                  '<div class="qty"><button type="button" data-d="' + idx + '|' + u.f + '|-1">−</button><input class="input" inputmode="numeric" value="' + q + '" data-q="' + idx + '|' + esc(u.unit) + '">' +
                  '<button type="button" class="plus" data-d="' + idx + '|' + u.f + '|1">+</button></div></div>';
              }).join('') + '</div>' +
              '<div class="between small" style="margin-top:8px"><span class="muted">รวม ' + esc(qfmt(it.base)) + ' ' + esc(pr.BaseUnit || '') + '</span><span class="b">' + (pv.length ? money(lineTot) : '') + '</span></div></div>';
          }).join('') : '<div class="empty-note">ค้นหาหรือกดปุ่ม ▾ เพื่อเลือกสินค้าลงบิล<br><button class="btn" id="repEmpty" type="button" style="margin-top:10px">' + ic('repeat', 18) + ' สั่งเหมือนครั้งก่อน</button></div>';
          if ($('#repEmpty')) $('#repEmpty').onclick = repeatLast;
          $$('[data-rm]').forEach(function (b) { b.onclick = function () { cart.items.splice(+b.getAttribute('data-rm'), 1); draw(); price(); }; });
          $$('[data-d]').forEach(function (b) {
            b.onclick = function () {
              var a = b.getAttribute('data-d').split('|'), it = cart.items[+a[0]];
              it.base = Math.max(0, it.base + num(a[1]) * num(a[2])); draw(); price();
            };
          });
          $$('[data-q]').forEach(function (inp) {
            inp.onchange = function () {
              inp.onchange = null;   // กันเหตุการณ์ change ซ้ำตอนช่องถูกวาดใหม่
              var a = inp.getAttribute('data-q').split('|'), it = cart.items[+a[0]];
              var parts = splitBase(it.code, it.base), cur = (parts.filter(function (x) { return x.unit === a[1]; })[0] || { qty: 0 }).qty;
              it.base = Math.max(0, it.base + (Math.max(0, Math.floor(num(inp.value))) - cur) * baseOf(it.code, a[1], 1));   // ดีดเป็นหน่วยใหญ่อัตโนมัติ
              setTimeout(function () { draw(); price(); }, 0);
            };
          });
          drawTotals();
        };
        var repeatLast = function () {
          docs({ partyId: party.id, docType: isVan() ? 'INV' : 'SO' }).then(function (l) {
            var last = l.filter(function (d) { return ['CANCELLED', 'REJECTED'].indexOf(d.Status) < 0; })[0];
            if (!last) { toast('ร้านนี้ยังไม่เคยมี' + (isVan() ? 'บิล' : 'ออเดอร์'), true); return; }
            return api('apiDocGet', last.DocId).then(function (g) {
              var add = 0;
              (g.items || []).forEach(function (i) {
                if (String(i.IsFree) === 'TRUE' || !S.catMap[i.ProductCode]) return;
                var it = cart.items.filter(function (x) { return x.code === i.ProductCode; })[0];
                if (!it) { it = { code: i.ProductCode, base: 0 }; cart.items.push(it); }
                it.base += num(i.QtyBase); add++;
              });
              toast(add ? 'ใส่สินค้าตาม ' + last.DocNo + ' แล้ว ' + add + ' รายการ — แก้จำนวนได้' : 'ไม่มีสินค้าที่สั่งซ้ำได้', !add);
              draw(); price();
            });
          }).catch(fail);
        };
        var lines = function () {
          var out = [];
          cart.items.forEach(function (it) { splitBase(it.code, it.base).forEach(function (x) { out.push({ ProductCode: it.code, Unit: x.unit, Qty: x.qty }); }); });
          return out;
        };
        var price = debounce(function () {
          var ls = lines();
          if (!ls.length) { cart.preview = null; draw(); return; }
          api('apiPricePreview', { lines: ls, docDate: today(), channel: party.tierChannel }).then(function (pv) { cart.preview = pv; draw(); }).catch(fail);
        }, 350);
        var drawTotals = function () {
          var pv = cart.preview, sub = 0, disc = 0, net = 0;
          (pv && pv.lines || []).forEach(function (l) { sub += num(l.GrossAmount); disc += num(l.DiscountAmount); net += num(l.LineTotal); });
          var vat = r2(net * vatRate() / 100);
          $('#groups').innerHTML = (pv && pv.groups && pv.groups.length) ? '<div class="tierbox"><div class="muted small">ส่วนลด Tier' + (isVan() ? ' · ตารางแวน' : '') + '</div>' + pv.groups.map(function (g) {
            return '<div class="between"><b>' + esc(g.GroupName) + '</b><b>' + qfmt(g.Cases) + ' หีบ → ' + esc(g.Tier ? g.Tier.DiscountValue : 0) + '%</b></div>' +
              '<div class="muted small">' + (g.NextTier ? 'อีก ' + qfmt(g.CasesToNext) + ' หีบ ได้ ' + esc(g.NextTier.DiscountValue) + '%' : 'ได้ขั้นสูงสุดแล้ว') + '</div>';
          }).join('') + '</div>' : '';
          var nItems = cart.items.filter(function (i) { return i.base > 0; }).length;
          $('#sbInfo').textContent = nItems + ' รายการ' + (disc ? ' · ส่วนลดโปร ' + money(disc) : '');
          $('#sbTot').textContent = '฿' + money(net + vat);
          $('#tot').innerHTML = '<div><span class="muted">รวมราคาสินค้า</span><span>' + money(sub) + '</span></div><div><span class="muted">ส่วนลด</span><span>-' + money(disc) + '</span></div>' +
            '<div><span class="muted">ก่อนภาษีมูลค่าเพิ่ม</span><span>' + money(net) + '</span></div><div><span class="muted">VAT ' + vatRate() + '%</span><span>' + money(vat) + '</span></div>' +
            '<div class="grand"><span>รวมทั้งสิ้น</span><span>' + money(net + vat) + '</span></div>';
        };
        var foot = function () {
          var f = $('#foot');
          if (isVan()) {
            f.innerHTML = '<div class="card"><h3>การชำระเงิน</h3><div class="seg" id="pay">' + [['CASH', 'เงินสด'], ['TRANSFER', 'โอน / QR'], ['CREDIT', 'เครดิต']].map(function (o) {
              return '<button type="button" data-pay="' + o[0] + '" class="' + (cart.pay === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
              '';
            $$('[data-pay]').forEach(function (b) { b.onclick = function () { cart.pay = b.getAttribute('data-pay'); foot(); }; });
          } else {
            var d = new Date(); d.setDate(d.getDate() + 1);
            f.innerHTML = '<div class="card"><label class="f"><span>วันที่ส่งของ</span><input class="input" type="date" id="dd2" value="' + esc(cart.delivery || ymd(d)) + '"></label>' +
              '<label class="f"><span>หมายเหตุ</span><input class="input" id="nt" value="' + esc(cart.note) + '"></label></div>';
            $('#dd2').onchange = function () { cart.delivery = this.value; };
            $('#nt').oninput = function () { cart.note = this.value; };
          }
        };
        $('#go').onclick = function () { submit(); };
        var submit = function () {
          var ls = lines();
          if (!ls.length) { toast('ยังไม่มีสินค้าในบิล', true); return; }
          var net = (cart.preview && cart.preview.lines || []).reduce(function (s, l) { return s + num(l.LineTotal); }, 0);
          var total = money(net * (1 + vatRate() / 100));
          var doc = isVan()
            ? { DocType: 'INV', PartyId: party.id, PaymentType: cart.pay, lines: ls }
            : { DocType: 'SO', PartyId: party.id, DeliveryType: 'COMPANY', DeliveryDate: cart.delivery || $('#dd2').value, Note: cart.note, lines: ls };
          var msg = isVan() ? 'ออกบิลให้ <b>' + esc(party.name) + '</b> ยอด <b>' + total + '</b> บาท' :
            'ส่งออเดอร์ของ <b>' + esc(party.name) + '</b> ยอด <b>' + total + '</b> บาท<br><span style="color:var(--red)">ยืนยันแล้วจะยกเลิกเองไม่ได้ ต้องให้แอดมินยกเลิก</span>';
          confirmBox(isVan() ? 'ยืนยันออกบิล' : 'ยืนยันออเดอร์', msg, 'ยืนยัน').then(function (y) {
            if (!y) return;
            api('apiDocSave', doc, { submit: true }).then(function (res) {
              trk('ORDER_SAVE', { cid: party.id, did: res.DocId }); trkFlush();
              S.cart = null; S.parties = null;
              toast((isVan() ? 'ออกบิล ' : 'ส่งออเดอร์ ') + res.DocNo + ' แล้ว');
              S.stack = [{ name: 'home', params: {} }];
              S.view = isVan() ? { name: 'bill', params: { id: res.DocId, justSold: true } } : { name: 'bill', params: { id: res.DocId } };
              render();
            }).catch(fail);
          });
        };
        draw(); foot();
        if (p.repeat && !cart.items.length) { p.repeat = false; repeatLast(); }
        else if (cart.items.length) price();
      });
    }
  };

  // ---------------------------------------------------------------- bills / orders
  var STAT = { DRAFT: ['ร่าง', ''], PENDING: ['รออนุมัติ', 'a'], APPROVED: ['อนุมัติแล้ว', 'g'], REJECTED: ['ไม่อนุมัติ', 'r'], CANCELLED: ['ยกเลิก', 'r'], RETURNED: ['ส่งกลับแก้ไข', 'a'] };
  var PAY = { UNPAID: ['ยังไม่รับชำระ', 'r'], COLLECTING: ['รอบัญชียืนยันรับชำระ', 'a'], PARTIAL: ['ชำระบางส่วน', 'a'], PAID: ['ชำระแล้ว', 'g'] };
  function chip(map, k) { var x = map[k]; return x ? '<span class="chip ' + x[1] + '">' + x[0] + '</span>' : ''; }
  function docRow(d) {
    return '<div class="it" data-doc="' + esc(d.DocId) + '" style="background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:6px;cursor:pointer;color:var(--ink)">' +
      '<div class="between"><div class="b">' + esc(d.DocNo) + '</div><div class="b">' + money(d.NetTotal) + '</div></div>' +
      '<div class="muted small">' + esc(d.PartyId) + ' ' + esc(d.PartyName) + ' · ' + thDateTime(d.DocDate + (d.DocTime ? ' ' + d.DocTime : '')) + '</div>' +
      '<div class="row" style="gap:6px;margin-top:4px">' + chip(STAT, d.Status) + (d.DocType === 'INV' && d.Status === 'APPROVED' ? chip(PAY, d.PaymentStatus || 'UNPAID') : '') + '</div></div>';
  }
  function bindDocRows() { $$('[data-doc]').forEach(function (b) { b.onclick = function () { go('bill', { id: b.getAttribute('data-doc') }); }; }); }
  VIEWS.bills = {
    shell: true, title: 'บิลวันนี้',
    render: function (el) {
      return docs({ docType: 'INV', dateFrom: today(), dateTo: today() }).then(function (l) {
        var ok = l.filter(function (d) { return d.Status !== 'CANCELLED'; });
        el.innerHTML = '<div class="card between"><div><div class="muted small">' + thDate(today()) + '</div><div class="big">' + money(ok.reduce(function (s, d) { return s + num(d.NetTotal); }, 0)) + '</div></div>' +
          '<div class="r muted">' + ok.length + ' บิล</div></div><div class="list">' + (l.map(docRow).join('') || '<div class="muted c">วันนี้ยังไม่มีบิล</div>') + '</div>';
        bindDocRows();
      });
    }
  };
  VIEWS.orders = {
    shell: true, title: 'ออเดอร์เดือนนี้',
    render: function (el) {
      return docs({ docType: 'SO', dateFrom: monthStart(), dateTo: today() }).then(function (l) {
        el.innerHTML = '<div class="muted small" style="margin-bottom:8px">ดูได้เฉพาะออเดอร์ของเดือนนี้ · ยกเลิกออเดอร์ได้ที่แอดมินเท่านั้น</div><div class="list">' +
          (l.map(docRow).join('') || '<div class="muted c">เดือนนี้ยังไม่มีออเดอร์</div>') + '</div>';
        bindDocRows();
      });
    }
  };
  VIEWS.bill = {
    shell: true, title: 'รายละเอียด',
    render: function (el, p) {
      return api('apiDocGet', p.id).then(function (r) {
        var d = r.doc, items = r.items || [];
        $('#title').textContent = d.DocNo;
        var steps = d.DocType === 'SO'
          ? [['ส่งออเดอร์', true], ['แอดมินอนุมัติ', d.Status === 'APPROVED' || d.FulfillStatus], ['ออกใบกำกับ/ส่งของ', !!(r.children || []).length]]
          : [['ออกบิล', true], ['รับชำระจากร้าน', ['COLLECTING', 'PARTIAL', 'PAID'].indexOf(d.PaymentStatus) >= 0], ['บัญชียืนยันรับชำระ', d.PaymentStatus === 'PAID']];
        el.innerHTML = '<div class="card"><div class="between"><div class="b">' + esc(d.PartyName) + '</div>' + chip(STAT, d.Status) + '</div>' +
          '<div class="muted small">' + esc(d.PartyId) + ' · ' + thDateTime(d.DocDate + (d.DocTime ? ' ' + d.DocTime : '')) + '</div>' +
          (d.DocType === 'INV' ? '<div style="margin-top:6px">' + chip(PAY, d.PaymentStatus || 'UNPAID') + '</div>' : '') +
          (d.Status !== 'CANCELLED' ? '<div class="tl" style="margin-top:10px">' + steps.map(function (s) { return '<div class="' + (s[1] ? 'on' : '') + '">' + s[0] + '</div>'; }).join('') + '</div>' :
            '<div class="warn" style="margin-top:8px">เอกสารนี้ถูกยกเลิก' + (d.Reason ? ': ' + esc(d.Reason) : '') + '</div>') + '</div>' +
          '<div class="card"><table class="t"><tr><th>สินค้า</th><th class="r">จำนวน</th><th class="r">เงิน</th></tr>' + items.map(function (i) {
            return '<tr><td><div class="small b">' + esc(i.ProductCode) + '</div>' + esc(i.ProductName) + '</td><td class="r">' + qfmt(i.Qty) + ' ' + esc(i.Unit) + '</td><td class="r">' + money(i.LineTotal) + '</td></tr>';
          }).join('') + '</table><div class="tot" style="margin-top:8px"><div><span class="muted">ก่อน VAT</span><span>' + money(num(d.AfterDiscount) - (d.VatType === 'IN' ? num(d.VatAmount) : 0)) + '</span></div>' +
          '<div><span class="muted">VAT</span><span>' + money(d.VatAmount) + '</span></div><div class="grand"><span>รวม</span><span>' + money(d.NetTotal) + '</span></div></div></div><div id="acts"></div>';
        var a = '';
        if (isVan() && d.DocType === 'INV' && d.Status === 'APPROVED') {
          var printed = num(d.ReceiptPrints);
          a += '<button class="btn pri block" id="prt" type="button">' + ic('print', 18) + ' ' + (printed ? 'พิมพ์ซ้ำ (สำเนา)' : 'พิมพ์บิล (ต้นฉบับ)') + '</button>' +
            '<p class="muted small c">' + (printed ? 'พิมพ์ไปแล้ว ' + printed + ' ครั้ง · พิมพ์ซ้ำได้ตามจำนวนที่แอดมินกำหนด' : 'ครั้งแรกพิมพ์เป็นต้นฉบับ') + '</p>';
          if (!d.PaymentStatus || d.PaymentStatus === 'UNPAID') a += '<button class="btn grn block" id="col" type="button">รับชำระบิลนี้</button>';
          if (d.PaymentStatus === 'COLLECTING') a += '<div class="ok">รับชำระแล้ว รอบัญชียืนยัน — ไม่ต้องทำอะไรเพิ่ม</div>';
        }
        $('#acts').innerHTML = a;
        if ($('#prt')) $('#prt').onclick = function () { printDoc(d.DocId).then(function () { render(); }); };
        if ($('#col')) $('#col').onclick = function () { go('collect', { invId: d.DocId }); };
        if (p.justSold && $('#prt')) { p.justSold = false; toast('แตะ "พิมพ์บิล" เพื่อพิมพ์ให้ร้าน แล้วรับชำระ'); }
      });
    }
  };

  // ---------------------------------------------------------------- collect (van)
  VIEWS.collectList = {
    shell: true, title: 'รับชำระเงิน',
    render: function (el) {
      return api('apiCollectPending').then(function (l) {
        el.innerHTML = l.length ? l.map(function (d) {
          return '<div class="card"><div class="between"><div><div class="b">' + esc(d.DocNo) + '</div><div class="muted small">' + esc(d.PartyName) + ' · ' + thDate(d.DocDate) + '</div></div>' +
            '<div class="r"><div class="b">' + money(d.NetTotal) + '</div><button class="btn grn" type="button" data-col="' + esc(d.DocId) + '">รับชำระ</button></div></div></div>';
        }).join('') : '<div class="ok">ไม่มีบิลค้างรับชำระ</div>';
        $$('[data-col]').forEach(function (b) { b.onclick = function () { go('collect', { invId: b.getAttribute('data-col') }); }; });
      });
    }
  };
  VIEWS.collect = {
    shell: true, title: 'รับชำระเงิน',
    render: function (el, p) {
      return api('apiDocGet', p.invId).then(function (r) {
        var d = r.doc, net = num(d.NetTotal), st = { kind: d.PaymentType === 'TRANSFER' ? 'QR' : 'CASH', slip: null };
        var draw = function () {
          el.innerHTML = '<div class="card"><div class="muted small">บิล ' + esc(d.DocNo) + '</div><div class="b">' + esc(d.PartyName) + '</div><div class="big">' + money(net) + ' บาท</div></div>' +
            '<div class="card"><h3>รับชำระด้วย</h3><div class="seg">' + [['CASH', 'เงินสด'], ['QR', 'QR / โอน']].map(function (o) {
              return '<button type="button" data-k="' + o[0] + '" class="' + (st.kind === o[0] ? 'on' : '') + '">' + o[1] + '</button>'; }).join('') + '</div>' +
            (st.kind === 'QR' ? '<label class="f" style="margin-top:10px"><span>ชื่อผู้โอน</span><input class="input" id="payer" value="' + esc(d.PartyName) + '"></label>' +
              '<label class="f"><span>เลขอ้างอิงในสลิป</span><input class="input" id="ref"></label><div id="sl"></div>' +
              '<button class="btn block" id="slip" type="button">' + (st.slip ? 'ถ่าย/เลือกสลิปใหม่' : 'แนบสลิปโอนเงิน') + '</button>' : '') + '</div>' +
            '<button class="btn grn block" id="ok" type="button">ยืนยันรับเงิน ' + money(net) + ' บาท</button>' +
            '<p class="muted small c">บัญชีจะตรวจยืนยันที่หลังบ้าน — หลังกดยืนยันไม่ต้องทำอะไรเพิ่ม</p>';
          if (st.slip) $('#sl').innerHTML = '<img class="photo" src="' + st.slip + '" style="margin-bottom:8px">';
          $$('[data-k]').forEach(function (b) { b.onclick = function () { st.kind = b.getAttribute('data-k'); draw(); }; });
          if ($('#slip')) $('#slip').onclick = function () { pickPhoto().then(function (f) { return shrinkImage(f, 1400); }).then(function (u) { st.slip = u; draw(); }); };
          $('#ok').onclick = function () {
            var pay = { Kind: st.kind, Amount: net };
            if (st.kind === 'QR') {
              pay.PayerName = $('#payer').value.trim(); pay.RefNo = $('#ref').value.trim();
              if (!st.slip) { toast('กรุณาแนบสลิปโอนเงิน', true); return; }
            }
            api('apiCollectionSave', { PartyId: d.PartyId, lines: [{ Kind: 'INV', RefDocId: d.DocId, Amount: net }, pay] }, { submit: true }).then(function (cl) {
              if (st.kind === 'QR' && st.slip) return api('apiDocUpload', cl.DocId, 'slip_' + d.DocNo + '.jpg', 'image/jpeg', st.slip.split(',')[1], 'SLIP').then(function () { return cl; });
              return cl;
            }).then(function (cl) {
              toast('รับชำระแล้ว (' + cl.DocNo + ') รอบัญชียืนยัน');
              S.stack = [{ name: 'home', params: {} }]; S.view = { name: 'bill', params: { id: d.DocId } }; render();
            }).catch(fail);
          };
        };
        draw();
      });
    }
  };

  // ---------------------------------------------------------------- van stock / load / return / day summary
  VIEWS.stock = {
    shell: true, title: 'สต็อกบนรถ',
    render: function (el) {
      return Promise.all([loadCatalog(), api('apiStockOnHand', S.boot.user.VanWarehouseId)]).then(function (r) {
        var q = r[1].qty || {};
        var rows = S.cat.filter(function (p) { return q[p.ProductCode] && q[p.ProductCode][0] > 0; });
        var tot = rows.reduce(function (s0, p) { return s0 + (num(q[p.ProductCode][0]) / (unitsOf(p.ProductCode)[0] || { f: 1 }).f); }, 0);
        el.innerHTML = '<div class="stack"><div class="hero sm"><div class="lbl">' + esc(S.boot.user.VanName || 'รถแวน') + ' · ' + thDate(today()) + '</div>' +
          '<div class="amt">' + rows.length + ' รายการ</div><div class="lbl">รวมประมาณ ' + Math.floor(tot) + ' หีบ</div></div>' +
          '<div class="quick"><button class="qk" id="ld" type="button"><b>ขอโหลดสินค้า</b><span>เติมของขึ้นรถ</span></button><button class="qk" id="rt" type="button"><b>ขอคืนสินค้า</b><span>คืนเข้าคลัง</span></button></div>' +
          '<div class="sticky"><div class="sbox">' + ic('search', 18) + '<input class="input" id="sq" placeholder="ค้นหาสินค้าบนรถ"></div></div><div class="rows" id="sl"></div>' +
          '<button class="btn block" id="pr" type="button">' + ic('print', 18) + ' พิมพ์ใบสต็อกคงเหลือ</button></div>';
        var drawS = function () {
          var k = $('#sq').value.trim().toLowerCase();
          var l = rows.filter(function (p) { return !k || (p.ProductCode + ' ' + p.NameTh).toLowerCase().indexOf(k) >= 0; });
          $('#sl').innerHTML = l.length ? l.map(function (p) {
            return '<div class="li"><div class="grow"><b class="small">' + esc(p.NameTh) + '</b><div class="muted small">' + esc(p.ProductCode) + '</div></div>' +
              '<div class="qtag">' + esc(qtyText(p.ProductCode, q[p.ProductCode][0])) + '</div></div>';
          }).join('') : '<div class="empty-note">' + (rows.length ? 'ไม่พบสินค้า' : 'ไม่มีสินค้าบนรถ') + '</div>';
        };
        $('#sq').oninput = debounce(drawS, 120); drawS();
        $('#ld').onclick = function () { go('loadReq'); };
        $('#rt').onclick = function () { go('returnReq'); };
        $('#pr').onclick = function () {
          printHtml(slipHtml('สต็อกคงเหลือบนหน่วยรถ', ['สินค้า', 'คงเหลือ'], rows.map(function (p) {
            return [esc(p.ProductCode) + ' ' + esc(p.NameTh), esc(qtyText(p.ProductCode, q[p.ProductCode][0]))];
          })), 'stock_' + today());
        };
      });
    }
  };
  function loadView(kind) {
    return {
      shell: true, title: kind === 'VL' ? 'ขอโหลดสินค้าขึ้นรถ' : 'ขอคืนสินค้าจากรถ',
      render: function (el) {
        var items = [];
        return loadCatalog().then(function () {
          el.innerHTML = '<div class="hint">' + (kind === 'VL' ? 'เลือกสินค้าและจำนวนที่ต้องการโหลดขึ้นรถ ส่งให้แอดมินอนุมัติ' : 'เลือกสินค้าที่จะคืนเข้าคลัง ส่งให้แอดมินอนุมัติ') + '</div>' +
            '<div class="search" style="margin:10px 0"><input class="input" id="ps" placeholder="ค้นหารหัส หรือชื่อสินค้า"><div class="drop hidden" id="dd"></div></div><div id="ls"></div>' +
            '<button class="btn pri block" id="go" type="button">ส่งคำขอ</button>';
          var draw = function () {
            $('#ls').innerHTML = items.map(function (it, i) {
              var pr = S.catMap[it.code];
              return '<div class="card"><div class="between"><div><div class="small b">' + esc(it.code) + '</div>' + esc(pr.NameTh) + '</div><button class="btn" data-rm="' + i + '" type="button">ลบ</button></div>' +
                unitsOf(it.code).map(function (u) {
                  return '<div class="between line"><span>' + esc(u.unit) + '</span><input class="input" style="width:90px;text-align:center" inputmode="numeric" data-u="' + i + '|' + esc(u.unit) + '" value="' + (it.q[u.unit] || '') + '"></div>';
                }).join('') + '</div>';
            }).join('');
            $$('[data-rm]').forEach(function (b) { b.onclick = function () { items.splice(+b.getAttribute('data-rm'), 1); draw(); }; });
            $$('[data-u]').forEach(function (inp) { inp.oninput = function () { var a = inp.getAttribute('data-u').split('|'); items[+a[0]].q[a[1]] = Math.max(0, Math.floor(num(inp.value))); }; });
          };
          $('#ps').oninput = debounce(function () {
            var q = $('#ps').value.trim().toLowerCase(), dd = $('#dd');
            if (!q) { dd.classList.add('hidden'); return; }
            dd.innerHTML = S.cat.filter(function (x) { return (x.ProductCode + ' ' + x.NameTh).toLowerCase().indexOf(q) >= 0; }).slice(0, 30)
              .map(function (x) { return '<div data-p="' + esc(x.ProductCode) + '"><b class="small">' + esc(x.ProductCode) + '</b> ' + esc(x.NameTh) + '</div>'; }).join('');
            dd.classList.remove('hidden');
            $$('[data-p]', dd).forEach(function (d) { d.onclick = function () { var c = d.getAttribute('data-p'); if (!items.some(function (i) { return i.code === c; })) items.push({ code: c, q: {} }); $('#ps').value = ''; dd.classList.add('hidden'); draw(); }; });
          }, 120);
          $('#go').onclick = function () {
            var ls = [];
            items.forEach(function (it) { Object.keys(it.q).forEach(function (u) { if (it.q[u] > 0) ls.push({ ProductCode: it.code, Unit: u, Qty: it.q[u] }); }); });
            if (!ls.length) { toast('ยังไม่ได้ใส่จำนวนสินค้า', true); return; }
            var wh = S.boot.user.VanWarehouseId;
            var doc = kind === 'VL' ? { DocType: 'VL', ToWarehouseId: wh, Reason: 'LOAD', lines: ls } : { DocType: 'VU', WarehouseId: wh, Reason: 'RETURN', lines: ls };
            api('apiDocSave', doc, { submit: true }).then(function (r) {
              toast('ส่งคำขอ ' + r.DocNo + ' แล้ว รอแอดมินอนุมัติ');
              printHtml(slipHtml(kind === 'VL' ? 'ใบขอโหลดสินค้า' : 'ใบขอคืนสินค้า', ['สินค้า', 'จำนวน'], ls.map(function (l) {
                return [esc(l.ProductCode) + ' ' + esc(S.catMap[l.ProductCode].NameTh), l.Qty + ' ' + esc(l.Unit)];
              }), r.DocNo), r.DocNo, true);
              back();
            }).catch(fail);
          };
          draw();
        });
      }
    };
  }
  VIEWS.loadReq = loadView('VL');
  VIEWS.returnReq = loadView('VU');
  VIEWS.daySummary = {
    shell: true, title: 'สรุปยอดขายวันนี้',
    render: function (el) {
      return docs({ docType: 'INV', dateFrom: today(), dateTo: today() }).then(function (l) {
        l = l.filter(function (d) { return d.Status !== 'CANCELLED'; });
        var by = { CASH: 0, TRANSFER: 0, CREDIT: 0 }, tot = 0;
        l.forEach(function (d) { tot += num(d.NetTotal); by[d.PaymentType || 'CASH'] = (by[d.PaymentType || 'CASH'] || 0) + num(d.NetTotal); });
        el.innerHTML = '<div class="card tot"><div class="grand"><span>รวมทั้งวัน (' + l.length + ' บิล)</span><span>' + money(tot) + '</span></div>' +
          '<div><span class="muted">เงินสด</span><span>' + money(by.CASH) + '</span></div><div><span class="muted">โอน / QR</span><span>' + money(by.TRANSFER) + '</span></div>' +
          '<div><span class="muted">เครดิต</span><span>' + money(by.CREDIT) + '</span></div></div>' +
          '<div class="card"><table class="t"><tr><th>เลขที่ / ร้าน</th><th class="r">ยอด</th></tr>' + l.map(function (d) {
            return '<tr><td><b>' + esc(d.DocNo) + '</b><br><span class="small">' + esc(d.PartyId) + ' ' + esc(d.PartyName) + '</span></td><td class="r">' + money(d.NetTotal) + '</td></tr>';
          }).join('') + '</table></div><button class="btn pri block" id="pr" type="button">' + ic('print', 18) + ' พิมพ์สรุปยอดขาย</button>';
        $('#pr').onclick = function () {
          printHtml(slipHtml('สรุปยอดขายประจำวัน', ['เลขที่ / รหัสร้าน', 'ยอด'], l.map(function (d) { return [esc(d.DocNo) + '<br>' + esc(d.PartyId) + ' ' + esc(d.PartyName), money(d.NetTotal)]; })
            .concat([['<b>รวม ' + l.length + ' บิล</b>', '<b>' + money(tot) + '</b>'], ['เงินสด', money(by.CASH)], ['โอน / QR', money(by.TRANSFER)], ['เครดิต', money(by.CREDIT)]])), 'day_' + today());
        };
      });
    }
  };

  // ---------------------------------------------------------------- printing (RawBT / ระบบพิมพ์ของมือถือ)
  function slipHtml(title, head, rows, docNo) {
    var s = S.boot.settings || {}, w = num(s.RECEIPT_WIDTH_MM) === 58 ? 58 : 80;
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:' + w + 'mm auto;margin:2mm}body{width:' + (w - 6) + 'mm;margin:0 auto;font-family:Tahoma,"Noto Sans Thai",sans-serif;font-size:' + (w === 58 ? 10 : 12) + 'px;color:#000;line-height:1.4}' +
      '.c{text-align:center}.b{font-weight:bold}.hr{border-top:1px dashed #000;margin:4px 0}table{width:100%;border-collapse:collapse}td,th{padding:2px 0;vertical-align:top;text-align:left}.r{text-align:right}</style></head><body>' +
      '<div class="c b">' + esc(s.COMPANY_NAME || '') + '</div><div class="hr"></div><div class="c b">' + esc(title) + '</div>' +
      (docNo ? '<div class="c">เลขที่ ' + esc(docNo) + '</div>' : '') + '<div class="c">' + esc(S.boot.user.VanName || '') + ' · ' + esc(S.boot.user.FullName) + '</div>' +
      '<div class="c">วันที่ ' + thDate(today()) + ' ' + new Date().toTimeString().substring(0, 5) + '</div><div class="hr"></div>' +
      '<table><tr>' + head.map(function (h, i) { return '<th class="' + (i ? 'r' : '') + '">' + esc(h) + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td class="' + (i ? 'r' : '') + '">' + c + '</td>'; }).join('') + '</tr>'; }).join('') +
      '</table><div class="hr"></div><div style="margin-top:22px">ลงชื่อ ........................................</div><div class="c">(พนักงานขาย)</div></body></html>';
  }
  function printDoc(docId) {
    return api('apiDocPrintHtml', docId, 'RECEIPT').then(function (html) { return printHtml(html, 'receipt_' + docId); }).catch(fail);
  }
  /** แปลงหน้า HTML เป็นรูป (สำหรับแชร์ไป RawBT) — ใช้ SVG foreignObject ไม่ต้องพึ่งไลบรารี */
  function htmlToPng(html) {
    // เครื่องพิมพ์ความร้อน 8 จุด/มม.: 58 มม. = 384 จุด, 80 มม. = 576 จุด
    // จัดหน้าที่ครึ่งความกว้าง แล้วขยาย 2 เท่า → ตัวอักษรใหญ่พออ่านบนกระดาษ
    var W = num((S.boot.settings || {}).RECEIPT_WIDTH_MM) === 58 ? 384 : 576, K = 2, w = W / K;
    return new Promise(function (res, rej) {
      var fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-10000px;top:0;width:' + w + 'px;height:100px;border:0';
      document.body.appendChild(fr);
      fr.onload = function () {
        try {
          var d = fr.contentDocument;
          var style = (d.querySelector('style') || { textContent: '' }).textContent.replace(/@page\{[^}]*\}/, '').replace(/body\{width:[^;]+;/, 'body{width:' + (w - 8) + 'px;padding:4px;')
            .replace(/font-size:\d+px/, 'font-size:' + (W === 384 ? 11 : 12) + 'px');
          d.querySelector('style') && (d.querySelector('style').textContent = style);
          var h = Math.ceil(d.documentElement.scrollHeight) + 16;
          var body = new XMLSerializer().serializeToString(d.body).replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + (h * K) + '" viewBox="0 0 ' + w + ' ' + h + '"><foreignObject width="' + w + '" height="' + h + '">' +
            '<div xmlns="http://www.w3.org/1999/xhtml" style="background:#fff;width:' + w + 'px"><style>' + style.replace(/body\{/g, '.bd{') + '</style><div class="bd">' + body + '</div></div></foreignObject></svg>';
          var img = new Image();
          img.onload = function () {
            var c = document.createElement('canvas'); c.width = W; c.height = h * K;
            var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
            fr.remove();
            c.toBlob(function (b) { b ? res(b) : rej(new Error('สร้างรูปไม่สำเร็จ')); }, 'image/png');
          };
          img.onerror = function () { fr.remove(); rej(new Error('สร้างรูปไม่สำเร็จ')); };
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        } catch (e) { fr.remove(); rej(e); }
      };
      fr.srcdoc = html;
    });
  }
  function printHtml(html, name, silentClose) {
    return new Promise(function (resolve) {
      modal('<h3>พิมพ์</h3><iframe class="rcpt" id="pv"></iframe><div style="height:10px"></div>' +
        '<button class="btn pri block" id="raw" type="button">' + ic('print', 18) + ' พิมพ์ผ่าน RawBT (เครื่องพิมพ์บลูทูธ)</button><div style="height:8px"></div>' +
        '<div class="btns"><button class="btn" id="sys" type="button">พิมพ์ด้วยมือถือ</button><button class="btn" data-close type="button">ปิด</button></div>',
        function (bg, close) {
          $('#pv', bg).srcdoc = html;
          $('#sys', bg).onclick = function () { var w = $('#pv', bg).contentWindow; w.focus(); w.print(); };
          $('#raw', bg).onclick = function () {
            htmlToPng(html).then(function (blob) {
              var file = new File([blob], (name || 'print') + '.png', { type: 'image/png' });
              if (navigator.canShare && navigator.canShare({ files: [file] })) return navigator.share({ files: [file], title: name || 'print' });
              var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();   // เครื่องที่แชร์ไฟล์ไม่ได้ → บันทึกรูปไว้พิมพ์
              toast('บันทึกรูปไว้แล้ว เปิดด้วย RawBT เพื่อพิมพ์');
            }).catch(function (e) { if (e && e.name !== 'AbortError') toast(e.message || 'พิมพ์ไม่สำเร็จ', true); });
          };
          $$('[data-close]', bg).forEach(function (b) { b.addEventListener('click', function () { resolve(); }); });
          if (silentClose) bg.addEventListener('click', function (e) { if (e.target === bg) resolve(); });
        });
    });
  }

  // ---------------------------------------------------------------- ติดตามการทำงาน (GPS / สถานะแอป / เยี่ยมร้าน / เวลาคีย์ออเดอร์)
  // ส่งให้หลังบ้านเป็นชุดแบบเงียบ ๆ (ไม่ขึ้นตัวหมุน/ข้อความ) · ส่งไม่ได้จะเก็บคิวไว้ส่งรอบถัดไป
  var TRK = { q: [], timer: null, pos: null, bat: '', intervalMin: 2, enabled: true, busy: false, watch: null };
  try { TRK.q = JSON.parse(LS.get('trkq') || '[]'); } catch (e) { TRK.q = []; }
  function stamp() { var d = new Date(); return ymd(d) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
  function trkSave() { LS.set('trkq', JSON.stringify(TRK.q.slice(-300))); }
  function trk(ev, extra) {
    if (!S.token || !TRK.enabled) return;
    var e = { ev: ev, ts: stamp(), bat: TRK.bat };
    if (TRK.pos) { e.lat = TRK.pos.lat; e.lng = TRK.pos.lng; e.acc = TRK.pos.acc; }
    Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
    TRK.q.push(e);
    if (TRK.q.length > 300) TRK.q.shift();
    trkSave();
  }
  function trkFlush(keepalive) {
    if (!S.token || !S.url || !TRK.q.length || (TRK.busy && !keepalive)) return;
    var batch = TRK.q.slice(0, 60);
    TRK.busy = true;
    fetch(S.url, { method: 'POST', redirect: 'follow', keepalive: !!keepalive, headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                   body: JSON.stringify({ fn: 'apiTrack', args: [S.token, batch] }) })
      .then(function (r) { return r.json(); }).then(function (j) {
        TRK.busy = false;
        if (!j || !j.ok) { if (j && j.code === 'ERR_SESSION_EXPIRED') { TRK.q = []; trkSave(); } return; }
        TRK.q = TRK.q.slice(batch.length); trkSave();
        if (j.data) { TRK.enabled = j.data.enabled !== false; if (j.data.intervalMin && j.data.intervalMin !== TRK.intervalMin) { TRK.intervalMin = j.data.intervalMin; trkTimer(); } }
      }).catch(function () { TRK.busy = false; });
  }
  function trkTimer() {
    if (TRK.timer) clearInterval(TRK.timer);
    TRK.timer = setInterval(function () {
      if (!S.token) return;
      if (document.visibilityState === 'visible') trk('PING');
      trkFlush();
    }, Math.max(TRK.intervalMin, 1) * 60000);
  }
  function trkStart() {
    if (navigator.geolocation && TRK.watch === null) {
      TRK.watch = navigator.geolocation.watchPosition(function (p) {
        TRK.pos = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy || 0) };
      }, function () { }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 });
    }
    if (navigator.getBattery) navigator.getBattery().then(function (b) {
      var upd = function () { TRK.bat = Math.round(b.level * 100); };
      upd(); b.addEventListener('levelchange', upd);
    }).catch(function () { });
    trk('OPEN');
    setTimeout(function () { trk('PING'); trkFlush(); }, 8000);     // รอ GPS จับตำแหน่งได้ก่อน
    trkTimer();
  }
  document.addEventListener('visibilitychange', function () {
    if (!S.token) return;
    trk(document.visibilityState === 'visible' ? 'SHOW' : 'HIDE');
    trkFlush(document.visibilityState !== 'visible');
  });
  window.addEventListener('pagehide', function () { if (S.token) { trk('CLOSE'); trkFlush(true); } });

  // เยี่ยมร้าน (เช็คอิน/เช็คเอาท์) — จำไว้ในเครื่อง เปิดแอปใหม่ก็ยังอยู่
  function curVisit() { try { return JSON.parse(LS.get('visit') || 'null'); } catch (e) { return null; } }
  function visitIn(cid, name, auto) {
    var v = curVisit();
    if (v && v.cid === cid) return v;
    if (v) trk('VISIT_OUT', { cid: v.cid, note: 'auto' });
    v = { cid: cid, name: name || cid, at: stamp() };
    LS.set('visit', JSON.stringify(v));
    trk('VISIT_IN', { cid: cid, note: auto ? 'auto' : '' });
    trkFlush();
    return v;
  }
  function visitOut() {
    var v = curVisit();
    if (!v) return;
    trk('VISIT_OUT', { cid: v.cid });
    LS.del('visit');
    trkFlush();
  }
  function visitMin(v) {
    var m = String(v.at).match(/(\d+)-(\d+)-(\d+) (\d+):(\d+)/);
    if (!m) return 0;
    return Math.max(Math.round((Date.now() - new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime()) / 60000), 0);
  }

  // ---------------------------------------------------------------- start / logout
  function logout(expired) {
    if (S.token && !expired) { visitOut(); trk('CLOSE'); trkFlush(true); api('apiLogout').catch(function () { }); }
    S.token = ''; S.boot = null; S.cat = null; S.parties = null; S.cart = null; S.stack = [];
    LS.del('token');
    if (expired) toast(ERR.ERR_SESSION_EXPIRED, true);
    S.view = { name: 'login', params: {} }; render();
  }
  function start() {
    S.stack = []; S.view = { name: 'home', params: {} };
    render();
    loadCatalog().catch(function () { });
    trkStart();
  }
  function boot() {
    $('#back').onclick = back;
    $('#menuBtn').onclick = function () { if (S.view.name !== 'more') go('more'); };
    applyBrand();
    var bl = brands();
    S.url = LS.get('url') || window.DMS_URL || '';
    if (window.DMS_URL && !LS.get('url')) S.url = window.DMS_URL;
    // ลิงก์ที่จำไว้ต้องเป็นแบรนด์ที่ยังอยู่ในรายชื่อ
    if (bl.length && !bl.some(function (b) { return b.url === S.url; })) { S.url = bl[0].url; LS.set('url', S.url); }
    if (!S.url) { S.view = { name: 'setup', params: {} }; render(); return; }
    // แอปขอ PIN ทุกครั้งที่เปิด (ไม่จำการเข้าระบบ)
    LS.del('token');
    applyBrand();
    S.view = { name: 'login', params: {} }; render();
    loadBrand().then(function () { if (S.view && S.view.name === 'login' && !$$('.dots span.on').length) render(); });
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { });
  }
  window.SalesApp = { S: S, go: go, api: api, htmlToPng: htmlToPng };   // สำหรับทดสอบ
  boot();
})();
