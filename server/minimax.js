import OpenAI from "openai";

// ---------------------------------------------------------------------------
// MiniMax Streaming AI Judge — Parallel Batched
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
      // Incomplete object — keep remainder starting from this brace
      break;
    }

    const candidate = buffer.slice(start, end + 1);
    try {
      const obj = JSON.parse(candidate);
      parsed.push(obj);
    } catch {
      // Malformed object — skip it
    }
    i = end + 1;
  }

  // Remainder is everything from the last unmatched '{' onward (or empty)
  const remainder = i < buffer.length ? buffer.slice(i) : "";

  return { parsed, remainder };
}

// ---------------------------------------------------------------------------
// Stream a single batch and call onRoast for each result
// ---------------------------------------------------------------------------

async function streamBatch(client, prompt, batchSubmissions, onRoast) {
  // Build lookups for this batch
  const playerLookup = new Map(batchSubmissions.map((s) => [s.index, s.playerName]));
  const textLookup = new Map(batchSubmissions.map((s) => [s.index, s.text]));
  const socketLookup = new Map(batchSubmissions.map((s) => [s.index, s.socketId]));

  const stream = await client.chat.completions.create({
    model: "MiniMax-M2",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(prompt, batchSubmissions) },
    ],
    stream: true,
  });

  let buffer = "";
  const results = [];

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
        text: textLookup.get(obj.index) ?? "",
        socketId: socketLookup.get(obj.index) ?? null,
        roast: obj.roast,
        score: obj.score,
      };

      results.push(roast);
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
        text: textLookup.get(obj.index) ?? "",
        socketId: socketLookup.get(obj.index) ?? null,
        roast: obj.roast,
        score: obj.score,
      };

      results.push(roast);
      onRoast(roast);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main export: judgeSubmissions (parallel batched)
// ---------------------------------------------------------------------------

const BATCH_SIZE = 25;

/**
 * Splits submissions into batches of ~25, fires all API calls in parallel,
 * and streams roasts back as they arrive from any batch.
 *
 * @param {string}   prompt       - The game prompt
 * @param {Array}    submissions  - [{ index, playerName, text, socketId }, ...]
 * @param {Function} onRoast      - Called with { index, playerName, roast, score }
 * @returns {Promise<Array>}      - Resolves with all parsed roast objects
 */
export async function judgeSubmissions(prompt, submissions, onRoast) {
  if (!submissions || submissions.length === 0) {
    return [];
  }

  const client = getClient();

  // Split into batches
  const batches = [];
  for (let i = 0; i < submissions.length; i += BATCH_SIZE) {
    batches.push(submissions.slice(i, i + BATCH_SIZE));
  }

  console.log(
    `[judge] ${submissions.length} submissions → ${batches.length} parallel batch(es) of ~${BATCH_SIZE}`
  );

  // Fire all batches in parallel — results stream back as they arrive
  const batchPromises = batches.map((batch) =>
    streamBatch(client, prompt, batch, onRoast)
  );

  // Wait for all batches to complete, collect results
  const batchResults = await Promise.all(batchPromises);
  return batchResults.flat();
}
