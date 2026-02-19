const puppeteer = require("puppeteer");
const fs = require("fs");
const os = require("os");
const path = require("path");

(async () => {
  /* ================= CONFIG ================= */

  // IMPORTANT: On first run, you'll need to login to ViewStats manually.
  // Your login will be saved in the 'chrome-profile' folder for future runs.

  const VIDEO_URL =
    "https://www.viewstats.com/@mrbeast/videos/zo7i8VTpfNM";

  const CHROME_USER_DATA_DIR =
    path.join(__dirname, "chrome-profile");

  const CHROME_EXECUTABLE = 
    process.platform === 'win32' 
      ? process.env.PROGRAMFILES + "/Google/Chrome/Application/chrome.exe"
      : process.platform === 'darwin'
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : "/usr/bin/google-chrome";

  const OUTPUT_PREFIX = "hourly_views";

  /* ========================================== */

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: CHROME_EXECUTABLE,
    userDataDir: CHROME_USER_DATA_DIR,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const page = await browser.newPage();

  console.log("▶ Opening ViewStats page...");
  await page.goto(VIDEO_URL, { waitUntil: "domcontentloaded", timeout: 1200000 });
  
  // Check if login is required (first run)
  const needsLogin = await page.evaluate(() => {
    return document.body.innerText.includes('Sign in') || 
           document.body.innerText.includes('Log in') ||
           document.querySelector('button[type="submit"]') !== null;
  });
  
  if (needsLogin) {
    console.log("\n⚠️  LOGIN REQUIRED");
    console.log("Please login to ViewStats in the browser window.");
    console.log("Waiting 2 minutes for you to complete login...\n");
    await new Promise(resolve => setTimeout(resolve, 120000));
    await page.goto(VIDEO_URL, { waitUntil: "domcontentloaded", timeout: 1200000 });
  }
  
  console.log("⏳ Waiting for chart to load...");
  await new Promise(resolve => setTimeout(resolve, 8000));

  /* ================= FIND CHART ================= */

  console.log('Checking for chart elements...');
  const canvases = await page.$$('canvas');
  const svgs = await page.$$('svg');
  console.log(`Found ${canvases.length} canvas and ${svgs.length} SVG elements`);
  
  let chartBox = null;
  let maxArea = 0;

  // Check canvases first
  for (const canvas of canvases) {
    const box = await canvas.boundingBox();
    if (!box) continue;
    console.log('Canvas:', box);
    const area = box.width * box.height;
    if (area > maxArea && box.width > 200 && box.height > 150) {
      maxArea = area;
      chartBox = box;
    }
  }

  // Check SVGs
  for (const svg of svgs) {
    const box = await svg.boundingBox();
    if (!box) continue;
    const area = box.width * box.height;
    if (area > maxArea && box.width > 200 && box.height > 150) {
      console.log('Large SVG:', box);
      maxArea = area;
      chartBox = box;
    }
  }

  if (!chartBox) {
    console.error("❌ Failed to identify chart.");
    await browser.close();
    return;
  }

  console.log("✅ Chart detected:", chartBox);
  console.log("⏳ Waiting for chart data to fully render...");
  await new Promise(resolve => setTimeout(resolve, 3000));

  /* ================= HOVER LOGIC ================= */

  const leftPadding = 30;
  const rightPadding = 30;

  const startX = chartBox.x + leftPadding;
  const endX = chartBox.x + chartBox.width - rightPadding;
  const totalWidth = endX - startX;
  const numPoints = 150;
  const step = totalWidth / numPoints;
  const y = chartBox.y + chartBox.height / 2;

  console.log("\n⏳ Scanning chart for data points...");
  const allData = [];

  for (let i = 0; i <= numPoints; i++) {
    const x = startX + step * i;

    await page.mouse.move(x, y);
    await new Promise(resolve => setTimeout(resolve, 800));

    const tooltipText = await page.evaluate(() => {
      const tooltip = document.querySelector('[role="tooltip"], [class*="tooltip"], [class*="Tooltip"]');
      if (tooltip && tooltip.textContent) {
        return tooltip.textContent.trim();
      }
      
      const bodyText = document.body.innerText;
      const hourMatch = bodyText.match(/Hour\s+(\d+)\s+•\s+[^\n]+\n([\d,]+)/);
      return hourMatch ? `Hour ${hourMatch[1]}: ${hourMatch[2]} views` : '';
    });

    if (tooltipText) {
      const hourMatch = tooltipText.match(/Hour\s+(\d+)/);
      const viewsMatch = tooltipText.match(/([\d,]+)\s*views/);
      
      if (hourMatch && viewsMatch) {
        const hour = Number(hourMatch[1]);
        const views = Number(viewsMatch[1].replace(/,/g, ''));
        allData.push({ hour, views, tooltip: tooltipText });
        console.log(`Position ${i}: ${tooltipText}`);
      }
    }
  }

  // Group by hour and take the first value for each
  const hourlyMap = new Map();
  allData.forEach(item => {
    if (!hourlyMap.has(item.hour)) {
      hourlyMap.set(item.hour, item);
    }
  });

  // Add hour 0 with 0 views if missing
  if (!hourlyMap.has(0)) {
    hourlyMap.set(0, { hour: 0, views: 0, tooltip: 'Hour 0: 0 views' });
  }

  const rawResults = Array.from(hourlyMap.values()).sort((a, b) => a.hour - b.hour);

  /* ================= SAVE RAW JSON ================= */

  fs.writeFileSync(
    `${OUTPUT_PREFIX}_raw.json`,
    JSON.stringify(rawResults, null, 2)
  );

  /* ================= PARSE & SAVE CSV ================= */

  // Create array with hours 0 to 24
  const hourlyData = Array.from({ length: 25 }, (_, i) => ({ 
    hour: i,
    views: null 
  }));
  
  // Fill in the data we captured
  rawResults.forEach(item => {
    if (item.hour >= 0 && item.hour <= 24) {
      hourlyData[item.hour].views = item.views;
    }
  });

  // Get video title and publish time from page
  const { videoTitle, publishDatetimeUtc } = await page.evaluate(() => {
    let title = 'Unknown Video';
    
    // Try multiple selectors for video title
    const selectors = [
      'h2',
      'h1',
      '[class*="title"]',
      '[class*="Title"]',
      '[class*="video"]'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent.trim();
        // Look for title that contains $ or is longer than 10 chars and not "MrBeast"
        if (text && text !== 'MrBeast' && text.length > 10 && !text.includes('ViewStats')) {
          title = text;
          break;
        }
      }
      if (title !== 'Unknown Video') break;
    }
    
    // Fallback to document title
    if (title === 'Unknown Video') {
      const docTitle = document.title;
      if (docTitle && !docTitle.includes('ViewStats')) {
        // Extract title before " - MrBeast" or similar
        const parts = docTitle.split(' - ');
        if (parts.length > 1) {
          title = parts[0].trim();
        }
      }
    }
    
    // Get publish time in UTC ISO format
    const timeElements = Array.from(document.querySelectorAll('time[datetime]'));
    let pubTimeUtc = '';
    
    if (timeElements.length > 0) {
      const datetime = timeElements[0].getAttribute('datetime');
      if (datetime) {
        pubTimeUtc = new Date(datetime).toISOString();
      }
    }
    
    // Fallback: look for date text and try to parse
    if (!pubTimeUtc) {
      const allText = document.body.innerText;
      const datePatterns = [
        /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/,
        /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/,
        /(\w+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M)/,
        /(\w+ \d{1,2}, \d{4})/
      ];
      
      for (const pattern of datePatterns) {
        const match = allText.match(pattern);
        if (match) {
          try {
            pubTimeUtc = new Date(match[0]).toISOString();
            break;
          } catch (e) {}
        }
      }
    }
    
    return { videoTitle: title, publishDatetimeUtc: pubTimeUtc };
  });
  
  if (!publishDatetimeUtc) {
    console.error('❌ ERROR: Could not extract publish_datetime_utc (T0).');
    await browser.close();
    return;
  }
  
  console.log('Video title:', videoTitle);
  console.log('T0 (publish_datetime_utc):', publishDatetimeUtc);

  const csvFile = `${OUTPUT_PREFIX}.csv`;
  const hourColumns = hourlyData.slice(1, 25).map(h => h.views ?? "").join(",");
  const escapedTitle = videoTitle.replace(/"/g, '""');
  const newRow = `"${escapedTitle}",${VIDEO_URL},"${publishDatetimeUtc}",${hourColumns},ViewStats`;

  if (fs.existsSync(csvFile)) {
    fs.appendFileSync(csvFile, "\n" + newRow);
  } else {
    const header = ["Video", "Link", "publish_datetime_utc", ...Array.from({length: 24}, (_, i) => `+${i+1}h`), "Source"].join(",");
    fs.writeFileSync(csvFile, header + "\n" + newRow);
  }

  console.log("\n✅ Output written:");
  console.log(`   - ${OUTPUT_PREFIX}_raw.json`);
  console.log(`   - ${OUTPUT_PREFIX}.csv (${fs.existsSync(csvFile) ? 'appended' : 'created'})`);
  console.log(`   - Title: ${videoTitle}`);
  console.log(`   - Hours captured: ${rawResults.length}`);
  console.log(`   - Hours with data: ${hourlyData.filter(h => h.views !== null).length}/25`);

  await browser.close();
})();
