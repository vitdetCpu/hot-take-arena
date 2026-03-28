import "dotenv/config";
import { judgeSubmissions } from "./minimax.js";

// ---------------------------------------------------------------------------
// Load test: Simulate 100+ submissions and measure AI judging speed
// ---------------------------------------------------------------------------

const PLAYER_COUNT = parseInt(process.argv[2] || "100", 10);

const SAMPLE_TAKES = [
  "Pineapple on pizza is the greatest culinary invention of all time",
  "Tabs are objectively better than spaces and I will die on this hill",
  "The Star Wars prequels are better than the originals",
  "Cereal is technically a soup and you can't change my mind",
  "Working from home is just napping with extra steps",
  "AI will replace developers by next Tuesday",
  "Dark mode is overrated, light mode supremacy",
  "Coffee is just socially acceptable drug addiction",
  "The office thermostat should be set to 68°F, fight me",
  "Meetings that could have been emails should be illegal",
  "Vim is the only real text editor, everything else is notepad",
  "React is just jQuery with extra steps and a marketing team",
  "Blockchain will solve literally everything including my love life",
  "The best programming language is whatever pays the most",
  "Standing desks are just a conspiracy by furniture companies",
  "Agile is just organized chaos with sticky notes",
  "Python is the English of programming languages - everyone speaks it badly",
  "Microservices are just distributed monoliths with more YAML",
  "The cloud is just someone else's computer with better marketing",
  "TDD slows you down... said every developer with no tests",
];

const PROMPT = "What's your most controversial tech opinion?";

// Generate fake submissions
const submissions = Array.from({ length: PLAYER_COUNT }, (_, i) => ({
  index: i + 1,
  playerName: `Player${i + 1}`,
  text: SAMPLE_TAKES[i % SAMPLE_TAKES.length],
  socketId: `fake-socket-${i}`,
}));

console.log(`\n🔥 Hot Take Arena Load Test`);
console.log(`   Simulating ${PLAYER_COUNT} submissions\n`);
console.log(`   Batches: ${Math.ceil(PLAYER_COUNT / 25)} (25 per batch, max 6 concurrent)\n`);

const startTime = performance.now();
let firstRoastTime = null;
let roastCount = 0;

function onRoast(roast) {
  roastCount++;
  if (!firstRoastTime) {
    firstRoastTime = performance.now();
    const elapsed = ((firstRoastTime - startTime) / 1000).toFixed(2);
    console.log(`   ⚡ First roast in ${elapsed}s → [${roast.playerName}] score: ${roast.score}`);
  }
  if (roastCount % 25 === 0 || roastCount === PLAYER_COUNT) {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`   📊 ${roastCount}/${PLAYER_COUNT} roasts received (${elapsed}s)`);
  }
}

try {
  const results = await judgeSubmissions(PROMPT, submissions, onRoast);

  const totalTime = ((performance.now() - startTime) / 1000).toFixed(2);
  const firstTime = firstRoastTime
    ? ((firstRoastTime - startTime) / 1000).toFixed(2)
    : "N/A";

  console.log(`\n   ✅ Done!`);
  console.log(`   ─────────────────────────────`);
  console.log(`   Total roasts:      ${results.length}/${PLAYER_COUNT}`);
  console.log(`   Time to first:     ${firstTime}s`);
  console.log(`   Total time:        ${totalTime}s`);
  console.log(`   Avg per roast:     ${(totalTime / results.length).toFixed(3)}s`);
  console.log(`   Throughput:        ${(results.length / totalTime).toFixed(1)} roasts/sec\n`);

  if (results.length < PLAYER_COUNT) {
    console.log(`   ⚠️  Missing ${PLAYER_COUNT - results.length} roasts (batch failures or parsing issues)\n`);
  }
} catch (err) {
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  console.error(`\n   ❌ Failed after ${elapsed}s: ${err.message}\n`);
  if (roastCount > 0) {
    console.log(`   (${roastCount} roasts were delivered before failure)\n`);
  }
  process.exit(1);
}
