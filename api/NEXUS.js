import { GoogleGenAI } from "@google/genai";

/*
=========================================================
                 AZHRT NEXUS v2
=========================================================

FAST AI ROUTER

ORDER:

1. Grok
2. Random:
   - GLM5
   - Claude 3.5
   - Blackbox
3. Gemini

FAILURE:
- 401
- 402
- 403
- 408
- 429
- 500
- 502
- 503
- 504
- Timeout
- Empty response
- Invalid response

=> يعتبر فشل وينتقل فورًا للمزود التالي.

NO LONG COOLDOWN.

Provider failed?
=> It can be used again in the next retry cycle.

=========================================================
*/


/* =======================================================
   CONFIG
======================================================= */

const FAST_TIMEOUT = 900;

const GROK_TIMEOUT = 1100;

const GEMINI_TIMEOUT = 1100;

/*
  أقصى وقت للطلب كله تقريبًا.
*/
const GLOBAL_TIMEOUT = 6500;

/*
  عدد دورات إعادة المحاولة.
*/
const MAX_CYCLES = 2;


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
   FETCH WITH TIMEOUT
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
   SAFE JSON
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

  if (!data) {
    return "";
  }

  const candidates = [

    data.message,

    data.reply,

    data.response,

    data.text,

    data.output,

    data.content,

    data?.choices?.[0]?.message?.content,

    data?.choices?.[0]?.text,

    data?.candidates?.[0]?.content?.parts?.[0]?.text

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
    منع رسائل الخطأ من اعتبارها ردًا.
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

    "gateway timeout",

    "temporarily unavailable",

    "request timeout",

    "server error"

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

      if (!item) {
        continue;
      }


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

          "User-Agent":
            "AZHRT-NEXUS",

          "Accept":
            "application/json"

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

          "User-Agent":
            "AZHRT-NEXUS",

          "Accept":
            "application/json"

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

          "User-Agent":
            "AZHRT-NEXUS",

          "Accept":
            "application/json"

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
   GEMINI SINGLE KEY
======================================================= */

async function callGeminiKey(
  key,
  prompt
) {

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

}


/* =======================================================
   GEMINI
======================================================= */

async function callGemini(prompt) {

  if (!GEMINI_KEYS.length) {

    throw new Error(
      "NO_GEMINI_KEYS"
    );

  }


  /*
    نجرب المفاتيح بالتوازي.

    أول مفتاح ينجح = النتيجة.
  */

  const attempts =
    GEMINI_KEYS.map(
      async key => {

        try {

          return await callGeminiKey(
            key,
            prompt
          );

        } catch {

          return null;

        }

      }
    );


  /*
    Promise.any ترجع أول نتيجة ناجحة.
  */

  try {

    return await Promise.any(
      attempts
    );

  } catch {

    throw new Error(
      "ALL_GEMINI_KEYS_FAILED"
    );

  }

}


/* =======================================================
   SHUFFLE
======================================================= */

function shuffle(array) {

  const result =
    [...array];


  for (
    let i = result.length - 1;
    i > 0;
    i--
  ) {

    const j =
      Math.floor(
        Math.random() * (i + 1)
      );


    [
      result[i],
      result[j]
    ] = [
      result[j],
      result[i]
    ];

  }


  return result;

}


/* =======================================================
   PROVIDERS
======================================================= */

function getFastProviders() {

  return shuffle([

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

  ]);

}


/* =======================================================
   RUN PROVIDER
======================================================= */

async function runProvider(
  name,
  fn,
  prompt
) {

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


    console.log(
      `[NEXUS] ${name} OK ${Date.now() - start}ms`
    );


    return result.trim();

  } catch (error) {

    console.log(
      `[NEXUS] ${name} FAILED ${Date.now() - start}ms`,
      error?.message || error
    );


    throw error;

  }

}


/* =======================================================
   GLOBAL TIMEOUT
======================================================= */

function createGlobalTimeout() {

  return new Promise(
    (_, reject) => {

      setTimeout(
        () => reject(
          new Error(
            "GLOBAL_TIMEOUT"
          )
        ),
        GLOBAL_TIMEOUT
      );

    }
  );

}


/* =======================================================
   SMART GENERATOR
======================================================= */

async function generate(
  prompt
) {

  /*
    Global timeout.

    مهما حصل لا نترك الطلب معلقًا
    إلى أجل غير محدود.
  */

  const work =
    generateWithRetry(
      prompt
    );


  return await Promise.race([

    work,

    createGlobalTimeout()

  ]);

}


/* =======================================================
   RETRY ENGINE
======================================================= */

async function generateWithRetry(
  prompt
) {

  for (
    let cycle = 1;
    cycle <= MAX_CYCLES;
    cycle++
  ) {

    console.log(
      `[NEXUS] Starting cycle ${cycle}`
    );


    /*
    =====================================================
    1. GROK FIRST
    =====================================================
    */

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
        "[NEXUS] Grok failed -> continue"
      );

    }


    /*
    =====================================================
    2. RANDOM FAST PROVIDERS

    لكن نجرب الثلاثة كلهم
    وليس واحدًا فقط.
    =====================================================
    */

    const providers =
      getFastProviders();


    for (
      const provider of providers
    ) {

      try {

        const result =
          await runProvider(

            provider.name,

            provider.fn,

            prompt

          );


        if (result) {

          return result;

        }

      } catch {

        console.log(
          `[NEXUS] ${provider.name} failed -> next`
        );

      }

    }


    /*
    =====================================================
    3. GEMINI
    =====================================================
    */

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
        "[NEXUS] Gemini failed -> next cycle"
      );

    }


    /*
    =====================================================
    RETRY
    =====================================================
    */

    if (
      cycle < MAX_CYCLES
    ) {

      console.log(
        "[NEXUS] Restarting provider cycle..."
      );

    }

  }


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
    =====================================================
    GET
    =====================================================

    /api/NEXUS?q=مرحبا
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
    =====================================================
    POST
    =====================================================
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
    =====================================================
    METHOD NOT ALLOWED
    =====================================================
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
    =====================================================
    VALIDATION
    =====================================================
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
    =====================================================
    BUILD PROMPT
    =====================================================
    */

    const finalPrompt =
      buildPrompt(

        prompt,

        systemPrompt,

        history

      );


    /*
    =====================================================
    GENERATE
    =====================================================
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
    =====================================================
    SUCCESS
    =====================================================
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
    =====================================================
    INTERNAL ERROR

    لا نكشف أي تفاصيل للمستخدم.
    =====================================================
    */

    console.error(
      "[AZHRT NEXUS] REQUEST FAILED:",
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
