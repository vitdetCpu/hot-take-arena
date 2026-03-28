import { fal } from "@fal-ai/client";

// ---------------------------------------------------------------------------
// fal Whisper Speech-to-Text
// ---------------------------------------------------------------------------

// Configure fal with API key (lazy — only errors when actually called)
let configured = false;

function ensureConfigured() {
  if (configured) return;

  if (!process.env.FAL_KEY) {
    throw new Error(
      "FAL_KEY is not set. Add it to your .env file to use voice input."
    );
  }

  fal.config({ credentials: process.env.FAL_KEY });
  configured = true;
}

/**
 * Transcribe an audio buffer using fal Whisper.
 *
 * @param {Buffer} audioBuffer - Raw audio data
 * @param {string} contentType - MIME type (e.g. "audio/webm")
 * @returns {Promise<string>} - Transcribed text
 */
export async function transcribeAudio(audioBuffer, contentType) {
  ensureConfigured();

  // Determine file extension from content type
  const ext = contentType.includes("webm")
    ? "webm"
    : contentType.includes("mp4") || contentType.includes("m4a")
      ? "m4a"
      : contentType.includes("wav")
        ? "wav"
        : "webm";

  // Upload the audio to fal storage first
  const file = new File([audioBuffer], `recording.${ext}`, {
    type: contentType,
  });
  const audioUrl = await fal.storage.upload(file);

  // Run Whisper
  const result = await fal.run("fal-ai/whisper", {
    input: {
      audio_url: audioUrl,
    },
  });

  // Extract transcribed text from result
  const text =
    result?.data?.text ||
    result?.text ||
    result?.data?.chunks?.map((c) => c.text).join(" ") ||
    "";

  return text.trim();
}
