import OpenAI from "openai";

// ---------------------------------------------------------------------------
// MiniMax Streaming AI Judge
// ---------------------------------------------------------------------------

// Lazy-initialised so the server can start even without a valid API key.
let openai = null;

function getClient() {
  if (openai) return openai;

  if (!process.env.MINIMAX_API_KEY) {
    throw new Error(
      "MINIMAX_API_KEY is not set. Add it to your .env file to use the AI judge."
    );
  }

  openai = new OpenAI({
    baseURL: "https://api.minimax.io/v1",
    apiKey: process.env.MINIMAX_API_KEY,
  });

  return openai;
}

// ---------------------------------------------------------------------------
// System & user prompt builders
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the world's most entertaining talent show judge \u2014 a mix of Simon Cowell's brutal honesty and a comedy roast host. You're judging hot takes submitted by a live audience. Be savage, be funny, be specific to what they wrote. Every roast should be unique and reference their actual words. Keep each roast to 1-2 sentences max. Be concise \u2014 short roasts hit harder.`;

function buildUserPrompt(prompt, submissions) {
  const list = submissions
    .map((s) => `${s.index}. [${s.playerName}]: "${s.text}"`)
    .join("\n");

  return `Here is the game prompt the audience was responding to:
"${prompt}"

Here are the submissions:
${list}

Return ONLY a JSON array of objects, one per submission. Each object must have:
- "index": the submission number (integer)
- "roast": your savage, funny, specific roast of their answer (1-2 short sentences)
- "score": a rating from 1-10 for how good/spicy the hot take is

Output the results from LOWEST score first, building up to the HIGHEST score (save the best for last). Keep roasts SHORT. No markdown fences, no extra text \u2014 just the JSON array.`;
}

// ---------------------------------------------------------------------------
// Chunked JSON object parser
// ---------------------------------------------------------------------------

/**
 * Scans `buffer` for complete top-level `{ ... }` objects using brace
 * counting. Returns { parsed: [...], remainder: string }.
 */
function extractJsonObjects(buffer) {
  const parsed = [];
  let i = 0;

  while (i < buffer.length) {
    // Find the next opening brace
    const start = buffer.indexOf("{", i);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;

    for (let j = start; j < buffer.length; j++) {
      const ch = buffer[j];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }

    if (end === -1) {
      // Incomplete object \u2014 keep remainder starting from this brace
      break;
    }

    const candidate = buffer.slice(start, end + 1);
    try {
      const obj = JSON.parse(candidate);
      parsed.push(obj);
    } catch {
      // Malformed object \u2014 skip it
    }
    i = end + 1;
  }

  // Remainder is everything from the last unmatched '{' onward (or empty)
  const remainder = i < buffer.length ? buffer.slice(i) : "";

  return { parsed, remainder };
}

// ---------------------------------------------------------------------------
// Main export: judgeSubmissions
// ---------------------------------------------------------------------------

/**
 * Streams roasts from MiniMax and calls `onRoast` for each one as it arrives.
 *
 * @param {string}   prompt       - The game prompt
 * @param {Array}    submissions  - [{ index, playerName, text }, ...]
 * @param {Function} onRoast      - Called with { index, playerName, roast, score }
 * @returns {Promise<Array>}      - Resolves with all parsed roast objects
 */
const MAX_SUBMISSIONS = 50;

export async function judgeSubmissions(prompt, submissions, onRoast) {
  if (!submissions || submissions.length === 0) {
    return [];
  }

  // Cap submissions to avoid exceeding AI context window
  const capped = submissions.length > MAX_SUBMISSIONS
    ? submissions.slice(0, MAX_SUBMISSIONS)
    : submissions;

  const client = getClient();

  let stream;
  try {
    stream = await client.chat.completions.create({
      model: "MiniMax-M2",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(prompt, capped) },
      ],
      stream: true,
    });
  } catch (err) {
    throw new Error(`MiniMax API call failed: ${err.message}`);
  }

  // Build lookups so we can attach playerName, text, and socketId from submissions
  const playerLookup = new Map(capped.map((s) => [s.index, s.playerName]));
  const textLookup = new Map(capped.map((s) => [s.index, s.text]));
  const socketLookup = new Map(capped.map((s) => [s.index, s.socketId]));

  let buffer = "";
  const allResults = [];

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta?.content;
    if (!delta) continue;

    buffer += delta;

    // Strip leading markdown fences if present
    buffer = buffer.replace(/^```(?:json)?\s*/, "");

    const { parsed, remainder } = extractJsonObjects(buffer);
    buffer = remainder;

    for (const obj of parsed) {
      if (obj.index == null || obj.roast == null || obj.score == null) continue;

      const roast = {
        index: obj.index,
        playerName: playerLookup.get(obj.index) ?? `Player ${obj.index}`,
        text: textLookup.get(obj.index) ?? '',
        socketId: socketLookup.get(obj.index) ?? null,
        roast: obj.roast,
        score: obj.score,
      };

      allResults.push(roast);
      onRoast(roast);
    }
  }

  // Final sweep: buffer might have a trailing ``` or whitespace
  buffer = buffer.replace(/```\s*$/, "").trim();
  if (buffer.length > 0) {
    const { parsed } = extractJsonObjects(buffer);
    for (const obj of parsed) {
      if (obj.index == null || obj.roast == null || obj.score == null) continue;

      const roast = {
        index: obj.index,
        playerName: playerLookup.get(obj.index) ?? `Player ${obj.index}`,
        text: textLookup.get(obj.index) ?? '',
        socketId: socketLookup.get(obj.index) ?? null,
        roast: obj.roast,
        score: obj.score,
      };

      allResults.push(roast);
      onRoast(roast);
    }
  }

  return allResults;
}
