/* ============================================================
   NeuralKinetics - Boomerang hero video background
   Plays the source clip once, capturing every frame to small
   offscreen canvases as it goes. Once the clip ends, switches to
   a display canvas that ping-pongs those frames forward→reverse
   forever at 30fps - a soft looping "boomerang" background with
   no visible seam, unlike a native video loop.
   ============================================================ */

(function () {
  const video = document.getElementById('heroBoomerangVideo');
  const canvas = document.getElementById('heroBoomerangCanvas');
  if (!video || !canvas) return;

  const ctx = canvas.getContext('2d');
  const MAX_CAPTURE_WIDTH = 960;

  const frames = [];
  let capturing = false;
  let lastCapturedTime = -1;
  let captureW = 0;
  let captureH = 0;
  let captureRafId = null;

  function captureFrame(_now, metadata) {
    if (!capturing) return;

    const t = metadata ? metadata.mediaTime : video.currentTime;

    if (t !== lastCapturedTime && video.videoWidth) {
      lastCapturedTime = t;

      if (!captureW) {
        captureW = Math.min(MAX_CAPTURE_WIDTH, video.videoWidth);
        captureH = Math.round(captureW * (video.videoHeight / video.videoWidth));
      }

      const off = document.createElement('canvas');
      off.width = captureW;
      off.height = captureH;
      off.getContext('2d').drawImage(video, 0, 0, captureW, captureH);
      frames.push(off);
    }

    scheduleNextCapture();
  }

  function scheduleNextCapture() {
    if (!capturing) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(captureFrame);
    } else {
      captureRafId = requestAnimationFrame(captureFrame);
    }
  }

  function startCapture() {
    if (capturing) return;
    capturing = true;
    scheduleNextCapture();
  }

  function stopCapture() {
    capturing = false;
    if (captureRafId) cancelAnimationFrame(captureRafId);
  }

  function startBoomerangPlayback() {
    if (!frames.length) return;

    canvas.width = captureW;
    canvas.height = captureH;
    video.style.display = 'none';
    canvas.style.display = 'block';

    let index = 0;
    let direction = 1;
    const interval = 1000 / 30;
    let lastTick = 0;

    function tick(ts) {
      if (!lastTick) lastTick = ts;
      if (ts - lastTick >= interval) {
        lastTick = ts;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(frames[index], 0, 0, canvas.width, canvas.height);

        index += direction;
        if (index >= frames.length - 1) {
          index = frames.length - 1;
          direction = -1;
        } else if (index <= 0) {
          index = 0;
          direction = 1;
        }
      }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  video.addEventListener(
    'loadeddata',
    function () {
      startCapture();
      video.play().catch(function () {
        /* Autoplay can be blocked before user interaction - the
           poster frame / fallback background still reads fine. */
      });
    },
    { once: true }
  );

  video.addEventListener(
    'ended',
    function () {
      stopCapture();
      startBoomerangPlayback();
    },
    { once: true }
  );
})();
