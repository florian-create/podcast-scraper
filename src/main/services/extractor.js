const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const OpenAI = require('openai');

// --- PATH setup (same as Site Scraper) ---
// Electron doesn't inherit the user's full shell PATH, so yt-dlp won't be found.
const EXTRA_PATHS = [
  '/Library/Frameworks/Python.framework/Versions/3.13/bin',
  '/Library/Frameworks/Python.framework/Versions/3.12/bin',
  '/Library/Frameworks/Python.framework/Versions/3.11/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  path.join(os.homedir(), '.local/bin'),
];
for (const p of EXTRA_PATHS) {
  if (fs.existsSync(p) && (process.env.PATH || '').indexOf(p) === -1) {
    process.env.PATH = p + ':' + (process.env.PATH || '');
  }
}

// Use bundled ffmpeg/ffprobe (no system install needed)
let FFMPEG_PATH, FFPROBE_PATH, FFMPEG_DIR;
try {
  FFMPEG_PATH = require('ffmpeg-static');
  FFPROBE_PATH = require('ffprobe-static').path;
  FFMPEG_DIR = path.dirname(FFMPEG_PATH);
  // yt-dlp's --ffmpeg-location expects both ffmpeg and ffprobe in the same dir
  const ffprobeLink = path.join(FFMPEG_DIR, 'ffprobe');
  if (fs.existsSync(ffprobeLink) === false) {
    try { fs.symlinkSync(FFPROBE_PATH, ffprobeLink); } catch (_) {}
  }
} catch (_) {
  FFMPEG_PATH = 'ffmpeg';
  FFPROBE_PATH = 'ffprobe';
  FFMPEG_DIR = '';
}

function runCommand(cmd, args, timeout = 600000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });
}

const http = require('http');

/**
 * HTTP/HTTPS GET that returns the response body as string (follows redirects)
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'PodcastScraper/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve, reject);
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * Resolve Apple Podcasts URL → direct audio URL via iTunes Lookup API + RSS feed
 */
async function resolveApplePodcast(url, onProgress) {
  // Extract podcast ID (id1539383194) and episode ID (i=1000745281696)
  const podcastIdMatch = url.match(/id(\d+)/);
  const episodeIdMatch = url.match(/[?&]i=(\d+)/);
  if (!podcastIdMatch) return null;

  const podcastId = podcastIdMatch[1];
  const episodeId = episodeIdMatch ? episodeIdMatch[1] : null;

  if (onProgress) onProgress('Looking up podcast on iTunes...');

  // Step 1: iTunes Lookup API → get RSS feed URL
  let feedUrl = null;
  let podcastName = '';
  try {
    const lookupData = await httpGet(`https://itunes.apple.com/lookup?id=${podcastId}&entity=podcast`);
    const lookup = JSON.parse(lookupData);
    if (lookup.results && lookup.results.length > 0) {
      feedUrl = lookup.results[0].feedUrl;
      podcastName = lookup.results[0].collectionName || '';
    }
  } catch (_) {}

  if (!feedUrl) return null;

  if (onProgress) onProgress('Fetching RSS feed...');

  // Step 2: Fetch RSS feed and find episode audio URL
  try {
    const rssData = await httpGet(feedUrl);

    // Parse episodes from RSS (simple regex - RSS is XML with <item> and <enclosure>)
    const items = rssData.split('<item>').slice(1); // skip header

    // Extract keywords from URL slug for matching
    const urlSlug = url.split('/podcast/')[1] || '';
    const slugPart = urlSlug.split('/id')[0];
    // Extract meaningful words from slug (skip short words like "en", "de", etc.)
    const slugWords = slugPart.replace(/-/g, ' ').toLowerCase().split(/\s+/)
      .filter(w => w.length > 3);

    let bestMatch = null;
    let bestTitle = '';
    let bestDate = '';

    for (const item of items) {
      const encMatch = item.match(/<enclosure[^>]+url="([^"]+)"/);
      if (!encMatch) continue;

      const audioUrl = encMatch[1];
      const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
      const itemTitle = titleMatch ? titleMatch[1] : '';
      const dateMatch = item.match(/<pubDate>([^<]+)<\/pubDate>/);
      const itemDate = dateMatch ? dateMatch[1] : '';

      // Match by episode ID in guid or any part of the item XML
      if (episodeId && item.includes(episodeId)) {
        bestMatch = audioUrl;
        bestTitle = itemTitle;
        bestDate = itemDate;
        break;
      }

      // Match by slug keywords (at least 3 words must match)
      if (slugWords.length > 0) {
        const normalizedTitle = itemTitle.toLowerCase();
        const matchCount = slugWords.filter(w => normalizedTitle.includes(w)).length;
        if (matchCount >= Math.min(3, slugWords.length)) {
          bestMatch = audioUrl;
          bestTitle = itemTitle;
          bestDate = itemDate;
          break;
        }
      }

      // Store first item as fallback
      if (bestMatch === null) {
        bestMatch = audioUrl;
        bestTitle = itemTitle;
        bestDate = itemDate;
      }
    }

    // If no match yet and we have an episode ID, try iTunes episode lookup
    if (bestMatch && episodeId) {
      try {
        const epData = await httpGet(`https://itunes.apple.com/lookup?id=${episodeId}&entity=podcastEpisode`);
        const epLookup = JSON.parse(epData);
        if (epLookup.results) {
          const ep = epLookup.results.find(r => r.wrapperType === 'podcastEpisode');
          if (ep && ep.episodeUrl) {
            return { audioUrl: ep.episodeUrl, title: ep.trackName || bestTitle, date: ep.releaseDate || bestDate, podcastName };
          }
          if (ep && ep.trackName) {
            const epTitle = ep.trackName.toLowerCase();
            for (const item of items) {
              const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
              if (titleMatch && titleMatch[1].toLowerCase().indexOf(epTitle) !== -1) {
                const encMatch = item.match(/<enclosure[^>]+url="([^"]+)"/);
                if (encMatch) {
                  bestMatch = encMatch[1];
                  bestTitle = ep.trackName;
                  bestDate = ep.releaseDate || bestDate;
                  break;
                }
              }
            }
          }
        }
      } catch (_) {}
    }

    if (bestMatch) {
      return { audioUrl: bestMatch, title: bestTitle, date: bestDate, podcastName };
    }
  } catch (_) {}

  return null;
}

/**
 * Resolve Spotify/Apple Podcast URL → downloadable URL
 * - YouTube: pass through (yt-dlp handles natively)
 * - Apple Podcasts: iTunes Lookup API → RSS feed → direct audio URL
 * - Spotify: extract title → search YouTube
 * - Other: pass through to yt-dlp
 */
async function resolveUrl(url, onProgress) {
  // YouTube URLs → pass through
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    return { resolvedUrl: url, directAudio: false };
  }

  // Apple Podcasts → iTunes API + RSS
  if (url.includes('podcasts.apple.com')) {
    if (onProgress) onProgress('Resolving Apple Podcast...');
    const result = await resolveApplePodcast(url, onProgress);
    if (result && result.audioUrl) {
      return { resolvedUrl: result.audioUrl, directAudio: true, metadata: { title: result.title, date: result.date } };
    }
  }

  // Spotify → get title via oEmbed API (no auth needed), search YouTube
  if (url.includes('spotify.com')) {
    if (onProgress) onProgress('Resolving Spotify link...');
    let title = null;
    try {
      const oembedData = await httpGet(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
      const oembed = JSON.parse(oembedData);
      title = oembed.title || null;
    } catch (_) {}

    if (title) {
      if (onProgress) onProgress(`Searching YouTube: ${title.substring(0, 40)}...`);
      try {
        const { stdout } = await runCommand('yt-dlp', [
          '--flat-playlist', '--print', '%(url)s',
          `ytsearch1:${title} podcast`,
        ], 30000);
        const ytUrl = stdout.trim();
        if (ytUrl) return { resolvedUrl: ytUrl, directAudio: false };
      } catch (_) {}
    }

    throw new Error('Could not find this podcast on YouTube. Try pasting the YouTube URL directly.');
  }

  // Fallback: let yt-dlp try the original URL
  return { resolvedUrl: url, directAudio: false };
}

/**
 * Download audio via yt-dlp (exact same mechanics as Site Scraper)
 * - 64k bitrate to keep files small for Whisper
 * - mp3 format
 */
/**
 * Download a direct audio URL (e.g. from RSS feed) using https
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const doRequest = (reqUrl) => {
      const mod = reqUrl.startsWith('https') ? https : http;
      mod.get(reqUrl, { headers: { 'User-Agent': 'PodcastScraper/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doRequest(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(resolve); });
      }).on('error', (err) => { file.close(); reject(err); });
    };
    doRequest(url);
  });
}

async function downloadAudio(url, onProgress) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podcast-scraper-'));

  // Resolve non-YouTube URLs
  const resolved = await resolveUrl(url, onProgress);
  let metadata = { title: '', date: '' };

  // If we got metadata from the resolver (Apple Podcasts), use it
  if (resolved.metadata) {
    metadata.title = resolved.metadata.title || '';
    if (resolved.metadata.date) {
      // Could be ISO date or RSS date
      const d = resolved.metadata.date;
      if (d.length === 10 && d[4] === '-') {
        metadata.date = d; // already YYYY-MM-DD
      } else {
        try { metadata.date = new Date(d).toISOString().split('T')[0]; } catch (_) {}
      }
    }
  }

  // Direct audio URL (from RSS feed) → download with https
  if (resolved.directAudio) {
    if (onProgress) onProgress('Downloading audio from RSS feed...');
    const ext = resolved.resolvedUrl.match(/\.(mp3|m4a|wav|aac)/i);
    const audioExt = ext ? ext[1] : 'mp3';
    const safeName = (metadata.title || 'podcast').replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 80);
    const rawPath = path.join(tmpDir, `${safeName}.${audioExt}`);

    await downloadFile(resolved.resolvedUrl, rawPath);

    // Convert to 64k mp3 for Whisper (same as yt-dlp approach)
    const mp3Path = path.join(tmpDir, `${safeName}.mp3`);
    if (audioExt !== 'mp3' || true) { // always re-encode to 64k to keep small
      if (onProgress) onProgress('Converting to 64k mp3...');
      await runCommand(FFMPEG_PATH, ['-y', '-i', rawPath, '-b:a', '64k', mp3Path === rawPath ? rawPath + '.tmp.mp3' : mp3Path], 120000);
      if (mp3Path === rawPath) {
        fs.unlinkSync(rawPath);
        fs.renameSync(rawPath + '.tmp.mp3', mp3Path);
      } else {
        try { fs.unlinkSync(rawPath); } catch (_) {}
      }
    }

    const fileSize = fs.statSync(mp3Path).size;
    metadata.file_size_mb = Math.round((fileSize / (1024 * 1024)) * 100) / 100;
    return { audioPath: mp3Path, tmpDir, metadata };
  }

  // YouTube / Spotify / other → use yt-dlp
  const outputTemplate = path.join(tmpDir, '%(title)s.%(ext)s');
  const resolvedUrl = resolved.resolvedUrl;

  // Get metadata via yt-dlp if we don't have it
  if (!metadata.title) {
    if (onProgress) onProgress('Getting metadata...');
    try {
      const { stdout } = await runCommand('yt-dlp', [
        '--print', '%(title)s\n%(upload_date)s',
        '--no-download', '--no-playlist', resolvedUrl,
      ], 30000);
      const lines = stdout.trim().split('\n');
      metadata.title = lines[0] || '';
      const d = lines[1];
      metadata.date = d && d.length === 8 ? `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}` : '';
    } catch (_) {}
  }

  // Download audio (same as Site Scraper: 64k bitrate for Whisper)
  if (onProgress) onProgress('Downloading audio...');

  const args = [
    '-x',
    '--audio-format', 'mp3',
    '--ffmpeg-location', FFMPEG_DIR,
    '--postprocessor-args', 'ffmpeg:-b:a 64k',
    '-o', outputTemplate,
    '--no-playlist',
    '--max-filesize', '200M',
    resolvedUrl,
  ];

  await runCommand('yt-dlp', args, 600000).catch((err) => {
    if (err.message.includes('ENOENT') || err.message.includes('not found')) {
      throw new Error('yt-dlp not found. Install with: pip3 install yt-dlp');
    }
    throw new Error(`Download failed: ${err.message.substring(0, 200)}`);
  });

  // Find the downloaded mp3
  const files = fs.readdirSync(tmpDir);
  const mp3 = files.find(f => f.endsWith('.mp3'));
  if (!mp3) {
    const audio = files.find(f => /\.(mp3|m4a|wav|webm|opus)$/i.test(f));
    if (!audio) throw new Error('No audio file found after download');
    const srcPath = path.join(tmpDir, audio);
    const mp3Path = path.join(tmpDir, audio.replace(/\.[^.]+$/, '.mp3'));
    await runCommand(FFMPEG_PATH, ['-y', '-i', srcPath, '-b:a', '64k', mp3Path], 120000);
    fs.unlinkSync(srcPath);
    const fileSize = fs.statSync(mp3Path).size;
    metadata.file_size_mb = Math.round((fileSize / (1024 * 1024)) * 100) / 100;
    return { audioPath: mp3Path, tmpDir, metadata };
  }

  const audioPath = path.join(tmpDir, mp3);
  const fileSize = fs.statSync(audioPath).size;
  metadata.file_size_mb = Math.round((fileSize / (1024 * 1024)) * 100) / 100;

  return { audioPath, tmpDir, metadata };
}

/**
 * Split large audio files into chunks < 24MB (Whisper API limit = 25MB)
 * Same approach as Site Scraper: ffprobe duration, ffmpeg split
 */
async function splitAudioFile(audioPath, onProgress) {
  const fileSizeMb = fs.statSync(audioPath).size / (1024 * 1024);
  if (fileSizeMb <= 24) return [audioPath];

  const numChunks = Math.ceil(fileSizeMb / 24);
  if (onProgress) onProgress(`Splitting large file (${fileSizeMb.toFixed(1)}MB) into ${numChunks} parts...`);

  // Get duration with ffprobe
  const { stdout } = await runCommand(FFPROBE_PATH, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    audioPath,
  ], 30000);
  const duration = parseFloat(stdout.trim());
  const chunkDuration = duration / numChunks;

  const dir = path.dirname(audioPath);
  const base = path.basename(audioPath, '.mp3');
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const chunkPath = path.join(dir, `${base}_chunk${i}.mp3`);

    await runCommand(FFMPEG_PATH, [
      '-y', '-i', audioPath,
      '-ss', String(startTime), '-t', String(chunkDuration),
      '-acodec', 'libmp3lame', '-b:a', '64k',
      chunkPath,
    ], 120000);

    if (fs.existsSync(chunkPath)) chunks.push(chunkPath);
  }

  return chunks.length > 0 ? chunks : [audioPath];
}

/**
 * Transcribe audio using OpenAI SDK (works with both Groq and OpenAI)
 * Exact same approach as Site Scraper: SDK client.audio.transcriptions.create()
 */
async function transcribeAudio(audioPath, provider, apiKey, onProgress) {
  // Create OpenAI-compatible client (Groq uses same API)
  const client = new OpenAI({
    apiKey,
    baseURL: provider === 'groq' ? 'https://api.groq.com/openai/v1' : undefined,
  });

  const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1';

  // Split if needed
  const chunks = await splitAudioFile(audioPath, onProgress);

  const transcripts = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunkPath = chunks[i];

    if (onProgress) {
      if (chunks.length > 1) {
        onProgress(`Transcribing part ${i + 1}/${chunks.length} (${provider})...`);
      } else {
        onProgress(`Transcribing audio (${provider})...`);
      }
    }

    // Use the SDK exactly like Site Scraper does
    const transcript = await client.audio.transcriptions.create({
      model,
      file: fs.createReadStream(chunkPath),
      response_format: 'text',
    });

    transcripts.push(transcript);

    // Cleanup chunk (not original file)
    if (chunkPath !== audioPath) {
      try { fs.unlinkSync(chunkPath); } catch (_) {}
    }
  }

  return transcripts.join(' ');
}

/**
 * Process a single podcast URL: resolve → download → split → transcribe
 */
async function processPodcast(url, index, total, provider, apiKey, onProgress) {
  const result = {
    source_url: url,
    status: 'pending',
    transcript: null,
    error: null,
    title: null,
    date: null,
    file_size_mb: null,
    word_count: null,
  };

  let audioPath = null;
  let tmpDir = null;

  try {
    // Step 1: Download
    if (onProgress) onProgress(`Downloading podcast ${index + 1}/${total}...`);
    const download = await downloadAudio(url, onProgress);
    audioPath = download.audioPath;
    tmpDir = download.tmpDir;

    result.title = download.metadata.title || path.basename(audioPath, '.mp3');
    result.date = download.metadata.date || null;
    result.file_size_mb = download.metadata.file_size_mb || null;

    // Step 2: Transcribe
    if (onProgress) onProgress(`Transcribing podcast ${index + 1}/${total}...`);
    const transcript = await transcribeAudio(audioPath, provider, apiKey, onProgress);

    result.status = 'success';
    result.transcript = transcript;
    result.word_count = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;

  } catch (err) {
    result.status = result.title ? 'transcription_failed' : 'download_failed';
    result.error = err.message;
  } finally {
    // Cleanup temp files
    try { if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath); } catch (_) {}
    try { if (tmpDir && fs.existsSync(tmpDir)) fs.rmdirSync(tmpDir, { recursive: true }); } catch (_) {}
  }

  return result;
}

module.exports = { processPodcast };
