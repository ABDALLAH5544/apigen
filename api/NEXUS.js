import { GoogleGenAI } from "@google/genai";

/*
=========================================================
                    AZHRT NEXUS
=========================================================

FLOW:

1) GROQ
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
   GROQ AGAIN

IMPORTANT:

- لا يوجد Cooldown لمدة 10 ساعات
- أي Provider يفشل يتم تجاوزه
- أول رد صحيح يفوز
- Solo الثلاثة يعملون معًا
- Gemini يعمل 2 Keys معًا
- لو Batch Gemini فشل ينتقل للـBatch التالي
- لو الدورة كلها فشلت يعيد من Groq
- MAX_CYCLES يمنع الدوران للأبد
- لا يتم إظهار أخطاء المزود للمستخدم
=========================================================
*/


/* =======================================================
   CONFIG
======================================================= */

const GROQ_TIMEOUT = 1800;
const SOLO_TIMEOUT = 1800;
const GEMINI_TIMEOUT = 1800;

/*
  أقصى مدة للدورة الواحدة.
*/
const CYCLE_TIMEOUT = 7500;

/*
  عدد مرات إعادة الدورة.

  1 =
  Groq → Solo → Gemini

  2 =
  Groq → Solo → Gemini
  ثم
  Groq → Solo → Gemini
*/
const MAX_CYCLES = 2;


/* =======================================================
   GROQ
======================================================= */

const GROQ_API_KEY =
  process.env.GROQ_API_KEY || "";

const GROQ_MODEL =
  process.env.GROQ_MODEL ||
  "llama-3.1-8b-instant";


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
- تفاصيل التشغيل الداخلية

أنت AZHRT NEXUS.
`;


/* =======================================================
   TIMEOUT FETCH
======================================================= */

async function fetchWithTimeout(
  url,
  options = {},
  timeout = 1800
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
        signal:
          controller.signal
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

    data?.choices?.[0]
      ?.message
      ?.content,

    data?.choices?.[0]
      ?.text,

    data?.candidates?.[0]
      ?.content
      ?.parts?.[0]
      ?.text

  ];


  for (
    const value of candidates
  ) {

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


  /*
    لا يوجد نص = فشل
  */

  if (!text) {

    throw new Error(
      "EMPTY_RESPONSE"
    );

  }


  /*
    منع بعض رسائل الخطأ من اعتبارها ردًا صحيحًا
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

      ? systemPrompt.slice(
          0,
          10000
        )

      : (

          process.env.AI_SYSTEM_PROMPT ||
          DEFAULT_PERSONALITY

        );


  let finalPrompt =
    personality.trim();


  /*
  =======================================================
  HISTORY
  =======================================================
  */

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


  /*
  =======================================================
  USER MESSAGE
  =======================================================
  */

  finalPrompt +=
    `\n\nرسالة المستخدم:\n${prompt}`;


  return finalPrompt;

}


/* =======================================================
   GROQ
======================================================= */

async function callGroq(prompt) {

  if (!GROQ_API_KEY) {

    throw new Error(
      "GROQ_NOT_CONFIGURED"
    );

  }


  const response =
    await fetchWithTimeout(

      "https://api.groq.com/openai/v1/chat/completions",

      {

        method: "POST",

        headers: {

          "Authorization":
            `Bearer ${GROQ_API_KEY}`,

          "Content-Type":
            "application/json",

          "Accept":
            "application/json"

        },

        body: JSON.stringify({

          model:
            GROQ_MODEL,

          messages: [

            {
              role: "user",
              content: prompt
            }

          ],

          temperature: 0.7

        })

      },

      GROQ_TIMEOUT

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


/* =======================================================
   GLM5
======================================================= */

async function callGLM(prompt) {

  return callSolo(
    "glm5",
    prompt
  );

}


/* =======================================================
   CLAUDE35
======================================================= */

async function callClaude(prompt) {

  return callSolo(
    "claude35",
    prompt
  );

}


/* =======================================================
   BLACKBOX
======================================================= */

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

  if (!key) {

    throw new Error(
      "EMPTY_GEMINI_KEY"
    );

  }


  const ai =
    new GoogleGenAI({
      apiKey: key
    });


  let timeout;


  try {

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

            timeout =
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

  } finally {

    if (timeout) {

      clearTimeout(timeout);

    }

  }

}


/* =======================================================
   GEMINI BATCH
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
  =======================================================
  مفتاحان معًا
  =======================================================
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
  =======================================================
  أول مفتاح ينجح يفوز
  =======================================================
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
  =======================================================
  BATCH 1
  Key1 + Key2
  =======================================================
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


    console.log(
      `[NEXUS] Gemini batch ${
        Math.floor(i / 2) + 1
      } started`
    );


    try {

      const result =
        await callGeminiBatch(
          batch,
          prompt
        );


      if (result) {

        console.log(
          `[NEXUS] Gemini batch ${
            Math.floor(i / 2) + 1
          } SUCCESS`
        );


        return result;

      }

    } catch (error) {

      console.log(
        `[NEXUS] Gemini batch ${
          Math.floor(i / 2) + 1
        } FAILED:`,
        error?.message
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
  =======================================================
  كل المزودات تعمل في نفس الوقت
  =======================================================
  */

  const attempts =
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

            `[NEXUS] ${provider.name} OK ` +
            `${Date.now() - start}ms`

          );


          return result.trim();

        } catch (error) {

          console.log(

            `[NEXUS] ${provider.name} FAILED ` +
            `${Date.now() - start}ms ` +
            `${error?.message || ""}`

          );


          throw error;

        }

      }
    );


  /*
  =======================================================
  أول نجاح يفوز
  =======================================================
  */

  try {

    return await Promise.any(
      attempts
    );

  } catch {

    throw new Error(
      "ALL_PARALLEL_PROVIDERS_FAILED"
    );

  }

}


/* =======================================================
   TIMEOUT
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
  =======================================================
  STEP 1
  GROQ
  =======================================================
  */

  console.log(
    "[NEXUS] STEP 1 → GROQ"
  );


  try {

    const result =
      await withTimeout(

        callGroq(prompt),

        GROQ_TIMEOUT + 300

      );


    if (result) {

      console.log(
        "[NEXUS] GROQ SUCCESS"
      );


      return result;

    }

  } catch (error) {

    console.log(
      "[NEXUS] GROQ FAILED:",
      error?.message
    );

  }


  /*
  =======================================================
  STEP 2
  GLM5 + CLAUDE35 + BLACKBOX
  =======================================================
  */

  console.log(
    "[NEXUS] STEP 2 → SOLO × 3"
  );


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
            name: "CLAUDE35",

            fn: () =>
              callClaude(prompt)

          },

          {
            name: "BLACKBOX",

            fn: () =>
              callBlackbox(prompt)

          }

        ]),

        SOLO_TIMEOUT + 700

      );


    if (result) {

      console.log(
        "[NEXUS] SOLO SUCCESS"
      );


      return result;

    }

  } catch (error) {

    console.log(
      "[NEXUS] ALL SOLO FAILED:",
      error?.message
    );

  }


  /*
  =======================================================
  STEP 3
  GEMINI
  =======================================================
  */

  console.log(
    "[NEXUS] STEP 3 → GEMINI"
  );


  try {

    const result =
      await withTimeout(

        callGemini(prompt),

        /*
          4 batches × 1800ms
          + هامش صغير
        */

        (GEMINI_TIMEOUT * 4) + 800

      );


    if (result) {

      console.log(
        "[NEXUS] GEMINI SUCCESS"
      );


      return result;

    }

  } catch (error) {

    console.log(
      "[NEXUS] ALL GEMINI FAILED:",
      error?.message
    );

  }


  /*
  =======================================================
  CYCLE FAILED
  =======================================================
  */

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
      `========================================`
    );


    console.log(
      `[NEXUS] CYCLE ${cycle}/${MAX_CYCLES}`
    );


    console.log(
      `========================================`
    );


    try {

      const result =
        await withTimeout(

          runCycle(prompt),

          CYCLE_TIMEOUT

        );


      if (result) {

        console.log(

          `[NEXUS] SUCCESS ` +
          `cycle=${cycle} ` +
          `time=${Date.now() - start}ms`

        );


        return result;

      }

    } catch (error) {

      console.log(

        `[NEXUS] CYCLE ${cycle} FAILED:`,
        error?.message

      );

    }


    /*
    =====================================================
    إعادة المحاولة
    =====================================================
    */

    if (
      cycle < MAX_CYCLES
    ) {

      console.log(
        "[NEXUS] RETRY → GROQ"
      );

    }

  }


  /*
  =======================================================
  كل شيء فشل
  =======================================================
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
  =======================================================
  CORS
  =======================================================
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
  =======================================================
  OPTIONS
  =======================================================
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
    INTERNAL LOG ONLY
    =====================================================
    */

    console.error(

      "[AZHRT NEXUS] FINAL FAILURE:",
      error?.message || error

    );


    /*
    =====================================================
    USER RESPONSE
    =====================================================
    */

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
