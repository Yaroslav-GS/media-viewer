import { useEffect, useRef, useState } from 'react';
import { parentPath } from '../lib/paths.js';

const maxPreviewLoads = 2;
const previewQueue = [];
let activePreviewLoads = 0;
const previewRequestVersion = '2';

export default function MediaGrid({ items, loading, thumbSize, onOpen, onItemActions, onDragPayloadChange }) {
  if (loading) {
    return <div className="muted-state content-state">Загрузка медиа...</div>;
  }

  if (!items.length) {
    return <div className="muted-state content-state">В этой папке нет поддерживаемых фото или видео</div>;
  }

  return (
    <div className={`media-grid media-grid-${thumbSize}`}>
      {items.map((item, index) => (
        <div
          className="media-card"
          key={item.path}
          role="button"
          tabIndex={0}
          onClick={() => onOpen(index)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onOpen(index);
            }
          }}
          title={item.name}
          draggable
          onDragStart={(event) => {
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            const payload = {
              kind: 'media-file',
              path: item.path,
              parentPath: parentPath(item.path)
            };
            const payloadText = JSON.stringify(payload);
            onDragPayloadChange(payload);
            event.dataTransfer.setData('application/x-media-viewer', payloadText);
            event.dataTransfer.setData('application/json', payloadText);
            event.dataTransfer.setData('text/plain', payloadText);
          }}
          onDragEnd={() => onDragPayloadChange(null)}
        >
          <button
            className="media-card-menu"
            onClick={(event) => {
              event.stopPropagation();
              onItemActions(item);
            }}
            aria-label={`Действия для ${item.name}`}
          >
            ⋮
          </button>
          <div className="thumb">
            <PreviewThumb item={item} thumbSize={thumbSize} />
          </div>
          <div className="media-tooltip" aria-hidden="true">
            {item.name}
          </div>
          <div className="media-name">{item.name}</div>
        </div>
      ))}
    </div>
  );
}

function PreviewThumb({ item, thumbSize }) {
  const [isVisible, setIsVisible] = useState(false);
  const [previewSrc, setPreviewSrc] = useState('');
  const [failed, setFailed] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    if (!('IntersectionObserver' in window)) {
      setIsVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setIsVisible(true);
        observer.disconnect();
      },
      { rootMargin: '640px 0px' }
    );

    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return undefined;

    const controller = new AbortController();
    let objectUrl = '';
    let cancelled = false;
    const previewUrl = buildPreviewUrl(item, thumbSize);

    setPreviewSrc('');
    setFailed(false);

    const cancelQueuedLoad = enqueuePreviewLoad(async () => {
      try {
        const response = await fetch(previewUrl, { signal: controller.signal });
        if (!response.ok) throw new Error('Preview request failed');

        const blob = await response.blob();
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        setPreviewSrc(objectUrl);
      } catch (error) {
        if (error.name !== 'AbortError' && !cancelled) {
          setFailed(true);
        }
      }
    });

    return () => {
      cancelled = true;
      controller.abort();
      cancelQueuedLoad();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isVisible, item.modifiedAt, item.previewUrl, item.size, item.type, thumbSize]);

  return (
    <div ref={rootRef} className={`preview-thumb ${item.type === 'video' ? 'video-thumb' : ''} ${failed ? 'preview-failed' : ''}`}>
      {previewSrc ? (
        <img src={previewSrc} alt={item.name} draggable={false} />
      ) : (
        <div className="preview-placeholder" aria-hidden="true" />
      )}
      {item.type === 'video' && <div className="play-badge">▶</div>}
    </div>
  );
}

function buildPreviewUrl(item, thumbSize) {
  const params = new URLSearchParams({
    size: String(previewPixelSize(thumbSize)),
    v: [
      previewRequestVersion,
      item.type,
      item.size,
      item.modifiedAt
    ].join(':')
  });

  return `${item.previewUrl}?${params}`;
}

function enqueuePreviewLoad(task) {
  const entry = { task, cancelled: false };
  previewQueue.push(entry);
  runPreviewQueue();

  return () => {
    entry.cancelled = true;
  };
}

function runPreviewQueue() {
  while (activePreviewLoads < maxPreviewLoads && previewQueue.length) {
    const entry = previewQueue.shift();
    if (entry.cancelled) continue;

    activePreviewLoads += 1;
    Promise.resolve(entry.task())
      .finally(() => {
        activePreviewLoads -= 1;
        runPreviewQueue();
      });
  }
}

function previewPixelSize(thumbSize) {
  if (thumbSize === 'small') return 240;
  if (thumbSize === 'large') return 720;
  return 480;
}
