(function () {
  const STOP = new Set("a an the i im i'm me my we our us you your yours do does did can could would should will is are was were be been am to of for in on at by with from about and or but so if it its this that these those what whats which who how much many any some have has had need needs want wants looking look find get give tell please there here just also more like really very new".split(" "));
  const INTENTS = {
    pricing: { label: "Pricing", terms: ["price", "prices", "pricing", "priced", "cost", "costs", "costing", "how much", "fee", "fees", "rate", "rates", "budget", "quote", "quotes", "package", "packages", "charge", "charges", "expensive", "cheap", "afford", "affordable", "pay", "tier", "tiers", "estimate", "investment", "spend", "£", "$"] },
    contact: { label: "Contact", terms: ["contact", "get in touch", "in touch", "email", "phone", "call", "talk", "speak", "reach", "enquiry", "enquire", "inquiry", "hello", "meeting", "book a call", "consultation", "work with you", "hire you", "start a project"] },
    careers: { label: "Careers", terms: ["career", "careers", "job", "jobs", "hiring", "vacancy", "vacancies", "role", "roles", "work for you", "work at", "join", "apply", "recruit", "recruitment", "position", "positions", "internship", "employment", "cv"] },
    work: { label: "Work", terms: ["work", "portfolio", "case study", "case studies", "example", "examples", "project", "projects", "clients", "client", "results", "past work", "track record", "experience", "done before", "showcase", "success"] },
    insight: { label: "Insight", terms: ["insight", "insights", "article", "articles", "blog", "read", "thought", "thinking", "opinion", "news", "guide", "trends", "perspective"] },
    location: { label: "Locations", terms: ["office", "offices", "location", "locations", "where", "based", "address", "london", "dubai", "kolkata", "india", "uk", "uae", "visit", "near"] },
    about: { label: "About", terms: ["about", "who are", "team", "company", "story", "values", "mission", "founded", "history", "nexyra"] },
    services: { label: "Services", terms: ["service", "services", "offer", "offering", "capability", "capabilities", "help with", "provide", "do you do", "can you"] },
    legal: { label: "Legal", terms: ["privacy", "gdpr", "data protection", "cookie", "cookies", "terms", "legal", "sitemap", "policy", "personal data"] },
  };
  const TOPICS = {
    "brand-building": { label: "Brand Building", terms: ["brand", "brands", "branding", "rebrand", "rebranding", "identity", "logo", "logos", "visual identity", "positioning", "naming", "guidelines", "brand design", "brand strategy", "repositioning"] },
    "user-research-and-insights": { label: "User Research", terms: ["research", "user research", "interviews", "usability testing", "survey", "surveys", "customer research", "market research", "discovery", "personas", "journey map", "journey mapping"] },
    "marketing-strategy-and-execution": { label: "Marketing", terms: ["marketing", "go to market", "go-to-market", "gtm", "campaign", "campaigns", "advertising", "ads", "seo", "social media", "launch", "messaging", "lead generation", "leads", "demand", "pipeline"] },
    "digital-transformation": { label: "Digital Transformation", terms: ["transformation", "digital transformation", "transform", "modernise", "modernize", "modernisation", "modernization", "legacy", "operating model", "roadmap", "data platform", "analytics", "cloud", "data strategy", "digitise", "digitize"] },
    "managed-services": { label: "Managed Services", terms: ["managed services", "managed service", "retainer", "ongoing", "embedded team", "outsource", "outsourcing", "support", "partnership", "partnership ladder", "long term"] },
    "accounts-and-business-services": { label: "Accounts & Business Services", terms: ["accounts", "accounting", "accountant", "bookkeeping", "audit", "tax", "finance", "financial reporting", "payroll", "forecasting", "vat", "compliance", "management reporting", "year end"] },
    "experience-design-ux-ui": { label: "Experience Design", terms: ["ux", "ui", "ux/ui", "user experience", "user interface", "interface", "website", "websites", "web", "web design", "site", "app", "apps", "mobile app", "app design", "wireframe", "wireframes", "prototype", "figma", "digital experience", "redesign", "landing page"] },
    "product-and-service-design": { label: "SaaS Product Design", terms: ["saas", "saas design", "saas product", "saas product design", "software as a service", "product", "products", "product design", "product redesign", "redesign", "ux audit", "design system", "dashboard", "onboarding", "mvp", "startup", "scale-up", "prototype", "user journey", "information architecture", "new product"] },
    "enterprise-software-design": { label: "Enterprise Software", terms: ["enterprise", "enterprise software", "erp", "crm", "internal tools", "internal platform", "dashboard", "dashboards", "admin", "platform", "saas", "b2b", "software", "portal"] },
    "automation-and-intelligent-systems": { label: "AI & Automation", terms: ["ai", "a.i.", "artificial intelligence", "machine learning", "ml", "automation", "automate", "automated", "bot", "bots", "chatbot", "llm", "gpt", "genai", "intelligent", "workflow", "workflows", "rpa", "integration", "ai-powered"] },
    "nexdrive": { label: "NEXDrive", terms: ["nexdrive", "nex drive", "driving instructor", "driving instructors", "driving school", "driving lessons", "learner driver", "learner drivers"] },
    "nexcut": { label: "NEXCut", terms: ["nexcut", "nex cut", "salon", "salons", "spa", "spas", "beauty", "hairdresser", "hairdressers", "barber", "barbers"] },
    "nexhr": { label: "NEXHR", terms: ["nexhr", "nex hr", "hr software", "human resources", "payslip", "payslips", "employee records", "annual leave"] },
    "nextime": { label: "NEXTime", terms: ["nextime", "nex time", "rota", "rotas", "timesheet", "timesheets", "shift planning", "staff scheduling"] },
    "no-code-development": { label: "No-Code", terms: ["no code", "no-code", "nocode", "low code", "low-code", "webflow", "bubble", "airtable", "zapier", "quick build", "pilot", "mvp build", "internal tool"] },
  };
  const LEGAL_PAGES = new Set(["Legal", "Terms of Use", "Privacy Policy", "Cookie Policy"]);
  const norm = (s) => (" " + (s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9£$./+\-]+/g, " ").replace(/\s+/g, " ") + " ");
  const stem = (w) => {
    if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
    if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
    return w;
  };
  const words = (s) => norm(s).trim().split(" ").filter(Boolean);
  const hasTerm = (n, t) => {
    const nt = norm(t).trim();
    if (!nt) return false;
    if (/^[£$]$/.test(nt)) return n.includes(nt);
    return n.includes(" " + nt + " ") || (nt.length > 3 && n.includes(" " + nt));
  };
  const detect = (n, map) => Object.keys(map).filter((k) => map[k].terms.some((t) => hasTerm(n, t)));
  const lev = (a, b) => {
    if (Math.abs(a.length - b.length) > 2) return 9;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  const category = (e) => {
    if (e.kind === "Pricing" || e.page === "Pricing") return "pricing";
    if (e.page === "Contact") return "contact";
    if (e.page === "Careers") return "careers";
    if (e.kind === "Case study" || e.page === "Work") return "work";
    if (e.page === "Insight") return "insight";
    if (e.page === "Locations") return "location";
    if (e.page === "About" || e.page === "Home") return "about";
    if (e.kind === "Service" || e.page === "Services") return "services";
    if (LEGAL_PAGES.has(e.page) || e.page === "Sitemap" || e.title === "Sitemap") return "legal";
    return "";
  };
  let prepared = null, vocab = null;
  const prepare = (idx) => {
    if (prepared && prepared.src === idx) return prepared.list;
    vocab = new Set();
    const list = idx.map((e) => {
      const nTitle = norm(e.title), nAll = norm(e.title + " " + e.text + " " + (e.body || "") + " " + e.kind);
      const tStems = new Set(words(e.title).map(stem));
      const aStems = new Set(words(e.title + " " + e.text + " " + (e.body || "") + " " + e.page + " " + e.kind).map(stem));
      aStems.forEach((w) => w.length > 2 && vocab.add(w));
      const topics = new Set(detect(nAll, TOPICS));
      const titleTopics = new Set(detect(nTitle, TOPICS));
      if (e.service) { topics.add(e.service); titleTopics.add(e.service); }
      return { e, nTitle, tStems, aStems, topics, titleTopics, cat: category(e) };
    });
    prepared = { src: idx, list };
    return list;
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function search(query, idx) {
    const raw = (query || "").trim();
    if (raw.length < 2) return { results: [], label: "" };
    const list = prepare(idx || []);
    const known = new Set();
    [INTENTS, TOPICS].forEach((m) => Object.values(m).forEach((v) => v.terms.forEach((t) => { if (!t.includes(" ")) known.add(t); })));
    const fixed = words(raw).map((w) => {
      if (w.length < 4 || known.has(w) || STOP.has(w) || vocab.has(stem(w))) return w;
      let best = w, bd = w.length > 6 ? 2 : 1;
      known.forEach((k) => { if (k.length >= 4) { const d = lev(w, k); if (d <= bd && (d < bd || best === w)) { bd = d; best = k; } } });
      vocab.forEach((k) => { if (best === w && k.length >= 4) { const d = lev(stem(w), k); if (d <= (w.length > 6 ? 2 : 1)) best = k; } });
      return best;
    });
    const n = norm(fixed.join(" "));
    let intents = detect(n, INTENTS);
    const topics = detect(n, TOPICS);
    if (intents.includes("careers") && intents.includes("work") && /work (for|at) /.test(n)) intents = intents.filter((i) => i !== "work");
    if (intents.includes("contact") && /work with you|hire you/.test(n)) intents = intents.filter((i) => i !== "work");
    if (topics.length && intents.includes("work") && !/work|portfolio|case|example|project|client|experience|result|done/.test(n)) intents = intents.filter((i) => i !== "work");
    const primary = intents.filter((i) => i !== "services")[0] || (topics.length ? "services" : intents[0] || "");
    const qWords = fixed.filter((w) => !STOP.has(w));
    const toks = qWords.map(stem).map((w) => {
      if (w.length < 4 || vocab.has(w)) return w;
      let best = w, bd = w.length > 6 ? 2 : 1;
      vocab.forEach((v) => { if (v[0] === w[0]) { const d = lev(w, v); if (d < bd || (d === bd && best === w && d <= (w.length > 6 ? 2 : 1))) { bd = d; best = v; } } });
      return best;
    });
    const scored = [];
    for (const p of list) {
      const e = p.e;
      let s = 0, textHits = 0;
      for (const t of toks) {
        if (p.tStems.has(t)) { s += 6; textHits++; }
        else if (t.length >= 3 && p.nTitle.includes(" " + t)) { s += 4; textHits++; }
        else if (p.aStems.has(t)) { s += 2; textHits++; }
        else if (t.length >= 4 && [...p.aStems].some((w) => w.startsWith(t))) { s += 1; textHits++; }
      }
      if (toks.length > 1 && p.nTitle.includes(norm(qWords.join(" ")).trim())) s += 6;
      let topicHit = 0;
      for (const t of topics) {
        if (p.titleTopics.has(t)) { s += 14; topicHit = 2; }
        else if (p.topics.has(t)) { s += 6; topicHit = Math.max(topicHit, 1); }
      }
      if (topics.length > 1 && topics.every((t) => p.topics.has(t))) s += 4;
      if (primary && p.cat === primary) s += topics.length ? (topicHit === 2 ? 16 : topicHit ? 7 : 3) : 14;
      if (topics.length && primary !== "services" && e.kind === "Service" && topicHit === 2) s += 8;
      else if (intents.includes(p.cat)) s += 6;
      if (primary === "pricing" && e.kind === "Pricing") s += topics.length ? (topicHit === 2 ? 24 : -4) : 2;
      if (primary === "pricing" && !topics.length && e.url === "pricing.html") s += 10;
      if (primary === "services" && e.kind === "Service" && topicHit === 2) s += 12;
      if (primary === "work" && e.kind === "Case study" && topicHit) s += 8;
      if (primary && !topics.length && p.cat === primary && e.kind === "Page") s += 8;
      if (primary === "contact" && e.url === "contact.html") s += 20;
      if (p.cat === "legal" && primary !== "legal") s -= 8;
      if (e.kind === "Page") s += 0.5;
      if (s > 2 && (textHits || topicHit || p.cat === primary)) scored.push({ p, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const seen = new Set();
    let top = scored.filter(({ p }) => { const k = p.e.url + "|" + p.e.title; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
    let fallback = false;
    if (!top.length) {
      fallback = true;
      const pick = ["services.html", "work.html", "pricing.html", "insight.html", "contact.html"];
      top = pick.map((u) => list.find((p) => p.e.url === u)).filter(Boolean).map((p) => ({ p, s: 0 }));
    }
    const hl = [...new Set([...toks, ...qWords].filter((t) => t.length >= 2))];
    topics.forEach((t) => TOPICS[t].terms.forEach((w) => { if (!w.includes(" ") && w.length >= 3) hl.push(w); }));
    const re = hl.length ? new RegExp("(\\b(?:" + hl.sort((a, b) => b.length - a.length).map(esc).join("|") + ")[a-z]*)", "i") : null;
    const reG = re ? new RegExp(re.source, "ig") : null;
    const results = top.map(({ p }, i) => {
      const e = p.e;
      const src = [e.text, e.body].find((x) => x && re && re.test(x)) || e.text || "";
      const m = re ? src.search(re) : -1;
      let start = m < 0 ? 0 : Math.max(0, m - 60);
      if (start > 0) { const sp = src.indexOf(" ", start); start = sp > 0 && sp < m ? sp + 1 : start; }
      let snip = src.slice(start, start + 170);
      if (start + 170 < src.length) snip = snip.replace(/\s+\S*$/, "") + "…";
      if (start > 0) snip = "…" + snip;
      const parts = (reG ? snip.split(reG) : [snip]).filter(Boolean).map((t) => ({ t, hit: re && new RegExp("^" + re.source + "$", "i").test(t) ? "true" : "false" }));
      const base = e.kind === "Page" || e.kind === "Section" ? e.page : e.page + " · " + e.kind;
      return { url: e.url, title: e.title, meta: i === 0 && !fallback ? "Best match · " + base : base, parts };
    });
    let label;
    const tl = topics.slice(0, 2).map((t) => TOPICS[t].label).join(" + ");
    if (fallback) label = "No direct match. Closest places to start";
    else if (primary && primary !== "services" && tl) label = tl + " · " + INTENTS[primary].label;
    else if (tl) label = tl;
    else if (primary) label = INTENTS[primary].label;
    else label = results.length + (results.length === 1 ? " result" : " results");
    return { results, label, fallback };
  }
  window.NX_SEARCH = search;
})();
