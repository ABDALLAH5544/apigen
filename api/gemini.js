import { GoogleGenAI } from "@google/genai";
import { kv } from "@vercel/kv";

const KEYS = [
  process.env.GEMINI_API_KEY1,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
  process.env.GEMINI_API_KEY4,
  process.env.GEMINI_API_KEY5
].filter(Boolean);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  const now = Date.now();
  let selectedKey = null;

  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    const cooldown = await kv.get(`gemini_key_cd_${i}`);
    if (!cooldown || now >= cooldown) {
      selectedKey = { key, index: i };
      break;
    }
  }

  if (!selectedKey) return res.status(500).json({ error: "كل المفاتيح في فترة Cool-down" });

  try {
    const ai = new GoogleGenAI({ apiKey: selectedKey.key });
    const result = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });

    const text = result?.text || "No response";
    return res.status(200).json({ reply: text });
  } catch (err) {
    await kv.set(`gemini_key_cd_${selectedKey.index}`, now + 25*60*60*1000);
    return res.status(500).json({ error: "حدث خطأ في Gemini" });
  }
}
