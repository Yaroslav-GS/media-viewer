import { useState } from 'react';
import { parentPath } from '../lib/paths.js';

export default function FolderTree({
  node,
  selectedPath,
  onSelect,
  onMoveFile,
  onMoveFolder,
  onDeleteFolder,
  onCreateFolder,
  onMoveFolderRequest,
  expandedPaths,
  onToggleFolder,
  dragPayload,
  onDragPayloadChange
}) {
  return (
    <nav className="folder-tree" aria-label="Папки">
      <TreeNode
        node={node}
        selectedPath={selectedPath}
        onSelect={onSelect}
        onMoveFile={onMoveFile}
        onMoveFolder={onMoveFolder}
        onDeleteFolder={onDeleteFolder}
        onCreateFolder={onCreateFolder}
        onMoveFolderRequest={onMoveFolderRequest}
        expandedPaths={expandedPaths}
        onToggleFolder={onToggleFolder}
        dragPayload={dragPayload}
        onDragPayloadChange={onDragPayloadChange}
        root
      />
    </nav>
  );
}

function TreeNode({
  node,
  selectedPath,
  onSelect,
  onMoveFile,
  onMoveFolder,
  onDeleteFolder,
  onCreateFolder,
  onMoveFolderRequest,
  expandedPaths,
  onToggleFolder,
  dragPayload,
  onDragPayloadChange,
  root = false
}) {
  const [dropTarget, setDropTarget] = useState(false);
  const hasChildren = node.children?.length > 0;
  const isSelected = selectedPath === node.path;
  const open = root || expandedPaths.has(node.path);

  function handleLabelClick() {
    onSelect(node.path);
  }

  function handleLabelDoubleClick() {
    if (hasChildren) {
      onToggleFolder(node.path);
    }
  }

  function handleDragStart(event) {
    if (root) return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    const payload = {
      kind: 'folder',
      path: node.path,
      parentPath: parentPath(node.path)
    };
    const payloadText = JSON.stringify(payload);
    onDragPayloadChange(payload);
    event.dataTransfer.setData('application/x-media-viewer', payloadText);
    event.dataTransfer.setData('application/json', payloadText);
    event.dataTransfer.setData('text/plain', payloadText);
  }

  function handleDragOver(event) {
    const payload = dragPayload || readDragPayload(event);
    if (!canDropPayload(payload, node.path)) return;

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(true);
  }

  function handleDrop(event) {
    const payload = dragPayload || readDragPayload(event);
    setDropTarget(false);
    if (!canDropPayload(payload, node.path)) return;

    event.preventDefault();
    event.stopPropagation();
    onDragPayloadChange(null);
    if (payload.kind === 'media-file') {
      onMoveFile(payload.path, node.path);
    }
    if (payload.kind === 'folder') {
      onMoveFolder(payload.path, node.path);
    }
  }

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${isSelected ? 'selected' : ''} ${dropTarget ? 'drop-target' : ''}`}
        draggable={!root}
        onDragStart={handleDragStart}
        onDragEnd={() => onDragPayloadChange(null)}
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          event.stopPropagation();
          setDropTarget(false);
        }}
        onDrop={handleDrop}
      >
        <button
          className="tree-toggle"
          onClick={() => onToggleFolder(node.path)}
          disabled={!hasChildren}
          aria-label={open ? 'Свернуть' : 'Развернуть'}
        >
          {hasChildren ? (open ? '▾' : '▸') : ''}
        </button>
        <button className="tree-label" onClick={handleLabelClick} onDoubleClick={handleLabelDoubleClick}>
          <span>{root ? 'MEDIA_ROOT' : node.name}</span>
        </button>
        <button
          className="tree-action tree-create"
          onClick={(event) => {
            event.stopPropagation();
            onCreateFolder(node.path);
          }}
          title="Создать папку"
          aria-label="Создать папку"
        >
          <span className="button-glyph" aria-hidden="true">+</span>
        </button>
        {!root && (
          <button
            className="tree-action tree-move"
            onClick={(event) => {
              event.stopPropagation();
              onMoveFolderRequest(node.path, node.name);
            }}
            title="Переместить папку"
            aria-label="Переместить папку"
          >
            <span className="button-glyph" aria-hidden="true">↗</span>
          </button>
        )}
        {!root && (
          <button
            className="tree-action tree-delete"
            onClick={(event) => {
              event.stopPropagation();
              onDeleteFolder(node.path, node.name);
            }}
            title="Удалить папку"
            aria-label="Удалить папку"
          >
            <span className="button-glyph" aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {hasChildren && open && (
        <div className="tree-children">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onMoveFile={onMoveFile}
              onMoveFolder={onMoveFolder}
              onDeleteFolder={onDeleteFolder}
              onCreateFolder={onCreateFolder}
              onMoveFolderRequest={onMoveFolderRequest}
              expandedPaths={expandedPaths}
              onToggleFolder={onToggleFolder}
              dragPayload={dragPayload}
              onDragPayloadChange={onDragPayloadChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function readDragPayload(event) {
  try {
    const value =
      event.dataTransfer.getData('application/x-media-viewer') ||
      event.dataTransfer.getData('application/json') ||
      event.dataTransfer.getData('text/plain');
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function canDropPayload(payload, targetPath) {
  if (!payload || (payload.kind !== 'media-file' && payload.kind !== 'folder')) return false;
  if (payload.parentPath === targetPath) return false;
  if (payload.kind === 'folder') {
    return payload.path !== targetPath && !targetPath.startsWith(`${payload.path}/`);
  }
  return true;
}
