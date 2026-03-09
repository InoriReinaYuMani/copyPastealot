export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();
    const image = formData.get('image');

    if (!image) {
      return Response.json({ error: 'image is required' }, { status: 400 });
    }

    const backendUrl = context.env.OCR_BACKEND_URL;
    if (!backendUrl) {
      return Response.json({ error: 'OCR_BACKEND_URL is not configured' }, { status: 501 });
    }

    const upstreamForm = new FormData();
    upstreamForm.append('image', image, image.name || 'upload.png');

    const headers = {};
    if (context.env.OCR_BACKEND_TOKEN) {
      headers.Authorization = `Bearer ${context.env.OCR_BACKEND_TOKEN}`;
    }

    const upstreamRes = await fetch(backendUrl, {
      method: 'POST',
      headers,
      body: upstreamForm
    });

    if (!upstreamRes.ok) {
      const detail = await upstreamRes.text();
      return Response.json({ error: 'upstream failed', detail }, { status: 502 });
    }

    const contentType = upstreamRes.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await upstreamRes.json();
      return Response.json({ text: typeof json.text === 'string' ? json.text : '' }, { status: 200 });
    }

    const text = await upstreamRes.text();
    return Response.json({ text }, { status: 200 });
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
}
