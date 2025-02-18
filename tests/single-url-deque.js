const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axeCore = require('axe-core');
const { parse } = require('json2csv');

(async () => {
  const urlsToTest = [
    'https://www.gsdm.com/',
   
  ];

  const viewports = [
    { name: 'Desktop', width: 1920, height: 1080 },
    { name: 'Tablet', width: 768, height: 1024 },
    { name: 'Mobile', width: 375, height: 667 }
  ];

  const resultsFolder = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsFolder)) {
    fs.mkdirSync(resultsFolder);
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    protocolTimeout: 120000 // Increased timeout
  });

  for (const url of urlsToTest) {
    console.log(`Testing URL: ${url}`);
    const page = await browser.newPage();

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    const cleanUrl = url.replace(/https?:\/\//, '').replace(/\W+/g, '_');
    const urlResults = [];

    for (const viewport of viewports) {
      await page.setViewport({ width: viewport.width, height: viewport.height });
      console.log(`Testing viewport: ${viewport.name} (${viewport.width}x${viewport.height})`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Wait for the page to fully load
        await page.waitForSelector('body', { timeout: 10000 });
        await page.waitForFunction(() => document.readyState === 'complete');

        // Scroll and wait to ensure all elements load
        await page.mouse.move(100, 100);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Inject axe-core
        const axeScript = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
        await page.evaluate(axeScript);

        // Run axe-core with WCAG 2.2, best practices, Section 508, and color contrast
        const results = await page.evaluate(async () => {
          const mainResults = await axe.run({
            runOnly: {
              type: 'tag',
              values: ['wcag2.2a', 'wcag2.2aa', 'wcag2.2aaa', 'best-practice', 'section508']
            },
            rules: {
              'color-contrast': { enabled: true } // ✅ Ensure color contrast is checked
            }
          });

          // Check all iframes
          const frames = [...document.querySelectorAll('iframe')];
          for (const frame of frames) {
            try {
              const frameDoc = frame.contentDocument;
              if (frameDoc) {
                const frameResults = await axe.run(frameDoc);
                mainResults.violations.push(...frameResults.violations);
              }
            } catch (error) {
              console.warn('Error accessing iframe:', error);
            }
          }

          return mainResults;
        });

        console.log(`Accessibility Violations for ${url} (${viewport.name}): ${results.violations.length}`);

        results.testEnvironment = {
          userAgent: await page.evaluate(() => navigator.userAgent),
          windowWidth: viewport.width,
          windowHeight: viewport.height,
          viewportName: viewport.name
        };

        results.violations.forEach((violation) => {
          violation.nodes.forEach((node) => {
            urlResults.push({
              URL: url,
              Viewport: viewport.name,
              Impact: violation.impact,
              Description: violation.description,
              Help: violation.help,
              HelpUrl: violation.helpUrl,
              Selector: node.target.join(', ')
            });
          });
        });

      } catch (error) {
        console.error(`Error testing URL: ${url} (${viewport.name})`, error);
      }
    }

    await page.close();

    // Save results as JSON
    const jsonFilename = `${cleanUrl}.json`;
    fs.writeFileSync(
      path.join(resultsFolder, jsonFilename),
      JSON.stringify(urlResults, null, 2),
      'utf8'
    );
    console.log(`Accessibility JSON results saved to ${path.join(resultsFolder, jsonFilename)}`);

    // Save results as CSV
    if (urlResults.length > 0) {
      const csv = parse(urlResults, { fields: ['URL', 'Viewport', 'Impact', 'Description', 'Help', 'HelpUrl', 'Selector'] });
      const csvFilename = `${cleanUrl}.csv`;
      fs.writeFileSync(path.join(resultsFolder, csvFilename), csv, 'utf8');
      console.log(`Accessibility CSV results saved to ${path.join(resultsFolder, csvFilename)}`);
    } else {
      console.log(`No accessibility issues found for ${url}`);
    }
  }

  await browser.close();
})();
