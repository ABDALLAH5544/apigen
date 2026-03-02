import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error("Error: GEMINI_API_KEY is not defined.");
      return res.status(500).json({ error: "Server configuration error." });
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    res.status(200).json({ reply: result.text });

  } catch (error) {
    console.error("Gemini 3 API Error:", error);
    res.status(500).json({
      error: "Failed to generate content.",
      details: error.message || error.toString()
    });
  }
}