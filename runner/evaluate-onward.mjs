import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../src/runtime.js';
import { AudioBridge } from '../src/audio-bridge.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const onwardDir = process.env.NORN_LAB_ONWARD_DIR || path.resolve(root, '../onward-norns');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function capture(bridge, durationMs) {
  const chunks = [];
  const onPcm = chunk => chunks.push(Buffer.from(chunk));
  bridge.on('pcm', onPcm);
  return delay(durationMs).then(() => {
    bridge.off('pcm', onPcm);
    const pcm = Buffer.concat(chunks);
    let peak = 0;
    let sum = 0;
    let step = 0;
    for (let i = 0; i < pcm.length; i += 4) {
      const sample = pcm.readFloatLE(i);
      peak = Math.max(peak, Math.abs(sample));
      sum += sample * sample;
      if (i >= 8) step = Math.max(step, Math.abs(sample - pcm.readFloatLE(i - 8)));
    }
    return { pcm, frames: pcm.length / 8, rms: Math.sqrt(sum / (pcm.length / 4)), peak, maxStep: step };
  });
}

function wav(pcm) {
  const frames = pcm.length / 8;
  const out = Buffer.alloc(44 + frames * 4);
  out.write('RIFF', 0);
  out.writeUInt32LE(out.length - 8, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(2, 22);
  out.writeUInt32LE(48000, 24);
  out.writeUInt32LE(48000 * 4, 28);
  out.writeUInt16LE(4, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames * 2; i++) {
    const sample = Math.max(-1, Math.min(1, pcm.readFloatLE(i * 4)));
    out.writeInt16LE(Math.round(sample * (sample < 0 ? 32768 : 32767)), 44 + i * 2);
  }
  return out;
}

function toneLevels(pcm) {
  const frames = Math.min(pcm.length / 8, 48000);
  const levels = {};
  for (const frequency of [220, 330, 440, 660, 880, 1320]) {
    let real = 0;
    let imaginary = 0;
    for (let i = 0; i < frames; i++) {
      const sample = pcm.readFloatLE(i * 8);
      const phase = 2 * Math.PI * frequency * i / 48000;
      real += sample * Math.cos(phase);
      imaginary += sample * Math.sin(phase);
    }
    levels[frequency] = 2 * Math.hypot(real, imaginary) / frames;
  }
  return levels;
}

async function command(runtime, code) {
  const marker = `__NL_EVAL_${Math.random().toString(36).slice(2)}__`;
  const from = runtime.lines.length;
  runtime.sendLua(`${code ? `${code}; ` : ''}print('${marker}')`);
  await runtime.waitForLine(line => line.includes(marker), 3000, from);
}

async function status(runtime) {
  const from = runtime.lines.length;
  await command(runtime, 'onward_status()');
  const lines = runtime.lines.slice(from);
  const parsed = {};
  for (const name of ['freeze', 'glitch']) {
    const line = lines.find(value => value.startsWith(`${name} enabled=`));
    const match = line?.match(/enabled=(\w+) locked=(\w+) active=(\w+) selections=(\d+)/);
    if (!match) throw new Error(`Missing ${name} status`);
    parsed[name] = { enabled: match[1] === 'true', locked: match[2] === 'true', active: match[3] === 'true', selections: Number(match[4]) };
  }
  return parsed;
}

async function gesture(runtime, keys, holdMs = 0) {
  for (const n of keys) {
    runtime.sendControl({ type: 'key', n, z: 1 });
    // Matron delivers K1 to the script only after its 250 ms menu hold.
    if (n === 1 && keys.length > 1) await delay(300);
  }
  if (holdMs) await delay(holdMs);
  for (const n of keys.toReversed()) runtime.sendControl({ type: 'key', n, z: 0 });
  await command(runtime, '');
}

async function withOnward(label, artifactDir, action) {
  const bridge = new AudioBridge();
  const audioAddress = await bridge.listen(0);
  const frameDir = path.join(artifactDir, `frames-${label}`);
  const runtime = new Runtime({ frameDir, audioPort: audioAddress.port, onwardDir });
  let result;
  try {
    await runtime.start();
    await runtime.loadScript('onward');
    const deadline = Date.now() + 5000;
    while (!bridge.source && Date.now() < deadline) await delay(50);
    if (!bridge.source) throw new Error('Audio stream did not connect');
    // Norns plays a startup sound through Crone. It lasts about 12 seconds
    // after readiness, and otherwise makes silence and routing checks invalid.
    let quietWindows = 0;
    const quietDeadline = Date.now() + 20000;
    while (quietWindows < 2 && Date.now() < quietDeadline) {
      const baseline = await capture(bridge, 1000);
      quietWindows = baseline.rms < 0.0005 ? quietWindows + 1 : 0;
    }
    if (quietWindows < 2) throw new Error('Startup audio did not settle to silence');
    result = await action({ runtime, bridge });
    const error = runtime.lines.find(line => /### SCRIPT ERROR|ERROR:/.test(line) && !line.includes('NO SCRIPT'));
    if (error) throw new Error(error);
  } finally {
    await fs.writeFile(path.join(artifactDir, `${label}.log`), `${runtime.lines.join('\n')}\n`);
    await runtime.stop();
    await bridge.close();
    await fs.rm(frameDir, { recursive: true, force: true });
  }
  return result;
}

async function glitchCase(locked, artifactDir) {
  const label = locked ? 'glitch-locked' : 'glitch-unlocked';
  return withOnward(label, artifactDir, async ({ runtime, bridge }) => {
    await command(runtime, "params:set('dry',0); params:set('freeze_direct_level',0); params:set('glitch_live_send',1); params:set('glitch_freeze_send',0); params:set('glitch_amount',1); params:set('glitch_level',1); params:set('glitch_stutter',0); params:set('glitch_size',0.5); params:set('glitch_mode',2); params:set('sustain',10)");
    await gesture(runtime, [2]);
    const duringPromise = capture(bridge, 3000);
    const tonePromise = runtime.playTestTone({ frequency: 440, toneMs: 1800, totalMs: 2800 });
    await delay(500);
    await gesture(runtime, [1, 3]);
    if (locked) {
      await delay(300);
      await gesture(runtime, [3], 700);
    }
    const [during] = await Promise.all([duringPromise, tonePromise]);
    const after = await capture(bridge, 1200);
    const secondTone = runtime.playTestTone({ frequency: 660, toneMs: 1800, totalMs: 2800 });
    const secondDuring = capture(bridge, 3000);
    await Promise.all([secondTone, secondDuring]);
    const afterSecondNote = await capture(bridge, 1200);
    await fs.writeFile(path.join(artifactDir, `${label}-during.wav`), wav(during.pcm));
    await fs.writeFile(path.join(artifactDir, `${label}-after.wav`), wav(after.pcm));
    await fs.writeFile(path.join(artifactDir, `${label}-after-second-note.wav`), wav(afterSecondNote.pcm));
    return { status: await status(runtime), during: { frames: during.frames, rms: during.rms, peak: during.peak, maxStep: during.maxStep }, after: { frames: after.frames, rms: after.rms, peak: after.peak, maxStep: after.maxStep, toneLevels: toneLevels(after.pcm) }, afterSecondNote: { frames: afterSecondNote.frames, rms: afterSecondNote.rms, peak: afterSecondNote.peak, toneLevels: toneLevels(afterSecondNote.pcm) } };
  });
}

async function captureRulesCase(artifactDir) {
  return withOnward('capture-rules', artifactDir, async ({ runtime }) => {
    const states = [];
    await runtime.playTestTone({ frequency: 440 });
    states.push({ action: 'first automatic note', ...(await status(runtime)) });
    await gesture(runtime, [2], 700);
    await runtime.playTestTone({ frequency: 660 });
    states.push({ action: 'second note with Freeze locked', ...(await status(runtime)) });
    await gesture(runtime, [2], 700);
    await gesture(runtime, [3], 700);
    await runtime.playTestTone({ frequency: 880 });
    states.push({ action: 'third note with Glitch locked', ...(await status(runtime)) });
    await command(runtime, "params:set('freeze_mode',2); params:set('glitch_mode',2)");
    await gesture(runtime, [3], 700);
    await runtime.playTestTone({ frequency: 330 });
    states.push({ action: 'fourth note in manual modes', ...(await status(runtime)) });
    await gesture(runtime, [1, 2]);
    await gesture(runtime, [1, 3]);
    states.push({ action: 'manual K1 captures', ...(await status(runtime)) });
    return states;
  });
}

async function freezeToGlitchCase(artifactDir) {
  return withOnward('freeze-to-glitch', artifactDir, async ({ runtime, bridge }) => {
    await command(runtime, "params:set('dry',0); params:set('freeze_direct_level',0); params:set('glitch_live_send',0); params:set('glitch_freeze_send',1); params:set('glitch_amount',0); params:set('glitch_level',1); params:set('freeze_level',1); params:set('sustain',10)");
    await runtime.playTestTone();
    const directOff = await capture(bridge, 1000);
    await command(runtime, "params:set('glitch_amount',1)");
    await delay(200);
    const glitchFromFreeze = await capture(bridge, 1000);
    await command(runtime, "params:set('glitch_freeze_send',0)");
    // The Glitch recorder holds four seconds of previously routed Freeze;
    // allow it to roll out before testing the disconnected steady state.
    await delay(4500);
    const sendOff = await capture(bridge, 1000);
    await command(runtime, "params:set('glitch_amount',0); params:set('freeze_direct_level',1)");
    await delay(200);
    const freezeDirect = await capture(bridge, 1000);
    for (const [name, result] of Object.entries({ directOff, glitchFromFreeze, sendOff, freezeDirect })) {
      await fs.writeFile(path.join(artifactDir, `routing-${name}.wav`), wav(result.pcm));
    }
    return { status: await status(runtime), rms: { directOff: directOff.rms, glitchFromFreeze: glitchFromFreeze.rms, sendOff: sendOff.rms, freezeDirect: freezeDirect.rms } };
  });
}

export async function evaluateOnward() {
  const artifactDir = path.join(root, 'artifacts', `onward-evaluation-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`);
  await fs.mkdir(artifactDir, { recursive: true });
  const lua = await fs.readFile(path.join(onwardDir, 'onward_norns.lua'));
  const engine = await fs.readFile(path.join(onwardDir, 'lib/Engine_OnwardGrain.sc'));
  const report = { source: onwardDir, sourceHash: { lua: createHash('sha256').update(lua).digest('hex'), engine: createHash('sha256').update(engine).digest('hex') }, cases: {} };
  const selectedCase = process.env.NORN_LAB_EVALUATE_CASE;
  try {
    if (selectedCase === 'routing') {
      report.cases.freezeToGlitch = await freezeToGlitchCase(artifactDir);
      const route = report.cases.freezeToGlitch.rms;
      report.assessment = { freezeToGlitchRoute: route.directOff < 0.001 && route.glitchFromFreeze > 0.003 && route.sendOff < 0.001 && route.freezeDirect > 0.003 };
      return { artifactDir, report };
    }
    report.cases.glitchUnlocked = await glitchCase(false, artifactDir);
    report.cases.glitchLocked = await glitchCase(true, artifactDir);
    report.cases.captureRules = await captureRulesCase(artifactDir);
    report.cases.freezeToGlitch = await freezeToGlitchCase(artifactDir);
    const unlocked = report.cases.glitchUnlocked;
    const locked = report.cases.glitchLocked;
    const rules = report.cases.captureRules;
    const route = report.cases.freezeToGlitch.rms;
    report.assessment = {
      manualSelection: unlocked.status.glitch.selections === 1,
      unlockedRepeatsAfterInput: unlocked.after.rms >= 0.003,
      lockedRepeatsAfterInput: locked.after.rms >= 0.003,
      manualPhrasePreservedWithoutLock: unlocked.afterSecondNote.toneLevels[440] > unlocked.afterSecondNote.toneLevels[660] * 5,
      lockedPhrasePreserved: locked.afterSecondNote.toneLevels[440] > locked.afterSecondNote.toneLevels[660] * 5,
      autoCapture: rules[0].freeze.selections === 1 && rules[0].glitch.selections === 1,
      independentFreezeLock: rules[1].freeze.selections === 1 && rules[1].glitch.selections === 2,
      independentGlitchLock: rules[2].freeze.selections === 2 && rules[2].glitch.selections === 2,
      manualModesIgnoreOnset: rules[3].freeze.selections === 2 && rules[3].glitch.selections === 2,
      manualKeysSelect: rules[4].freeze.selections === 3 && rules[4].glitch.selections === 3,
      freezeToGlitchRoute: route.directOff < 0.001 && route.glitchFromFreeze > 0.003 && route.sendOff < 0.001 && route.freezeDirect > 0.003
    };
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    await fs.writeFile(path.join(artifactDir, 'report.json'), JSON.stringify(report, null, 2));
  }
  return { artifactDir, report };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { artifactDir, report } = await evaluateOnward();
    console.log(JSON.stringify({ artifactDir, assessment: report.assessment, unlockedAfterRms: report.cases.glitchUnlocked?.after.rms, lockedAfterRms: report.cases.glitchLocked?.after.rms }, null, 2));
    const failed = Object.entries(report.assessment).filter(([, passed]) => !passed).map(([name]) => name);
    if (failed.length) {
      console.error(`Onward behavior differs from the reference: ${failed.join(', ')}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Onward evaluation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
