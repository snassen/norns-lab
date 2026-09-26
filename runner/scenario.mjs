export function assertAwakeStates(states) {
  if (states.length !== 4) throw new Error('Expected four Awake state checkpoints');
  const [initial, loop, returned, selected] = states;
  if (initial.mode !== 1 || initial.edit_ch !== 1) throw new Error('Awake did not start in STEP, channel 1');
  if (loop.mode !== 2) throw new Error('E1 did not change Awake to LOOP');
  if (returned.mode !== 1) throw new Error('E1 did not return Awake to STEP');
  if (selected.mode !== 1 || selected.edit_ch !== 2) throw new Error('K2 did not select Awake edit channel 2');
}
