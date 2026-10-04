import { GoogleGenAI } from '@google/genai';
import { DEBUG, GEMINI_API_KEY } from './config.ts';

let ai: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set on the server.');
  ai ??= new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return ai;
}

// In-memory cache to avoid duplicate translations for identical utterances
const translationCache = new Map<string, string>();
const MAX_CACHE_SIZE = 500;

/**
 * Translates a non-English transcript utterance into natural English using Gemini Flash.
 *
 * Runs asynchronously with a strict timeout guard. Returns null on failure
 * so the original transcript remains unaffected.
 */
export async function translateToEnglish(
  text: string,
  sourceLang = 'auto',
  timeoutMs = 3500,
): Promise<string | null> {
  const clean = text.trim();
  if (!clean) return null;

  if (translationCache.has(clean)) {
    return translationCache.get(clean)!;
  }

  if (!GEMINI_API_KEY) {
    if (DEBUG) console.warn('[translator] Cannot translate: GEMINI_API_KEY not configured');
    return null;
  }

  const prompt = `Translate the following text into natural, fluent English.
Return ONLY the direct English translation. Do NOT add quotes, markdown formatting, explanations, or conversational filler.

Source text:
${clean}`;

  const models = ['gemini-3.5-flash', 'gemini-3.8-flash'];

  for (const model of models) {
    try {
      const translationPromise = (async () => {
        const client = getClient();
        const res = await client.models.generateContent({
          model,
          contents: prompt,
        });
        const out = res.text?.trim() ?? '';
        // Clean any leading/trailing quotes or markdown code block fences if added
        return out.replace(/^["'`]|["'`]$/g, '').replace(/^```\w*\n?|\n?```$/g, '').trim();
      })();

      const timeoutPromise = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      );

      const result = await Promise.race([translationPromise, timeoutPromise]);
      if (result) {
        if (translationCache.size >= MAX_CACHE_SIZE) {
          const firstKey = translationCache.keys().next().value;
          if (firstKey) translationCache.delete(firstKey);
        }
        translationCache.set(clean, result);
        if (DEBUG) console.log(`[translator] [${sourceLang}->en]: "${clean}" -> "${result}" (${model})`);
        return result;
      }
    } catch (err) {
      if (DEBUG) console.warn(`[translator] ${model} translation failed:`, (err as Error).message);
    }
  }

  return null;
}
