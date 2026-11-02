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

test('collections: detection, audio vs video, list parsing, subject and queries', async () => {
  const m = await import('../../src/renderer/download-steps.ts');
  const cmd = 'find all the music videos from the movie top gun with tom cruise and download them';
  assert.ok(m.isMediaCollectionRequest(cmd));
  assert.ok(!m.isMediaCollectionRequest('download the beat it music video'));
  assert.equal(m.collectionWantsAudioOnly(cmd), false);
  assert.equal(m.collectionWantsAudioOnly('download all the songs from the album thriller'), true);
  assert.deepEqual(m.listItems(['Danger Zone', 'Take My Breath Away', 'Danger Zone']), ['Danger Zone', 'Take My Breath Away']);
  assert.deepEqual(m.listItems('1. Danger Zone\n2. Mighty Wings\n- Playing with the Boys'), ['Danger Zone', 'Mighty Wings', 'Playing with the Boys']);
  assert.equal(m.collectionSubject(cmd), 'top gun');
  assert.equal(m.collectionSubject('download every song from the album thriller'), 'thriller');
  assert.equal(m.collectionQuery('Danger Zone', 'top gun', false), 'Danger Zone top gun official music video');
  assert.equal(m.collectionQuery('Top Gun Anthem', 'top gun', false), 'Top Gun Anthem official music video');
});
