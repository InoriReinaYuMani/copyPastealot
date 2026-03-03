export async function onRequestPost(context) {
  try {
    const formData = await context.request.formData();
    const image = formData.get('image');

    if (!image) {
      return Response.json({ error: 'image is required' }, { status: 400 });
    }

    // TODO: Replace this stub with actual OCR integration (e.g. NDLOCR backend call).
    // Keeping response shape compatible with frontend expectation: { text: string }
    return Response.json({ text: '' }, { status: 200 });
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
}
