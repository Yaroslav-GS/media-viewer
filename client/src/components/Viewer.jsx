import { useEffect, useRef, useState } from 'react';

export default function Viewer({ items, index, onIndexChange, onClose, onDelete }) {
  const item = items[index];
  const [scale, setScale] = useState(1);
  const dragRef = useRef(null);
  const frameRef = useRef(0);
  const imageRef = useRef(null);
  const lastTapRef = useRef(0);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);
  const transformRef = useRef({ scale: 1, x: 0, y: 0 });
  const viewerRef = useRef(null);
  const wasDraggingRef = useRef(false);

  useEffect(() => {
    setImageTransform({ scale: 1, x: 0, y: 0 }, { commit: true, immediate: true });
    pointersRef.current.clear();
    pinchRef.current = null;
    dragRef.current = null;
  }, [index]);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.classList.add('viewer-open');

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.classList.remove('viewer-open');
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return undefined;

    function stopWheel(event) {
      event.preventDefault();
    }

    viewer.addEventListener('wheel', stopWheel, { passive: false, capture: true });
    return () => viewer.removeEventListener('wheel', stopWheel, { capture: true });
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') {
        onIndexChange((index - 1 + items.length) % items.length);
      }
      if (event.key === 'ArrowRight') {
        onIndexChange((index + 1) % items.length);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [index, items.length, onClose, onIndexChange]);

  if (!item) return null;

  function go(delta) {
    onIndexChange((index + delta + items.length) % items.length);
  }

  function zoom(delta) {
    if (item.type !== 'image') return;
    const rect = imageRef.current?.getBoundingClientRect();
    const clientX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const clientY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    zoomAt(clientX, clientY, delta);
  }

  function resetZoom() {
    setImageTransform({ scale: 1, x: 0, y: 0 }, { commit: true });
  }

  function onWheel(event) {
    event.stopPropagation();
    if (item.type !== 'image') return;
    event.preventDefault();
    zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 0.18 : -0.18);
  }

  function zoomAt(clientX, clientY, delta) {
    const image = imageRef.current;
    if (!image) return;

    const currentTransform = transformRef.current;
    const nextScale = clamp(Number((currentTransform.scale + delta).toFixed(2)), 1, 6);

    if (nextScale === 1) {
      setImageTransform({ scale: 1, x: 0, y: 0 }, { commit: true });
      return;
    }

    setImageTransform({
      scale: nextScale,
      x: currentTransform.scale === 1 ? 0 : currentTransform.x,
      y: currentTransform.scale === 1 ? 0 : currentTransform.y
    }, { commit: true });
  }

  function onPointerDown(event) {
    if (item.type !== 'image') return;

    event.currentTarget.setPointerCapture(event.pointerId);
    wasDraggingRef.current = false;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      const center = midpoint(first, second);
      pinchRef.current = {
        startDistance: distance(first, second),
        startScale: transformRef.current.scale,
        startOffset: { x: transformRef.current.x, y: transformRef.current.y },
        startCenter: center
      };
      dragRef.current = null;
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset: { x: transformRef.current.x, y: transformRef.current.y },
      mode: transformRef.current.scale > 1 ? 'pan' : 'swipe'
    };
  }

  function onPointerMove(event) {
    if (item.type !== 'image') return;

    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }

    if (pinchRef.current && pointersRef.current.size >= 2) {
      event.preventDefault();
      const [first, second] = Array.from(pointersRef.current.values());
      const center = midpoint(first, second);
      const nextScale = clamp(Number((pinchRef.current.startScale * (distance(first, second) / pinchRef.current.startDistance)).toFixed(2)), 1, 6);

      if (nextScale === 1) {
        setImageTransform({ scale: 1, x: 0, y: 0 });
      } else {
        setImageTransform({
          scale: nextScale,
          x: pinchRef.current.startOffset.x + center.x - pinchRef.current.startCenter.x,
          y: pinchRef.current.startOffset.y + center.y - pinchRef.current.startCenter.y
        });
      }
      wasDraggingRef.current = true;
      return;
    }

    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
      wasDraggingRef.current = true;
    }

    if (dragRef.current.mode !== 'pan') return;

    event.preventDefault();
    setImageTransform({
      scale: transformRef.current.scale,
      x: dragRef.current.offset.x + deltaX,
      y: dragRef.current.offset.y + deltaY
    });
  }

  function onPointerUp(event) {
    const activeDrag = dragRef.current;

    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }

    setScale(transformRef.current.scale);

    if (activeDrag?.mode === 'swipe') {
      const deltaX = event.clientX - activeDrag.startX;
      const deltaY = event.clientY - activeDrag.startY;
      if (deltaY < -72 && Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
        onClose();
        return;
      }
      if (Math.abs(deltaX) > 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) {
        go(deltaX < 0 ? 1 : -1);
      }
    }
  }

  function onBackdropClick(event) {
    if (event.target === event.currentTarget) onClose();
  }

  function onContentClick(event) {
    if (event.target === event.currentTarget && !wasDraggingRef.current) onClose();
  }

  function onImageClick(event) {
    event.stopPropagation();
    if (wasDraggingRef.current) return;

    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      if (scale > 1) {
        resetZoom();
      } else {
        zoomAt(event.clientX, event.clientY, 1.8);
      }
      lastTapRef.current = 0;
      return;
    }

    lastTapRef.current = now;
  }

  return (
    <div ref={viewerRef} className={`viewer ${scale > 1 ? 'viewer-image-zoomed' : ''}`} onClick={onBackdropClick} onWheel={onWheel}>
      <div className="viewer-topbar">
        <div className="viewer-name">{item.name}</div>
        <div className="viewer-actions">
          {item.type === 'image' && (
            <>
              <button className="viewer-zoom-action" onClick={() => zoom(-0.25)} aria-label="Уменьшить"><span className="button-glyph" aria-hidden="true">−</span></button>
              <button className="viewer-zoom-action" onClick={resetZoom}>100%</button>
              <button className="viewer-zoom-action" onClick={() => zoom(0.25)} aria-label="Увеличить"><span className="button-glyph" aria-hidden="true">+</span></button>
            </>
          )}
          <button className="danger-action" onClick={() => onDelete(item, index)} aria-label="Удалить файл">Удалить</button>
          <button onClick={onClose} aria-label="Закрыть"><span className="button-glyph" aria-hidden="true">×</span></button>
        </div>
      </div>

      <button className="viewer-click-zone viewer-click-zone-left" onClick={() => go(-1)} aria-label="Предыдущий файл">
        <span className="viewer-arrow" aria-hidden="true">‹</span>
      </button>
      <button className="viewer-click-zone viewer-click-zone-right" onClick={() => go(1)} aria-label="Следующий файл">
        <span className="viewer-arrow" aria-hidden="true">›</span>
      </button>

      <div
        className="viewer-content"
        onClick={onContentClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {item.type === 'image' ? (
          <img
            ref={imageRef}
            src={item.url}
            alt={item.name}
            draggable={false}
            onClick={onImageClick}
            className={scale > 1 ? 'zoomed' : ''}
          />
        ) : (
          <video src={item.url} controls autoPlay />
        )}
      </div>
    </div>
  );

  function setImageTransform(nextTransform, { commit = false, immediate = false } = {}) {
    const normalizedTransform = normalizeTransform(nextTransform);
    transformRef.current = normalizedTransform;

    if (immediate) {
      applyImageTransform(normalizedTransform);
    } else {
      scheduleImageTransform();
    }

    if (commit) {
      setScale(normalizedTransform.scale);
    }
  }

  function scheduleImageTransform() {
    if (frameRef.current) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      applyImageTransform(transformRef.current);
    });
  }

  function applyImageTransform(nextTransform) {
    const image = imageRef.current;
    if (!image) return;

    image.style.transform = `translate3d(${nextTransform.x}px, ${nextTransform.y}px, 0) scale(${nextTransform.scale})`;
    image.classList.toggle('zoomed', nextTransform.scale > 1);
    viewerRef.current?.classList.toggle('viewer-image-zoomed', nextTransform.scale > 1);
  }
}

function normalizeTransform(transform) {
  const scale = clamp(transform.scale, 1, 6);

  if (scale === 1) {
    return { scale, x: 0, y: 0 };
  }

  return {
    scale,
    x: Math.round(transform.x),
    y: Math.round(transform.y)
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}
