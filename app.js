(function () {
  'use strict';
  const { num, fmt, fmtDate, lineValue, calc, itemPdv, buildDoc } = window.PonudaPDF;

  // Lokalno ostaju samo nedovršena ponuda i kopija postavki (za rad bez interneta), obje vezane uz korisnika.
  // Ključevi legacy* su iz verzije bez baze i služe samo za jednokratni prijenos u bazu.
  const KEY = {
    settingsCache: 'bp_settings_cache', draft: 'bp_draft_v2',
    legacySettings: 'bp_settings', legacyHistory: 'bp_history', legacyCustomers: 'bp_customers', legacyCounter: 'bp_counter',
  };
  const JEDINICE = ['M2', 'M3', 'M1', 'KOM', 'SAT', 'PAU', 'KG', 'L'];
  const PDV_STOPE = [25, 13, 5, 0];

  const DEFAULT_SETTINGS = {
    firma: '',
    adresa: '',
    oib: '',
    dodatno: '',
    odgovornaOsoba: '',
    srednjiDio: '010',
    valjanostDana: 5,
    uPdv: false,
    stopaPdv: 25,
    predlozak: 'klasicni',
    boja: '#f7941d',
    porezNapomena: 'Roba - PDV se ne obračunava i ne plaća',
    napomenaDno: 'Ova ponuda važeća je bez pečata i potpisa.',
    pdvNapomena: 'Obveznik nije u sustavu PDV-a, PDV nije obračunat temeljem čl.90., st.1 i st.2 Zakona o PDV-u (NN 73/13)',
    logo: null,
  };

  // --- spremanje u preglednik ---
  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // --- baza (Supabase) ---
  const cfg = window.APP_CONFIG || {};
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
  let user = null;

  async function q(request) {
    const { data, error } = await request;
    if (error) throw error;
    return data;
  }
  const nowIso = () => new Date().toISOString();

  const db = {
    async loadSettings() {
      const rows = await q(sb.from('settings').select('data').limit(1));
      return rows.length ? rows[0].data : null;
    },
    saveSettings: (data) => q(sb.from('settings').upsert({ user_id: user.id, data, updated_at: nowIso() })),
    async peekCounter(year) {
      const rows = await q(sb.from('counters').select('next').eq('year', year));
      return rows.length ? rows[0].next : 1;
    },
    setCounter: (year, next) => q(sb.from('counters').upsert({ user_id: user.id, year, next })),
    takeCounter: (year) => q(sb.rpc('next_broj', { p_year: year })),
    async listCustomers() {
      const rows = await q(sb.from('customers').select('data').order('updated_at', { ascending: false }));
      return rows.map((r) => r.data);
    },
    saveCustomer: (k) => q(sb.from('customers').upsert(
      { user_id: user.id, naziv: k.naziv.trim(), data: k, updated_at: nowIso() }, { onConflict: 'user_id,naziv' })),
    listQuotes: () => q(sb.from('quotes').select('broj,datum,kupac,iznos,data').order('created_at', { ascending: false }).limit(500)),
    saveQuote: (d) => q(sb.from('quotes').upsert({
      user_id: user.id, broj: d.broj, datum: d.datum || null, kupac: (d.kupac.naziv || '').split('\n')[0],
      iznos: calc(d.stavke, settings).zaPlatiti, data: d, updated_at: nowIso(),
    }, { onConflict: 'user_id,broj' })),
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let customers = [];
  const counterCache = {};
  let draft = null;
  let lastPdf = null; // { blob, name }

  const $ = (id) => document.getElementById(id);

  // --- datumi i brojevi ---
  function today() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + Number(n || 0));
    return d.toISOString().slice(0, 10);
  }
  function yy(iso) { return (iso || today()).slice(2, 4); }
  function formatBroj(year, n) { return `${year}-${settings.srednjiDio}-${String(n).padStart(6, '0')}`; }

  async function refreshCounter(year) {
    try { counterCache[year] = await db.peekCounter(year); } catch (e) { /* bez interneta: ostaje stara vrijednost */ }
    renderHeader();
  }

  // pdv '' = zadana stopa iz postavki
  function emptyItem() { return { naziv: '', opis: '', kolicina: '', jedinica: 'M2', cijena: '', pdv: '' }; }
  function newDraft() {
    const datum = today();
    return {
      broj: null,
      kupac: { naziv: '', adresa: '', posta: '', mjesto: '', oib: '' },
      datum,
      valjanost: addDays(datum, settings.valjanostDana),
      rokIsporuke: '',
      odgovornaOsoba: settings.odgovornaOsoba,
      stavke: [emptyItem()],
      napomena: '',
    };
  }

  function persistDraft() { if (user) save(KEY.draft, { userId: user.id, data: draft }); }

  // --- forma ---
  const simpleFields = {
    k_naziv: ['kupac', 'naziv'], k_adresa: ['kupac', 'adresa'], k_posta: ['kupac', 'posta'],
    k_mjesto: ['kupac', 'mjesto'], k_oib: ['kupac', 'oib'],
    datum: [null, 'datum'], valjanost: [null, 'valjanost'], rokIsporuke: [null, 'rokIsporuke'],
    odgovornaOsoba: [null, 'odgovornaOsoba'], napomena: [null, 'napomena'],
  };

  function fillForm() {
    for (const [id, [group, key]] of Object.entries(simpleFields)) {
      $(id).value = (group ? draft[group][key] : draft[key]) || '';
    }
    renderItems();
    renderHeader();
    renderCustomers();
  }

  function renderHeader() {
    if (!draft) return;
    $('formTitle').textContent = draft.broj ? 'Uređivanje ponude' : 'Nova ponuda';
    const year = yy(draft.datum);
    $('brojLabel').textContent = draft.broj ? `br. ${draft.broj}`
      : counterCache[year] ? `br. ${formatBroj(year, counterCache[year])}` : '';
  }

  function renderTotal() {
    $('totalLabel').textContent = settings.uPdv ? 'Ukupno s PDV-om' : 'Ukupno';
    $('total').textContent = fmt(calc(draft.stavke, settings).zaPlatiti) + ' €';
  }

  function renderItems() {
    const box = $('items');
    box.innerHTML = '';
    draft.stavke.forEach((it, i) => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="item-head"><span class="num">Stavka ${i + 1}</span><button class="del" aria-label="Obriši stavku">✕</button></div>
        <input class="i-naziv" placeholder="Naziv, npr. Farbanje zidova u bijelo">
        <textarea class="i-opis" rows="1" placeholder="Dodatni opis (neobavezno, svaki red posebno)"></textarea>
        <div class="row3">
          <label>Količina<input class="i-kol" inputmode="decimal" placeholder="0"></label>
          <label>Jed. mjera<select class="i-jed">${JEDINICE.map((j) => `<option>${j}</option>`).join('')}</select></label>
          <label>${settings.uPdv ? 'Cijena bez PDV' : 'Cijena €'}<input class="i-cij" inputmode="decimal" placeholder="0,00"></label>
        </div>
        <div class="item-foot">
          ${settings.uPdv ? `<label class="pdv">PDV<select class="i-pdv">${PDV_STOPE.map((p) => `<option value="${p}">${p} %</option>`).join('')}</select></label>` : '<span></span>'}
          <div class="item-val"></div>
        </div>`;
      const q = (sel) => el.querySelector(sel);
      const bind = (sel, key) => q(sel).addEventListener('input', (e) => {
        it[key] = e.target.value;
        showVal(); renderTotal(); persistDraft();
      });
      const showVal = () => {
        q('.item-val').textContent = '= ' + fmt(lineValue(it)) + ' €' + (settings.uPdv ? ' + PDV' : '');
      };
      if (it.jedinica && !JEDINICE.includes(it.jedinica)) q('.i-jed').append(new Option(it.jedinica));
      q('.i-naziv').value = it.naziv || '';
      q('.i-opis').value = it.opis || '';
      q('.i-kol').value = it.kolicina || '';
      q('.i-jed').value = it.jedinica || 'M2';
      q('.i-cij').value = it.cijena || '';
      if (settings.uPdv) {
        const stopa = itemPdv(it, settings);
        if (!PDV_STOPE.includes(stopa)) q('.i-pdv').append(new Option(stopa + ' %', stopa));
        q('.i-pdv').value = String(stopa);
        bind('.i-pdv', 'pdv');
      }
      showVal();
      bind('.i-naziv', 'naziv'); bind('.i-opis', 'opis'); bind('.i-kol', 'kolicina'); bind('.i-jed', 'jedinica'); bind('.i-cij', 'cijena');
      q('.del').addEventListener('click', () => {
        if ((it.naziv || it.cijena) && !confirm('Obrisati stavku ' + (i + 1) + '?')) return;
        draft.stavke.splice(i, 1);
        if (!draft.stavke.length) draft.stavke.push(emptyItem());
        renderItems(); persistDraft();
      });
      box.append(el);
    });
    renderTotal();
  }

  function renderCustomers() {
    const sel = $('savedCustomers');
    sel.hidden = !customers.length;
    sel.innerHTML = '<option value="">📇 Odaberi spremljenog kupca…</option>' +
      customers.map((c, i) => `<option value="${i}"></option>`).join('');
    customers.forEach((c, i) => { sel.options[i + 1].textContent = c.naziv.split('\n')[0]; });
    sel.style.marginBottom = '10px';
  }

  function bindForm() {
    for (const [id, [group, key]] of Object.entries(simpleFields)) {
      $(id).addEventListener('input', (e) => {
        if (group) draft[group][key] = e.target.value; else draft[key] = e.target.value;
        if (id === 'datum' && e.target.value) {
          draft.valjanost = addDays(e.target.value, settings.valjanostDana);
          $('valjanost').value = draft.valjanost;
          renderHeader();
          if (!counterCache[yy(draft.datum)]) refreshCounter(yy(draft.datum));
        }
        persistDraft();
      });
    }
    $('savedCustomers').addEventListener('change', (e) => {
      const c = customers[e.target.value];
      if (c) { draft.kupac = Object.assign({}, c); fillForm(); persistDraft(); }
      e.target.value = '';
    });
    $('btnAdd').addEventListener('click', () => {
      draft.stavke.push(emptyItem());
      renderItems(); persistDraft();
      const all = document.querySelectorAll('.i-naziv');
      all[all.length - 1].focus();
    });
    $('btnNew').addEventListener('click', () => {
      if (!confirm('Započeti novu, praznu ponudu? (Trenutna je spremljena ako je već generirana.)')) return;
      draft = newDraft(); persistDraft(); fillForm(); window.scrollTo(0, 0);
    });
    $('btnGenerate').addEventListener('click', generate);
  }

  // --- generiranje ---
  async function rememberCustomer(k) {
    if (!String(k.naziv || '').trim()) return;
    const copy = Object.assign({}, k);
    await db.saveCustomer(copy);
    customers = [copy, ...customers.filter((c) => c.naziv.trim() !== copy.naziv.trim())];
  }

  function makePdf(d) {
    return new Promise((resolve, reject) => {
      try {
        pdfMake.createPdf(buildDoc(d, settings, settings.logo)).getBlob(resolve);
      } catch (e) { reject(e); }
    });
  }

  async function generate() {
    if (!String(settings.firma || '').trim()) {
      toast('Prvo upiši podatke svoje firme');
      openSettings(true);
      return;
    }
    const filled = draft.stavke.filter((it) => String(it.naziv || '').trim());
    if (!filled.length) { toast('Upiši barem jednu stavku'); return; }
    const missingPrice = filled.find((it) => !num(it.kolicina) || !num(it.cijena));
    if (missingPrice && !confirm(`Stavka "${missingPrice.naziv}" nema količinu ili cijenu. Svejedno generirati?`)) return;

    const btn = $('btnGenerate');
    btn.disabled = true; btn.textContent = 'Generiram…';
    try {
      if (!draft.broj) {
        const year = yy(draft.datum);
        try {
          draft.broj = formatBroj(year, await db.takeCounter(year));
        } catch (e) {
          alert('Za novu ponudu potreban je internet (broj ponude dolazi iz baze). Provjeri vezu i pokušaj ponovno.');
          return;
        }
        counterCache[year] = null;
        refreshCounter(year);
      }
      persistDraft();
      const blob = await makePdf(draft);
      lastPdf = { blob, name: `PONUDA_${draft.broj}.pdf` };
      renderHeader();
      downloadPdf();
      $('doneTitle').textContent = `Ponuda ${draft.broj} je spremna`;
      $('btnShare').hidden = !canShare();
      $('dlgDone').showModal();
      try {
        await db.saveQuote(JSON.parse(JSON.stringify(draft)));
        await rememberCustomer(draft.kupac);
        renderCustomers();
      } catch (e) {
        console.error(e);
        toast('PDF je spremljen, ali ponuda nije spremljena u bazu (nema interneta?)');
      }
    } catch (e) {
      console.error(e);
      alert('Greška pri izradi PDF-a: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Generiraj ponudu';
    }
  }

  function pdfFile() { return new File([lastPdf.blob], lastPdf.name, { type: 'application/pdf' }); }
  function canShare() {
    try { return !!(navigator.canShare && navigator.canShare({ files: [pdfFile()] })); } catch (e) { return false; }
  }
  function downloadPdf() {
    const url = URL.createObjectURL(lastPdf.blob);
    const a = document.createElement('a');
    a.href = url; a.download = lastPdf.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function sharePdf() {
    try { await navigator.share({ files: [pdfFile()], title: lastPdf.name }); }
    catch (e) { if (e.name !== 'AbortError') toast('Dijeljenje nije uspjelo'); }
  }
  function openPdf() { window.open(URL.createObjectURL(lastPdf.blob), '_blank'); }

  // --- spremljene ponude ---
  async function renderHistory() {
    const box = $('historyList');
    box.innerHTML = '<p class="muted">Učitavam…</p>';
    let list;
    try { list = await db.listQuotes(); } catch (e) {
      box.innerHTML = '<p class="muted">Ponude se ne mogu učitati. Provjeri internet.</p>';
      return;
    }
    box.innerHTML = list.length ? '' : '<p class="muted">Još nema generiranih ponuda.</p>';
    list.forEach((h) => {
      const row = document.createElement('div');
      row.className = 'hist-row';
      row.innerHTML = `<div><strong></strong></div><div class="meta"></div>
        <div class="acts"><button data-a="open">Otvori</button><button data-a="pdf">PDF</button><button data-a="copy">Kopiraj u novu</button></div>`;
      row.querySelector('strong').textContent = h.broj + ' · ' + fmt(Number(h.iznos) || 0) + ' €';
      row.querySelector('.meta').textContent = fmtDate(h.datum) + ' · ' + (h.kupac || 'bez kupca');
      row.querySelector('.acts').addEventListener('click', async (e) => {
        const a = e.target.dataset.a;
        if (!a) return;
        if (a === 'open') {
          draft = JSON.parse(JSON.stringify(h.data));
        } else if (a === 'copy') {
          const fresh = newDraft();
          draft = Object.assign(JSON.parse(JSON.stringify(h.data)), { broj: null, datum: fresh.datum, valjanost: fresh.valjanost });
        } else if (a === 'pdf') {
          lastPdf = { blob: await makePdf(h.data), name: `PONUDA_${h.broj}.pdf` };
          downloadPdf();
          return;
        }
        persistDraft(); fillForm(); $('dlgHistory').close(); window.scrollTo(0, 0);
      });
      box.append(row);
    });
  }

  // --- postavke ---
  const settingFields = {
    s_firma: 'firma', s_adresa: 'adresa', s_oib: 'oib', s_dodatno: 'dodatno', s_odgovorna: 'odgovornaOsoba',
    s_srednji: 'srednjiDio', s_valjanost: 'valjanostDana', s_porez: 'porezNapomena', s_napDno: 'napomenaDno', s_pdv: 'pdvNapomena',
    s_stopaPdv: 'stopaPdv', s_predlozak: 'predlozak', s_boja: 'boja',
  };

  function showBoja() { $('s_bojaWrap').hidden = $('s_predlozak').value === 'klasicni'; }

  function showPdvFields() {
    const u = $('s_uPdv').checked;
    $('s_stopaWrap').hidden = !u;
    $('s_porezWrap').hidden = u;
    $('s_pdvWrap').hidden = u;
  }
  let pendingLogo;

  async function openSettings(firstTime) {
    $('s_intro').hidden = firstTime !== true;
    for (const [id, key] of Object.entries(settingFields)) $(id).value = settings[key] ?? '';
    $('s_uPdv').checked = !!settings.uPdv;
    showPdvFields();
    showBoja();
    $('s_next').value = counterCache[yy(today())] || '';
    $('s_user').textContent = user ? user.email : '';
    pendingLogo = settings.logo;
    showLogoPreview();
    $('s_logo').value = '';
    $('dlgSettings').showModal();
    try { $('s_next').value = await db.peekCounter(yy(today())); } catch (e) { /* ostaje predmemorirana vrijednost */ }
  }

  async function saveSettings() {
    const next = Object.assign({}, settings);
    for (const [id, key] of Object.entries(settingFields)) next[key] = $(id).value;
    next.valjanostDana = Math.max(0, parseInt(next.valjanostDana, 10) || 0);
    next.uPdv = $('s_uPdv').checked;
    next.stopaPdv = num(next.stopaPdv);
    next.logo = pendingLogo || null;
    const btn = $('btnSettingsSave');
    btn.disabled = true;
    try {
      await db.saveSettings(next);
      const n = parseInt($('s_next').value, 10);
      const year = yy(today());
      if (n > 0 && n !== counterCache[year]) { await db.setCounter(year, n); counterCache[year] = n; }
      settings = next;
      cacheSettings();
      $('dlgSettings').close(); renderHeader(); renderItems(); toast('Postavke spremljene');
    } catch (e) {
      console.error(e);
      toast('Spremanje nije uspjelo. Provjeri internet.');
    } finally {
      btn.disabled = false;
    }
  }

  function showLogoPreview() {
    $('s_logoPrev').hidden = !pendingLogo;
    $('btnLogoReset').hidden = !pendingLogo;
    if (pendingLogo) $('s_logoPrev').src = pendingLogo;
  }

  function cacheSettings() { save(KEY.settingsCache, { userId: user.id, data: settings }); }

  function readLogo(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // smanji na razumnu veličinu da ne opterećuje bazu
        const scale = Math.min(1, 1200 / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        pendingLogo = c.toDataURL('image/jpeg', 0.9);
        showLogoPreview();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // --- prijenos podataka spremljenih prije baze (samo uz potvrdu, pa se lokalna kopija briše) ---
  async function migrateLocal(hadRemoteSettings) {
    const hist = load(KEY.legacyHistory, []), cust = load(KEY.legacyCustomers, []);
    const cnt = load(KEY.legacyCounter, null), legacySettings = load(KEY.legacySettings, null);
    if (!hist.length && !cust.length && !cnt && !legacySettings) return;
    const ok = confirm(`Na ovom uređaju su ponude spremljene prije uvođenja prijave (${hist.length} ponuda, ${cust.length} kupaca). Prenijeti ih u račun ${user.email}?`);
    if (ok) {
      if (legacySettings && !hadRemoteSettings) {
        settings = Object.assign({}, DEFAULT_SETTINGS, legacySettings);
        await db.saveSettings(settings);
      }
      for (const k of cust.slice().reverse()) if (k.naziv && k.naziv.trim()) await db.saveCustomer(k);
      for (const h of hist.slice().reverse()) await db.saveQuote(h.data);
      if (cnt && cnt.next > (await db.peekCounter(cnt.year))) await db.setCounter(cnt.year, cnt.next);
      toast(`Prenijeto: ${hist.length} ponuda, ${cust.length} kupaca`);
    }
    [KEY.legacyHistory, KEY.legacyCustomers, KEY.legacyCounter, KEY.legacySettings, 'bp_draft', 'bp_migrated']
      .forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* nije bitno */ } });
  }

  // --- prijava ---
  function showScreen(name) {
    $('loginScreen').hidden = name !== 'login';
    $('loadingScreen').hidden = name !== 'loading';
    $('appScreen').hidden = name !== 'app';
  }

  async function login(e) {
    e.preventDefault();
    const btn = $('btnLogin');
    $('loginError').textContent = '';
    btn.disabled = true; btn.textContent = 'Prijavljujem…';
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: $('l_email').value.trim(), password: $('l_pass').value });
      if (error) throw error;
      $('l_pass').value = '';
      await startApp(data.user);
    } catch (err) {
      $('loginError').textContent = /invalid/i.test(err.message || '') ? 'Pogrešan e-mail ili lozinka.' : 'Prijava nije uspjela. Provjeri internet.';
    } finally {
      btn.disabled = false; btn.textContent = 'Prijava';
    }
  }

  async function logout() {
    if (!confirm('Odjaviti se s ovog uređaja?')) return;
    await sb.auth.signOut();
    [KEY.draft, KEY.settingsCache].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* nije bitno */ } });
    user = null;
    draft = null;
    customers = [];
    for (const k of Object.keys(counterCache)) delete counterCache[k];
    $('dlgSettings').close();
    showScreen('login');
  }

  let started = false;
  async function startApp(u) {
    user = u;
    showScreen('loading');
    settings = Object.assign({}, DEFAULT_SETTINGS);
    let online = true;
    try {
      const remote = await db.loadSettings();
      if (remote) settings = Object.assign({}, DEFAULT_SETTINGS, remote);
      await migrateLocal(!!remote);
      cacheSettings();
      customers = await db.listCustomers();
    } catch (e) {
      console.error(e);
      online = false;
      const cached = load(KEY.settingsCache, null);
      if (cached && cached.userId === u.id) settings = Object.assign({}, DEFAULT_SETTINGS, cached.data);
      toast('Nema veze s bazom – radim s lokalnom kopijom postavki');
    }
    const saved = load(KEY.draft, null);
    draft = saved && saved.userId === u.id ? saved.data : newDraft();
    if (!started) { bindForm(); started = true; }
    fillForm();
    showScreen('app');
    refreshCounter(yy(draft.datum));
    if (online && !String(settings.firma || '').trim()) openSettings(true);
  }

  // --- ostalo ---
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }

  async function init() {
    $('loginForm').addEventListener('submit', login);
    $('btnShare').addEventListener('click', sharePdf);
    $('btnDownload').addEventListener('click', downloadPdf);
    $('btnOpen').addEventListener('click', openPdf);
    $('btnDoneClose').addEventListener('click', () => $('dlgDone').close());
    $('btnHistory').addEventListener('click', () => { renderHistory(); $('dlgHistory').showModal(); });
    $('btnHistoryClose').addEventListener('click', () => $('dlgHistory').close());
    $('btnSettings').addEventListener('click', () => openSettings(false));
    $('btnSettingsSave').addEventListener('click', saveSettings);
    $('btnSettingsClose').addEventListener('click', () => $('dlgSettings').close());
    $('btnLogout').addEventListener('click', logout);
    $('s_uPdv').addEventListener('change', showPdvFields);
    $('s_predlozak').addEventListener('change', showBoja);
    $('s_logo').addEventListener('change', (e) => { if (e.target.files[0]) readLogo(e.target.files[0]); });
    $('btnLogoReset').addEventListener('click', () => { pendingLogo = null; $('s_logo').value = ''; showLogoPreview(); });

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Prijava se pamti na uređaju; bez interneta getSession i dalje vraća spremljenu sesiju.
    const { data } = await sb.auth.getSession();
    if (data.session) startApp(data.session.user);
    else showScreen('login');
  }

  init();
})();
