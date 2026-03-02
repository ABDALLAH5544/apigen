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

  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    const lastUsed = await kv.get(`gemini_key_${i}`); // اخر استخدام
    if (!lastUsed || now - lastUsed >= COOLDOWN_HOURS * 60 * 60 * 1000) {
      selectedKey = { key, index: i };
      break;
    }
  }

  if (!selectedKey) {
    return res.status(500).json({ error: "كل المفاتيح في فترة Cool-down" });
  }

  try {
    // استخدم المفتاح المحدد
    const ai = new GoogleGenAI({ apiKey: selectedKey.key });
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text =
      result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      result?.text ||
      "No response";

    // سجل آخر استخدام
    await kv.set(`gemini_key_${selectedKey.index}`, now);

    res.status(200).json({ reply: text });
  } catch (error) {
    console.error("Gemini API Error:", error.message);
    res.status(500).json({ error: "API Error" });
  }
}
