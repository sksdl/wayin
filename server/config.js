import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = process.env.WAYIN_ENV_FILE || path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

// Accepts the endpoint the way the Azure portal shows it (resource URL, .../openai/v1/ or a full
// .../responses URL) and returns the v1 base URL: https://<resource>.openai.azure.com/openai/v1/
export function azureBaseUrl(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    throw new Error(`AZURE_OPENAI_ENDPOINT is not a URL: "${raw}"`);
  }
  if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(u.hostname)) {
    throw new Error('AZURE_OPENAI_ENDPOINT must start with https://');
  }
  let p = u.pathname.replace(/\/+$/, '').replace(/\/(responses|chat\/completions)$/, '');
  if (!/\/openai\/v1$/.test(p)) p = `${p.replace(/\/openai$/, '')}/openai/v1`;
  return `${u.origin}${p}/`;
}

export function resolveConfig(env) {
  const port = Number(env.PORT || 8795);

  // Qloo: "live" calls the hackathon API with QLOO_API_KEY. "mock" answers from fixtures/qloo-mock
  // with the same response shapes, so the app can be built and tested before a key arrives.
  // A key turns live mode on; QLOO_MODE=mock forces the fixtures even with a key.
  const qlooMode = (env.QLOO_MODE || (env.QLOO_API_KEY ? 'live' : 'mock')).toLowerCase();
  if (!['live', 'mock'].includes(qlooMode)) throw new Error(`QLOO_MODE must be "live" or "mock" (got "${qlooMode}")`);
  if (qlooMode === 'live' && !env.QLOO_API_KEY) throw new Error('QLOO_MODE=live needs QLOO_API_KEY in .env');

  // AI: "azure-openai" runs the agent on an Azure OpenAI deployment (Responses API with function
  // tools). "off" runs the same plan with fixed rules and templates and no model at all.
  const aiMode = (env.AI_PROVIDER || (env.AZURE_OPENAI_API_KEY ? 'azure-openai' : 'off')).toLowerCase();
  if (!['off', 'azure-openai'].includes(aiMode)) throw new Error(`AI_PROVIDER must be "azure-openai" or "off" (got "${aiMode}")`);
  let azure = null;
  if (aiMode === 'azure-openai') {
    const missing = ['AZURE_OPENAI_ENDPOINT', 'AZURE_OPENAI_API_KEY', 'AZURE_OPENAI_DEPLOYMENT'].filter((k) => !env[k]);
    if (missing.length) throw new Error(`AI_PROVIDER=azure-openai needs ${missing.join(', ')} in .env`);
    azure = {
      baseUrl: azureBaseUrl(env.AZURE_OPENAI_ENDPOINT),
      apiKey: env.AZURE_OPENAI_API_KEY,
      deployment: env.AZURE_OPENAI_DEPLOYMENT,
    };
  }

  return {
    port,
    host: env.HOST || '127.0.0.1',
    publicUrl: env.PUBLIC_URL || `http://localhost:${port}`,
    dataDir: env.WAYIN_DATA_DIR || path.join(ROOT, 'data'),
    qlooMode,
    qlooBase: (env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, ''),
    qlooKey: qlooMode === 'live' ? env.QLOO_API_KEY : null,
    aiMode,
    azure,
    modelLabel: aiMode === 'azure-openai' ? env.AZURE_OPENAI_MODEL || env.AZURE_OPENAI_DEPLOYMENT : null,
    // Public demo guard rails. Runs per IP per hour; model-backed runs per day for the whole site
    // (past that, runs continue with fixed rules instead of failing); live Qloo calls per day.
    limits: {
      runsPerIpPerHour: Number(env.RUNS_PER_IP_PER_HOUR || 60),
      lookupsPerIpPerHour: Number(env.LOOKUPS_PER_IP_PER_HOUR || 300),
      modelRunsPerDay: Number(env.MODEL_RUNS_PER_DAY || 300),
      workspacesPerIpPerHour: Number(env.WORKSPACES_PER_IP_PER_HOUR || 20),
    },
    qlooDailyBudget: Number(env.QLOO_DAILY_BUDGET || 1500),
  };
}

export const config = resolveConfig(process.env);
