import { GoogleGenAI } from "@google/genai";

/*
=========================================================
                    AZHRT NEXUS
=========================================================

FLOW:

1) GROK
   ↓ failure
2) GLM5 + CLAUDE35 + BLACKBOX
   ↓ all failure
3) GEMINI
   Key1 + Key2
   ↓ both failure
   Key3 + Key4
   ↓ both failure
   Key5 + Key6
   ↓ both failure
   Key7 + Key8
   ↓ all failure
4) RETRY CYCLE
   ↓
   GROK AGAIN

IMPORTANT:
- No 10-hour cooldown
- Failed providers can retry
- First successful response wins
- Solo providers run simultaneously
- Gemini runs 2 keys simultaneously
- Global timeout prevents hanging forever
=========================================================
*/


/* =======================================================
   CONFIG
======================================================= */

const GROK_TIMEOUT = 1500;
const SOLO_TIMEOUT = 1500;
const GEMINI_TIMEOUT = 1500;

/*
  أقصى مدة للدورة الواحدة.
*/
const CYCLE_TIMEOUT = 5500;

/*
  أقصى عدد دورات.
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
   TIMEOUT FETCH
======================================================= */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = 1500
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

    data?.candidates?.[0]
      ?.content
      ?.parts?.[0]
      ?.text

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
   VALIDATE
======================================================= */

function validateResponse(
  response,
  data
) {

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
   SOLO API
======================================================= */

async function callSolo(
  endpoint,
  prompt
) {

  const url =
    new URL(
      `https://soloapi.vercel.app/api/ai/${endpoint}`
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

      SOLO_TIMEOUT

    );


  const data =
    await safeJSON(response);


  return validateResponse(
    response,
    data
  );

}


async function callGLM(prompt) {

  return callSolo(
    "glm5",
    prompt
  );

}


async function callClaude(prompt) {

  return callSolo(
    "claude35",
    prompt
  );

}


async function callBlackbox(prompt) {

  return callSolo(
    "blackbox",
    prompt
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
   GEMINI 2 KEYS AT A TIME
======================================================= */

async function callGeminiBatch(
  keys,
  prompt
) {

  if (!keys.length) {

    throw new Error(
      "NO_GEMINI_KEYS"
    );

  }


  /*
    تشغيل مفتاحين فقط معًا.
  */

  const attempts =
    keys.map(
      key =>
        callGeminiKey(
          key,
          prompt
        )
    );


  /*
    أول Key ينجح يفوز.
  */

  try {

    return await Promise.any(
      attempts
    );

  } catch {

    throw new Error(
      "GEMINI_BATCH_FAILED"
    );

  }

}


/* =======================================================
   GEMINI
======================================================= */

async function callGemini(
  prompt
) {

  if (!GEMINI_KEYS.length) {

    throw new Error(
      "NO_GEMINI_KEYS"
    );

  }


  /*
    1+2
    3+4
    5+6
    7+8
  */

  for (
    let i = 0;
    i < GEMINI_KEYS.length;
    i += 2
  ) {

    const batch =
      GEMINI_KEYS.slice(
        i,
        i + 2
      );


    try {

      const result =
        await callGeminiBatch(
          batch,
          prompt
        );


      if (result) {

        return result;

      }

    } catch {

      console.log(
        `[NEXUS] Gemini batch ${i / 2 + 1} failed`
      );

    }

  }


  throw new Error(
    "ALL_GEMINI_FAILED"
  );

}


/* =======================================================
   FIRST SUCCESS
======================================================= */

async function firstSuccess(
  providers
) {

  /*
    Promise.any:
    أول Promise ينجح يرجع فورًا.

    الـPromises الفاشلة يتم تجاهلها.
  */

  try {

    return await Promise.any(

      providers.map(
        async provider => {

          const start =
            Date.now();


          try {

            const result =
              await provider.fn();


            if (
              !result ||
              !result.trim()
            ) {

              throw new Error(
                "EMPTY_RESPONSE"
              );

            }


            console.log(
              `[NEXUS] ${provider.name} OK ${Date.now() - start}ms`
            );


            return result.trim();

          } catch (error) {

            console.log(
              `[NEXUS] ${provider.name} FAILED ${Date.now() - start}ms`
            );


            throw error;

          }

        }
      )

    );

  } catch {

    throw new Error(
      "ALL_PARALLEL_PROVIDERS_FAILED"
    );

  }

}


/* =======================================================
   TIMEOUT WRAPPER
======================================================= */

async function withTimeout(
  promise,
  timeout
) {

  let timer;


  const timeoutPromise =
    new Promise(
      (_, reject) => {

        timer =
          setTimeout(
            () => reject(
              new Error(
                "STAGE_TIMEOUT"
              )
            ),
            timeout
          );

      }
    );


  try {

    return await Promise.race([

      promise,

      timeoutPromise

    ]);

  } finally {

    clearTimeout(timer);

  }

}


/* =======================================================
   ONE CYCLE
======================================================= */

async function runCycle(
  prompt
) {

  /*
  =====================================================
  STEP 1
  GROK
  =====================================================
  */

  try {

    const result =
      await withTimeout(

        callGrok(prompt),

        GROK_TIMEOUT + 300

      );


    if (result) {

      return result;

    }

  } catch {

    console.log(
      "[NEXUS] Grok failed"
    );

  }


  /*
  =====================================================
  STEP 2
  THREE SOLO PROVIDERS TOGETHER
  =====================================================
  */

  try {

    const result =
      await withTimeout(

        firstSuccess([

          {
            name: "GLM5",
            fn: () =>
              callGLM(prompt)
          },

          {
            name: "Claude35",
            fn: () =>
              callClaude(prompt)
          },

          {
            name: "Blackbox",
            fn: () =>
              callBlackbox(prompt)
          }

        ]),

        SOLO_TIMEOUT + 500

      );


    if (result) {

      return result;

    }

  } catch {

    console.log(
      "[NEXUS] All Solo providers failed"
    );

  }


  /*
  =====================================================
  STEP 3
  GEMINI 2 + 2
  =====================================================
  */

  try {

    const result =
      await withTimeout(

        callGemini(prompt),

        /*
          4 batches × timeout
          لكن لا نتجاوز حد الدورة.
        */

        GEMINI_TIMEOUT * 4 + 500

      );


    if (result) {

      return result;

    }

  } catch {

    console.log(
      "[NEXUS] Gemini failed"
    );

  }


  throw new Error(
    "CYCLE_FAILED"
  );

}


/* =======================================================
   GENERATE
======================================================= */

async function generate(
  prompt
) {

  for (
    let cycle = 1;
    cycle <= MAX_CYCLES;
    cycle++
  ) {

    const start =
      Date.now();


    console.log(
      `[NEXUS] Cycle ${cycle} started`
    );


    try {

      const result =
        await withTimeout(

          runCycle(prompt),

          CYCLE_TIMEOUT

        );


      if (result) {

        console.log(
          `[NEXUS] SUCCESS cycle=${cycle} time=${Date.now() - start}ms`
        );


        return result;

      }

    } catch {

      console.log(
        `[NEXUS] Cycle ${cycle} failed`
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
    METHOD
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
    BUILD
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
    FINAL FAILURE
    =====================================================
    */

    console.error(
      "[AZHRT NEXUS] FAILED:",
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
