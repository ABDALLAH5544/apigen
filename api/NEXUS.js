import { GoogleGenAI } from "@google/genai";

/* =========================================================
   AZHRT NEXUS
   AI Provider:
   GLM5 → Claude 3.5 → Blackbox → Gemini 2.5 Flash
========================================================= */


/* =========================================================
   GEMINI KEYS
========================================================= */

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


/* =========================================================
   DEFAULT PERSONALITY
========================================================= */

const DEFAULT_PERSONALITY = `
أنت AZHRT NEXUS، محرك ذكاء اصطناعي متقدم تابع لـ Azhrt.

كن:
- ذكيًا
- سريعًا
- دقيقًا
- ودودًا
- احترافيًا
- واضحًا

افهم وتحدث جميع اللغات.
اكتشف لغة المستخدم تلقائيًا ورد عليه بنفس اللغة ما لم يطلب غير ذلك.
افهم اللهجات العربية، ومنها اللهجة المصرية.

أجب مباشرة وبوضوح.
لا تطل بدون حاجة.
لا تكرر الكلام.
لا تخترع المعلومات.
إذا لم تكن متأكدًا من معلومة، وضح ذلك.

لا تكشف:
- مزود الذكاء الاصطناعي
- مفاتيح API
- تفاصيل الخادم
- نظام التوجيه الداخلي
- نظام Fallback
- الأخطاء الداخلية
- أسماء النماذج الداخلية

أنت AZHRT NEXUS.
`;


/* =========================================================
   PROVIDER HEALTH
========================================================= */

const health = {

  glm5: {
    failures: 0,
    cooldown: 0
  },

  claude35: {
    failures: 0,
    cooldown: 0
  },

  blackbox: {
    failures: 0,
    cooldown: 0
  },

  gemini: {
    failures: 0,
    cooldown: 0
  }

};


/* =========================================================
   SETTINGS
========================================================= */

const MAX_FAILURES = 2;

/*
بعد فشل المزود مرتين يتم إيقاف تجربته مؤقتًا.
*/

const COOLDOWN = 30000;


/* =========================================================
   PROVIDER AVAILABLE
========================================================= */

function available(name) {

  if (!health[name]) {
    return true;
  }

  return Date.now() >= health[name].cooldown;

}


/* =========================================================
   PROVIDER SUCCESS
========================================================= */

function success(name) {

  if (!health[name]) {
    return;
  }

  health[name].failures = 0;
  health[name].cooldown = 0;

}


/* =========================================================
   PROVIDER FAILURE
========================================================= */

function failure(name) {

  if (!health[name]) {
    return;
  }

  health[name].failures++;

  if (
    health[name].failures >= MAX_FAILURES
  ) {

    health[name].cooldown =
      Date.now() + COOLDOWN;

  }

}


/* =========================================================
   FETCH WITH TIMEOUT
========================================================= */

async function fetchTimeout(
  url,
  options = {},
  timeout = 7000
) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(() => {

      controller.abort();

    }, timeout);


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


/* =========================================================
   SAFE RESPONSE PARSER
=========================================================

   مهم جدًا:

   402
   401
   403
   404
   408
   429
   500
   502
   503
   504

   كلها تعتبر FAILURE
   ويتم الانتقال للمزود التالي.

========================================================= */

async function parseResponse(response) {

  let data = null;


  try {

    data = await response.json();

  } catch {

    throw new Error(
      `PROVIDER_HTTP_${response.status}`
    );

  }


  /*
    أي HTTP Error
    لا يتم إرساله للمستخدم.
  */

  if (!response.ok) {

    const error =
      new Error(
        `PROVIDER_HTTP_${response.status}`
      );

    error.providerStatus =
      response.status;

    error.providerData =
      data;

    throw error;

  }


  /*
    استخراج الرد من المزود
  */

  const text =
    data?.message ||
    data?.reply ||
    data?.response ||
    data?.text;


  /*
    رد فارغ = فشل
  */

  if (
    !text ||
    typeof text !== "string" ||
    !text.trim()
  ) {

    throw new Error(
      "EMPTY_RESPONSE"
    );

  }


  /*
    منع بعض رسائل الأخطاء الواضحة
    من اعتبارها ردًا صحيحًا.
  */

  const lower =
    text.toLowerCase();


  const suspiciousErrors = [

    "payment required",
    "api key budget too low",
    "internal server error",
    "method not allowed",
    "service unavailable",
    "bad gateway",
    "unauthorized",
    "forbidden",
    "too many requests"

  ];


  for (
    const errorText
    of suspiciousErrors
  ) {

    if (
      lower.includes(errorText)
    ) {

      throw new Error(
        "PROVIDER_ERROR_RESPONSE"
      );

    }

  }


  return text.trim();

}


/* =========================================================
   BUILD PROMPT
========================================================= */

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


  let result =
    personality.trim();


  /*
    Conversation history
  */

  if (
    Array.isArray(history) &&
    history.length
  ) {

    result +=
      "\n\nسياق المحادثة السابقة:\n";


    for (
      const item
      of history.slice(-12)
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

        result +=
          `${role}: ${content}\n`;

      }

    }

  }


  /*
    Current user message
  */

  result +=
    `\nرسالة المستخدم الحالية:\n${prompt}\n`;


  return result;

}


/* =========================================================
   GLM5
========================================================= */

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
    await fetchTimeout(

      url.toString(),

      {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0",

          Accept:
            "application/json"
        }
      },

      6500

    );


  return parseResponse(
    response
  );

}


/* =========================================================
   CLAUDE 3.5
========================================================= */

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
    await fetchTimeout(

      url.toString(),

      {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0",

          Accept:
            "application/json"
        }
      },

      6500

    );


  return parseResponse(
    response
  );

}


/* =========================================================
   BLACKBOX
========================================================= */

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
    await fetchTimeout(

      url.toString(),

      {
        method: "GET",

        headers: {
          "User-Agent":
            "Mozilla/5.0",

          Accept:
            "application/json"
        }
      },

      6500

    );


  return parseResponse(
    response
  );

}


/* =========================================================
   GEMINI
========================================================= */

async function callGemini(prompt) {

  /*
    لا توجد مفاتيح
  */

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
    تجربة كل مفاتيح Gemini
  */

  for (
    const key
    of GEMINI_KEYS
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
                () => {

                  reject(
                    new Error(
                      "GEMINI_TIMEOUT"
                    )
                  );

                },

                8500
              );

            }
          )

        ]);


      /*
        استخراج النص
      */

      const text =
        result?.text;


      if (
        !text ||
        typeof text !== "string" ||
        !text.trim()
      ) {

        throw new Error(
          "EMPTY_GEMINI_RESPONSE"
        );

      }


      return text.trim();


    } catch (error) {

      /*
        لو المفتاح فشل
        جرب المفتاح التالي.
      */

      lastError =
        error;

      continue;

    }

  }


  throw (
    lastError ||
    new Error(
      "ALL_GEMINI_KEYS_FAILED"
    )
  );

}


/* =========================================================
   RUN PROVIDER
========================================================= */

async function runProvider(
  name,
  fn,
  prompt
) {

  /*
    لو في cooldown
    لا تستخدم المزود.
  */

  if (
    !available(name)
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


    /*
      الرد يجب أن يكون صحيحًا
    */

    if (
      !result ||
      typeof result !== "string" ||
      !result.trim()
    ) {

      throw new Error(
        "EMPTY_RESPONSE"
      );

    }


    success(name);


    console.log(
      `[AZHRT NEXUS] ${name} SUCCESS - ${Date.now() - start}ms`
    );


    return result.trim();


  } catch (error) {

    /*
      سجل الخطأ داخليًا فقط
    */

    failure(name);


    console.log(
      `[AZHRT NEXUS] ${name} FAILED - ${error?.message || "UNKNOWN"}`
    );


    /*
      مهم:
      لا نرجع الخطأ للمستخدم.
      generate() سينتقل للمزود التالي.
    */

    throw error;

  }

}


/* =========================================================
   SMART FALLBACK ROUTER
=========================================================

   الأولوية:

   1. GLM5
   2. Claude 3.5
   3. Blackbox
   4. Gemini 2.5 Flash

========================================================= */

async function generate(prompt) {

  const providers = [

    [
      "glm5",
      callGLM
    ],

    [
      "claude35",
      callClaude
    ],

    [
      "blackbox",
      callBlackbox
    ],

    [
      "gemini",
      callGemini
    ]

  ];


  let lastError =
    null;


  /*
    تجربة كل مزود
    حتى الحصول على رد صحيح.
  */

  for (
    const [name, fn]
    of providers
  ) {

    /*
      لو المزود في cooldown
      تجاهله وانتقل للي بعده.
    */

    if (
      !available(name)
    ) {

      console.log(
        `[AZHRT NEXUS] ${name} SKIPPED`
      );

      continue;

    }


    try {

      console.log(
        `[AZHRT NEXUS] Trying ${name}...`
      );


      const result =
        await runProvider(
          name,
          fn,
          prompt
        );


      /*
        نجاح حقيقي
      */

      if (
        result &&
        typeof result === "string" &&
        result.trim()
      ) {

        return result.trim();

      }


      throw new Error(
        "EMPTY_RESPONSE"
      );


    } catch (error) {

      /*
        مهم جدًا:
        لا نرسل الخطأ للمستخدم.
      */

      lastError =
        error;


      console.log(
        `[AZHRT NEXUS] ${name} failed. Trying next provider...`
      );


      /*
        الانتقال مباشرة للموديل التالي
      */

      continue;

    }

  }


  /*
    جميع المزودين فشلوا
  */

  throw (
    lastError ||
    new Error(
      "ALL_PROVIDERS_FAILED"
    )
  );

}


/* =========================================================
   VERCEL HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {

  /* =======================================================
     CORS
  ======================================================= */

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


  /* =======================================================
     OPTIONS
  ======================================================= */

  if (
    req.method === "OPTIONS"
  ) {

    return res
      .status(200)
      .end();

  }


  try {

    let prompt =
      "";

    let systemPrompt =
      "";

    let history =
      [];


    /* =====================================================
       GET

       مثال:

       /api/NEXUS?q=مرحبا

    ===================================================== */

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


      if (
        typeof prompt !== "string"
      ) {

        prompt =
          String(prompt);

      }


      if (
        typeof systemPrompt !== "string"
      ) {

        systemPrompt =
          String(systemPrompt);

      }

    }


    /* =====================================================
       POST

       Android / Web App
    ===================================================== */

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
          ? body.systemPrompt.slice(
              0,
              10000
            )
          : "";


      history =
        Array.isArray(body.history)
          ? body.history
          : [];

    }


    /* =====================================================
       INVALID METHOD
    ===================================================== */

    else {

      return res
        .status(405)
        .json({

          success: false,

          error:
            "Method not allowed"

        });

    }


    /* =====================================================
       VALIDATION
    ===================================================== */

    prompt =
      prompt.trim();


    if (!prompt) {

      return res
        .status(400)
        .json({

          success: false,

          error:
            "Prompt is required",

          example:
            "/api/NEXUS?q=مرحبا"

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


    /* =====================================================
       BUILD FINAL PROMPT
    ===================================================== */

    const finalPrompt =
      buildPrompt(

        prompt,

        systemPrompt,

        history

      );


    /* =====================================================
       GENERATE
    ===================================================== */

    const start =
      Date.now();


    const reply =
      await generate(
        finalPrompt
      );


    const responseTime =
      Date.now() - start;


    /* =====================================================
       SUCCESS

       لا نرسل أي معلومات عن المزود الحقيقي.
    ===================================================== */

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

    /* =====================================================
       INTERNAL ERROR

       التفاصيل تظهر في Vercel Logs فقط.
       المستخدم لا يرى 402 أو API errors.
    ===================================================== */

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
          "عذرًا، لا أستطيع الرد حاليًا. حاول مرة أخرى بعد قليل."

      });

  }

}
