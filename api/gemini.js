import { GoogleGenAI } from "@google/genai";
import { kv } from "@vercel/kv";

const KEYS = [
  process.env.GEMINI_API_KEY1,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
  process.env.GEMINI_API_KEY4,
  process.env.GEMINI_API_KEY5
].filter(Boolean);

const COOLDOWN_HOURS = 25;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  const now = Date.now();
  let selectedKey = null;

  // اختار أول مفتاح مش في Cool-down
  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    const cooldownUntil = await kv.get(`gemini_key_cd_${i}`); // null أو timestamp
    if (!cooldownUntil || now >= cooldownUntil) {
      selectedKey = { key, index: i };
      break;
    }
  }

  if (!selectedKey) {
    return res.status(500).json({ error: "كل المفاتيح في فترة Cool-down" });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: selectedKey.key });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text =
      result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      result?.text ||
      "No response";

    res.status(200).json({ reply: text });

  } catch (error) {
    console.log(`Key ${selectedKey.index + 1} exhausted. Moving to next.`);

    // حط المفتاح في Cool-down 25 ساعة
    await kv.set(`gemini_key_cd_${selectedKey.index}`, now + COOLDOWN_HOURS * 60 * 60 * 1000);

    // جرب المفتاح التالي
    for (let j = 0; j < KEYS.length; j++) {
      if (j === selectedKey.index) continue;
      const nextKey = KEYS[j];
      const cooldownUntil = await kv.get(`gemini_key_cd_${j}`);
      if (!cooldownUntil || now >= cooldownUntil) {
        try {
          const ai2 = new GoogleGenAI({ apiKey: nextKey });
          const result2 = await ai2.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
          });
          const text2 =
            result2?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
            result2?.text ||
            "No response";

          return res.status(200).json({ reply: text2 });
        } catch (err2) {
          await kv.set(`gemini_key_cd_${j}`, now + COOLDOWN_HOURS * 60 * 60 * 1000);
          continue;
        }
      }
    }

    return res.status(500).json({ error: "كل المفاتيح في فترة Cool-down" });
  }
}
