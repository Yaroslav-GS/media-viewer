import { useEffect, useRef, useState } from 'react';

export default function Viewer({ items, index, onIndexChange, onClose, onDelete }) {
  const item = items[index];
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const imageRef = useRef(null);
  const viewerRef = useRef(null);
  const wasDraggingRef = useRef(false);

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [index]);

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
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

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
    setScale(1);
    setOffset({ x: 0, y: 0 });
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

    const rect = image.getBoundingClientRect();
    const nextScale = clamp(Number((scale + delta).toFixed(2)), 1, 6);

    if (nextScale === 1) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
      return;
    }

    const ratio = nextScale / scale;
    setScale(nextScale);
    setOffset({
      x: clientX - (clientX - rect.left) * ratio - rect.left + offset.x,
      y: clientY - (clientY - rect.top) * ratio - rect.top + offset.y
    });
  }

  function onPointerDown(event) {
    if (item.type !== 'image' || scale <= 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    wasDraggingRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offset
    };
  }

  function onPointerMove(event) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
      wasDraggingRef.current = true;
    }

    setOffset({
      x: dragRef.current.offset.x + event.clientX - dragRef.current.startX,
      y: dragRef.current.offset.y + event.clientY - dragRef.current.startY
    });
  }

  function onPointerUp(event) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  function onBackdropClick(event) {
    if (event.target === event.currentTarget) onClose();
  }

  function onContentClick(event) {
    if (event.target === event.currentTarget) onClose();
  }

  function onImageClick(event) {
    event.stopPropagation();
    if (!wasDraggingRef.current) {
      onClose();
    }
  }

  return (
    <div ref={viewerRef} className="viewer" onClick={onBackdropClick} onWheel={onWheel}>
      <div className="viewer-topbar">
        <div className="viewer-name">{item.name}</div>
        <div className="viewer-actions">
          {item.type === 'image' && (
            <>
              <button onClick={() => zoom(-0.25)} aria-label="Уменьшить"><span className="button-glyph" aria-hidden="true">−</span></button>
              <button onClick={resetZoom}>100%</button>
              <button onClick={() => zoom(0.25)} aria-label="Увеличить"><span className="button-glyph" aria-hidden="true">+</span></button>
            </>
          )}
          <button className="danger-action" onClick={() => onDelete(item, index)} aria-label="Удалить файл"><span className="button-glyph" aria-hidden="true">×</span></button>
          <button onClick={onClose} aria-label="Закрыть"><span className="button-glyph" aria-hidden="true">×</span></button>
        </div>
      </div>

      <button className="viewer-click-zone viewer-click-zone-left" onClick={() => go(-1)} aria-label="Предыдущий файл">
        <span className="viewer-arrow" aria-hidden="true">‹</span>
      </button>
      <button className="viewer-click-zone viewer-click-zone-right" onClick={() => go(1)} aria-label="Следующий файл">
        <span className="viewer-arrow" aria-hidden="true">›</span>
      </button>

      <div className="viewer-content" onClick={onContentClick}>
        {item.type === 'image' ? (
          <img
            ref={imageRef}
            src={item.url}
            alt={item.name}
            draggable={false}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onClick={onImageClick}
            className={scale > 1 ? 'zoomed' : ''}
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`
            }}
          />
        ) : (
          <video src={item.url} controls autoPlay />
        )}
      </div>
    </div>
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
