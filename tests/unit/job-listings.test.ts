// Vagas na página: o bloco diz que os cartões SÃO as vagas (recomendadas na home logada) e marca as salvas.
import { test } from 'node:test';
import assert from 'node:assert';
import { formatJobListings } from '../../src/renderer/job-listings.ts';

const jobs = [
  { title: 'VP of IT Infrastructure & Operations', text: 'VP of IT Infrastructure & Operations Serve Robotics Remote in Los Angeles, CA $220,000 - $320,000 a year', href: 'https://www.indeed.com/viewjob?jk=a1', saved: true },
  { title: 'Engineering Manager, Capital', text: 'Engineering Manager, Capital Adyen Hybrid remote in San Francisco, CA', href: 'https://www.indeed.com/viewjob?jk=b2', saved: false },
];

test('lists the cards as the recommended jobs, with saved ones marked', () => {
  const b = formatJobListings(jobs);
  assert.match(b, /JOB LISTINGS ON THIS PAGE \(2 found, 1 ★ saved\)/);
  assert.match(b, /recommended \/ suggested jobs, whatever the heading says/);
  assert.match(b, /1\. ★ SAVED · VP of IT Infrastructure & Operations — Serve Robotics Remote in Los Angeles, CA \$220,000 - \$320,000 a year → https:\/\/www\.indeed\.com\/viewjob\?jk=a1/);
  assert.match(b, /2\. Engineering Manager, Capital — Adyen/);
  assert.doesNotMatch(b.split('\n')[2], /SAVED/);
});

test('nothing for a single link or an empty page; caps the list', () => {
  assert.strictEqual(formatJobListings([jobs[0]]), '');
  assert.strictEqual(formatJobListings([]), '');
  const many = Array.from({ length: 12 }, (_, i) => ({ ...jobs[1], title: `Job ${i}`, text: `Job ${i} Acme`, href: `https://x.test/jobs/${i}1` }));
  const b = formatJobListings(many, 8);
  assert.match(b, /\(12 found\)/);
  assert.match(b, /… 4 more/);
});

test('job ids from board URLs; opened jobs are marked and the next one named', async () => {
  const { jobIdOf } = await import('../../src/renderer/job-listings.ts');
  assert.strictEqual(jobIdOf('https://www.indeed.com/viewjob?jk=318c71b5316ff6af&from=hp'), '318c71b5316ff6af');
  assert.strictEqual(jobIdOf('https://www.indeed.com/?vjk=3b676fe537c91b59'), '3b676fe537c91b59');
  assert.strictEqual(jobIdOf('https://www.linkedin.com/jobs/view/4012345678/'), '4012345678');
  assert.strictEqual(jobIdOf('https://www.indeed.com/'), null);
  const b = formatJobListings(jobs.map((j, i) => ({ ...j, href: `https://www.indeed.com/rc/clk?jk=id${i}x` })), 8, new Set(['id0x']));
  assert.match(b, /1\. ✓ OPENED · ★ SAVED · VP of IT/);
  assert.match(b, /You already opened 1 of these \(✓ OPENED\) — do not open them again\. NEXT unopened: #2\./);
  assert.doesNotMatch(b.split('\n').find(l => l.includes('2. '))!, /OPENED/);
});

test('a sponsored card (no job id) counts as opened when its posting page was seen', async () => {
  const { noteOpenedByTitle } = await import('../../src/renderer/job-listings.ts');
  const items = [{ ...jobs[0], href: 'https://www.indeed.com/pagead/clk?mo=r' }, { ...jobs[1], href: 'https://www.indeed.com/pagead/clk?mo=s' }];
  const opened = new Set<string>();
  noteOpenedByTitle(opened, 'Engineering Manager, Capital - San Francisco, CA - Indeed.com', items);
  const b = formatJobListings(items, 8, opened);
  assert.match(b, /2\. ✓ OPENED · Engineering Manager, Capital/);
  assert.match(b, /NEXT unopened: #1\./);
});

test('counts the jobs asked and keeps opened job details with what is left to do', async () => {
  const { jobsAsked, openedJobOn, formatOpenedJobs } = await import('../../src/renderer/job-listings.ts');
  assert.strictEqual(jobsAsked('Open the first 2 suggested job postings one at a time'), 2);
  assert.strictEqual(jobsAsked('open two jobs on my home page'), 2);
  assert.strictEqual(jobsAsked('abra 3 vagas'), 3);
  assert.strictEqual(jobsAsked('find me a job'), null);
  const seen = [{ ...jobs[0], href: 'https://www.indeed.com/rc/clk?jk=abc123' }, { ...jobs[1], href: 'https://www.indeed.com/pagead/clk?mo=x' }];
  assert.strictEqual(openedJobOn('https://www.indeed.com/viewjob?jk=abc123', 'whatever', seen)?.title, jobs[0].title);
  assert.strictEqual(openedJobOn('https://www.indeed.com/viewjob?jk=zz', 'Engineering Manager, Capital - San Francisco, CA - Indeed.com', seen)?.title, jobs[1].title);
  assert.strictEqual(openedJobOn('https://www.indeed.com/', 'Job Search | Indeed', seen), null);
  const one = [{ title: 'VP of IT', url: 'u1', text: 'Serve Robotics $220k' }];
  assert.match(formatOpenedJobs(one, 2), /opened 1 of the 2 job\(s\) asked — open the NEXT unopened one/);
  assert.match(formatOpenedJobs([...one, { title: 'EM', url: 'u2', text: 'Adyen' }], 2), /ALL DONE: report them now/);
  assert.strictEqual(formatOpenedJobs([], 2), '');
});

test('the page scan ignores tracking params like from=gnav-viewjob; the next job is named', async () => {
  const { JOB_LISTINGS_SCRIPT, formatOpenedJobs } = await import('../../src/renderer/job-listings.ts');
  const re = new RegExp(/var JOB = (\/.*\/i);/.exec(JOB_LISTINGS_SCRIPT)![1].slice(1, -2), 'i');
  for (const h of ['/viewjob?jk=abc123', 'https://www.indeed.com/rc/clk?jk=abc', '/pagead/clk?mo=r', 'https://www.linkedin.com/jobs/view/4012345678/', '/?vjk=abc123'])
    assert.ok(re.test(h), h);
  for (const h of ['/?from=gnav-viewjob', 'https://myjobs.indeed.com?from=gnav-util-viewjob', '/notifications?from=gnav-viewjob'])
    assert.ok(!re.test(h), h);
  const b = formatOpenedJobs([{ title: 'VP of IT', url: 'u1', text: 't' }], 2, { title: 'Engineering Manager, Capital', text: '', href: 'http://x/viewjob?jk=2c93', saved: true });
  assert.match(b, /open the NEXT unopened one: "Engineering Manager, Capital" → navigate to http:\/\/x\/viewjob\?jk=2c93\./);
});
