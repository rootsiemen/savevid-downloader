import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3001;
const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true }));

// Get video info + available formats
app.post('/api/info', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Valid video URL required' });
  }
  try {
    const { stdout } = await execFileAsync(YTDLP, [
      '--skip-download',
      '--dump-json',
      '--no-playlist',
      '--socket-timeout', '20',
      url,
    ], { timeout: 45000, maxBuffer: 32 * 1024 * 1024 });

    const info = JSON.parse(stdout);
    const formats = (info.formats || []).filter(f => f.url);

    // Collect best video-only format per height, and best audio
    const videoByHeight = new Map();
    for (const f of formats) {
      const hasVideo = f.vcodec && f.vcodec !== 'none';
      const hasAudio = f.acodec && f.acodec !== 'none';
      if (hasVideo && f.height) {
        const h = f.height;
        if (!videoByHeight.has(h) || (f.filesize || 0) > (videoByHeight.get(h).filesize || 0)) {
          videoByHeight.set(h, f);
        }
      }
    }
    const qualities = [];
    const heights = [...videoByHeight.keys()].sort((a, b) => b - a).slice(0, 6);
    for (const h of heights) {
      const f = videoByHeight.get(h);
      qualities.push({
        label: `${h}p${f.fps && f.fps > 30 ? '60' : ''}`,
        format_id: `bv*[height=${h}]+ba/best[height=${h}]/best`,
        ext: 'mp4',
        filesize: f.filesize || f.filesize_approx || null,
        type: 'video',
        height: h,
      });
    }
    const bestAudio = formats.find(f => (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none');
    if (bestAudio) qualities.push({ label: 'Audio only (MP3)', format_id: 'bestaudio/best', ext: 'mp3', filesize: bestAudio.filesize || null, type: 'audio' });

    res.json({
      title: info.title,
      uploader: info.uploader || info.channel || '',
      duration: info.duration || 0,
      duration_string: info.duration_string || '',
      thumbnail: info.thumbnail || '',
      webpage_url: info.webpage_url || url,
      extractor: info.extractor || '',
      qualities,
    });
  } catch (err) {
    const msg = (err.stderr || err.message || '').slice(0, 300);
    res.status(422).json({ error: 'Could not fetch video info. The link may be private, geo-blocked, or unsupported.', detail: msg });
  }
});

// Download / stream the video
app.get('/api/download', async (req, res) => {
  const { url, format_id, type } = req.query;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Valid video URL required' });
  }
  const isAudio = type === 'audio';
  const fmt = format_id || (isAudio ? 'bestaudio/best' : 'bestvideo+bestaudio/best');
  const args = ['--no-playlist', '--socket-timeout', '20', '-f', fmt, '-o', '-'];
  if (isAudio) args.push('--extract-audio', '--audio-format', 'mp3');
  else args.push('--merge-output-format', 'mp4');
  args.push(url);

  try {
    // Probe title first for a nice filename
    let filename = 'video';
    try {
      const { stdout } = await execFileAsync(YTDLP, ['--skip-download', '--print', '%(title)s', '--no-playlist', url], { timeout: 30000 });
      filename = stdout.trim().replace(/[^\w\- ]+/g, '').slice(0, 80) || 'video';
    } catch { /* fallback filename */ }

    const ext = type === 'audio' ? 'mp3' : 'mp4';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.${ext}"`);
    res.setHeader('Content-Type', type === 'audio' ? 'audio/mpeg' : 'video/mp4');

    const child = spawn(YTDLP, args, { timeout: 600000 });
    child.stdout.pipe(res);
    child.stderr.on('data', () => {});
    child.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    req.on('close', () => child.kill());
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
});

app.listen(PORT, () => console.log(`VideoDL backend on :${PORT}`));
