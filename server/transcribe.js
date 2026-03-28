import { BatchClient } from "@speechmatics/batch-client";

// ---------------------------------------------------------------------------
// Speechmatics Batch STT
// ---------------------------------------------------------------------------

let client = null;

function getClient() {
  if (client) return client;

  if (!process.env.SPEECHMATICS_API_KEY) {
    throw new Error(
      "SPEECHMATICS_API_KEY is not set. Add it to your .env file for voice input."
    );
  }

  client = new BatchClient({
    apiKey: process.env.SPEECHMATICS_API_KEY,
    appId: "hot-take-arena",
  });

  return client;
}

/**
 * Transcribe an audio buffer using Speechmatics Batch API.
 *
 * @param {Buffer} audioBuffer - Raw audio data
 * @param {string} mimeType - e.g. "audio/webm", "audio/mp4"
 * @returns {Promise<string>} - Transcribed text
 */
export async function transcribeAudio(audioBuffer, mimeType) {
  const sm = getClient();

  // Convert Buffer to File (Speechmatics expects a File/Blob)
  const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("aac") ? "aac" : "webm";
  const blob = new Blob([audioBuffer], { type: mimeType });
  const file = new File([blob], `recording.${ext}`, { type: mimeType });

  const response = await sm.transcribe(
    file,
    {
      transcription_config: {
        language: "en",
        operating_point: "enhanced",
      },
    },
    "json-v2"
  );

  if (typeof response === "string") return response.trim();

  const text = response.results
    ?.map((r) => r.alternatives?.[0]?.content)
    .filter(Boolean)
    .join(" ");

  return text?.trim() || "";
}
