import React, { useState, useEffect } from 'react';

export default function Settings({ onClose }) {
  const [keys, setKeys] = useState({
    groq_api_key: '', openai_api_key: '',
    transcription_provider: 'groq',
    llm_api_key: '', llm_provider: 'groq',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { window.api.getApiKeys().then(setKeys); }, []);

  const save = async () => {
    setSaving(true); await window.api.saveApiKeys(keys);
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
  };
  const u = (k, v) => setKeys(p => ({ ...p, [k]: v }));

  return (
    <div className="fixed inset-0 bg-black/15 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white border border-[#e5e5ea] rounded-2xl w-[380px] shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e5e5ea]">
          <h2 className="text-[14px] font-semibold">Settings</h2>
          <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded hover:bg-[#f5f5f7]">
            <svg className="w-3.5 h-3.5 text-[#86868b]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3 space-y-4">
          {/* Transcription */}
          <Section title="Transcription (Whisper)">
            <Toggle options={[{v:'groq',l:'Groq'},{v:'openai',l:'OpenAI'}]} selected={keys.transcription_provider} onChange={v => u('transcription_provider', v)} />
            {keys.transcription_provider === 'groq'
              ? <Field label="Groq API Key" value={keys.groq_api_key} onChange={v => u('groq_api_key', v)} secret />
              : <Field label="OpenAI API Key" value={keys.openai_api_key} onChange={v => u('openai_api_key', v)} secret />
            }
          </Section>

          {/* LLM */}
          <Section title="PDF Analysis (LLM)">
            <Toggle options={[{v:'groq',l:'Groq'},{v:'anthropic',l:'Claude'},{v:'openai',l:'OpenAI'}]} selected={keys.llm_provider} onChange={v => u('llm_provider', v)} />
            <Field
              label={keys.llm_provider === 'groq' ? 'Groq API Key' : keys.llm_provider === 'anthropic' ? 'Anthropic API Key' : 'OpenAI API Key'}
              value={keys.llm_api_key}
              onChange={v => u('llm_api_key', v)} secret />
            <p className="text-[10px] text-[#aeaeb2]">
              {keys.llm_provider === 'groq' ? 'Uses llama-3.3-70b-versatile' : keys.llm_provider === 'anthropic' ? 'Uses Claude Sonnet' : 'Uses GPT-4o-mini'}
            </p>
          </Section>

          <button onClick={save} disabled={saving}
            className="w-full h-8 bg-[#1d1d1f] hover:bg-[#333] text-white text-[12px] font-semibold rounded-xl disabled:opacity-50 transition-colors">
            {saved ? 'Saved' : saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[10px] font-semibold text-[#86868b] uppercase tracking-wider">{title}</h3>
      {children}
    </div>
  );
}

function Toggle({ options, selected, onChange }) {
  return (
    <div className="flex gap-[2px] bg-[#f5f5f7] rounded-lg p-[2px]">
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)}
          className={`flex-1 py-1 text-[11px] font-medium rounded-md transition-all ${
            selected === o.v ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#86868b] hover:text-[#6e6e73]'
          }`}>{o.l}</button>
      ))}
    </div>
  );
}

function Field({ label, value, onChange, secret }) {
  return (
    <div>
      <label className="text-[10px] text-[#aeaeb2] mb-0.5 block">{label}</label>
      <input type={secret ? 'password' : 'text'} value={value} onChange={e => onChange(e.target.value)}
        className="w-full h-8 px-2.5 text-[12px] bg-[#f5f5f7] border border-[#e5e5ea] rounded-lg focus:border-[#0071e3]/40 focus:ring-1 focus:ring-[#0071e3]/10 transition-all" />
    </div>
  );
}
