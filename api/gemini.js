import { GoogleGenAI } from "@google/genai";

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
    if (!prompt) return res.status(400).json({ error: "Prompt is required" });

    let lastError = null;

    for (let i = 0; i < KEYS.length; i++) {
        const key = KEYS[i];
        try {
            const ai = new GoogleGenAI({ apiKey: key });
            const result = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt
            });

            const text =
                result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
                result?.text ||
                "لا يوجد رد";

            console.log(`Key ${i + 1} succeeded`);
            return res.status(200).json({ reply: text });

        } catch (error) {
            console.log(`Key ${i + 1} failed, trying next key...`);
            lastError = error;
            continue;
        }
    }

    console.error("All keys failed:", lastError);
    return res.status(500).json({ error: "لقد فشلت جميع المفاتيح، يرجى تفعيل المفتاح من الزر في الأعلى" });
}
