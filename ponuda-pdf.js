// Izračuni i izgled PDF ponude (pdfmake). Bez ovisnosti o DOM-u.
(function (root) {
  'use strict';

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const s = String(v || '').trim().replace(/\s/g, '');
    if (!s) return 0;
    // "1.234,56" -> 1234.56 ; "12,5" -> 12.5 ; "12.5" -> 12.5
    const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
    const n = parseFloat(norm);
    return isFinite(n) ? n : 0;
  }

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  function fmt(n) {
    return round2(n).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  }

  function lineValue(it) { return round2(num(it.kolicina) * num(it.cijena)); }

  function activeItems(stavke) {
    return (stavke || []).filter((it) => String(it.naziv || '').trim() || num(it.kolicina) || num(it.cijena));
  }

  function total(stavke) {
    return round2(activeItems(stavke).reduce((sum, it) => sum + lineValue(it), 0));
  }

  // --- Iznos slovima (hrvatski) ---
  const JED_M = ['', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'];
  const JED_Z = ['', 'jedna', 'dvije', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'];
  const NAEST = ['deset', 'jedanaest', 'dvanaest', 'trinaest', 'četrnaest', 'petnaest', 'šesnaest', 'sedamnaest', 'osamnaest', 'devetnaest'];
  const DESET = ['', '', 'dvadeset', 'trideset', 'četrdeset', 'pedeset', 'šezdeset', 'sedamdeset', 'osamdeset', 'devedeset'];
  const STO = ['', 'sto', 'dvjesto', 'tristo', 'četiristo', 'petsto', 'šesto', 'sedamsto', 'osamsto', 'devetsto'];

  function triple(n, zenski) {
    const h = Math.floor(n / 100), t = Math.floor((n % 100) / 10), u = n % 10;
    const out = [];
    if (h) out.push(STO[h]);
    if (t === 1) out.push(NAEST[u]);
    else {
      if (t) out.push(DESET[t]);
      if (u) out.push((zenski ? JED_Z : JED_M)[u]);
    }
    return out.join(' ');
  }

  // 1 -> oblik1, 2-4 -> oblik2, ostalo -> oblik5 (11-14 uvijek oblik5)
  function oblik(n, o1, o2, o5) {
    const zadnje2 = n % 100, zadnja = n % 10;
    if (zadnje2 >= 11 && zadnje2 <= 14) return o5;
    if (zadnja === 1) return o1;
    if (zadnja >= 2 && zadnja <= 4) return o2;
    return o5;
  }

  function cijeliSlovima(n) {
    if (n === 0) return 'nula';
    const parts = [];
    const mil = Math.floor(n / 1e6), tis = Math.floor((n % 1e6) / 1000), ost = n % 1000;
    if (mil) parts.push((mil === 1 ? '' : triple(mil, false) + ' ') + oblik(mil, 'milijun', 'milijuna', 'milijuna'));
    if (tis) parts.push(tis === 1 ? 'tisuću' : triple(tis, true) + ' ' + oblik(tis, 'tisuća', 'tisuće', 'tisuća'));
    if (ost) parts.push(triple(ost, false));
    return parts.join(' ');
  }

  function slovima(iznos) {
    const centiUkupno = Math.round(round2(iznos) * 100);
    const eura = Math.floor(centiUkupno / 100), centi = centiUkupno % 100;
    let s = cijeliSlovima(eura) + ' EUR';
    if (centi) s += ` i ${centi} ${oblik(centi, 'cent', 'centa', 'centi')}`;
    return s;
  }

  // --- Dokument ---
  const SIVA = '#d4d4d4';
  const SIVA_SVIJETLA = '#ececec';

  function lbl(text, extra) { return Object.assign({ text, bold: true, fontSize: 6.5 }, extra || {}); }
  function right(text, extra) { return Object.assign({ text, alignment: 'right' }, extra || {}); }

  const tableLines = {
    hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0),
    vLineWidth: () => 0,
    fillColor: (row) => (row === 0 ? SIVA : null),
    paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2,
  };

  function kupacBlock(k) {
    const lines = String(k.naziv || '').split('\n').map((t) => t.trim()).filter(Boolean);
    if (k.oib) lines.push('OIB: ' + k.oib);
    if (k.adresa) lines.push(k.adresa);
    let posta = String(k.posta || '').trim();
    if (posta && !/^[A-Z]{2}-/i.test(posta)) posta = 'HR-' + posta;
    return {
      stack: [
        ...lines.map((t) => ({ text: t })),
        { text: ' ' },
        { columns: [{ text: posta, width: 55 }, { text: String(k.mjesto || '').toUpperCase() }] },
      ],
      fontSize: 8,
    };
  }

  function buildDoc(d, s, logo) {
    const items = activeItems(d.stavke);
    const ukupno = total(d.stavke);
    const k = d.kupac || {};

    const itemRows = items.map((it, i) => {
      const opis = String(it.opis || '').split('\n').map((t) => t.trim()).filter(Boolean);
      const bottom = opis.length ? 6 : 1;
      return [
        { text: String(i + 1), margin: [0, 0, 0, bottom] },
        { stack: [{ text: it.naziv || '' }, ...opis.map((t) => ({ text: t, fontSize: 6.5 }))], margin: [0, 0, 0, bottom] },
        right(fmt(num(it.kolicina))),
        { text: it.jedinica || '' },
        right(fmt(num(it.cijena))),
        right('0,00'),
        right('0,00'),
        right(fmt(lineValue(it))),
      ];
    });

    const header = [
      lbl('Ident'), lbl('Naziv'), lbl('Količina', { alignment: 'right' }), lbl('Jed.'),
      lbl('Cijena', { alignment: 'right' }), lbl('R. %', { alignment: 'right' }),
      lbl('PDV %', { alignment: 'right' }), lbl('Vrijednost', { alignment: 'right' }),
    ];

    const content = [
      {
        columns: [
          logo ? { image: logo, width: 150 } : { text: s.firma, bold: true, fontSize: 16, width: 150 },
          { text: '', width: '*' },
          {
            width: 'auto',
            alignment: 'right',
            stack: [
              { text: s.firma, bold: true },
              { text: s.adresa, bold: true },
              { text: 'OIB: ' + s.oib, bold: true },
              { text: (s.dodatno || '').replace(/ {2,}/g, '   '), fontSize: 6, margin: [0, 5, 0, 0], lineHeight: 1.1 },
            ],
            fontSize: 7.5,
          },
        ],
        columnGap: 10,
      },

      { columns: [lbl('Kupac:', { fontSize: 5.5 }), lbl('Kupac:', { fontSize: 5.5 })], margin: [0, 30, 0, 1], columnGap: 20 },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6 }] },
      { columns: [kupacBlock(k), kupacBlock(k)], margin: [0, 3, 0, 0], columnGap: 20 },

      {
        margin: [0, 30, 0, 0],
        fontSize: 7.5,
        layout: 'noBorders',
        table: {
          widths: [50, 85, 60, 95, 70, '*'],
          body: [
            [lbl('Datum'), fmtDate(d.datum), lbl('Rok isporuke'), d.rokIsporuke || '', lbl('Dostava'), ''],
            [lbl('Valjanost'), fmtDate(d.valjanost), '', '', lbl('Odgovorna osoba'), d.odgovornaOsoba || ''],
          ],
        },
      },

      { text: [{ text: 'Ponuda  ', bold: true }, { text: d.broj }], fontSize: 15, margin: [0, 10, 0, 3] },
      {
        canvas: [
          { type: 'line', x1: 0, y1: 2, x2: 515, y2: 2, lineWidth: 0.6 },
          { type: 'rect', x: 0, y: 0, w: 245, h: 4, color: '#000' },
        ],
      },

      {
        margin: [0, 32, 0, 0],
        fontSize: 7.5,
        layout: tableLines,
        table: { headerRows: 1, widths: [26, '*', 42, 28, 48, 26, 28, 58], body: [header, ...itemRows] },
      },

      {
        margin: [0, 10, 0, 0],
        columnGap: 15,
        columns: [
          {
            width: '*',
            fontSize: 7.5,
            layout: 'noBorders',
            table: {
              widths: [40, '*'],
              body: [
                [lbl('Por.br.'), ''],
                [lbl('OIB'), k.oib || ''],
                [lbl('Slovima'), slovima(ukupno)],
              ],
            },
          },
          {
            width: 210,
            fontSize: 7.5,
            table: {
              widths: [65, '*', 75],
              body: [
                [lbl('Ukupno'), '', right(fmt(ukupno))],
                [lbl('PDV'), '', right('0,00')],
                [lbl('Za platiti'), lbl('EUR'), right(fmt(ukupno), { bold: true, fontSize: 8.5 })],
              ],
            },
            layout: {
              hLineWidth: (i) => (i === 2 || i === 3 ? 0.8 : 0),
              vLineWidth: (i) => (i === 0 ? 0.8 : 0),
              fillColor: (row, node, col) => (col === 1 ? SIVA_SVIJETLA : null),
              paddingTop: () => 3, paddingBottom: () => 3,
            },
          },
        ],
      },

      {
        margin: [0, 10, 0, 0],
        fontSize: 7.5,
        layout: tableLines,
        table: {
          widths: ['*', 80, 110, 80],
          body: [
            [lbl('POREZNE STOPE'), lbl('Osnova', { alignment: 'right' }), lbl('PDV', { alignment: 'center' }), lbl('Vrijednost', { alignment: 'right' })],
            [s.porezNapomena || '', right(fmt(ukupno)), { text: '0,00', alignment: 'center' }, right(fmt(ukupno))],
          ],
        },
      },
    ];

    if (String(d.napomena || '').trim()) {
      content.push({ text: d.napomena.trim(), fontSize: 8, margin: [3, 35, 0, 0], lineHeight: 1.15 });
    }
    content.push(
      { text: s.napomenaDno || '', bold: true, fontSize: 10, margin: [3, d.napomena ? 18 : 35, 0, 1] },
      { text: s.pdvNapomena || '', bold: true, fontSize: 7, margin: [3, 0, 0, 0] },
      { text: `Pri plaćanju platnim nalogom navedite model 00 i poziv ${d.broj}.`, fontSize: 7.5, margin: [0, 40, 0, 0] },
    );

    return {
      pageSize: 'A4',
      pageMargins: [40, 40, 40, 50],
      defaultStyle: { font: 'Roboto', fontSize: 8 },
      info: { title: 'Ponuda ' + d.broj, author: s.firma },
      footer: (cur, count) => ({
        text: [{ text: 'Strana   ', bold: true }, `${cur}/${count}`],
        alignment: 'center', fontSize: 7, margin: [0, 15, 0, 0],
      }),
      content,
    };
  }

  const api = { num, fmt, fmtDate, lineValue, total, slovima, buildDoc };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PonudaPDF = api;
})(this);
