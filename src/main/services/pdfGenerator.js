const PDFDocument = require('pdfkit');
const fs = require('fs');

async function generateReport(results, userPrompt, provider, apiKey, onProgress) {
  const podcastSummary = results
    .filter((r) => r.status === 'success')
    .map((r) => ({
      title: r.title,
      date: r.date,
      word_count: r.word_count,
      transcript_preview: (r.transcript || '').substring(0, 500),
    }));

  const prompt = `${userPrompt}

Based on the following podcast transcription data:

${JSON.stringify(podcastSummary, null, 2)}

Write a professional report. Include sections with clear headers using ## markdown. Be thorough and analytical. Do NOT use ** bold markers in the body text.`;

  if (onProgress) onProgress(0.1, 'Analyzing with LLM...');

  let reportText;

  if (provider === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    reportText = msg.content[0].text;
  } else if (provider === 'groq') {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
    const resp = await client.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    });
    reportText = resp.choices[0].message.content;
  } else {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey });
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    });
    reportText = resp.choices[0].message.content;
  }

  if (onProgress) onProgress(0.6, 'Generating PDF...');
  return reportText;
}

/**
 * Clean markdown bold/italic markers from text
 */
function cleanMarkdown(text) {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1');
}

async function generatePdf({ results, prompt, provider, apiKey, filePath, onProgress }) {
  const reportText = await generateReport(results, prompt, provider, apiKey, onProgress);

  if (onProgress) onProgress(0.65, 'Building PDF layout...');

  const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: 55, right: 55 } });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const pageWidth = 595.28;
  const contentLeft = 55;
  const contentRight = pageWidth - 55;
  const contentWidth = contentRight - contentLeft;

  // --- Header accent bar ---
  doc.rect(0, 0, pageWidth, 6).fill('#1d1d1f');

  // --- Title ---
  doc.moveDown(1.5);
  doc.fontSize(26).font('Helvetica-Bold').fillColor('#1d1d1f').text('Podcast Report', { align: 'center' });
  doc.moveDown(0.3);

  // Subtitle
  const successCount = results.filter(r => r.status === 'success').length;
  const totalWords = results.reduce((s, r) => s + (r.word_count || 0), 0);
  doc.fontSize(10).font('Helvetica').fillColor('#86868b')
    .text(`Generated on ${new Date().toISOString().split('T')[0]}  ·  ${results.length} podcasts  ·  ${successCount} transcribed  ·  ${totalWords.toLocaleString()} words`, { align: 'center' });

  doc.moveDown(1.2);

  // Divider line
  doc.strokeColor('#e5e5ea').lineWidth(0.5)
    .moveTo(contentLeft, doc.y).lineTo(contentRight, doc.y).stroke();
  doc.moveDown(1);

  if (onProgress) onProgress(0.7, 'Writing report sections...');

  // --- Report body ---
  // Split by markdown headers (##, ###, #)
  const lines = reportText.split('\n');
  let inList = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // Check for page break
    if (doc.y > 720) doc.addPage();

    // Markdown header
    const headerMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const heading = cleanMarkdown(headerMatch[2].trim());
      inList = false;

      if (level === 1) {
        doc.moveDown(0.8);
        doc.fontSize(18).font('Helvetica-Bold').fillColor('#1d1d1f').text(heading);
        doc.moveDown(0.3);
        // Thin accent under h1
        doc.strokeColor('#1d1d1f').lineWidth(1)
          .moveTo(contentLeft, doc.y).lineTo(contentLeft + 50, doc.y).stroke();
        doc.moveDown(0.5);
      } else if (level === 2) {
        doc.moveDown(0.6);
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#1d1d1f').text(heading);
        doc.moveDown(0.3);
      } else {
        doc.moveDown(0.4);
        doc.fontSize(12).font('Helvetica-Bold').fillColor('#333333').text(heading);
        doc.moveDown(0.2);
      }
      continue;
    }

    // Numbered list item (1. 2. 3.)
    const numberedMatch = line.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) {
      const text = cleanMarkdown(numberedMatch[2]);
      doc.fontSize(10).font('Helvetica').fillColor('#333333');
      doc.text(`${numberedMatch[1]}.`, contentLeft, doc.y, { continued: true, width: 20 });
      doc.text(`  ${text}`, { lineGap: 2, width: contentWidth - 20 });
      doc.moveDown(0.15);
      inList = true;
      continue;
    }

    // Bullet list item (- or *)
    const bulletMatch = line.match(/^[\-\*]\s+(.+)/);
    if (bulletMatch) {
      const text = cleanMarkdown(bulletMatch[1]);
      doc.fontSize(10).font('Helvetica').fillColor('#333333');
      // Draw bullet dot
      doc.circle(contentLeft + 4, doc.y + 5, 1.5).fill('#86868b');
      doc.fillColor('#333333').text(text, contentLeft + 14, doc.y, { lineGap: 2, width: contentWidth - 14 });
      doc.moveDown(0.15);
      inList = true;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      if (inList) {
        doc.moveDown(0.3);
        inList = false;
      } else {
        doc.moveDown(0.3);
      }
      continue;
    }

    // Regular paragraph
    inList = false;
    doc.fontSize(10).font('Helvetica').fillColor('#333333')
      .text(cleanMarkdown(line.trim()), { lineGap: 3, width: contentWidth });
    doc.moveDown(0.15);
  }

  if (onProgress) onProgress(0.85, 'Adding podcast summary...');

  // --- Podcast list section ---
  if (results.some((r) => r.status === 'success')) {
    if (doc.y > 620) doc.addPage();
    doc.moveDown(1.5);

    // Section header with background
    const listY = doc.y;
    doc.rect(contentLeft, listY - 4, contentWidth, 24).fill('#f5f5f7');
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#1d1d1f')
      .text('Podcasts Analyzed', contentLeft + 10, listY, { lineGap: 0 });
    doc.moveDown(0.8);

    for (const r of results) {
      if (doc.y > 740) doc.addPage();

      const statusColor = r.status === 'success' ? '#34c759' : '#ff3b30';
      const y = doc.y;

      // Status dot
      doc.circle(contentLeft + 6, y + 4.5, 3).fill(statusColor);

      // Title
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1d1d1f')
        .text(r.title || r.source_url, contentLeft + 16, y, { width: contentWidth - 16 });

      // Details line
      const details = [];
      if (r.date) details.push(r.date);
      if (r.word_count) details.push(`${r.word_count.toLocaleString()} words`);
      if (r.file_size_mb) details.push(`${r.file_size_mb} MB`);
      if (r.error) details.push(r.error);

      if (details.length > 0) {
        doc.fontSize(8.5).font('Helvetica').fillColor('#86868b')
          .text(details.join('  ·  '), contentLeft + 16, doc.y, { width: contentWidth - 16 });
      }

      doc.moveDown(0.5);

      // Separator
      doc.strokeColor('#e5e5ea').lineWidth(0.3)
        .moveTo(contentLeft + 16, doc.y).lineTo(contentRight, doc.y).stroke();
      doc.moveDown(0.4);
    }
  }

  if (onProgress) onProgress(0.95, 'Finalizing PDF...');

  // --- Footer ---
  doc.moveDown(2);
  doc.strokeColor('#e5e5ea').lineWidth(0.5)
    .moveTo(contentLeft, doc.y).lineTo(contentRight, doc.y).stroke();
  doc.moveDown(0.5);
  doc.fontSize(8).font('Helvetica').fillColor('#aeaeb2')
    .text('Generated by Podcast Scraper', { align: 'center' });

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => {
      if (onProgress) onProgress(1.0, 'Done');
      resolve();
    });
    stream.on('error', reject);
  });
}

module.exports = { generatePdf };
