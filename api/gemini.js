import { GoogleGenAI } from "@google/genai";

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY1,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
  process.env.GEMINI_API_KEY4,
  process.env.GEMINI_API_KEY5,
  process.env.GEMINI_API_KEY6,
  process.env.GEMINI_API_KEY7,
  process.env.GEMINI_API_KEY8
].filter(Boolean);

const DEFAULT_PERSONALITY = `أنت AZHRT NEXUS، محرك ذكاء اصطناعي متقدم تابع لـAzhrt. كن ذكيًا، سريعًا، دقيقًا، ودودًا واحترافيًا. افهم العربية واللهجة المصرية والإنجليزية، وتكيف مع أسلوب المستخدم. أجب مباشرة وبوضوح دون إطالة أو تكرار. لا تخترع المعلومات، ولا تكشف مزود الذكاء الاصطناعي أو الـAPI أو نظام الـFallback.
`;

const health = {
  glm5: { failures: 0, cooldown: 0 },
  claude35: { failures: 0, cooldown: 0 },
  blackbox: { failures: 0, cooldown: 0 },
  gemini: { failures: 0, cooldown: 0 }
};

const MAX_FAILURES = 2;
const COOLDOWN = 30000;

function available(name) {
  return Date.now() >= health[name].cooldown;
}

function success(name) {
  health[name].failures = 0;
  health[name].cooldown = 0;
}

function failure(name) {
  health[name].failures++;

  if (health[name].failures >= MAX_FAILURES) {
    health[name].cooldown = Date.now() + COOLDOWN;
  }
}

async function fetchTimeout(url, options = {}, timeout = 7000) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(response) {
  if (!response.ok) {
    throw new Error(`HTTP_${response.status}`);
  }

  const data = await response.json();

  const text =
    data?.message ||
    data?.reply ||
    data?.response ||
    data?.text;

  if (!text || typeof text !== "string") {
    throw new Error("EMPTY_RESPONSE");
  }

  return text.trim();
}

function buildPrompt(prompt, systemPrompt, history) {
  const personality =
    systemPrompt ||
    process.env.AI_SYSTEM_PROMPT ||
    DEFAULT_PERSONALITY;

  let result = personality;

  if (Array.isArray(history) && history.length) {
    result += "\n\nسياق المحادثة:\n";

    for (const item of history.slice(-12)) {
      if (!item) continue;

      const role =
        item.role === "assistant"
          ? "AzhrtAI"
          : "المستخدم";

      const content =
        typeof item.content === "string"
          ? item.content
          : "";

      if (content) {
        result += `${role}: ${content}\n`;
      }
    }
  }

  result += `\nرسالة المستخدم:\n${prompt}\n`;

  return result;
}

/* =========================================================
   GLM5
========================================================= */

async function callGLM(prompt) {
  const url = new URL(
    "https://soloapi.vercel.app/api/ai/glm5"
  );

  url.searchParams.set("q", prompt);

  const response = await fetchTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json"
      }
    },
    6500
  );

  return parseResponse(response);
}

/* =========================================================
   CLAUDE 3.5
========================================================= */

async function callClaude(prompt) {
  const url = new URL(
    "https://soloapi.vercel.app/api/ai/claude35"
  );

  url.searchParams.set("q", prompt);

  const response = await fetchTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json"
      }
    },
    6500
  );

  return parseResponse(response);
}

/* =========================================================
   BLACKBOX
========================================================= */

async function callBlackbox(prompt) {
  const url = new URL(
    "https://soloapi.vercel.app/api/ai/blackbox"
  );

  url.searchParams.set("q", prompt);

  const response = await fetchTimeout(
    url.toString(),
    {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json"
      }
    },
    6500
  );

  return parseResponse(response);
}

/* =========================================================
   GEMINI + 8 KEYS
========================================================= */

async function callGemini(prompt) {
  if (!GEMINI_KEYS.length) {
    throw new Error("NO_GEMINI_KEYS");
  }

  let lastError = null;

  for (const key of GEMINI_KEYS) {
    try {
      const ai = new GoogleGenAI({
        apiKey: key
      });

      const result = await Promise.race([
        ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt
        }),

        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("GEMINI_TIMEOUT")),
            8500
          )
        )
      ]);

      const text = result?.text;

      if (!text || typeof text !== "string") {
        throw new Error("EMPTY_GEMINI_RESPONSE");
      }

      return text.trim();

    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("ALL_GEMINI_KEYS_FAILED");
}

/* =========================================================
   PROVIDER
========================================================= */

async function runProvider(name, fn, prompt) {
  if (!available(name)) {
    throw new Error(`${name}_COOLDOWN`);
  }

  const start = Date.now();

  try {
    const result = await fn(prompt);

    if (!result) {
      throw new Error("EMPTY_RESPONSE");
    }

    success(name);

    console.log(
      `[AzhrtAI] ${name}: ${Date.now() - start}ms`
    );

    return result;

  } catch (error) {
    failure(name);

    console.log(
      `[AzhrtAI] ${name}: failed`
    );

    throw error;
  }
}

/* =========================================================
   SMART ROUTER

   Priority:
   GLM5 → Claude → Blackbox → Gemini
========================================================= */

async function generate(prompt) {
  const providers = [
    ["glm5", callGLM],
    ["claude35", callClaude],
    ["blackbox", callBlackbox],
    ["gemini", callGemini]
  ];

  let lastError = null;

  for (const [name, fn] of providers) {
    try {
      return await runProvider(
        name,
        fn,
        prompt
      );
    } catch (error) {
      lastError = error;
    }
  }

  throw (
    lastError ||
    new Error("ALL_PROVIDERS_FAILED")
  );
}

/* =========================================================
   VERCEL API
========================================================= */

export default async function handler(req, res) {

  /* CORS */
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const body = req.body || {};

    const prompt =
      typeof body.prompt === "string"
        ? body.prompt.trim()
        : "";

    if (!prompt) {
      return res.status(400).json({
        error: "Prompt is required"
      });
    }

    if (prompt.length > 20000) {
      return res.status(413).json({
        error: "Prompt is too long"
      });
    }

    const systemPrompt =
      typeof body.systemPrompt === "string"
        ? body.systemPrompt.slice(0, 10000)
        : "";

    const history =
      Array.isArray(body.history)
        ? body.history
        : [];

    const finalPrompt = buildPrompt(
      prompt,
      systemPrompt,
      history
    );

    const reply = await generate(
      finalPrompt
    );

    return res.status(200).json({
      reply
    });

  } catch (error) {
    console.error(
      "[AzhrtAI] All providers failed"
    );

    return res.status(503).json({
      error:
        "خدمات الذكاء الاصطناعي غير متاحة حاليًا، حاول مرة أخرى."
    });
  }
                    }
