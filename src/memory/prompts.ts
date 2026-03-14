import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

interface Prompts {
  extraction: { system_prompt: string };
  consolidation: { system_prompt: string };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const yamlPath = join(__dirname, 'prompts.yaml');

let _cached: Prompts | null = null;

function load(): Prompts {
  if (_cached) return _cached;
  _cached = parseYaml(readFileSync(yamlPath, 'utf-8')) as Prompts;
  return _cached;
}

export function getExtractionPrompt(): string {
  return load().extraction.system_prompt;
}

export function getConsolidationPrompt(): string {
  return load().consolidation.system_prompt;
}
