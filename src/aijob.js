// Background AI jobs that answer with one JSON object, saved to a file (project briefs, HR views).
// One job per id at a time; the page polls the job state and reads the saved file.
const fs = require('node:fs');
const path = require('node:path');

function jsonFrom(text) {
  const s = String(text || '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : s;
  const i = body.indexOf('{');
  const j = body.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('The AI did not return JSON');
  return JSON.parse(body.slice(i, j + 1));
}

function makeJobs(ctx) {
  const jobs = {};
  function start(id, { prompt, out, title, kind = 'run', timeoutMs = 10 * 60_000, small = false, shape }) {
    if (jobs[id]?.running) return jobs[id];
    const job = (jobs[id] = { id, running: true, startedAt: new Date().toISOString(), finishedAt: null, error: null });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    ctx.ai(prompt, { small, cwd: ctx.workDir(), addDir: ctx.DATA, timeoutMs }).then((r) => {
      let error = r.error;
      let data = null;
      if (!error) {
        try {
          data = jsonFrom(r.text);
          if (shape) data = shape(data);
          data.generatedAt = new Date().toISOString();
          fs.writeFileSync(out, JSON.stringify(data, null, 2));
        } catch (e) { error = e.message; }
      }
      Object.assign(job, { running: false, error: error ? String(error).slice(0, 300) : null, finishedAt: new Date().toISOString() });
      ctx.logRun({ kind, title, startedAt: job.startedAt, finishedAt: job.finishedAt, result: error ? null : (data?.summary || data?.headline || 'Done').toString().slice(0, 1500), error: job.error, cost: r.cost });
    });
    return job;
  }
  return { start, get: (id) => jobs[id] || null, all: () => jobs };
}

const readJson = (f, dflt = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };

module.exports = { makeJobs, jsonFrom, readJson };
