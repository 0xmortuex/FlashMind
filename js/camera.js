// ===== Camera (voice tutor "show your work") =====
// Opens a camera, keeps a small muted <video> preview, and grabs frames as
// ~640px JPEGs plus a tiny grayscale thumbnail used to tell whether the page
// in view actually changed (unchanged frames are not worth sending).
const Camera = (() => {
  const THUMB_W = 32, THUMB_H = 24;

  function supported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof HTMLCanvasElement !== 'undefined';
  }

  // `choice`: 'environment' | 'user' (phone back/front) or a deviceId.
  async function open(choice) {
    const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (choice === 'user' || choice === 'environment' || !choice) video.facingMode = { ideal: choice || 'environment' };
    else video.deviceId = { exact: choice };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    } catch (err) {
      // A saved camera that is gone: fall back to any camera.
      if (!video.deviceId || (err.name !== 'OverconstrainedError' && err.name !== 'NotFoundError')) throw err;
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    }
    const el = document.createElement('video');
    el.className = 'voice-cam-video';
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.setAttribute('playsinline', '');
    el.srcObject = stream;
    const facing = (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].getSettings && stream.getVideoTracks()[0].getSettings().facingMode) || (choice === 'user' ? 'user' : '');
    if (facing === 'user') el.classList.add('mirror');
    await el.play().catch(() => {});
    const canvas = document.createElement('canvas');
    const thumb = document.createElement('canvas');
    thumb.width = THUMB_W; thumb.height = THUMB_H;
    const tctx = thumb.getContext('2d', { willReadFrequently: true });

    function ready() { return el.readyState >= 2 && el.videoWidth > 0; }

    // Grayscale thumbnail of the current frame (for change detection).
    function sample() {
      if (!ready()) return null;
      tctx.drawImage(el, 0, 0, THUMB_W, THUMB_H);
      const px = tctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
      const out = new Uint8Array(THUMB_W * THUMB_H);
      for (let i = 0; i < out.length; i++) out[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
      return out;
    }

    // Current frame as base64 JPEG (no data: prefix), longest side 640px.
    function jpeg(quality = 0.7) {
      if (!ready()) return Promise.resolve(null);
      const size = LiveCore.frameSize(el.videoWidth, el.videoHeight, 640);
      canvas.width = size.w; canvas.height = size.h;
      canvas.getContext('2d').drawImage(el, 0, 0, size.w, size.h);
      return new Promise(resolve => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(null); return; }
          const r = new FileReader();
          r.onload = () => resolve(String(r.result).split(',')[1] || null);
          r.onerror = () => resolve(null);
          r.readAsDataURL(blob);
        }, 'image/jpeg', quality);
      });
    }

    function setEnabled(on) { stream.getVideoTracks().forEach(t => { t.enabled = on; }); }

    function stop() {
      stream.getTracks().forEach(t => t.stop());
      el.srcObject = null;
      el.remove();
    }

    return { video: el, stream, sample, jpeg, setEnabled, stop, facing };
  }

  // [{ id, label }] of cameras (labels appear once permission is granted).
  async function list() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.deviceId).map(d => ({ id: d.deviceId, label: d.label }));
    } catch (e) { return []; }
  }

  return { supported, open, list };
})();
