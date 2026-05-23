import { chromium } from 'playwright-core';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const portfolioDir = __dirname;
const screenshotsDir = path.join(portfolioDir, 'works', 'screenshots');

const projects = [
  { id: '01', file: 'works/GirlComic/GirlComic.html' },
  { id: '02', file: 'works/mind/mind.html' },
  { id: '03', file: 'works/reframing/reframing500.html' },
  { id: '04', file: 'works/hobby/hobby-200-plus.html' },
  { id: '05', file: 'works/talkGacha/talkGacha.html' },
  { id: '06', file: 'works/Today/今日は何の日 Ver1.2.html' },
  { id: '07', file: 'works/jenga/jenga.html' },
  { id: '08', file: 'works/Toeic240/TOEIC240.html' },
  { id: '09', file: 'works/Mario/マリオVer1.8.html' },
  { id: '10', file: 'works/Neontower/Neontower.html' },
  { id: '11', file: 'works/weather/WeatherVer1.1.html' },
  { id: '12', file: 'works/Poke/Poke.html' },
  { id: '13', file: 'works/Clean/clean.html' },
  { id: '14', file: 'works/Selfcare/selfcare.html' },
  { id: '15', file: 'works/roofrun/roofrun.html' },
  { id: '16', file: 'works/ROBOHON/robohon-commands.html' },
  { id: '17', file: 'works/job interview/job interview.html' },
  { id: '18', file: 'works/fruits/fruits.html' },
  { id: '19', file: 'works/mental partner/Mental partner.html' },
  { id: '20', file: 'works/Solitire/elemental_solitaire.html' },
  { id: '21', file: 'works/Umekidoll/Umekidoll.html' },
  { id: '22', file: 'works/Mine/Mine.html' },
  { id: '23', file: 'works/Antiage/Antiage.html' },
  { id: '24', file: 'works/Kondate/Kondate.html' },
  { id: '25', file: 'works/Seikaku/Seikaku.html' },
  { id: '26', file: 'works/Houkan/Houkan.html' },
  { id: '27', file: 'works/Job SOpt/job-search-optimizer.html' },
];

async function takeScreenshots() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  });

  for (const project of projects) {
    const filePath = path.join(portfolioDir, project.file);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  SKIP (not found): ${project.file}`);
      continue;
    }

    const url = `file://${filePath}`;
    const outPath = path.join(screenshotsDir, `${project.id}.jpg`);

    console.log(`📸 ${project.id}: ${project.file}`);

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // ローディング画面・アニメーション完了を待つ
      await page.waitForTimeout(3000);
      await page.screenshot({
        path: outPath,
        type: 'jpeg',
        quality: 88,
        clip: { x: 0, y: 0, width: 1280, height: 800 },
      });
      console.log(`   ✅ saved → ${outPath}`);
    } catch (err) {
      console.log(`   ❌ error: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log('\n🎉 Done! All screenshots saved to works/screenshots/');
}

takeScreenshots();
