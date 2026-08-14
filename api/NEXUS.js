import { GoogleGenAI } from "@google/genai";

/*
=========================================================
                    AZHRT NEXUS
=========================================================

Fast AI Router

Primary:
  Random:
    - GLM5
    - Claude 3.5
    - Blackbox

Fallback:
  - Grok
  - Gemini 2.5 Flash

Any:
  402
  401
  403
  408
  429
  500
  502
  503
  504
  Timeout

=> يعتبر فشل وينتقل للمزود التالي.

=========================================================
*/


/* =======================================================
   CONFIG
======================================================= */

const FAST_TIMEOUT = 1800;
const GEMINI_TIMEOUT = 1800;
const GROK_TIMEOUT = 1800;

const COOLDOWN_MS = 10 * 60 * 60 * 1000;


/* =======================================================
   GEMINI KEYS
======================================================= */

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


/* =======================================================
   GROK
======================================================= */

const GROK_API_KEY =
  process.env.GROK_API_KEY || "";

const GROK_MODEL =
  process.env.GROK_MODEL || "grok-3-mini";


/* =======================================================
   PERSONALITY
======================================================= */

const DEFAULT_PERSONALITY = `
أنت AZHRT NEXUS، مساعد ذكاء اصطناعي تابع لـ Azhrt.

كن:
- ذكيًا
- سريعًا
- دقيقًا
- ودودًا
- احترافيًا
- مختصرًا عند الحاجة

افهم جميع اللغات واللهجات، ومنها العربية واللهجة المصرية.
اكتشف لغة المستخدم ورد عليه بنفس اللغة.

أجب مباشرة بدون مقدمات طويلة.
لا تكرر الكلام.
لا تخترع معلومات.
إذا لم تكن متأكدًا فاذكر أنك غير متأكد.

لا تكشف:
- مفاتيح API
- مزود الذكاء الاصطناعي
- أسماء النماذج
- الخادم
- نظام التوجيه
- نظام Fallback
- الأخطاء الداخلية

أنت AZHRT NEXUS.
`;


/* =======================================================
   PROVIDER STATE
======================================================= */

const state = {

  glm5: {
    failedAt: 0
  },

  claude35: {
    failedAt: 0
  },

  blackbox: {
    failedAt: 0
  },

  grok: {
    failedAt: 0
  },

  gemini: {
    failedAt: 0
  }

};


/* =======================================================
   COOLDOWN
======================================================= */

function isAvailable(name) {

  const item = state[name];

  if (!item) return true;

  if (!item.failedAt) return true;

  return (
    Date.now() - item.failedAt >= COOLDOWN_MS
  );

}


function markFailed(name) {

  if (state[name]) {
    state[name].failedAt = Date.now();
  }

}


function markSuccess(name) {

  if (state[name]) {
    state[name].failedAt = 0;
  }

}


/* =======================================================
   TIMEOUT FETCH
======================================================= */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = FAST_TIMEOUT
) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {

    return await fetch(
      url,
      {
        ...options,
        signal: controller.signal
      }
    );

  } finally {

    clearTimeout(timer);

  }

}


/* =======================================================
   JSON
======================================================= */

async function safeJSON(response) {

  try {

    return await response.json();

  } catch {

    return null;

  }

}


/* =======================================================
   EXTRACT TEXT
======================================================= */

function extractText(data) {

  if (!data) return "";

  const candidates = [

    data.message,

    data.reply,

    data.response,

    data.text,

    data.output,

    data.content,

    data?.choices?.[0]?.message?.content,

    data?.choices?.[0]?.text

  ];

  for (const value of candidates) {

    if (
      typeof value === "string" &&
      value.trim()
    ) {

      return value.trim();

    }

  }

  return "";

}


/* =======================================================
   VALIDATE RESPONSE
======================================================= */

function validateResponse(
  response,
  data
) {

  /*
    أي HTTP error = فشل
  */

  if (!response.ok) {

    const error =
      new Error(
        `HTTP_${response.status}`
      );

    error.status =
      response.status;

    throw error;

  }


  const text =
    extractText(data);


  if (!text) {

    throw new Error(
      "EMPTY_RESPONSE"
    );

  }


  /*
    منع رسائل الخطأ من اعتبارها ردًا
  */

  const badMessages = [

    "payment required",
    "queue full",
    "api key budget too low",
    "bad gateway",
    "internal server error",
    "service unavailable",
    "too many requests",
    "unauthorized",
    "forbidden",
    "gateway timeout"

  ];


  const lower =
    text.toLowerCase();


  for (
    const bad of badMessages
  ) {

    if (
      lower.includes(bad)
    ) {

      throw new Error(
        "INVALID_PROVIDER_RESPONSE"
      );

    }

  }


  return text;

}


/* =======================================================
   BUILD PROMPT
======================================================= */

function buildPrompt(
  prompt,
  systemPrompt,
  history
) {

  const personality =
    (
      typeof systemPrompt === "string" &&
      systemPrompt.trim()
    )
      ? systemPrompt.slice(0, 10000)
      : (
          process.env.AI_SYSTEM_PROMPT ||
          DEFAULT_PERSONALITY
        );


  let finalPrompt =
    personality.trim();


  if (
    Array.isArray(history) &&
    history.length
  ) {

    finalPrompt +=
      "\n\nسياق المحادثة:\n";


    for (
      const item of history.slice(-10)
    ) {

      if (!item) continue;


      const role =
        item.role === "assistant"
          ? "AZHRT NEXUS"
          : "المستخدم";


      const content =
        typeof item.content === "string"
          ? item.content.trim()
          : "";


      if (content) {

        finalPrompt +=
          `${role}: ${content}\n`;

      }

    }

  }


  finalPrompt +=
    `\n\nرسالة المستخدم:\n${prompt}`;


  return finalPrompt;

}


/* =======================================================
   GLM5
======================================================= */

async function callGLM(prompt) {

  const url =
    new URL(
      "https://soloapi.vercel.app/api/ai/glm5"
    );


  url.searchParams.set(
    "q",
    prompt
  );


  const response =
    await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",

        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json"
        }
      },
      FAST_TIMEOUT
    );


  const data =
    await safeJSON(response);


  return validateResponse(
    response,
    data
  );

}


/* =======================================================
   CLAUDE
======================================================= */

async function callClaude(prompt) {

  const url =
    new URL(
      "https://soloapi.vercel.app/api/ai/claude35"
    );


  url.searchParams.set(
    "q",
    prompt
  );


  const response =
    await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",

        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json"
        }
      },
      FAST_TIMEOUT
    );


  const data =
    await safeJSON(response);


  return validateResponse(
    response,
    data
  );

}


/* =======================================================
   BLACKBOX
======================================================= */

async function callBlackbox(prompt) {

  const url =
    new URL(
      "https://soloapi.vercel.app/api/ai/blackbox"
    );


  url.searchParams.set(
    "q",
    prompt
  );


  const response =
    await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",

        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json"
        }
      },
      FAST_TIMEOUT
    );


  const data =
    await safeJSON(response);


  return validateResponse(
    response,
    data
  );

}


/* =======================================================
   GROK
======================================================= */

async function callGrok(prompt) {

  if (!GROK_API_KEY) {

    throw new Error(
      "GROK_NOT_CONFIGURED"
    );

  }


  const response =
    await fetchWithTimeout(

      "https://api.x.ai/v1/chat/completions",

      {
        method: "POST",

        headers: {

          "Authorization":
            `Bearer ${GROK_API_KEY}`,

          "Content-Type":
            "application/json",

          "Accept":
            "application/json"

        },

        body: JSON.stringify({

          model:
            GROK_MODEL,

          messages: [

            {
              role: "user",
              content: prompt
            }

          ],

          temperature: 0.7

        })

      },

      GROK_TIMEOUT

    );


  const data =
    await safeJSON(response);


  return validateResponse(
    response,
    data
  );

}


/* =======================================================
   GEMINI
======================================================= */

async function callGemini(prompt) {

  if (
    !GEMINI_KEYS.length
  ) {

    throw new Error(
      "NO_GEMINI_KEYS"
    );

  }


  let lastError =
    null;


  /*
    جرب المفاتيح
  */

  for (
    const key of GEMINI_KEYS
  ) {

    try {

      const ai =
        new GoogleGenAI({
          apiKey: key
        });


      const result =
        await Promise.race([

          ai.models.generateContent({

            model:
              "gemini-2.5-flash",

            contents:
              prompt

          }),

          new Promise(
            (_, reject) => {

              setTimeout(
                () => reject(
                  new Error(
                    "GEMINI_TIMEOUT"
                  )
                ),
                GEMINI_TIMEOUT
              );

            }
          )

        ]);


      const text =
        result?.text;


      if (
        !text ||
        typeof text !== "string" ||
        !text.trim()
      ) {

        throw new Error(
          "EMPTY_GEMINI"
        );

      }


      return text.trim();

    } catch (error) {

      lastError =
        error;

    }

  }


  throw (
    lastError ||
    new Error(
      "GEMINI_FAILED"
    )
  );

}


/* =======================================================
   RUN PROVIDER
======================================================= */

async function runProvider(
  name,
  fn,
  prompt
) {

  if (
    !isAvailable(name)
  ) {

    throw new Error(
      `${name}_COOLDOWN`
    );

  }


  const start =
    Date.now();


  try {

    const result =
      await fn(prompt);


    if (
      !result ||
      !result.trim()
    ) {

      throw new Error(
        "EMPTY_RESPONSE"
      );

    }


    markSuccess(name);


    console.log(
      `[NEXUS] ${name} OK ${Date.now() - start}ms`
    );


    return result.trim();

  } catch (error) {

    markFailed(name);


    console.log(
      `[NEXUS] ${name} FAILED:`,
      error?.message
    );


    throw error;

  }

}


/* =======================================================
   RANDOM SOLO PROVIDER
======================================================= */

function getRandomSolo() {

  const providers = [

    {
      name: "glm5",
      fn: callGLM
    },

    {
      name: "claude35",
      fn: callClaude
    },

    {
      name: "blackbox",
      fn: callBlackbox
    }

  ];


  /*
    تجاهل المزودات الموجودة في cooldown
  */

  const availableProviders =
    providers.filter(
      provider =>
        isAvailable(provider.name)
    );


  if (
    !availableProviders.length
  ) {

    return null;

  }


  const index =
    Math.floor(
      Math.random() *
      availableProviders.length
    );


  return availableProviders[index];

}


/* =======================================================
   SMART GENERATOR
======================================================= */

async function generate(
  prompt
) {

  /*
    1
    اختيار عشوائي من:
    GLM5 / Claude / Blackbox
  */

  const first =
    getRandomSolo();


  if (first) {

    try {

      const result =
        await runProvider(
          first.name,
          first.fn,
          prompt
        );


      if (result) {

        return result;

      }

    } catch {

      console.log(
        `[NEXUS] ${first.name} failed`
      );

    }

  }


  /*
    2
    Grok
  */

  if (
    isAvailable("grok")
  ) {

    try {

      const result =
        await runProvider(
          "grok",
          callGrok,
          prompt
        );


      if (result) {

        return result;

      }

    } catch {

      console.log(
        "[NEXUS] Grok failed"
      );

    }

  }


  /*
    3
    Gemini
  */

  if (
    isAvailable("gemini")
  ) {

    try {

      const result =
        await runProvider(
          "gemini",
          callGemini,
          prompt
        );


      if (result) {

        return result;

      }

    } catch {

      console.log(
        "[NEXUS] Gemini failed"
      );

    }

  }


  /*
    4
    لو كل شيء فشل
  */

  throw new Error(
    "ALL_PROVIDERS_FAILED"
  );

}


/* =======================================================
   VERCEL HANDLER
======================================================= */

export default async function handler(
  req,
  res
) {

  /*
    CORS
  */

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );


  /*
    OPTIONS
  */

  if (
    req.method === "OPTIONS"
  ) {

    return res
      .status(200)
      .end();

  }


  try {

    let prompt = "";

    let systemPrompt = "";

    let history = [];


    /*
    ================================================
    GET

    /api/NEXUS?q=مرحبا
    ================================================
    */

    if (
      req.method === "GET"
    ) {

      prompt =
        req.query?.q ||
        req.query?.prompt ||
        "";

      systemPrompt =
        req.query?.systemPrompt ||
        "";

    }


    /*
    ================================================
    POST
    ================================================
    */

    else if (
      req.method === "POST"
    ) {

      const body =
        req.body || {};


      prompt =
        typeof body.prompt === "string"
          ? body.prompt.trim()
          : "";


      systemPrompt =
        typeof body.systemPrompt === "string"
          ? body.systemPrompt
          : "";


      history =
        Array.isArray(body.history)
          ? body.history
          : [];

    }


    /*
    ================================================
    INVALID METHOD
    ================================================
    */

    else {

      return res
        .status(405)
        .json({

          success: false,

          error:
            "Method not allowed"

        });

    }


    /*
    ================================================
    VALIDATION
    ================================================
    */

    if (
      typeof prompt !== "string"
    ) {

      prompt =
        String(prompt);

    }


    prompt =
      prompt.trim();


    if (!prompt) {

      return res
        .status(400)
        .json({

          success: false,

          error:
            "Prompt is required"

        });

    }


    if (
      prompt.length > 20000
    ) {

      return res
        .status(413)
        .json({

          success: false,

          error:
            "Prompt is too long"

        });

    }


    /*
    ================================================
    BUILD
    ================================================
    */

    const finalPrompt =
      buildPrompt(
        prompt,
        systemPrompt,
        history
      );


    /*
    ================================================
    GENERATE
    ================================================
    */

    const start =
      Date.now();


    const reply =
      await generate(
        finalPrompt
      );


    const responseTime =
      Date.now() - start;


    /*
    ================================================
    SUCCESS
    ================================================
    */

    return res
      .status(200)
      .json({

        success: true,

        reply,

        engine:
          "AZHRT NEXUS",

        responseTime,

        timestamp:
          new Date().toISOString()

      });


  } catch (error) {

    /*
    =================================================
    ALL FAILED

    لا نظهر:
      402
      429
      502
      API key
      Cloudflare
      Grok error
      Gemini error
      SoloAPI error

    للمستخدم.
    =================================================
    */

    console.error(
      "[AZHRT NEXUS] ALL PROVIDERS FAILED:",
      error?.message || error
    );


    return res
      .status(503)
      .json({

        success: false,

        engine:
          "AZHRT NEXUS",

        reply:
          "AzhrtAi غير قادر على الرد على طلبات كثيره حاليًا، حاول مرة أخرى بعد قليل."

      });

  }

}
