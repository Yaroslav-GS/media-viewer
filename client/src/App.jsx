import { useEffect, useRef, useState } from 'react';
import Login from './components/Login.jsx';
import FolderTree from './components/FolderTree.jsx';
import MediaGrid from './components/MediaGrid.jsx';
import Viewer from './components/Viewer.jsx';
import { apiFetch, jsonFetch, uploadWithProgress } from './lib/api.js';
import { collectDroppedEntries } from './lib/dropEntries.js';

const AUTH_KEY = 'media-viewer-authenticated';
const EXPANDED_FOLDERS_KEY = 'media-viewer-expanded-folders';

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(sessionStorage.getItem(AUTH_KEY) === '1');
  const [tree, setTree] = useState(null);
  const [selectedPath, setSelectedPath] = useState('/');
  const [items, setItems] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadDropActive, setUploadDropActive] = useState(false);
  const [dragPayload, setDragPayload] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(null);
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false);
  const [uploadSheetOpen, setUploadSheetOpen] = useState(false);
  const [mediaActionItem, setMediaActionItem] = useState(null);
  const [moveRequest, setMoveRequest] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState(() => readExpandedFolders());
  const [thumbSize, setThumbSize] = useState(() => localStorage.getItem('media-viewer-thumb-size') || 'medium');
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    loadTree();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    loadMedia(selectedPath);
  }, [isAuthenticated, selectedPath]);

  useEffect(() => {
    if (!folderInputRef.current) return;

    folderInputRef.current.setAttribute('webkitdirectory', '');
    folderInputRef.current.setAttribute('directory', '');
    folderInputRef.current.setAttribute('mozdirectory', '');
  }, [isAuthenticated]);

  useEffect(() => {
    function preventBrowserFileDrop(event) {
      if (!hasDroppedFiles(event.dataTransfer)) return;

      event.preventDefault();
      if (event.type === 'dragover') {
        event.dataTransfer.dropEffect = 'copy';
      }
    }

    window.addEventListener('dragover', preventBrowserFileDrop);
    window.addEventListener('drop', preventBrowserFileDrop);
    return () => {
      window.removeEventListener('dragover', preventBrowserFileDrop);
      window.removeEventListener('drop', preventBrowserFileDrop);
    };
  }, []);

  function loadTree() {
    setTreeLoading(true);
    return apiFetch('/api/tree')
      .then((data) => {
        setTree(data);
        setError('');
      })
      .catch((err) => handleAuthError(err, setIsAuthenticated, setError))
      .finally(() => setTreeLoading(false));
  }

  function loadMedia(path) {
    setMediaLoading(true);
    return apiFetch(`/api/media?path=${encodeURIComponent(path)}`)
      .then((data) => {
        setItems(data.items || []);
        setError('');
      })
      .catch((err) => handleAuthError(err, setIsAuthenticated, setError))
      .finally(() => setMediaLoading(false));
  }

  async function refresh({ tree: shouldLoadTree = false, mediaPath = selectedPath } = {}) {
    const tasks = [loadMedia(mediaPath)];
    if (shouldLoadTree) tasks.push(loadTree());
    await Promise.all(tasks);
  }

  function handleLogin() {
    sessionStorage.setItem(AUTH_KEY, '1');
    setIsAuthenticated(true);
  }

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    sessionStorage.removeItem(AUTH_KEY);
    sessionStorage.removeItem(EXPANDED_FOLDERS_KEY);
    setIsAuthenticated(false);
    setTree(null);
    setItems([]);
    setExpandedFolders(new Set(['/']));
    setFolderDrawerOpen(false);
    setUploadSheetOpen(false);
    setMediaActionItem(null);
    setMoveRequest(null);
    setConfirmAction(null);
  }

  function selectPath(path) {
    updateExpandedFolders((current) => {
      const next = new Set(current);
      for (const ancestor of pathAncestors(path)) {
        next.add(ancestor);
      }
      return next;
    });
    setSelectedPath(path);
    setFolderDrawerOpen(false);
  }

  function toggleFolder(path) {
    updateExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      next.add('/');
      return next;
    });
  }

  function updateExpandedFolders(updater) {
    setExpandedFolders((current) => {
      const next = updater(current);
      sessionStorage.setItem(EXPANDED_FOLDERS_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  }

  function changeThumbSize(size) {
    setThumbSize(size);
    localStorage.setItem('media-viewer-thumb-size', size);
  }

  async function uploadEntries(entries) {
    if (!entries.length) {
      setError('В папке не найдено файлов для загрузки');
      return;
    }

    setError('');
    setStatus('');
    setUploadProgress(0);

    try {
      const result = await uploadWithProgress(selectedPath, entries, setUploadProgress);
      const skippedText = result.skipped?.length ? `, пропущено: ${result.skipped.length}` : '';
      setStatus(`Загружено: ${result.saved?.length || 0}${skippedText}`);
      try {
        await refresh({ tree: true });
      } catch (refreshError) {
        setError(refreshError.message || 'Файлы загружены, но список не удалось обновить');
      }
    } catch (err) {
      if (err.details?.skipped?.length) {
        setError(`${err.message}. Поддерживаются только jpg, jpeg, png, gif, webp, avif, mp4, webm, mov, m4v.`);
      } else {
        setError(err.message || 'Загрузка не удалась');
      }
    } finally {
      setUploadProgress(null);
    }
  }

  function handleFileInput(event) {
    const entries = Array.from(event.target.files || []).map((file) => ({
      file,
      path: file.name
    }));
    event.target.value = '';
    setUploadSheetOpen(false);
    uploadEntries(entries);
  }

  function handleFolderInput(event) {
    const entries = Array.from(event.target.files || []).map((file) => ({
      file,
      path: file.webkitRelativePath || file.name
    }));
    event.target.value = '';
    setUploadSheetOpen(false);
    uploadEntries(entries);
  }

  async function handleUploadDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setUploadDropActive(false);

    if (!hasDroppedFiles(event.dataTransfer)) {
      return;
    }

    try {
      const entries = await collectDroppedEntries(event.dataTransfer);
      if (!entries.length) {
        setError('Браузер не передал файлы из папки. Попробуйте выбрать папку кликом в зоне загрузки.');
        return;
      }
      uploadEntries(entries);
    } catch (err) {
      setError(err.message || 'Не удалось прочитать перетащенную папку');
    }
  }

  async function moveFileToFolder(filePath, folderPath) {
    try {
      setError('');
      await jsonFetch('/api/move-file', { from: filePath, toDir: folderPath });
      setStatus('Файл перемещён');
      await refresh({ tree: true });
    } catch (err) {
      setError(err.message || 'Перемещение невозможно');
    }
  }

  async function moveFolderToFolder(folderPath, targetFolderPath) {
    try {
      setError('');
      await jsonFetch('/api/move-folder', { from: folderPath, toDir: targetFolderPath });
      setStatus('Папка перемещена');
      removeExpandedFolderBranch(folderPath);
      if (selectedPath === folderPath || selectedPath.startsWith(`${folderPath}/`)) {
        setSelectedPath('/');
        await refresh({ tree: true, mediaPath: '/' });
      } else {
        await refresh({ tree: true });
      }
    } catch (err) {
      setError(err.message || 'Перемещение невозможно');
    }
  }

  async function completeMove(targetFolderPath) {
    if (!moveRequest) return;

    setMoveRequest(null);
    setFolderDrawerOpen(false);

    if (moveRequest.kind === 'media-file') {
      await moveFileToFolder(moveRequest.path, targetFolderPath);
      return;
    }

    await moveFolderToFolder(moveRequest.path, targetFolderPath);
  }

  async function createFolderInTree(parentPath) {
    const name = window.prompt('Название новой папки', 'New folder');
    if (name === null) return;

    try {
      setError('');
      const result = await jsonFetch('/api/folder', { parentPath, name });
      setStatus(`Папка создана: ${result.name}`);
      updateExpandedFolders((current) => new Set([...current, parentPath]));
      await refresh({ tree: true });
    } catch (err) {
      setError(err.message || 'Не удалось создать папку');
    }
  }

  async function deleteMediaItem(item) {
    try {
      setError('');
      await jsonFetch('/api/media', { path: item.path }, { method: 'DELETE' });
      setStatus('Файл удалён');
      const nextItems = items.filter((mediaItem) => mediaItem.path !== item.path);
      setItems(nextItems);
      setViewerIndex(null);
    } catch (err) {
      setError(err.message || 'Удаление невозможно');
    }
  }

  async function deleteViewerItem(item) {
    setConfirmAction({
      title: 'Удалить файл?',
      text: item.name,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: () => deleteMediaItem(item)
    });
  }

  async function deleteFolderFromTree(folderPath, folderName) {
    if (folderPath === '/') return;
    setConfirmAction({
      title: 'Удалить папку?',
      text: `${folderName} и всё содержимое`,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: () => deleteFolder(folderPath)
    });
  }

  async function deleteFolder(folderPath) {
    try {
      setError('');
      await jsonFetch('/api/folder', { path: folderPath }, { method: 'DELETE' });
      setStatus('Папка удалена');
      if (selectedPath === folderPath || selectedPath.startsWith(`${folderPath}/`)) {
        setSelectedPath('/');
        removeExpandedFolderBranch(folderPath);
        await refresh({ tree: true, mediaPath: '/' });
      } else {
        removeExpandedFolderBranch(folderPath);
        await refresh({ tree: true });
      }
    } catch (err) {
      setError(err.message || 'Удаление невозможно');
    }
  }

  function requestMediaMove(item) {
    setMediaActionItem(null);
    setMoveRequest({
      kind: 'media-file',
      path: item.path,
      name: item.name
    });
  }

  function requestFolderMove(folderPath, folderName) {
    setMoveRequest({
      kind: 'folder',
      path: folderPath,
      name: folderName
    });
    setFolderDrawerOpen(true);
  }

  function removeExpandedFolderBranch(folderPath) {
    updateExpandedFolders((current) => {
      const next = new Set(['/']);
      for (const path of current) {
        if (path !== folderPath && !path.startsWith(`${folderPath}/`)) {
          next.add(path);
        }
      }
      return next;
    });
  }

  async function confirmPendingAction() {
    const pendingAction = confirmAction;
    setConfirmAction(null);
    await pendingAction?.onConfirm?.();
  }

  const currentPathLabel = selectedPath === '/' ? 'MEDIA_ROOT' : selectedPath;
  const breadcrumbs = pathBreadcrumbs(selectedPath);

  if (!isAuthenticated) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-logo" aria-hidden="true">M</div>
            <div>
              <div className="app-title">Media Viewer</div>
              <div className="app-subtitle">Локальное хранилище</div>
            </div>
          </div>
          <button className="icon-button" onClick={handleLogout} title="Выйти" aria-label="Выйти">
            <span className="button-glyph" aria-hidden="true">⏻</span>
          </button>
        </div>
        {treeLoading && <div className="muted-state">Загрузка папок...</div>}
        {tree && (
          <FolderTree
            node={tree}
            selectedPath={selectedPath}
            onSelect={selectPath}
            onMoveFile={moveFileToFolder}
            onMoveFolder={moveFolderToFolder}
            onDeleteFolder={deleteFolderFromTree}
            onCreateFolder={createFolderInTree}
            onMoveFolderRequest={requestFolderMove}
            expandedPaths={expandedFolders}
            onToggleFolder={toggleFolder}
            dragPayload={dragPayload}
            onDragPayloadChange={setDragPayload}
          />
        )}
        <input
          ref={fileInputRef}
          className="hidden-input"
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleFileInput}
        />
        <input
          ref={folderInputRef}
          className="hidden-input"
          type="file"
          multiple
          accept="image/*,video/*"
          onChange={handleFolderInput}
        />
        <div
          className={`sidebar-upload ${uploadDropActive ? 'drop-active' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(event) => {
            if (hasDroppedFiles(event.dataTransfer)) setUploadDropActive(true);
          }}
          onDragOver={(event) => {
            if (hasDroppedFiles(event.dataTransfer)) {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'copy';
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setUploadDropActive(false);
          }}
          onDrop={handleUploadDrop}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          <div className="sidebar-upload-title">Загрузить в текущую папку</div>
          <div className="sidebar-upload-text">
            Перетащите файлы или папки сюда, либо выберите{' '}
            <span>файлы</span>
            {' / '}
            <span
              onClick={(event) => {
                event.stopPropagation();
                folderInputRef.current?.click();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  folderInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              папку
            </span>
          </div>
          <div className="sidebar-upload-path">{selectedPath === '/' ? 'MEDIA_ROOT' : selectedPath}</div>
        </div>
      </aside>

      <main className="content">
        <header className="mobile-topbar">
          <button className="mobile-tool-button" onClick={() => setFolderDrawerOpen(true)}>Папки</button>
          <div className="mobile-current-path">{currentPathLabel}</div>
          <button className="mobile-tool-button" onClick={() => setUploadSheetOpen(true)}>Загрузить</button>
        </header>

        <nav className="breadcrumbs" aria-label="Текущий путь">
          {breadcrumbs.map((crumb, index) => (
            <button key={crumb.path} onClick={() => selectPath(crumb.path)}>
              {crumb.label}
              {index < breadcrumbs.length - 1 && <span aria-hidden="true">/</span>}
            </button>
          ))}
        </nav>

        <header className="content-header">
          <div>
            <h1>{currentPathLabel}</h1>
            <p>{items.length ? `${items.length} медиафайлов` : 'Выберите папку или добавьте файлы'}</p>
          </div>
          <div className="content-tools">
            <div className="size-control" aria-label="Размер превью">
              {[
                ['small', 'Маленькие'],
                ['medium', 'Средние'],
                ['large', 'Большие']
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={thumbSize === value ? 'active' : ''}
                  onClick={() => changeThumbSize(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {uploadProgress !== null && (
          <div className="upload-progress" aria-label="Прогресс загрузки">
            <div style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
        {status && <div className="status-banner">{status}</div>}
        {error && <div className="error-banner">{error}</div>}
        <MediaGrid
          items={items}
          loading={mediaLoading}
          thumbSize={thumbSize}
          onOpen={setViewerIndex}
          onItemActions={setMediaActionItem}
          onDragPayloadChange={setDragPayload}
        />
        {uploadDropActive && <div className="drop-hint">Отпустите файлы или папки для загрузки в текущую папку</div>}
      </main>

      <button className="mobile-view-fab" onClick={() => changeThumbSize(nextThumbSize(thumbSize))}>
        Вид
      </button>

      {folderDrawerOpen && (
        <div className="mobile-overlay" role="dialog" aria-modal="true" aria-label={moveRequest ? 'Выбор папки' : 'Папки'}>
          <div className="mobile-drawer">
            <div className="mobile-drawer-header">
              <div>
                <div className="drawer-title">{moveRequest ? 'Куда переместить' : 'Папки'}</div>
                {moveRequest && <div className="drawer-subtitle">{moveRequest.name}</div>}
              </div>
              <button className="icon-button" onClick={() => {
                setFolderDrawerOpen(false);
                setMoveRequest(null);
              }} aria-label="Закрыть">
                <span className="button-glyph" aria-hidden="true">×</span>
              </button>
            </div>
            {treeLoading && <div className="muted-state">Загрузка папок...</div>}
            {tree && (
              <FolderTree
                node={tree}
                selectedPath={selectedPath}
                onSelect={moveRequest ? completeMove : selectPath}
                onMoveFile={moveFileToFolder}
                onMoveFolder={moveFolderToFolder}
                onDeleteFolder={deleteFolderFromTree}
                onCreateFolder={createFolderInTree}
                onMoveFolderRequest={requestFolderMove}
                expandedPaths={expandedFolders}
                onToggleFolder={toggleFolder}
                dragPayload={dragPayload}
                onDragPayloadChange={setDragPayload}
              />
            )}
          </div>
        </div>
      )}

      {uploadSheetOpen && (
        <ActionSheet title="Загрузить в текущую папку" onClose={() => setUploadSheetOpen(false)}>
          <button onClick={() => fileInputRef.current?.click()}>Выбрать фото или видео</button>
          <button onClick={() => folderInputRef.current?.click()}>Выбрать папку</button>
          <p>На телефонах выбор папки может быть недоступен. В этом случае используйте множественный выбор файлов.</p>
        </ActionSheet>
      )}

      {mediaActionItem && (
        <ActionSheet title={mediaActionItem.name} onClose={() => setMediaActionItem(null)}>
          <button onClick={() => {
            setViewerIndex(items.findIndex((item) => item.path === mediaActionItem.path));
            setMediaActionItem(null);
          }}>
            Открыть
          </button>
          <button onClick={() => {
            requestMediaMove(mediaActionItem);
            setFolderDrawerOpen(true);
          }}>
            Переместить
          </button>
          <button className="sheet-danger" onClick={() => {
            const item = mediaActionItem;
            setMediaActionItem(null);
            setConfirmAction({
              title: 'Удалить файл?',
              text: item.name,
              confirmLabel: 'Удалить',
              danger: true,
              onConfirm: () => deleteMediaItem(item)
            });
          }}>
            Удалить
          </button>
        </ActionSheet>
      )}

      {confirmAction && (
        <ActionSheet title={confirmAction.title} onClose={() => setConfirmAction(null)}>
          <p>{confirmAction.text}</p>
          <button className={confirmAction.danger ? 'sheet-danger' : ''} onClick={confirmPendingAction}>
            {confirmAction.confirmLabel || 'Подтвердить'}
          </button>
        </ActionSheet>
      )}

      {viewerIndex !== null && (
        <Viewer
          items={items}
          index={viewerIndex}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          onDelete={deleteViewerItem}
        />
      )}
    </div>
  );
}

function ActionSheet({ title, children, onClose }) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="action-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-header">
          <div className="sheet-title">{title}</div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть">
            <span className="button-glyph" aria-hidden="true">×</span>
          </button>
        </div>
        <div className="sheet-actions">{children}</div>
      </div>
    </div>
  );
}

function pathBreadcrumbs(path) {
  if (path === '/') return [{ label: 'MEDIA_ROOT', path: '/' }];

  const parts = path.split('/').filter(Boolean);
  return [
    { label: 'MEDIA_ROOT', path: '/' },
    ...parts.map((part, index) => ({
      label: part,
      path: `/${parts.slice(0, index + 1).join('/')}`
    }))
  ];
}

function pathAncestors(path) {
  if (path === '/') return ['/'];

  const parts = path.split('/').filter(Boolean);
  return [
    '/',
    ...parts.slice(0, -1).map((_, index) => `/${parts.slice(0, index + 1).join('/')}`)
  ];
}

function readExpandedFolders() {
  try {
    const paths = JSON.parse(sessionStorage.getItem(EXPANDED_FOLDERS_KEY) || '[]');
    return new Set(['/', ...paths.filter((path) => typeof path === 'string')]);
  } catch {
    return new Set(['/']);
  }
}

function nextThumbSize(size) {
  if (size === 'small') return 'medium';
  if (size === 'medium') return 'large';
  return 'small';
}

function hasDroppedFiles(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []).map((type) => String(type).toLowerCase());
  return types.includes('files') || Boolean(dataTransfer?.files?.length);
}

function handleAuthError(error, setIsAuthenticated, setError) {
  if (error.status === 401) {
    sessionStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
    return;
  }

  setError(error.message);
}
