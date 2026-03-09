const DEFAULT_MODEL = 'gpt-4.1-mini';

function buildInstruction(matchMode, matchText, customPrompt) {
  if (customPrompt) return customPrompt;

  const condition = matchText
    ? matchMode === 'suffix'
      ? `末尾が「${matchText}」の文字列を優先して1件返してください。`
      : `先頭が「${matchText}」の文字列を優先して1件返してください。`
    : '画像内の文字列から最も有用そうな1件を返してください。';

  return [
    'あなたはOCRアシスタントです。',
    '画像内の文字列を読み取り、最終的に1件だけ返してください。',
    condition,
    '返答は抽出結果の文字列のみ。余計な説明や記号は不要です。'
  ].join('\n');
}

export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();
    const image = formData.get('image');
    const matchMode = String(formData.get('matchMode') || 'prefix');
    const matchText = String(formData.get('matchText') || '').trim();

    if (!image) {
      return Response.json({ error: 'image is required' }, { status: 400 });
    }

    const apiKey = context.env.OPENAI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: 'OPENAI_API_KEY is not configured' }, { status: 501 });
    }

    const model = context.env.OPENAI_MODEL || DEFAULT_MODEL;
    const customPrompt = context.env.OCR_PROMPT || '';
    const instruction = buildInstruction(matchMode, matchText, customPrompt);

    const imageBuffer = await image.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
    const mimeType = image.type || 'image/png';
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const openaiRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: instruction },
              { type: 'input_image', image_url: dataUrl }
            ]
          }
        ]
      })
    });

    if (!openaiRes.ok) {
      const detail = await openaiRes.text();
      return Response.json({ error: 'openai request failed', detail }, { status: 502 });
    }

    const json = await openaiRes.json();
    const text = typeof json.output_text === 'string' ? json.output_text.trim() : '';
    return Response.json({ text }, { status: 200 });
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
}
