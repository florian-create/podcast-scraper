import React, { useState, useEffect, useCallback } from 'react';
import Settings from './components/Settings';

const COLORS = [
  [220,50,50],[230,100,40],[235,150,35],[230,190,30],[210,210,40],
  [160,210,50],[100,200,60],[50,190,80],[30,180,120],[20,170,150],
];
const SEG = 40;
function lerp(i, n) {
  const t = i / Math.max(n - 1, 1), p = t * (COLORS.length - 1), idx = Math.floor(p), f = p - idx;
  if (idx >= COLORS.length - 1) return `rgb(${COLORS.at(-1)})`;
  const [r1,g1,b1] = COLORS[idx], [r2,g2,b2] = COLORS[idx+1];
  return `rgb(${Math.round(r1+(r2-r1)*f)},${Math.round(g1+(g2-g1)*f)},${Math.round(b1+(b2-b1)*f)})`;
}
function Bar({ progress }) {
  const a = Math.floor(progress * SEG);
  return (
    <div className="flex gap-[2px] h-[8px]">
      {Array.from({ length: SEG }, (_, i) => (
        <div key={i} className="flex-1 rounded-[2px] transition-colors duration-200"
          style={{ backgroundColor: i < a ? lerp(i, SEG) : '#e5e5ea' }} />
      ))}
    </div>
  );
}

const ALL_SUGGESTIONS = [
  "Analyze their marketing & growth strategy",
  "Break down their GTM approach and podcast presence",
  "Summarize key insights and actionable takeaways",
  "Evaluate their content distribution playbook",
  "Assess their thought leadership positioning",
  "Map their audience engagement strategy",
];

function pickRandom(arr, count) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export default function App() {
  const [urls, setUrls] = useState(['', '', '']);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [msg, setMsg] = useState('');
  const [results, setResults] = useState(null);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const [pdfPrompt, setPdfPrompt] = useState('');
  const [genPdf, setGenPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState(0);
  const [pdfMsg, setPdfMsg] = useState('');
  const [suggestions, setSuggestions] = useState(() => pickRandom(ALL_SUGGESTIONS, 3));

  const shuffleSuggestions = () => setSuggestions(pickRandom(ALL_SUGGESTIONS, 3));

  useEffect(() => {
    const unsub1 = window.api.onExtractionProgress((d) => { setProgress(d.progress); setMsg(d.message); });
    const unsub2 = window.api.onPdfProgress((d) => { setPdfProgress(d.progress); setPdfMsg(d.message); });
    return () => { unsub1(); unsub2(); };
  }, []);

  const addUrl = () => setUrls(p => [...p, '']);
  const rmUrl = (i) => { if (urls.length > 1) setUrls(p => p.filter((_, j) => j !== i)); };
  const setUrl = (i, v) => setUrls(p => p.map((u, j) => j === i ? v : u));

  const extract = useCallback(async () => {
    const valid = urls.filter(u => u.trim());
    if (!valid.length) return;
    setExtracting(true); setProgress(0); setError(''); setResults(null); setResultMsg('');
    try {
      const data = await window.api.extractPodcasts(valid);
      setResults(data);
      setResultMsg(`${data.filter(r => r.status === 'success').length}/${data.length} transcribed`);
    } catch (e) { setError(e.message); }
    finally { setExtracting(false); }
  }, [urls]);

  const exportJson = useCallback(async () => {
    if (!results) return;
    const p = await window.api.exportJson({
      extracted_at: new Date().toISOString(),
      total: results.length,
      successful: results.filter(r => r.status === 'success').length,
      total_words: results.reduce((s, r) => s + (r.word_count || 0), 0),
      podcasts: results,
    }, 'podcasts.json');
    if (p) setResultMsg(`Saved ${p}`);
  }, [results]);

  const genReport = useCallback(async () => {
    if (!results || !pdfPrompt.trim()) return;
    setGenPdf(true); setError(''); setPdfProgress(0); setPdfMsg('');
    try {
      const p = await window.api.generatePdf(results, pdfPrompt.trim());
      if (p) setResultMsg(`PDF: ${p}`);
    } catch (e) { setError(e.message); }
    finally { setGenPdf(false); }
  }, [results, pdfPrompt]);

  const hasResults = results && results.length > 0;
  const hasSuccess = results && results.some(r => r.status === 'success');
  const stats = {
    n: hasResults ? results.length : 0,
    ok: hasResults ? results.filter(r => r.status === 'success').length : 0,
    w: hasResults ? results.reduce((s, r) => s + (r.word_count || 0), 0) : 0,
  };

  return (
    <div className="flex flex-col h-screen bg-white select-none">
      {/* Titlebar - aligned with traffic lights */}
      <div className="drag-region flex items-center h-[38px] pl-[78px] pr-3 border-b border-[#e5e5ea]/60">
        <span className="text-[13px] font-semibold text-[#1d1d1f] tracking-tight flex-1">Podcast Scraper</span>
        {extracting && <span className="text-[9px] font-semibold px-1.5 py-[1px] rounded bg-orange-100 text-orange-600 mr-2">EXTRACTING</span>}
        {!extracting && hasResults && <span className="text-[9px] font-semibold px-1.5 py-[1px] rounded bg-green-50 text-green-600 mr-2">DONE</span>}
        <button onClick={() => setShowSettings(true)} className="no-drag w-6 h-6 flex items-center justify-center rounded hover:bg-black/5">
          <svg className="w-[15px] h-[15px] text-[#86868b]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[560px] mx-auto px-5 py-4 space-y-4">

          {/* URLs */}
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <h2 className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider">Podcast URLs</h2>
              <button onClick={addUrl} disabled={extracting} className="text-[11px] font-medium text-[#0071e3] hover:text-[#0071e3]/70 disabled:opacity-30">+ Add</button>
            </div>
            <div className="space-y-1.5">
              {urls.map((url, i) => (
                <div key={i} className="flex gap-1">
                  <input type="text" value={url} onChange={e => setUrl(i, e.target.value)} disabled={extracting}
                    placeholder="YouTube, Spotify, or Apple Podcast URL"
                    className="flex-1 h-8 px-2.5 text-[12px] bg-[#f5f5f7] border border-[#e5e5ea] rounded-lg focus:border-[#0071e3]/40 focus:ring-1 focus:ring-[#0071e3]/10 transition-all disabled:opacity-40" />
                  {urls.length > 1 && (
                    <button onClick={() => rmUrl(i)} disabled={extracting} className="w-6 flex items-center justify-center text-[#c7c7cc] hover:text-red-400 disabled:opacity-30">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Extract button */}
          <button onClick={extract} disabled={extracting || urls.every(u => !u.trim())}
            className="w-full h-9 bg-[#1d1d1f] hover:bg-[#333] text-white text-[12px] font-semibold rounded-xl disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors">
            {extracting && <div className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />}
            {extracting ? 'Extracting...' : 'Extract Podcasts'}
          </button>

          {/* Progress */}
          <div className="space-y-1">
            <Bar progress={progress} />
            {msg && <p className="text-[10px] text-[#86868b]">{msg}</p>}
          </div>

          {/* Error */}
          {error && <p className="text-[11px] text-red-500 bg-red-50 border border-red-100 px-2.5 py-1.5 rounded-lg">{error}</p>}

          {/* Stats - always visible */}
          <div className="flex gap-1.5">
            <Stat label="Podcasts" value={stats.n} active={hasResults} />
            <Stat label="Transcribed" value={stats.ok} green active={hasResults} />
            <Stat label="Words" value={stats.w.toLocaleString()} active={hasResults} />
          </div>

          {/* Results list - always visible (empty state when no results) */}
          <div className={`rounded-xl border overflow-hidden transition-colors ${hasResults ? 'border-[#e5e5ea]' : 'border-[#e5e5ea]/60'}`}>
            {hasResults ? (
              results.map((r, i) => (
                <div key={i} className={`flex items-center gap-2.5 px-3 py-2 ${i > 0 ? 'border-t border-[#e5e5ea]' : ''}`}>
                  <span className={`w-[6px] h-[6px] rounded-full flex-shrink-0 ${r.status === 'success' ? 'bg-green-500' : 'bg-red-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate">{r.title || r.source_url}</p>
                    <p className="text-[10px] text-[#86868b]">
                      {r.status === 'success'
                        ? `${r.word_count} words${r.date ? ' · '+r.date : ''}${r.file_size_mb ? ' · '+r.file_size_mb+' MB' : ''}`
                        : r.error || r.status}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-center">
                <p className="text-[11px] text-[#c7c7cc]">Results will appear here</p>
              </div>
            )}
          </div>

          {/* Export JSON - always visible */}
          <button onClick={exportJson} disabled={!hasResults}
            className={`w-full h-8 border text-[12px] font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              hasResults ? 'border-[#e5e5ea] hover:bg-[#f5f5f7] text-[#1d1d1f]' : 'border-[#e5e5ea]/60 text-[#c7c7cc] cursor-not-allowed'
            }`}>
            <svg className={`w-3 h-3 ${hasResults ? 'text-[#86868b]' : 'text-[#d1d1d6]'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export JSON
          </button>

          {resultMsg && <p className="text-[10px] text-green-600">{resultMsg}</p>}

          {/* Analysis & PDF Report - always visible */}
          <section className={`pt-3 border-t space-y-2 transition-colors ${hasSuccess ? 'border-[#e5e5ea]' : 'border-[#e5e5ea]/60'}`}>
            <div className="flex items-center gap-1.5">
              <h2 className={`text-[11px] font-semibold uppercase tracking-wider ${hasSuccess ? 'text-[#86868b]' : 'text-[#c7c7cc]'}`}>Analysis & PDF Report</h2>
              <button
                onClick={shuffleSuggestions}
                disabled={!hasSuccess}
                className={`w-5 h-5 flex items-center justify-center rounded-md transition-colors ${
                  hasSuccess ? 'hover:bg-[#f5f5f7] text-[#86868b] hover:text-[#6e6e73]' : 'text-[#d1d1d6] cursor-not-allowed'
                }`}
                title="Shuffle suggestions"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  onClick={() => setPdfPrompt(s)}
                  disabled={!hasSuccess}
                  className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
                    hasSuccess
                      ? 'border-[#e5e5ea] bg-[#f5f5f7] hover:bg-[#eaeaec] text-[#1d1d1f] hover:border-[#d1d1d6] cursor-pointer'
                      : 'border-[#e5e5ea]/60 bg-[#fafafa] text-[#c7c7cc] cursor-not-allowed'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <textarea value={pdfPrompt} onChange={e => setPdfPrompt(e.target.value)} disabled={!hasSuccess}
              placeholder="Describe the report you want..."
              className={`w-full h-20 px-2.5 py-2 text-[12px] border rounded-xl transition-all resize-none ${
                hasSuccess
                  ? 'bg-[#f5f5f7] border-[#e5e5ea] focus:border-[#0071e3]/40 focus:ring-1 focus:ring-[#0071e3]/10'
                  : 'bg-[#fafafa] border-[#e5e5ea]/60 text-[#c7c7cc] cursor-not-allowed'
              }`} />
            <button onClick={genReport} disabled={genPdf || !hasSuccess || !pdfPrompt.trim()}
              className="w-full h-9 bg-[#1d1d1f] hover:bg-[#333] text-white text-[12px] font-semibold rounded-xl disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 transition-colors">
              {genPdf && <div className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />}
              {genPdf ? 'Generating...' : 'Generate PDF Report'}
            </button>
            {genPdf && (
              <div className="space-y-1">
                <Bar progress={pdfProgress} />
                {pdfMsg && <p className="text-[10px] text-[#86868b]">{pdfMsg}</p>}
              </div>
            )}
          </section>

          <div className="h-2" />
        </div>
      </div>

      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function Stat({ label, value, green, active }) {
  return (
    <div className={`flex-1 rounded-lg px-2.5 py-2 text-center transition-colors ${active ? 'bg-[#f5f5f7]' : 'bg-[#fafafa]'}`}>
      <div className={`text-[16px] font-bold ${!active ? 'text-[#d1d1d6]' : green ? 'text-green-600' : 'text-[#1d1d1f]'}`}>{value}</div>
      <div className={`text-[9px] uppercase tracking-wider ${active ? 'text-[#86868b]' : 'text-[#c7c7cc]'}`}>{label}</div>
    </div>
  );
}
