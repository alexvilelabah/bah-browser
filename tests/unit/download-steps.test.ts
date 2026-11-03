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

test('collections: "Title — Artist" entries and the work\'s year make precise per-track queries', async () => {
  const m = await import('../../src/renderer/download-steps.ts');
  assert.deepEqual(m.parseTrackEntry('Danger Zone — Kenny Loggins'), { title: 'Danger Zone', artist: 'Kenny Loggins' });
  assert.deepEqual(m.parseTrackEntry('Take My Breath Away – Berlin'), { title: 'Take My Breath Away', artist: 'Berlin' });
  assert.deepEqual(m.parseTrackEntry('Mighty Wings - Cheap Trick'), { title: 'Mighty Wings', artist: 'Cheap Trick' });
  assert.deepEqual(m.parseTrackEntry('"Hold My Hand" by Lady Gaga'), { title: 'Hold My Hand', artist: 'Lady Gaga' });
  assert.deepEqual(m.parseTrackEntry('Stand by Me'), { title: 'Stand by Me', artist: '' });
  assert.deepEqual(m.parseTrackEntry('Danger Zone'), { title: 'Danger Zone', artist: '' });
  // ano: do pedido ou da expansão; o que vem depois de "not" (o Maverick) não conta
  const x = 'find all the music videos from the soundtrack of the 1986 film Top Gun (Tom Cruise), not Top Gun: Maverick (2022)';
  assert.equal(m.subjectYear('top gun', 'find all the music videos from the movie top gun', x), '1986');
  assert.equal(m.subjectYear('top gun', 'download all songs from top gun: maverick (2022)'), '2022');
  assert.equal(m.subjectYear('top gun', 'download all songs from the movie top gun'), '');
  assert.equal(m.subjectYear('top gun', 'all the videos of Top Gun, not the 2022 sequel'), '');
  assert.equal(m.collectionSubject(x), 'top gun');
  assert.equal(m.collectionSubject('download all songs from the movie top gun: maverick'), 'top gun: maverick');
  assert.equal(m.collectionQuery('Danger Zone — Kenny Loggins', 'top gun', false, '1986'), 'Danger Zone Kenny Loggins top gun 1986 official music video');
  assert.equal(m.collectionQuery('Take My Breath Away — Berlin', 'top gun', true, '1986'), 'Take My Breath Away Berlin top gun 1986 official audio');
  assert.equal(m.collectionQuery('Danger Zone — Kenny Loggins', '', false), 'Danger Zone Kenny Loggins official music video');
  assert.equal(m.collectionQuery('Top Gun Anthem — Harold Faltermeyer', 'top gun', false, '1986'), 'Top Gun Anthem Harold Faltermeyer 1986 official music video');
  assert.deepEqual(m.listItems(['Danger Zone — Kenny Loggins', 'Take My Breath Away — Berlin']), ['Danger Zone — Kenny Loggins', 'Take My Breath Away — Berlin']);
});

test("collections: an artist's top N / most famous songs or videos is a collection too", async () => {
  const { isMediaCollectionRequest } = await import('../../src/renderer/download-steps.ts');
  assert.ok(isMediaCollectionRequest("Find Michael Jackson's most famous songs and download all of their music videos, just the top 3"));
  assert.ok(isMediaCollectionRequest('find the most famous Michael Jackson music videos and download 3 of them'));
  assert.ok(isMediaCollectionRequest('download the top 5 Queen music videos'));
  assert.ok(isMediaCollectionRequest('baixe os 3 maiores sucessos do Tim Maia'));
  assert.ok(!isMediaCollectionRequest('download the most famous Michael Jackson video'));
  assert.ok(!isMediaCollectionRequest('find the most famous Michael Jackson songs'));   // no download
});
