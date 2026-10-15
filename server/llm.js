// Azure OpenAI client for the agent. Uses the v1 Responses API because this deployment only
// accepts function tools together with reasoning there. Two calls are exported:
//   runTools(): a tool loop. The model calls our functions until it answers or hits the step cap.
//   structured(): one call that must return JSON matching a schema.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export class AiError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'AiError';
    this.detail = detail;
  }
}

// When the deployment refuses calls (expired credit, removed key, missing deployment) every run
// would wait for a failure. After such an error the model is treated as off for 30 minutes and
// runs go straight to the fixed-rule path; the page shows "AI paused" meanwhile.
let downUntil = 0;
let downReason = null;
export function modelStatus() {
  if (!config.azure) return { available: false, reason: 'AI is off' };
  if (Date.now() < downUntil) return { available: false, reason: downReason };
  return { available: true, reason: null };
}
function markDown(reason) {
  downUntil = Date.now() + 30 * 60 * 1000;
  downReason = reason;
}

function logCall(entry) {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.appendFileSync(path.join(config.dataDir, 'ai-calls.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    // usage logging must never break a request
  }
}

async function postWithRetry(url, init, waits = [1500, 5000]) {
  for (let i = 0; ; i++) {
    let res;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(120000) });
    } catch (e) {
      if (i >= waits.length) {
        markDown('Azure OpenAI could not be reached');
        throw new AiError(`Azure OpenAI could not be reached: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, waits[i]));
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && i < waits.length) {
      const after = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, after > 0 && after < 30 ? after * 1000 : waits[i]));
      continue;
    }
    return res;
  }
}

async function respond(body, job) {
  const started = Date.now();
  const res = await postWithRetry(`${config.azure.baseUrl}responses`, {
    method: 'POST',
    headers: { 'api-key': config.azure.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.azure.deployment, store: false, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  const usage = data.usage || {};
  const meta = { job, model: data.model || config.modelLabel, ms: Date.now() - started, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
  if (!res.ok) {
    const err = data.error || {};
    logCall({ ...meta, ok: false, status: res.status, code: err.code });
    if ([401, 403, 404].includes(res.status) || err.code === 'insufficient_quota' || err.code === 'DeploymentNotFound') markDown(`Azure OpenAI returned ${res.status}`);
    if (err.code === 'content_filter') throw new AiError('Azure content filtering blocked this request', err);
    throw new AiError(`Azure OpenAI returned HTTP ${res.status}${err.code ? ` ${err.code}` : ''}: ${err.message || 'no message'}`, err);
  }
  if (data.status === 'incomplete') {
    logCall({ ...meta, ok: false, incomplete: data.incomplete_details?.reason });
    throw new AiError(`The model stopped early (${data.incomplete_details?.reason || 'unknown reason'})`);
  }
  logCall({ ...meta, ok: true });
  return { data, meta };
}

function outputText(data) {
  return (data.output || [])
    .filter((o) => o.type === 'message')
    .flatMap((o) => o.content || [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('');
}

// tools: [{ name, description, parameters, run(args) -> result }]
// onEvent receives { kind: 'tool_call' | 'tool_result' | 'model', ... } for the live trace.
export async function runTools({ job, instructions, input, tools, maxSteps = 10, effort = 'low', onEvent = () => {} }) {
  const defs = tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: true }));
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const transcript = [...input];
  const usage = { calls: 0, input_tokens: 0, output_tokens: 0, ms: 0 };
  for (let step = 0; step < maxSteps; step++) {
    const { data, meta } = await respond(
      { instructions, input: transcript, tools: defs, reasoning: { effort }, include: ['reasoning.encrypted_content'], max_output_tokens: 6000 },
      job,
    );
    usage.calls++;
    usage.input_tokens += meta.input_tokens || 0;
    usage.output_tokens += meta.output_tokens || 0;
    usage.ms += meta.ms;
    onEvent({ kind: 'model', step, ms: meta.ms, model: meta.model });
    const calls = (data.output || []).filter((o) => o.type === 'function_call');
    transcript.push(...(data.output || []));
    if (!calls.length) return { text: outputText(data), usage, steps: step + 1 };
    for (const c of calls) {
      let args;
      try {
        args = JSON.parse(c.arguments || '{}');
      } catch {
        args = null;
      }
      onEvent({ kind: 'tool_call', name: c.name, args });
      let result;
      try {
        if (!byName[c.name]) throw new Error(`Unknown tool ${c.name}`);
        if (!args) throw new Error('Arguments were not valid JSON');
        result = await byName[c.name].run(args);
      } catch (e) {
        result = { error: e.message };
      }
      onEvent({ kind: 'tool_result', name: c.name, result });
      transcript.push({ type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(result).slice(0, 60000) });
    }
  }
  throw new AiError(`The agent did not finish within ${maxSteps} steps`);
}

export async function structured({ job, instructions, input, schema, effort = 'low', maxTokens = 8000 }) {
  const { data, meta } = await respond(
    {
      instructions,
      input: typeof input === 'string' ? [{ role: 'user', content: input }] : input,
      text: { format: { type: 'json_schema', name: job, strict: true, schema } },
      reasoning: { effort },
      max_output_tokens: maxTokens,
    },
    job,
  );
  const text = outputText(data);
  try {
    return { data: JSON.parse(text), meta };
  } catch {
    throw new AiError('The model returned text that is not valid JSON');
  }
}

export const S = {
  str: { type: 'string' },
  int: { type: 'integer' },
  num: { type: 'number' },
  bool: { type: 'boolean' },
  arr: (items) => ({ type: 'array', items }),
  obj: (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties }),
  oneOf: (values) => ({ type: 'string', enum: values }),
};
