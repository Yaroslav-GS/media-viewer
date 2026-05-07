export default function MediaGrid({ items, loading, thumbSize, onOpen, onDragPayloadChange }) {
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
          <div className="thumb">
            {item.type === 'image' ? (
              <img src={item.url} alt={item.name} loading="lazy" />
            ) : (
              <div className="video-thumb">
                <video src={item.url} preload="metadata" muted />
                <div className="play-badge">▶</div>
              </div>
            )}
          </div>
          <div className="media-tooltip" aria-hidden="true">
            {item.name}
          </div>
        </div>
      ))}
    </div>
  );
}

function parentPath(filePath) {
  const index = filePath.lastIndexOf('/');
  if (index <= 0) return '/';
  return filePath.slice(0, index);
}
