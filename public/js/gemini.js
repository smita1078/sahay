// Gemini through Firebase AI Logic (Gemini Developer API backend: no billing account needed).
// Same tasks, prompts and output shapes as the Python client (src/sahay/ai); every answer is
// schema-constrained JSON, retried once on failure, and callers fall back to local logic on error.
import { getAI, getGenerativeModel, GoogleAIBackend, Schema } from "../vendor/firebase-sdk.js";

const PROMPTS = {};
export async function loadPrompts(base = ".") {
  await Promise.all(["system", "read_frame", "ask", "translate", "scam", "understand"].map(async (name) => {
    PROMPTS[name] = await (await fetch(`${base}/prompts/${name}.md`)).text();
  }));
}

// Python string.Template: $name or ${name}.
export function renderPrompt(name, values) {
  return PROMPTS[name].replace(/\$(?:\{(\w+)\}|(\w+))/g, (m, a, b) => {
    const k = a || b;
    if (!(k in values)) throw new Error(`prompt ${name} needs ${k}`);
    return String(values[k]);
  });
}

const DOC_TYPES = ["AADHAAR", "PAN", "EPAN_PRINTOUT", "PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "NREGA_JOB_CARD", "NPR_LETTER", "OTHER", "NONE"];
const NEEDS = ["BLIND_LOW_VISION", "DEAF_HARD_OF_HEARING", "NO_FACIAL_GESTURES", "FINGERPRINTS_UNREADABLE", "CANNOT_SIGN", "CANNOT_TRAVEL", "NO_OWN_MOBILE", "NEEDS_SIMPLE_LANGUAGE"];
const OVDS = ["PASSPORT", "DRIVING_LICENCE", "VOTER_ID", "NREGA_JOB_CARD", "NPR_LETTER"];
const SIGNALS = ["ASKS_SECRET", "ASKS_DOCUMENTS", "REMOTE_ACCESS_APP", "LINK", "INSTALL_APP", "URGENCY_THREAT", "KYC_PRETEXT"];

const optionalString = (description) => Schema.string({ nullable: true, description });
const SCHEMAS = {
  read_frame: () => Schema.object({
    properties: {
      document_present: Schema.boolean({ description: "True if an identity document is visible in the photo." }),
      document_type: Schema.enumString({ enum: DOC_TYPES, description: "Best guess of the document type. NONE if no document." }),
      edges_cut_off: Schema.array({ items: Schema.enumString({ enum: ["left", "right", "top", "bottom"] }), description: "Sides of the document that run outside the photo, from the viewer's perspective." }),
      glare: Schema.boolean({ description: "True if reflection or shine makes any printed text hard to read." }),
      readable: Schema.boolean({ description: "True if the printed name and number are clearly legible." }),
      is_printout_of_e_document: Schema.boolean({ description: "True if this is a paper printout of a downloaded e-document (for example an e-PAN printed on paper) rather than the original card or a screen." }),
      name: optionalString("Holder's name exactly as printed, or null."),
      date_of_birth: optionalString("Date or year of birth as printed, or null."),
      download_date: optionalString("For a downloaded Aadhaar, the printed download or generation date as DD/MM/YYYY, or null if not printed."),
    },
    optionalProperties: ["name", "date_of_birth", "download_date"],
  }),
  ask: () => Schema.object({
    properties: {
      answer: Schema.string({ description: "Answer in the requested language, at most 80 words, simple words." }),
      rule_ids: Schema.array({ items: Schema.string(), description: "IDs of the rules the answer relies on, from the list provided." }),
    },
  }),
  translate: () => Schema.object({ properties: { text: Schema.string({ description: "Faithful translation. No additions, advice or hints." }) } }),
  scam: () => Schema.object({ properties: { signals: Schema.array({ items: Schema.enumString({ enum: SIGNALS }), description: "Every warning sign present in the message. Empty if none." }) } }),
  understand: () => Schema.object({
    properties: {
      needs: Schema.array({ items: Schema.enumString({ enum: NEEDS }), description: "Difficulties the person says they have. Empty if none." }),
      has_aadhaar: Schema.boolean({ nullable: true, description: "Whether they say they have Aadhaar; null if not said." }),
      pan: Schema.enumString({ enum: ["CARD", "E_PAN", "NONE"], nullable: true, description: "CARD for a PAN card, E_PAN for a downloaded e-PAN, NONE if they have no PAN; null if not said." }),
      other_ovds: Schema.array({ items: Schema.enumString({ enum: OVDS }), description: "Other identity documents they say they have." }),
      seeks_government_benefit: Schema.boolean({ nullable: true, description: "True if they want the account for a government pension, subsidy or scheme." }),
    },
    optionalProperties: ["has_aadhaar", "pan", "seeks_government_benefit"],
  }),
};
const REQUIRED = {
  read_frame: ["document_present", "document_type", "edges_cut_off", "glare", "readable", "is_printout_of_e_document"],
  ask: ["answer", "rule_ids"], translate: ["text"], scam: ["signals"], understand: ["needs", "other_ovds"],
};

export class GeminiError extends Error {}

export class Gemini {
  constructor(firebaseApp, model) {
    this.model = model;
    this.ai = getAI(firebaseApp, { backend: new GoogleAIBackend() });
    this.models = {};
  }

  modelFor(task) {
    if (!this.models[task]) {
      this.models[task] = getGenerativeModel(this.ai, {
        model: this.model,
        systemInstruction: PROMPTS.system,
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMAS[task](), temperature: 0.2 },
      });
    }
    return this.models[task];
  }

  // images: [{ data: base64, mimeType }]
  async generate(task, prompt, images = []) {
    const parts = [prompt, ...images.map((i) => ({ inlineData: { data: i.data, mimeType: i.mimeType || "image/jpeg" } }))];
    let last;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await this.modelFor(task).generateContent(parts);
        const out = JSON.parse(res.response.text());
        for (const k of REQUIRED[task]) if (!(k in out)) throw new GeminiError(`missing ${k}`);
        return out;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      }
    }
    throw new GeminiError(String(last && last.message ? last.message : last));
  }
}
