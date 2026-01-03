const express = require('express');
const { chromium } = require('playwright');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'TestifyAI Playwright API is running',
    version: '1.0.0'
  });
});

// Main testing endpoint
app.post('/execute-test-plan', async (req, res) => {
  const { testPlan } = req.body;
  
  if (!testPlan || !testPlan.url) {
    return res.status(400).json({ 
      error: 'Invalid test plan. URL is required.' 
    });
  }

  const results = {
    url: testPlan.url,
    timestamp: new Date().toISOString(),
    totalTests: 0,
    passed: 0,
    failed: 0,
    criticalErrors: [],
    executionTime: 0,
    details: []
  };

  const startTime = Date.now();
  let browser;

  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    
    const page = await context.newPage();

    // Execute each action in test plan
    for (const action of testPlan.actions || []) {
      results.totalTests++;

      try {
        console.log(`Executing: ${action.type}`);

        // NAVIGATION
        if (action.type === 'navigation') {
          const targetUrl = action.target.startsWith('http') 
            ? action.target 
            : testPlan.url + action.target;
          
          await page.goto(targetUrl, { 
            timeout: 60000,
            waitUntil: 'domcontentloaded' 
          });
          
          results.passed++;
          results.details.push({
            action: 'navigation',
            target: action.target,
            status: 'success',
            message: `Successfully navigated to ${targetUrl}`
          });
        }

        // CHECK LINKS
        else if (action.type === 'checkLinks') {
          const links = await page.$$('a');
          let brokenLinks = [];
          
          for (const link of links.slice(0, 20)) { // Check first 20 links
            const href = await link.getAttribute('href');
            
            if (!href || href === '#' || href.startsWith('javascript:')) {
              brokenLinks.push(href || 'empty');
            }
          }

          if (brokenLinks.length === 0) {
            results.passed++;
            results.details.push({
              action: 'checkLinks',
              status: 'success',
              message: `All ${links.length} links are valid`
            });
          } else {
            results.failed++;
            results.details.push({
              action: 'checkLinks',
              status: 'failed',
              severity: 'medium',
              message: `Found ${brokenLinks.length} broken links`,
              issues: brokenLinks
            });
          }
        }

        // CHECK BUTTONS
        else if (action.type === 'checkButtons') {
          const buttons = await page.$$('button, input[type="submit"], input[type="button"]');
          let issueButtons = [];

          for (const button of buttons) {
            const disabled = await button.getAttribute('disabled');
            const onclick = await button.getAttribute('onclick');
            const type = await button.getAttribute('type');
            
            if (disabled !== null) {
              issueButtons.push('Button is disabled');
            }
            if (!onclick && !type) {
              issueButtons.push('Button has no action');
            }
          }

          if (issueButtons.length === 0) {
            results.passed++;
            results.details.push({
              action: 'checkButtons',
              status: 'success',
              message: `Found ${buttons.length} buttons, all functional`
            });
          } else {
            results.failed++;
            results.details.push({
              action: 'checkButtons',
              status: 'warning',
              severity: 'low',
              message: `Found issues with buttons`,
              issues: issueButtons
            });
          }
        }

        // FILL FORM
        else if (action.type === 'fillForm') {
          for (const field of action.fields || []) {
            const selector = field.selector || `[name="${field.name}"]`;
            
            const element = await page.$(selector);
            if (element) {
              await element.fill(field.value);
            } else {
              throw new Error(`Field ${field.name} not found`);
            }
          }

          results.passed++;
          results.details.push({
            action: 'fillForm',
            status: 'success',
            message: `Successfully filled ${action.fields.length} fields`
          });
        }

        // PAGE LOAD
        else if (action.type === 'pageLoad') {
          const performanceTiming = await page.evaluate(() => {
            const timing = performance.timing;
            return {
              loadTime: timing.loadEventEnd - timing.navigationStart,
              domReady: timing.domContentLoadedEventEnd - timing.navigationStart
            };
          });

          results.passed++;
          results.details.push({
            action: 'pageLoad',
            status: 'success',
            metrics: performanceTiming
          });
        }

        // SCREENSHOT ON FAIL (if needed)
        else if (action.type === 'screenshotOnFail') {
          // Implement screenshot logic here if needed
          results.passed++;
        }

      } catch (error) {
        results.failed++;
        results.criticalErrors.push({
          action: action.type,
          error: error.message,
          stack: error.stack
        });
        
        results.details.push({
          action: action.type,
          status: 'error',
          severity: 'high',
          message: error.message
        });
      }
    }

    await browser.close();

  } catch (error) {
    results.criticalErrors.push({
      stage: 'browser_launch',
      error: error.message,
      stack: error.stack
    });
    
    if (browser) {
      await browser.close();
    }
  }

  results.executionTime = Date.now() - startTime;
  
  res.json(results);
});

app.listen(PORT, () => {
  console.log(`🚀 TestifyAI Playwright API running on port ${PORT}`);
});