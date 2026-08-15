import { GoogleGenAI } from "@google/genai";

/*
=========================================================
                    AZHRT NEXUS
=========================================================

FLOW:

1) GROQ KEY 1
   ↓ فشل
2) GROQ KEY 2
   ↓ فشل
3) GLM5 + CLAUDE35 + BLACKBOX
   ↓ الثلاثة فشلوا
4) GEMINI KEY 1 + KEY 2
   ↓ فشلوا
5) GEMINI KEY 3 + KEY 4
   ↓ فشلوا
6) GEMINI KEY 5 + KEY 6
   ↓ فشلوا
7) GEMINI KEY 7 + KEY 8
   ↓ فشلوا
8) RETRY CYCLE
   ↓
   GROQ KEY 1 مرة أخرى

IMPORTANT:

- Groq واحد واحد
- Solo الثلاثة يعملون بالتوازي
- Gemini مفتاحين بالتوازي
- لا يوجد Cooldown
- لا يوجد توقف 10 ساعات
- أي HTTP Error = فشل
- Timeout = فشل
- Empty Response = فشل
- أول رد صحيح يفوز
- إذا فشل كل شيء يعيد الدورة
- لا تظهر الأخطاء الداخلية للمستخدم
=========================================================
*/


/* =======================================================
   CONFIG
======================================================= */

const GROQ_TIMEOUT = 1800;

const SOLO_TIMEOUT = 1800;

const GEMINI_TIMEOUT = 1800;


/*
  أقصى وقت للدورة.

  Groq:
  1.8s + 1.8s

  Solo:
  حوالي 1.8s

  Gemini:
  4 batches × 1.8s

  لذلك نترك مساحة كافية.
*/

const CYCLE_TIMEOUT = 10500;


/*
  عدد الدورات.

  الدورة الثانية تبدأ من Groq
  من جديد.
*/

const MAX_CYCLES = 2;


/* =======================================================
   GROQ
======================================================= */

const GROQ_KEYS = [

  process.env.GROQ_API_KEY1,

  process.env.GROQ_API_KEY2

].filter(Boolean);


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
`;


/* =======================================================
   FETCH WITH TIMEOUT
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
  أي HTTP Error = فشل
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
  Empty Response = فشل
  */

  if (!text) {

    throw new Error(
      "EMPTY_RESPONSE"
    );

  }


  /*
  رسائل الخطأ التي لا نعتبرها ردًا صالحًا
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

    "server error",

    "rate limit",

    "rate_limit",

    "quota exceeded",

    "overloaded"

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
  =====================================================
  HISTORY
  =====================================================
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
  =====================================================
  USER MESSAGE
  =====================================================
  */

  finalPrompt +=
    `\n\nرسالة المستخدم:\n${prompt}`;


  return finalPrompt;

}


/* =======================================================
   GROQ SINGLE KEY
======================================================= */

async function callGroqKey(
  key,
  keyNumber,
  prompt
) {

  if (!key) {

    throw new Error(
      "EMPTY_GROQ_KEY"
    );

  }


  const response =
    await fetchWithTimeout(

      "https://api.groq.com/openai/v1/chat/completions",

      {

        method: "POST",

        headers: {

          "Authorization":
            `Bearer ${key}`,

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

              content:
                prompt

            }

          ],

          temperature:
            0.7

        })

      },

      GROQ_TIMEOUT

    );


  const data =
    await safeJSON(response);


  const result =
    validateResponse(
      response,
      data
    );


  return result;

}


/* =======================================================
   GROQ
   KEY 1 → KEY 2
======================================================= */

async function callGroq(
  prompt
) {

  if (!GROQ_KEYS.length) {

    throw new Error(
      "NO_GROQ_KEYS"
    );

  }


  let lastError =
    null;


  /*
  =====================================================
  IMPORTANT:

  لا نستخدم Promise.all هنا.

  Key 1 أولًا.
  إذا فشل → Key 2.
  =====================================================
  */

  for (
    let i = 0;
    i < GROQ_KEYS.length;
    i++
  ) {

    const key =
      GROQ_KEYS[i];


    const keyNumber =
      i + 1;


    const start =
      Date.now();


    try {

      console.log(
        `[NEXUS] GROQ KEY ${keyNumber} START`
      );


      const result =
        await callGroqKey(

          key,

          keyNumber,

          prompt

        );


      if (
        result &&
        result.trim()
      ) {

        console.log(

          `[NEXUS] GROQ KEY ${keyNumber} SUCCESS ` +
          `${Date.now() - start}ms`

        );


        return result.trim();

      }


      throw new Error(
        "EMPTY_RESPONSE"
      );

    } catch (error) {

      lastError =
        error;


      console.log(

        `[NEXUS] GROQ KEY ${keyNumber} FAILED ` +
        `${Date.now() - start}ms ` +
        `${error?.message || ""}`

      );


      /*
        لا تتوقف.
        ينتقل مباشرة للمفتاح التالي.
      */

    }

  }


  throw (

    lastError ||

    new Error(
      "ALL_GROQ_KEYS_FAILED"
    )

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

async function callGLM(
  prompt
) {

  return callSolo(
    "glm5",
    prompt
  );

}


/* =======================================================
   CLAUDE35
======================================================= */

async function callClaude(
  prompt
) {

  return callSolo(
    "claude35",
    prompt
  );

}


/* =======================================================
   BLACKBOX
======================================================= */

async function callBlackbox(
  prompt
) {

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
  keyNumber,
  prompt
) {

  if (!key) {

    throw new Error(
      "EMPTY_GEMINI_KEY"
    );

  }


  const ai =
    new GoogleGenAI({

      apiKey:
        key

    });


  let timer;


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

            timer =
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

    if (timer) {

      clearTimeout(timer);

    }

  }

}


/* =======================================================
   FIRST SUCCESS
======================================================= */

async function firstSuccess(
  providers
) {

  if (!providers.length) {

    throw new Error(
      "NO_PROVIDERS"
    );

  }


  /*
  =====================================================
  تشغيل المزودات في نفس الوقت
  =====================================================
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

            typeof result !== "string" ||

            !result.trim()

          ) {

            throw new Error(
              "EMPTY_RESPONSE"
            );

          }


          console.log(

            `[NEXUS] ${provider.name} SUCCESS ` +
            `${Date.now() - start}ms`

          );


          return result.trim();

        } catch (error) {

          console.log(

            `[NEXUS] ${provider.name} FAILED ` +
            `${Date.now() - start}ms`

          );


          throw error;

        }

      }

    );


  try {

    return await Promise.any(
      attempts
    );

  } catch {

    throw new Error(
      "ALL_PARALLEL_FAILED"
    );

  }

}


/* =======================================================
   GEMINI BATCH
======================================================= */

async function callGeminiBatch(
  startIndex,
  prompt
) {

  const keys =
    GEMINI_KEYS.slice(

      startIndex,

      startIndex + 2

    );


  if (!keys.length) {

    throw new Error(
      "NO_GEMINI_KEYS"
    );

  }


  const providers =
    keys.map(

      (key, index) => ({

        name:
          `GEMINI_KEY_${
            startIndex + index + 1
          }`,

        fn:
          () =>
            callGeminiKey(

              key,

              startIndex + index + 1,

              prompt

            )

      })

    );


  /*
  =====================================================
  مفتاحين معًا
  =====================================================
  */

  return firstSuccess(
    providers
  );

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
  =====================================================
  1 + 2
  =====================================================
  */

  for (

    let i = 0;

    i < GEMINI_KEYS.length;

    i += 2

  ) {

    const batchNumber =
      Math.floor(i / 2) + 1;


    console.log(

      `[NEXUS] GEMINI BATCH ` +
      `${batchNumber} START`

    );


    try {

      const result =
        await callGeminiBatch(

          i,

          prompt

        );


      if (result) {

        console.log(

          `[NEXUS] GEMINI BATCH ` +
          `${batchNumber} SUCCESS`

        );


        return result;

      }

    } catch (error) {

      console.log(

        `[NEXUS] GEMINI BATCH ` +
        `${batchNumber} FAILED`

      );

    }

  }


  throw new Error(
    "ALL_GEMINI_FAILED"
  );

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
  GROQ KEY 1 → KEY 2
  =====================================================
  */

  console.log(
    "[NEXUS] STEP 1 → GROQ"
  );


  try {

    const result =
      await withTimeout(

        callGroq(
          prompt
        ),

        (GROQ_TIMEOUT * 2) + 500

      );


    if (result) {

      return result;

    }

  } catch (error) {

    console.log(
      "[NEXUS] GROQ FAILED"
    );

  }


  /*
  =====================================================
  STEP 2
  GLM5 + CLAUDE + BLACKBOX
  =====================================================
  */

  console.log(
    "[NEXUS] STEP 2 → SOLO × 3"
  );


  try {

    const result =
      await withTimeout(

        firstSuccess([

          {

            name:
              "GLM5",

            fn:
              () =>
                callGLM(
                  prompt
                )

          },


          {

            name:
              "CLAUDE35",

            fn:
              () =>
                callClaude(
                  prompt
                )

          },


          {

            name:
              "BLACKBOX",

            fn:
              () =>
                callBlackbox(
                  prompt
                )

          }

        ]),

        SOLO_TIMEOUT + 700

      );


    if (result) {

      return result;

    }

  } catch (error) {

    console.log(
      "[NEXUS] ALL SOLO FAILED"
    );

  }


  /*
  =====================================================
  STEP 3
  GEMINI
  ===================================================== */

  console.log(
    "[NEXUS] STEP 3 → GEMINI"
  );


  try {

    const result =
      await withTimeout(

        callGemini(
          prompt
        ),

        (GEMINI_TIMEOUT * 4) + 1000

      );


    if (result) {

      return result;

    }

  } catch (error) {

    console.log(
      "[NEXUS] ALL GEMINI FAILED"
    );

  }


  /*
  =====================================================
  CYCLE FAILED
  ===================================================== */

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
      "======================================"
    );


    console.log(

      `[NEXUS] CYCLE ` +
      `${cycle}/${MAX_CYCLES}`

    );


    console.log(
      "======================================"
    );


    try {

      const result =
        await withTimeout(

          runCycle(
            prompt
          ),

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

        `[NEXUS] CYCLE ${cycle} FAILED`

      );

    }


    /*
    =====================================================
    إذا فشلت الدورة:
    ابدأ دورة جديدة من Groq
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
  =====================================================
  CORS
  =====================================================
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
  =====================================================
  OPTIONS
  =====================================================
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
    INVALID METHOD
    =====================================================
    */

    else {

      return res
        .status(405)
        .json({

          success:
            false,

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

          success:
            false,

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

          success:
            false,

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

        success:
          true,

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
    INTERNAL LOG
    =====================================================
    */

    console.error(

      "[AZHRT NEXUS] FINAL FAILURE:",

      error?.message ||
      error

    );


    /*
    =====================================================
    USER RESPONSE
    =====================================================
    */

    return res
      .status(503)
      .json({

        success:
          false,

        engine:
          "AZHRT NEXUS",

        reply:
          "AzhrtAi غير قادر على الرد على طلبات كثيره حاليًا، حاول مرة أخرى بعد قليل."

      });

  }

}
