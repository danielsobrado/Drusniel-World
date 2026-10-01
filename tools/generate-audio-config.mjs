import fs from 'node:fs';
import yaml from 'js-yaml';

const source = new URL('../config/audio_events.yaml', import.meta.url);
const target = new URL('../src/editor/audio/audio_events_defaults.json', import.meta.url);
const config = yaml.load(fs.readFileSync(source, 'utf8'));
if (!config?.global || !config?.events) throw new Error('Audio config requires global and events.');
const output = `${JSON.stringify(config, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output) {
    throw new Error('Audio defaults are stale. Run node tools/generate-audio-config.mjs.');
  }
} else fs.writeFileSync(target, output);
