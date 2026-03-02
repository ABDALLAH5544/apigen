import { GoogleGenAI } from "@google/genai";

// جميع مفاتيح Gemini API المتاحة
const KEYS = [
  process.env.GEMINI_API_KEY1,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
  process.env.GEMINI_API_KEY4,
  process.env.GEMINI_API_KEY5
].filter(Boolean);

// السماح لكل المواقع (تجنب مشاكل CORS)
const ALLOWED_ORIGINS = ["*"];

export default async function handler(req, res) {
  // السماح بالـ CORS لأي موقع
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  for (let i = 0; i < KEYS.length; i++) {
    const key = KEYS[i];
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      // استخرج الرد
      const text =
        result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
        result?.text ||
        "لا يوجد رد";

      return res.status(200).json({ reply: text });

    } catch (error) {
      console.log(`Key ${i + 1} فشل، جرب المفتاح التالي...`);
      continue; // جرب المفتاح اللي بعده
    }
  }

  // لو كل المفاتيح فشلت
  return res.status(500).json({ error: "لقد وجب عليك تفعيل المفتاح من الزر الذى فى الأعلى" });
}
