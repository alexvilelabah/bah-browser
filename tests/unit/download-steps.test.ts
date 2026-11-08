// Tarefa de download: acaba quando o download começa (último passo) ou o Bah espera terminar (encadeado)?
import { test } from 'node:test';
import assert from 'node:assert';
import { downloadIsLastStep, commandHasFollowUp, commandWantsSeveralFiles } from '../../src/renderer/download-steps.ts';

test('a single download with nothing after it is the last step', () => {
  for (const c of ['download the latest version of Steam for this computer', 'download the installer for my HP printer', "download michael jackson's beat it video from youtube in 4K", 'baixe o instalador do SolidWorks'])
    assert.ok(downloadIsLastStep(c), c);
});

test('follow-up steps or several files keep the agent engaged until the downloads finish', () => {
  for (const c of ['download the driver and install it', 'download the PDF then summarize it', 'download both manuals and compare them', 'download 3 videos of pink floyd', 'download the zip and extract it',
    'baixe o arquivo e depois resuma', 'baixe os dois e compare', 'descarga el instalador y luego instálalo'])
    assert.ok(!downloadIsLastStep(c), c);
  assert.ok(commandHasFollowUp('download the report and attach it to an email'));
  assert.ok(commandWantsSeveralFiles('download all the episodes'));
  assert.ok(!commandHasFollowUp('download the installer'));   // "installer" is not "install"
});
