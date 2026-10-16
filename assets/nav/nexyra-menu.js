/* Nexyra site menu: the only file to edit when the navigation changes.
   Upload it to /assets/nav/ and every page that loads nexyra-nav.js picks it up.
   Paths are relative to the site root ("about.html", "/nexcut"). Full URLs (https://...) are used as-is. */
window.NX_MENU = (function () {
  var services = [
    { key: "user-research", group: "Core service", label: "User Research & Insights", to: "services-user-research.html", img: "assets/insights-journey-mapping.jpg", alt: "Researchers mapping a customer journey on a wall", desc: "Evidence before opinion. Qualitative and quantitative research across your customers, market and competitors, turned into decisions your teams can act on." },
    { key: "brand-building", group: "Core service", label: "Brand Building", to: "services-brand-building.html", img: "assets/services-brand.jpg", alt: "Branded packaging and collateral on a studio table", desc: "Positioning, identity and the system that holds them together, documented so every team ships on-brand without asking permission." },
    { key: "marketing-strategy", group: "Core service", label: "Marketing Strategy & Execution", to: "services-marketing-strategy.html", img: "assets/work-gtm-launch.jpg", alt: "Campaign planning session in progress", desc: "Go-to-market planning, messaging architecture and the campaigns behind it, measured against pipeline and revenue rather than impressions." },
    { key: "digital-transformation", group: "Core service", label: "Digital Transformation", to: "services-digital-transformation.html", img: "assets/services-digital-transformation-hero.jpg", alt: "Abstract grid of a modern building facade", desc: "Modernisation with a business case attached: target operating model, platforms and data, sequenced into deliverable phases that stick." },
    { key: "managed-services", group: "Core service", label: "Managed Services", to: "services-managed-services.html", img: "assets/home-partnership.jpg", alt: "Embedded team working alongside a client", desc: "Embedded Nexyra teams running design, brand and digital operations alongside yours, under clear service levels, month after month." },
    { key: "accounts-business-services", group: "Core service", label: "Accounts & Business Services", to: "services-accounts-and-business-services.html", img: "assets/services-accounts-hero.jpg", alt: "Glass-partitioned office corridor", desc: "Accounts, audit and assurance under one roof, with management reporting and forecasting leaders can actually read." },
    { key: "experience-design", group: "Extended capability", label: "Experience Design (UX/UI)", to: "services-experience-design.html", img: "assets/services-product.jpg", alt: "Interface wireframes being drawn on a tablet", desc: "Information architecture, high-fidelity screens, prototypes and accessible, developer-ready specifications." },
    { key: "product-service-design", group: "Extended capability", label: "SaaS Product Design", to: "services-product-and-service-design.html", img: "assets/services-creative.jpg", alt: "Concept sketches and prototypes on a work surface", desc: "Service blueprints, MVP definition, concept testing and the roadmap that takes an idea to launch." },
    { key: "enterprise-software-design", group: "Extended capability", label: "Enterprise Software Design", to: "services-enterprise-software-design.html", img: "assets/services-enterprise-software-hero.jpg", alt: "A tall glass building against the sky", desc: "Design discipline for ERP, CRM, internal platforms and admin tooling, making complex workflows navigable every day." },
    { key: "automation-intelligent-systems", group: "Extended capability", label: "Automation & Intelligent Systems", to: "services-automation-and-intelligent-systems.html", img: "assets/services-automation-hero.jpg", alt: "Shelving units filled with stacked boxes in an automated warehouse aisle", desc: "Workflow automation, AI-assisted decision support and system integration, designed around measurable time saved." },
    { key: "no-code-development", group: "Extended capability", label: "No-Code Development", to: "services-no-code-development.html", img: "assets/services-no-code-hero.jpg", alt: "Blurred city street at night", desc: "Fast, low-risk builds for internal tools, pilots and validation work, integrated with your stack and handed over with training." }
  ];
  services.forEach(function (s) { s.cta = "Visit page"; });

  var industries = [
    { key: "ind-financial", label: "Financial Services", img: "assets/work-ai-service.jpg", alt: "Customer service operations supported by AI tooling", desc: "Banks, insurers and fintechs modernising how they serve customers, from AI-assisted service platforms to the data and compliance layers underneath.", feature: "AI-Powered Customer Service Transformation" },
    { key: "ind-healthcare", label: "Healthcare", img: "assets/work-data-platform.jpg", alt: "Data platform dashboards", desc: "Healthcare technology and care providers turning clinical and operational data into predictive, patient-centred decisions.", feature: "Data Platform Modernisation & Analytics Strategy" },
    { key: "ind-technology", label: "Technology", img: "assets/work-gtm-launch.jpg", alt: "Campaign planning session in progress", desc: "Software and platform companies taking new products to market with a clear proposition, sharp positioning and launch plans tied to revenue.", feature: "Go-to-Market Strategy & Product Launch" },
    { key: "ind-retail", label: "Retail & E-commerce", img: "assets/work-brand-repositioning.jpg", alt: "Brand repositioning work on screen", desc: "Retailers and marketplaces repositioning the brand and rebuilding the digital experience end to end, measured in conversion and revenue.", feature: "Brand Repositioning & Digital Experience Redesign" },
    { key: "ind-manufacturing", label: "Manufacturing", img: "assets/work-automation.jpg", alt: "Automated production environment", desc: "Manufacturers removing manual effort and error from operations with enterprise-wide automation and connected systems.", feature: "Intelligent Automation & Process Optimisation" },
    { key: "ind-fmcg", label: "Consumer Products", img: "assets/work-journey-mapping.jpg", alt: "Customer journey map on a wall", desc: "Consumer brands building retention and lifetime value through mapped journeys, personalisation and research-led product decisions.", feature: "Customer Journey Optimisation & Personalisation" }
  ];
  industries.forEach(function (i) { i.group = "Industry"; i.to = "work.html"; i.cta = "Explore our work"; });

  var products = [
    { key: "nexdrive", label: "NEXDrive", tagline: "For driving instructors", to: "nexdrive/product/index.html", overview: "NEXDrive overview", groups: [
      { heading: "Explore", items: [
        { label: "The complete toolkit", to: "nexdrive/product/index.html#toolkit-heading" },
        { label: "Refer & earn", to: "nexdrive/product/index.html#referral-heading" },
        { label: "Pricing", to: "nexdrive/product/index.html#pricing-heading" },
        { label: "14-day free trial", to: "nexdrive/product/index.html#trial-heading" },
        { label: "Common questions", to: "nexdrive/product/index.html#faq-heading" }
      ] },
      { heading: "Get started", items: [
        { label: "Start 14-day free trial", to: "nexdrive/index.html" }
      ] }
    ] },
    { key: "nexcut", label: "NEXCut", tagline: "For salons, spas & beauty", to: "/nexcut", overview: "NEXCut overview", groups: [
      { heading: "Explore", items: [
        { label: "For customers", to: "/nexcut/customers.html" },
        { label: "For businesses", to: "/nexcut/business.html" },
        { label: "Pricing", to: "/nexcut/pricing.html" },
        { label: "14-day free trial", to: "/nexcut/business.html#trial-heading" },
        { label: "Common questions", to: "/nexcut/business.html#faq-heading" }
      ] },
      { heading: "Get started", items: [
        { label: "Start 14-day free trial", to: "/nexcut/checkout.html" },
        { label: "Get the customer app", to: "/nexcut/customers.html#download" }
      ] }
    ] },
    { key: "nexhr", label: "NEXHR", tagline: "All-in-one HR workspace", to: "nexhr/index.html", overview: "NEXHR overview", groups: [
      { heading: "Explore", items: [
        { label: "Product", to: "nexhr/index.html#product" },
        { label: "Roles", to: "nexhr/index.html#roles" },
        { label: "How it works", to: "nexhr/index.html#how" },
        { label: "Security", to: "nexhr/index.html#security" },
        { label: "Pricing", to: "nexhr/pricing.html" }
      ] },
      { heading: "Get started", items: [
        { label: "Start free trial", to: "nexhr/signup.html" },
        { label: "Sign in", to: "nexhr/login.html" }
      ] }
    ] },
    { key: "nextime", label: "NEXTime", tagline: "For rotas & timesheets", to: "nextime/index.html", overview: "NEXTime overview", groups: [
      { heading: "Explore", items: [
        { label: "Features", to: "nextime/index.html#/features" },
        { label: "How it works", to: "nextime/index.html#/how-it-works" },
        { label: "Security", to: "nextime/index.html#/security" },
        { label: "Pricing", to: "nextime/index.html#/pricing" },
        { label: "FAQ", to: "nextime/index.html#/faq" }
      ] },
      { heading: "Get started", items: [
        { label: "Start free trial", to: "nextime/account.html?view=signup" },
        { label: "Sign in", to: "nextime/account.html" }
      ] }
    ] }
  ];

  return {
    contact: { email: "hello@nexyraconsulting.co.uk", phone: "+447415171157", phoneLabel: "+44 74151 71157" },
    services: services,
    industries: industries,
    products: products,
    menu: [
      { key: "about", label: "About", to: "about.html", overview: "About Nexyra", groups: [
        { heading: null, items: [
          { label: "Our story", to: "about.html#about-heading" },
          { label: "What we stand for", to: "about.html#values-heading" },
          { label: "What we bring", to: "about.html#expertise-heading" }
        ] }
      ] },
      { key: "services", label: "Services", to: "services.html", overview: "All services", preview: true, groups: [
        { heading: "Core services", items: services.filter(function (s) { return s.group === "Core service"; }) },
        { heading: "Extended capabilities", items: services.filter(function (s) { return s.group === "Extended capability"; }) }
      ] },
      { key: "products", label: "Products", to: "nexdrive/product/index.html", overview: null, preview: true, products: true, groups: [
        { heading: null, items: products }
      ] },
      { key: "work", label: "Work", to: "work.html", overview: "All work", preview: true, groups: [
        { heading: "Industries", items: industries }
      ] },
      { key: "pricing", label: "Pricing", to: "pricing.html", overview: "Pricing overview", groups: [
        { heading: null, items: [
          { label: "Architecture", to: "pricing.html#arch-heading" },
          { label: "Fixed price, fixed scope", to: "pricing.html#fixed-heading" },
          { label: "Partnership Ladder", to: "pricing.html#ladder-heading" },
          { label: "Common questions", to: "pricing.html#faq-heading" }
        ] }
      ] },
      { key: "insight", label: "Insight", to: "insight.html" },
      { key: "careers", label: "Careers", to: "careers.html" },
      { key: "contact", label: "Contact", to: "contact.html" }
    ]
  };
})();
