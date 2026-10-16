/* Nexyra universal navigation + search. Add one line to any page, on any folder of the site:
     <script src="/assets/nav/nexyra-nav.js" data-active="careers" defer></script>
   data-active (optional): about | services | products | work | pricing | insight | careers | contact. Guessed from the URL if left out.
   data-product (optional): nexdrive | nexcut | nexhr | nextime, the product shown first under Products. Guessed from the URL if left out.
   Content lives in assets/nav/nexyra-menu.js (menu) and assets/nav/nexyra-search-index.js (search). This file holds behaviour only.
   Standalone product deploys (e.g. NEXHR on its own domain) add two attributes:
     data-site="https://nexyraconsulting.co.uk/"  Nexyra pages and the logo link resolve against the main site.
     data-local="nexhr"                            Menu/search links under nexhr/ resolve to this app's own root instead.
   With data-site set, menu preview images load from this folder (assets/nav/<file>.jpg). */
(function () {
  "use strict";
  if (window.__nexyraNav) return;
  window.__nexyraNav = true;

  var me = document.currentScript || document.querySelector('script[src*="nexyra-nav.js"]');
  var src = me ? me.src : location.href;
  var BASE = new URL("../../", src).href;
  var HERE = new URL("./", src).href;
  var SITE_ATTR = me && me.getAttribute("data-site");
  var SITE = SITE_ATTR ? new URL(SITE_ATTR, location.href).href.replace(/\/?$/, "/") : BASE;
  var LOCAL = me && me.getAttribute("data-local");
  var Q = src.indexOf("?") > -1 ? src.slice(src.indexOf("?")) : "";
  function asset(p) { return BASE + p + Q; }
  function url(p) {
    if (p == null || p === "") return SITE;
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(p)) return p;
    var s = String(p).replace(/^\//, "");
    if (LOCAL && (s === LOCAL || s.indexOf(LOCAL + "/") === 0)) return new URL(s.slice(LOCAL.length + 1) || "index.html", BASE).href;
    return new URL(s, SITE).href;
  }
  function imgUrl(p) { return SITE_ATTR && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(p) ? HERE + String(p).split("/").pop() : url(p); }
  function load(s, cb) { var el = document.createElement("script"); el.src = s; el.onload = el.onerror = function () { if (cb) cb(); }; document.head.appendChild(el); }

  if (!document.querySelector('link[href*="nexyra-nav.css"]')) {
    var css = document.createElement("link"); css.rel = "stylesheet"; css.href = asset("assets/nav/nexyra-nav.css"); document.head.appendChild(css);
  }
  load(asset("assets/nav/nexyra-search-engine.js"));
  load(asset("assets/nav/nexyra-search-index.js"));
  function start() { if (window.NX_MENU) init(); else load(asset("assets/nav/nexyra-menu.js"), init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function resolveAll(o, seen) {
    if (!o || typeof o !== "object" || seen.indexOf(o) > -1) return;
    seen.push(o);
    if (Array.isArray(o)) { o.forEach(function (x) { resolveAll(x, seen); }); return; }
    if (typeof o.to === "string") o.to = url(o.to);
    if (typeof o.img === "string") o.img = imgUrl(o.img);
    Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === "object") resolveAll(o[k], seen); });
  }

  var ICON_MENU = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.8 7h18.4"></path><path d="M2.8 12h18.4"></path><path d="M2.8 17h18.4"></path></svg>';
  var ICON_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
  function CHEV(s) { return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>'; }
  var BACK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"></path><path d="m12 19-7-7 7-7"></path></svg>';
  function ARROW(s) { return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path></svg>'; }
  var N_PATH = "M0 140 L0 0 L26 0 L94 96 L94 0 L120 0 L120 140 L94 140 L26 44 L26 140 Z";
  var FONT = "'Hanken Grotesk','Neue Haas Grotesk Display','Helvetica Neue',Arial,sans-serif";
  var LOGO = '<svg class="nx-logo-svg" viewBox="0 0 400 104" aria-hidden="true"><defs>' +
    '<linearGradient id="nxNavGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="130" y2="130"><stop offset="0" stop-color="#A78BFA"></stop><stop offset="0.39" stop-color="#7C3AED"></stop><stop offset="1" stop-color="#3B82F6"></stop></linearGradient>' +
    '<clipPath id="nxNavCutTop"><polygon points="-40,120 160,22 160,-70 -40,-70"></polygon></clipPath><clipPath id="nxNavCutBot"><polygon points="-40,130 160,32 160,230 -40,230"></polygon></clipPath></defs>' +
    '<g transform="translate(34,20) scale(0.457)">' +
    '<g class="nx-mono-light"><g clip-path="url(#nxNavCutTop)"><path fill="url(#nxNavGrad)" d="' + N_PATH + '"></path></g><g clip-path="url(#nxNavCutBot)"><path fill="url(#nxNavGrad)" d="' + N_PATH + '"></path></g></g>' +
    '<g class="nx-mono-dark"><g clip-path="url(#nxNavCutTop)"><path fill="#FFFFFF" d="' + N_PATH + '"></path></g><g clip-path="url(#nxNavCutBot)"><path fill="#FFFFFF" d="' + N_PATH + '"></path></g></g>' +
    '<line stroke="#9333EA" fill="none" stroke-width="4" stroke-linecap="round" x1="-30" y1="115" x2="-2" y2="101"></line><line stroke="#9333EA" fill="none" stroke-width="4" stroke-linecap="round" x1="122" y1="41" x2="150" y2="27"></line></g>' +
    '<text x="138" y="57.1" font-family="' + FONT + '" font-size="51" font-weight="500" letter-spacing="5.33" fill="#000000">NEXYRA</text>' +
    '<text x="140.7" y="84.0" font-family="' + FONT + '" font-size="16.1" font-weight="400" letter-spacing="9.67" fill="#000000">CONSULTING</text></svg>';
  var ICON_SEARCH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>';
  var ICON_CLOSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>';
  function directNav() { return window.matchMedia("(min-width: 1200px) and (hover: hover)").matches; }

  function init() {
    var D = window.NX_MENU;
    if (!D || document.getElementById("nx-nav-root")) return;
    resolveAll(D, []);
    var MENU = D.menu, PRODUCTS = D.products || [];
    var BY_KEY = {}, PRODUCT_BY_KEY = {};
    (D.services || []).concat(D.industries || []).forEach(function (s) { BY_KEY[s.key] = s; });
    PRODUCTS.forEach(function (p) { PRODUCT_BY_KEY[p.key] = p; });

    var path = location.pathname.toLowerCase();
    var file = path.split("/").pop() || "index.html";
    var ACTIVE = me && me.getAttribute("data-active");
    var PRODUCT = me && me.getAttribute("data-product");
    if (!PRODUCT) PRODUCTS.forEach(function (p) { if (!PRODUCT && (path.indexOf("/" + p.key + "/") > -1 || path.slice(-p.key.length - 1) === "/" + p.key || file.indexOf("-" + p.key) > -1)) PRODUCT = p.key; });
    if (!ACTIVE) {
      if (PRODUCT) ACTIVE = "products";
      else if (/^services/.test(file)) ACTIVE = "services";
      else MENU.forEach(function (m) { if (!ACTIVE && m.to && m.to.split("#")[0].split("/").pop().toLowerCase() === file) ACTIVE = m.key; });
    }

    var root = document.createElement("div");
    root.id = "nx-nav-root";
    root.style.display = "none";
    root.innerHTML =
      '<div class="nx-pill" data-tone="light">' +
        '<button class="nx-toggle" type="button" aria-expanded="false" aria-controls="nx-menu-overlay" aria-label="Open menu">' + ICON_MENU + '</button>' +
        '<a href="' + esc(SITE) + '" class="nx-logo" data-open="false" aria-label="Nexyra Consulting homepage">' + LOGO + '</a>' +
      '</div>' +
      '<div class="nx-search" data-open="false" data-tone="light">' +
        '<form class="nx-search-bar" role="search">' +
          '<input class="nx-search-input" type="text" placeholder="Search Nexyra" aria-label="Search the site" autocomplete="off" tabindex="-1" aria-controls="nx-search-results">' +
          '<button type="button" class="nx-search-btn" aria-label="Open search" aria-expanded="false"><span class="nx-search-ico-open">' + ICON_SEARCH + '</span><span class="nx-search-ico-close">' + ICON_CLOSE + '</span><span class="nx-search-label">Search</span></button>' +
        '</form>' +
        '<div id="nx-search-results" class="nx-search-results" role="listbox" aria-label="Search results" hidden></div>' +
      '</div>' +
      '<div id="nx-menu-overlay" class="nx-overlay" role="dialog" aria-modal="true" aria-label="Site navigation" hidden></div>';
    document.body.insertBefore(root, document.body.firstChild);

    /* ---------- Menu overlay ---------- */
    var pill = root.querySelector(".nx-pill");
    var toggleBtn = pill.querySelector(".nx-toggle");
    var logo = pill.querySelector(".nx-logo");
    var overlay = root.querySelector("#nx-menu-overlay");
    var M = { open: false, section: null, drilled: false, preview: null };
    var hoverT = null, preloaded = false;

    function renderMenu() {
      var sec = MENU.filter(function (m) { return m.key === M.section; })[0] || null;
      var level = sec ? (M.drilled ? "2" : "1") : "0";
      var backLabel = sec ? (M.drilled ? "Back to " + sec.label : "Back to menu") : "Back";
      var main = MENU.map(function (m) {
        var act = M.section === m.key, dim = M.section && !act ? "true" : "false", cur = m.key === ACTIVE ? ' data-current="page"' : "";
        if (m.groups) return '<li><button type="button" class="nx-main-link" data-sec="' + esc(m.key) + '" data-active="' + act + '" data-dim="' + dim + '"' + cur + ' aria-expanded="' + act + '"><span class="nx-label">' + esc(m.label) + "</span>" + CHEV(20) + "</button></li>";
        return '<li><a class="nx-main-link" href="' + esc(m.to) + '" data-close data-dim="' + dim + '"' + (cur ? cur + ' aria-current="page"' : "") + '><span class="nx-label">' + esc(m.label) + "</span></a></li>";
      }).join("");
      var sub = "";
      if (sec) {
        sub += '<button type="button" class="nx-back" data-back aria-label="' + esc(backLabel) + '">' + BACK + "<span>" + esc(sec.label) + "</span></button>";
        if (sec.overview) sub += '<a class="nx-sub-overview" href="' + esc(sec.to) + '" data-close>' + esc(sec.overview) + ARROW(14) + "</a>";
        sec.groups.forEach(function (g) {
          sub += '<div class="nx-sub-group">' + (g.heading ? '<p class="nx-sub-heading">' + esc(g.heading) + "</p>" : "");
          g.items.forEach(function (it) {
            if (sec.products) sub += '<button type="button" class="nx-sub-link nx-sub-btn" data-prod="' + esc(it.key) + '" data-selected="' + (M.preview === it.key) + '" aria-expanded="' + (M.preview === it.key) + '" aria-controls="nx-product-nav" aria-label="' + esc(it.label + ", " + it.tagline + ": show pages") + '"><span><span style="display:block">' + esc(it.label) + '</span><span class="nx-sub-tag">' + esc(it.tagline) + "</span></span>" + CHEV(18) + "</button>";
            else if (sec.preview) sub += '<a class="nx-sub-link" href="' + esc(it.to) + '" data-pv="' + esc(it.key) + '" data-selected="' + (M.preview === it.key) + '">' + esc(it.label) + "</a>";
            else sub += '<a class="nx-sub-link" href="' + esc(it.to) + '" data-close data-selected="false">' + esc(it.label) + "</a>";
          });
          sub += "</div>";
        });
      }
      var pv = sec && sec.preview && !sec.products && M.preview ? BY_KEY[M.preview] : null;
      var prod = sec && sec.products && M.preview ? PRODUCT_BY_KEY[M.preview] : null;
      var prev = '<button type="button" class="nx-back nx-back-mobile" data-back aria-label="' + esc(backLabel) + '">' + BACK + "<span>" + esc(sec ? sec.label : "") + "</span></button>";
      if (prod) {
        prev += '<nav id="nx-product-nav" class="nx-pv" aria-label="' + esc(prod.label + " pages") + '">' +
          '<p class="nx-preview-eyebrow" style="margin-top:14px">' + esc(prod.tagline) + "</p>" +
          '<h3 style="margin:0;font-size:clamp(24px,2.2vw,32px);font-weight:600;line-height:1.12;letter-spacing:-0.02em;color:#0A0A0F">' + esc(prod.label) + "</h3>" +
          '<a class="nx-sub-overview" data-prod-first href="' + esc(prod.to) + '" data-close style="margin-top:10px">' + esc(prod.overview) + ARROW(14) + "</a>" +
          (prod.groups || []).map(function (pg) {
            return '<div class="nx-sub-group"><p class="nx-sub-heading">' + esc(pg.heading) + "</p>" +
              pg.items.map(function (pl) { return '<a class="nx-sub-link" href="' + esc(pl.to) + '" data-close>' + esc(pl.label) + "</a>"; }).join("") + "</div>";
          }).join("") + "</nav>";
      } else if (pv) {
        prev += '<div class="nx-pv"><img src="' + esc(pv.img) + '" alt="' + esc(pv.alt) + '" style="display:block;width:100%;height:auto;aspect-ratio:16/10;object-fit:cover;filter:grayscale(1);background:#F7F7F9">' +
          '<p class="nx-preview-eyebrow">' + esc(pv.group) + "</p>" +
          '<h3 style="margin:0;font-size:clamp(24px,2.2vw,32px);font-weight:600;line-height:1.12;letter-spacing:-0.02em;text-wrap:pretty;color:#0A0A0F">' + esc(pv.label) + "</h3>" +
          '<p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#4A4A5A;max-width:52ch;text-wrap:pretty">' + esc(pv.desc) + "</p>" +
          (pv.feature ? '<p style="margin:20px 0 0;padding-top:16px;border-top:1px solid #E7E7EC;font-size:13px;line-height:1.5;color:#6B6B7B;max-width:52ch"><span style="font-weight:600;color:#0A0A0F">Featured work:</span> ' + esc(pv.feature) + "</p>" : "") +
          '<a class="nx-preview-cta" href="' + esc(pv.to) + '" data-close>' + esc(pv.cta || "Visit page") + ARROW(16) + "</a></div>";
      }
      var c = D.contact || {};
      overlay.innerHTML = '<div style="max-width:1440px;margin:0 auto;padding:112px 7vw 56px"><div class="nx-stage"><div class="nx-track" data-level="' + level + '" data-preview="' + !!(sec && sec.preview) + '">' +
        '<nav class="nx-col nx-col-main" aria-label="Main navigation"><ul class="nx-main-list">' + main + "</ul></nav>" +
        '<div class="nx-col nx-col-sub">' + sub + "</div>" +
        '<div class="nx-col nx-col-preview" aria-live="polite">' + prev + "</div></div></div>" +
        '<div class="nx-contact">' +
        (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : "") +
        (c.phone ? '<a href="tel:' + esc(c.phone) + '">' + esc(c.phoneLabel || c.phone) + "</a>" : "") +
        "</div></div>";
    }
    function focusSel(sel) { var el = overlay.querySelector(sel); if (el) el.focus({ preventScroll: true }); }
    function setMenu(patch, focus) {
      var prevKey = M.preview, active = document.activeElement, keep = focus || null;
      if (!keep && active && overlay.contains(active)) {
        ["data-sec", "data-prod", "data-pv"].forEach(function (a) { if (!keep && active.getAttribute(a)) keep = "[" + a + '="' + active.getAttribute(a) + '"]'; });
      }
      for (var k in patch) M[k] = patch[k];
      overlay.hidden = !M.open;
      document.body.style.overflow = M.open ? "hidden" : "";
      toggleBtn.innerHTML = M.open ? ICON_X : ICON_MENU;
      toggleBtn.setAttribute("aria-expanded", String(M.open));
      toggleBtn.setAttribute("aria-label", M.open ? "Close menu" : "Open menu");
      logo.setAttribute("data-open", String(M.open));
      if (M.open) {
        if (!preloaded) { preloaded = true; Object.keys(BY_KEY).forEach(function (k) { var i = new Image(); i.src = BY_KEY[k].img; }); }
        renderMenu();
        var p = overlay.querySelector(".nx-pv");
        if (p && prevKey && prevKey !== M.preview && p.animate) p.animate([{ opacity: 0.3, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], { duration: 280, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
        if (keep) focusSel(keep);
      }
      queueTone();
    }
    function closeMenu() { clearTimeout(hoverT); setMenu({ open: false, section: null, drilled: false, preview: null }); }
    function back(escape) {
      if (M.drilled) setMenu({ drilled: false });
      else if (M.section) setMenu({ section: null, preview: null });
      else if (escape) closeMenu();
    }
    toggleBtn.addEventListener("click", function () { setMenu({ open: !M.open, section: null, drilled: false, preview: null }); });
    overlay.addEventListener("click", function (e) {
      var t = e.target.closest("[data-sec],[data-back],[data-prod],[data-pv],[data-close]");
      if (!t) return;
      if (t.hasAttribute("data-sec")) {
        var key = t.getAttribute("data-sec");
        if (M.section === key) return setMenu({ section: null, drilled: false, preview: null });
        var m = MENU.filter(function (x) { return x.key === key; })[0];
        var first = m.groups && m.groups[0] && m.groups[0].items[0];
        return setMenu({ section: key, drilled: false, preview: m.preview ? (m.products && PRODUCT && PRODUCT_BY_KEY[PRODUCT] ? PRODUCT : first && first.key) : null });
      }
      if (t.hasAttribute("data-back")) return back(false);
      if (t.hasAttribute("data-prod")) {
        clearTimeout(hoverT);
        var pk = t.getAttribute("data-prod"), keyboard = e.detail === 0, dn = directNav();
        return setMenu(dn ? { preview: pk } : { preview: pk, drilled: true }, keyboard || !dn ? "[data-prod-first]" : null);
      }
      if (t.hasAttribute("data-pv")) {
        if (directNav()) return closeMenu();
        e.preventDefault();
        return setMenu({ preview: t.getAttribute("data-pv"), drilled: true });
      }
      closeMenu();
    });
    overlay.addEventListener("mouseover", function (e) {
      var pr = e.target.closest("[data-prod]");
      if (pr) {
        var k = pr.getAttribute("data-prod");
        clearTimeout(hoverT);
        hoverT = setTimeout(function () { if (M.preview !== k) setMenu({ preview: k }); }, 90);
        return;
      }
      var t = e.target.closest("[data-pv]");
      if (t && M.preview !== t.getAttribute("data-pv")) setMenu({ preview: t.getAttribute("data-pv") });
    });
    overlay.addEventListener("mouseout", function (e) { if (e.target.closest("[data-prod]")) clearTimeout(hoverT); });
    overlay.addEventListener("focusin", function (e) {
      var t = e.target.closest("[data-pv],[data-prod]");
      if (!t) return;
      var k = t.getAttribute("data-pv") || t.getAttribute("data-prod");
      if (M.preview !== k) setMenu({ preview: k });
    });

    /* ---------- Search ---------- */
    var S = { open: false, q: "", active: 0, results: [], label: "" };
    var sWrap = root.querySelector(".nx-search");
    var sForm = sWrap.querySelector(".nx-search-bar");
    var sInput = sWrap.querySelector(".nx-search-input");
    var sBtn = sWrap.querySelector(".nx-search-btn");
    var sList = root.querySelector("#nx-search-results");
    function runSearch() {
      var q = S.q.trim();
      if (q.length < 2 || !window.NX_SEARCH) { S.results = []; S.label = ""; return; }
      var r = window.NX_SEARCH(q, window.NX_SEARCH_INDEX || []);
      S.results = r.results.map(function (x) { var y = {}; for (var k in x) y[k] = x[k]; y.url = url(x.url); return y; });
      S.label = r.label;
    }
    function renderSearch() {
      sWrap.setAttribute("data-open", String(S.open));
      sBtn.setAttribute("aria-expanded", String(S.open));
      sBtn.setAttribute("aria-label", S.open ? "Close search" : "Open search");
      sInput.tabIndex = S.open ? 0 : -1;
      var show = S.open && S.q.trim().length >= 2;
      sList.hidden = !show;
      if (!show) { sList.innerHTML = ""; return; }
      if (!S.results.length) { sList.innerHTML = '<p class="nx-sr-empty">No results for \u201C' + esc(S.q) + '\u201D. Try a service, industry or topic.</p>'; return; }
      sList.innerHTML = '<p class="nx-sr-count">' + esc(S.label || S.results.length + (S.results.length === 1 ? " result" : " results")) + "</p>" + S.results.map(function (r, i) {
        return '<a class="nx-sr-item" href="' + esc(r.url) + '" role="option" data-i="' + i + '" aria-selected="' + (i === S.active) + '" data-active="' + (i === S.active) + '">' +
          '<span class="nx-sr-meta">' + esc(r.meta) + '</span><span class="nx-sr-title">' + esc(r.title) + '</span><span class="nx-sr-snip">' +
          (r.parts || []).map(function (p) { return '<span data-hit="' + p.hit + '">' + esc(p.t) + "</span>"; }).join("") + "</span></a>";
      }).join("");
    }
    function openSearch() { S.open = true; renderSearch(); setTimeout(function () { sInput.focus(); }, 60); queueTone(); }
    function closeSearch() { S.open = false; S.q = ""; S.active = 0; sInput.value = ""; runSearch(); renderSearch(); queueTone(); }
    function goResult(r) { if (!r) return; closeSearch(); closeMenu(); window.location.href = r.url; }
    sBtn.addEventListener("click", function () { if (S.open) closeSearch(); else openSearch(); });
    sInput.addEventListener("input", function () { S.q = sInput.value; S.active = 0; runSearch(); renderSearch(); });
    sForm.addEventListener("submit", function (e) { e.preventDefault(); goResult(S.results[S.active]); });
    sInput.addEventListener("keydown", function (e) {
      var n = S.results.length;
      if (e.key === "Escape") { e.stopPropagation(); closeSearch(); }
      else if (e.key === "ArrowDown" && n) { e.preventDefault(); S.active = (S.active + 1) % n; renderSearch(); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); S.active = (S.active - 1 + n) % n; renderSearch(); }
    });
    sList.addEventListener("mouseover", function (e) {
      var t = e.target.closest("[data-i]"); if (!t) return;
      var i = +t.getAttribute("data-i");
      if (i !== S.active) { S.active = i; sList.querySelectorAll("[data-i]").forEach(function (a, j) { a.setAttribute("data-active", String(j === i)); a.setAttribute("aria-selected", String(j === i)); }); }
    });
    sList.addEventListener("click", function (e) { var t = e.target.closest("[data-i]"); if (!t) return; e.preventDefault(); goResult(S.results[+t.getAttribute("data-i")]); });

    window.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (S.open) return closeSearch();
      if (M.open) back(true);
    });

    /* ---------- Light/dark tone from what sits behind the pill and search ---------- */
    var imgCache = {}, lumCanvas = null;
    function loadImg(s) {
      var c = imgCache[s];
      if (c) return c.ok ? c.img : null;
      var img = new Image();
      imgCache[s] = { ok: false, img: img };
      img.crossOrigin = "anonymous";
      img.onload = function () { imgCache[s].ok = true; queueTone(); };
      img.src = s;
      return null;
    }
    function regionLum(img, rect, box, fit) {
      var iw = img.naturalWidth, ih = img.naturalHeight;
      if (!iw || !ih || !rect.width || !rect.height) return null;
      var sc = fit === "contain" ? Math.min(rect.width / iw, rect.height / ih) : Math.max(rect.width / iw, rect.height / ih);
      var ox = rect.left + (rect.width - iw * sc) / 2, oy = rect.top + (rect.height - ih * sc) / 2;
      var sx = (box.left - ox) / sc, sy = (box.top - oy) / sc, sw = box.width / sc, sh = box.height / sc;
      sx = Math.max(0, Math.min(iw - 1, sx)); sy = Math.max(0, Math.min(ih - 1, sy));
      sw = Math.max(1, Math.min(iw - sx, sw)); sh = Math.max(1, Math.min(ih - sy, sh));
      try {
        var cv = lumCanvas || (lumCanvas = document.createElement("canvas"));
        cv.width = 16; cv.height = 16;
        var x = cv.getContext("2d", { willReadFrequently: true });
        x.clearRect(0, 0, 16, 16); x.drawImage(img, sx, sy, sw, sh, 0, 0, 16, 16);
        var d = x.getImageData(0, 0, 16, 16).data, t = 0;
        for (var i = 0; i < d.length; i += 4) t += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        return t / (d.length / 4) / 255;
      } catch (err) { return null; }
    }
    function isNav(e) { return root.contains(e); }
    function toneAt(box) {
      var r = box.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var el = document.elementsFromPoint(cx, cy).filter(function (e) { return !isNav(e); })[0];
      var layers = Array.prototype.slice.call(document.querySelectorAll('[data-parallax-layer], img, [style*="background-image"]')).filter(function (c) {
        if (isNav(c)) return false;
        var b = c.getBoundingClientRect();
        if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return false;
        var st = getComputedStyle(c);
        return st.visibility !== "hidden" && st.display !== "none" && +st.opacity > 0.2;
      }).reverse();
      var layer = el && layers.filter(function (c) { return el === c || el.contains(c) || (c.parentElement && c.parentElement.contains(el)); })[0];
      if (layer) el = layer;
      while (el && el !== document.documentElement) {
        var ex = el.getAttribute && el.getAttribute("data-nav-tone");
        if (ex) return ex;
        var cs = getComputedStyle(el);
        var bgUrl = (cs.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/) || [])[1];
        var isImg = el.tagName === "IMG", s = isImg ? el.currentSrc || el.src : bgUrl;
        if (s) {
          var im = loadImg(s), fit = isImg ? cs.objectFit : cs.backgroundSize;
          var lum = im ? regionLum(im, el.getBoundingClientRect(), r, fit === "contain" ? "contain" : "cover") : null;
          if (lum !== null) return lum < 0.5 ? "dark" : "light";
        }
        if (/gradient/.test(cs.backgroundImage)) {
          var gm = cs.backgroundImage.match(/rgba?\(([^)]+)\)/);
          if (gm) { var v = gm[1].split(",").map(Number); if (v[3] === undefined || v[3] > 0.5) return (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) / 255 < 0.4 ? "dark" : "light"; }
        }
        var m = cs.backgroundColor.match(/[\d.]+/g);
        if (m && (m[3] === undefined || +m[3] > 0.5)) return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.4 ? "dark" : "light";
        el = el.parentElement;
      }
      return "light";
    }
    var raf = null;
    function detectTone() {
      raf = null;
      pill.setAttribute("data-tone", M.open ? "light" : toneAt(pill));
      sWrap.setAttribute("data-tone", M.open || S.open ? "light" : toneAt(sForm));
    }
    function queueTone() { if (!raf) raf = requestAnimationFrame(detectTone); }
    window.addEventListener("scroll", queueTone, { passive: true });
    window.addEventListener("resize", queueTone);
    setTimeout(detectTone, 60);
    setTimeout(detectTone, 600);
    setInterval(queueTone, 700);

    /* ---------- Page content clears the fixed nav by 30px via --nx-clear ---------- */
    function measureClear() {
      var b = 0;
      root.querySelectorAll(".nx-pill, .nx-search-bar").forEach(function (el) { b = Math.max(b, el.getBoundingClientRect().bottom); });
      if (b) document.documentElement.style.setProperty("--nx-clear", Math.ceil(b + 30) + "px");
    }
    measureClear();
    requestAnimationFrame(measureClear);
    setTimeout(measureClear, 400);
    window.addEventListener("resize", measureClear);
    window.addEventListener("load", function () { measureClear(); queueTone(); });
  }
})();
