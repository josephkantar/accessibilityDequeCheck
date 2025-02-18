const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axeCore = require('axe-core');
const { parse } = require('json2csv');

(async () => {
  const url = 'https://review.gsdm.com/client-projects/capital-one/gsdm-p00106361/'; // Replace with actual URL

  const authCredentials = {
    username: 'studiodev2024', // Replace with actual credentials
    password: 'F1rst&Only'
  };

  const resultsFolder = path.join(__dirname, 'results');
  if (!fs.existsSync(resultsFolder)) fs.mkdirSync(resultsFolder);

  // ✅ Create a single CSV file to store all results
  const csvFilePath = path.join(resultsFolder, `Version_Result_File.csv`);
  let allResults = [];

  // ✅ Launch browser and maximize window
  const browser = await puppeteer.launch({ headless: false, args: ['--start-maximized'] });
  const page = await browser.newPage();
  await page.authenticate(authCredentials);
  await page.setViewport({ width: 1920, height: 1080 });

  console.log(`🔍 Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2' });
  await new Promise(resolve => setTimeout(resolve, 3000)); // ✅ Wait for page to fully load

  // Inject axe-core for WCAG accessibility testing
  const axeScript = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  await page.evaluate(axeScript);

  /**
   * ✅ Expand All Dropdowns One-by-One in Correct Order
   */
  async function expandDropdowns() {
    let menuItems = await page.$$('button[data-breadcrumb]');
    for (let i = 0; i < menuItems.length; i++) {
      menuItems = await page.$$('button[data-breadcrumb]'); // Refresh list in case DOM updates
      const item = menuItems[i];

      let text = await page.evaluate(el => el.getAttribute('data-breadcrumb'), item);
      if (!text) continue;

      console.log(`📂 Expanding: ${text}`);
      await item.click();
      await new Promise(resolve => setTimeout(resolve, 1000)); // ✅ Fixed wait

      // ✅ Wait for new submenus to appear (if any)
      await page.waitForSelector('button[data-breadcrumb]', { visible: true, timeout: 3000 }).catch(() => {});
    }
  }

  await expandDropdowns();

  /**
   * ✅ Click on Every "Version xx" File & Run Accessibility Tests
   */
  async function processVersionFiles() {
    let versionItems = await page.$$(`button[data-breadcrumb*="Version"]`);
    for (let i = 0; i < versionItems.length; i++) {
      versionItems = await page.$$(`button[data-breadcrumb*="Version"]`); // Refresh list in case DOM updates
      const versionItem = versionItems[i];

      let versionText = await page.evaluate(el => el.getAttribute('data-breadcrumb'), versionItem);
      if (!versionText) continue;

      console.log(`📂 Opening Version: ${versionText}`);
      await versionItem.click();
      await new Promise(resolve => setTimeout(resolve, 2000)); // ✅ Fixed wait

      // ✅ Wait for banner or iframe content to fully load
      await page.waitForSelector('.animated-banner img, .static-backup img, iframe', { visible: true, timeout: 5000 }).catch(() => {});

      await runAxeTests(versionText);
    }
  }

  /**
   * ✅ Run WCAG Accessibility Tests for Each "Version xx"
   */
  async function runAxeTests(versionText) {
    console.log(`🛠️ Running WCAG Test on: ${versionText}`);

    // ✅ Extract actual image `src` URL dynamically
    const imageInfo = await page.evaluate(() => {
      const imgElement = document.querySelector('.animated-banner img, .static-backup img, img');
      if (!imgElement) return { name: 'Unknown', src: 'Unknown' };

      let src = imgElement.getAttribute('src') || 'Unknown';
      let name = src.split('/').pop().split('?')[0];

      return { name, src };
    });

    const results = await page.evaluate(() => {
      return axe.run({
        runOnly: {
          type: 'tag',
          values: ['wcag2.2a', 'wcag2.2aa', 'wcag2.2aaa', 'best-practice', 'section508']
        }
        
      });
    });

    console.log(`📊 Accessibility Violations Found: ${results.violations.length}`);

    // ✅ Save results in a single CSV file
    for (let violation of results.violations) {
      for (let node of violation.nodes) {
        let issueData = {
          ImageSrc: imageInfo.src, // ✅ Save image `src` instead of website URL
          ImageName: imageInfo.name,
          Version: versionText,
          Impact: violation.impact,
          Description: violation.description,
          Help: violation.help,
          HelpUrl: violation.helpUrl,
          Selector: violation.nodes.map(node => node.target.join(', ')).join(' | ')
        };

        allResults.push(issueData);
      }
    }
  }

  // ✅ Expand all menus & test each "Version xx" file
  await expandDropdowns();
  await processVersionFiles();

  // ✅ Write all results to a single CSV file
  if (allResults.length > 0) {
    let csvData = parse(allResults, { fields: Object.keys(allResults[0]) });
    fs.writeFileSync(csvFilePath, csvData);
    console.log(`✅ All results saved in: ${csvFilePath}`);
  } else {
    console.log(`✅ No accessibility violations found.`);
  }

  console.log("🎯 All accessibility tests are completed. Exiting...");
  await browser.close();
})();

