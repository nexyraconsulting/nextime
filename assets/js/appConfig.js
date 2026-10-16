// NexHR front-end configuration. Edit these values for each deployment (see CONFIGURATION_CHECKLIST.md).
export default {
  // Workspaces live at <workspace>.baseDomain; the marketing site at www.baseDomain.
  baseDomain: 'nexhr.com',
  // 'demo' keeps workspaces, accounts and sample HR data in the browser (no server needed).
  // Set to 'api' once platform.js and app.html are wired to the server (INTEGRATION_GUIDE.md).
  mode: 'demo',
  // Shown in the marketing footer and pricing page.
  supportEmail: 'hello@nexyraconsulting.co.uk',
  // QR code library for two-step login setup in demo mode. After running scripts/vendor_frontend_libs.sh
  // this becomes 'assets/vendor/qrcode.js' so nothing loads from a third-party CDN.
  qrScriptUrl: 'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js'
};
