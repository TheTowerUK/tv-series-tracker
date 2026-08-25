import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const staticEntries = Object.freeze(["index.html", "css", "data", "js", "vendor/supabase-js"]);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

function fail(message) {
  throw new Error(message);
}

function validateOutput(value) {
  if (!value) fail("--output is required");
  const output = resolve(value);
  const relation = relative(repositoryRoot, output);
  const insideRepository = relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
  const ignoredTestOutput = /^node_modules(?:[\\/]|$)/.test(relation);
  if (output === repositoryRoot || relation === "" || (insideRepository && !ignoredTestOutput)) {
    fail("Pages output must be outside the repository");
  }
  if (!isAbsolute(output)) fail("Pages output must resolve to an absolute path");
  return output;
}

function validatePublicConfiguration(urlValue, keyValue) {
  const url = String(urlValue || "").trim();
  const publishableKey = String(keyValue || "").trim();
  if (!url || !publishableKey) fail("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are required");

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    fail("SUPABASE_URL must be an absolute URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    fail("SUPABASE_URL must be a credential-free HTTPS origin");
  }
  if (publishableKey.length < 20 || /\s/.test(publishableKey)) fail("SUPABASE_PUBLISHABLE_KEY is invalid");
  if (/^(?:sb_)?secret_/i.test(publishableKey) || /service[_-]?role/i.test(publishableKey)) {
    fail("Privileged Supabase keys are forbidden in the Pages artifact");
  }
  return Object.freeze({ url: parsed.href, publishableKey });
}

function configurationSource(configuration) {
  return `window.SUPABASE_CONFIG = Object.freeze(${JSON.stringify(configuration, null, 2)});\n`;
}

export async function buildPagesArtifact({ output, url, publishableKey }) {
  const target = validateOutput(output);
  const configuration = validatePublicConfiguration(url, publishableKey);

  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  for (const entry of staticEntries) {
    await cp(resolve(repositoryRoot, entry), resolve(target, entry), { recursive: true, errorOnExist: true });
  }
  await mkdir(resolve(target, "config"), { recursive: true });
  await writeFile(resolve(target, "config", "supabase.local.js"), configurationSource(configuration), "utf8");
  await writeFile(resolve(target, ".nojekyll"), "", "utf8");
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildPagesArtifact({
    output: argumentValue("--output"),
    url: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY
  });
}

export { configurationSource, staticEntries, validatePublicConfiguration };
