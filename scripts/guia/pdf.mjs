import { chromium } from "playwright-core";
const [, , html, pdf] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage(); await p.goto("file://" + html); await p.waitForLoadState("networkidle"); await p.evaluate(() => document.fonts.ready);
await p.pdf({ path: pdf, format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: '<div style="width:100%;font-size:8px;color:#55676f;padding:0 15mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>Guía de usuario de Regenta</span><span class="pageNumber"></span></div>' });
await b.close();
