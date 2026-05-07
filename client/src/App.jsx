import { useEffect, useRef, useState } from 'react';
import Login from './components/Login.jsx';
import FolderTree from './components/FolderTree.jsx';
import MediaGrid from './components/MediaGrid.jsx';
import Viewer from './components/Viewer.jsx';

const AUTH_KEY = 'media-viewer-authenticated';

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
    setIsAuthenticated(false);
    setTree(null);
    setItems([]);
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
      await refresh({ tree: true });
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
    uploadEntries(entries);
  }

  function handleFolderInput(event) {
    const entries = Array.from(event.target.files || []).map((file) => ({
      file,
      path: file.webkitRelativePath || file.name
    }));
    event.target.value = '';
    uploadEntries(entries);
  }

  async function handleUploadDrop(event) {
    event.preventDefault();
    setUploadDropActive(false);

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

  async function createFolderInTree(parentPath) {
    const name = window.prompt('Название новой папки', 'New folder');
    if (name === null) return;

    try {
      setError('');
      const result = await jsonFetch('/api/folder', { parentPath, name });
      setStatus(`Папка создана: ${result.name}`);
      await refresh({ tree: true });
    } catch (err) {
      setError(err.message || 'Не удалось создать папку');
    }
  }

  async function deleteViewerItem(item, index) {
    if (!window.confirm(`Удалить файл "${item.name}"?`)) return;

    try {
      setError('');
      await jsonFetch('/api/media', { path: item.path }, { method: 'DELETE' });
      setStatus('Файл удалён');
      const nextItems = items.filter((mediaItem) => mediaItem.path !== item.path);
      setItems(nextItems);
      if (!nextItems.length) {
        setViewerIndex(null);
      } else {
        setViewerIndex(Math.min(index, nextItems.length - 1));
      }
    } catch (err) {
      setError(err.message || 'Удаление невозможно');
    }
  }

  async function deleteFolderFromTree(folderPath, folderName) {
    if (folderPath === '/') return;
    if (!window.confirm(`Удалить папку "${folderName}" со всем содержимым?`)) return;

    try {
      setError('');
      await jsonFetch('/api/folder', { path: folderPath }, { method: 'DELETE' });
      setStatus('Папка удалена');
      if (selectedPath === folderPath || selectedPath.startsWith(`${folderPath}/`)) {
        setSelectedPath('/');
        await refresh({ tree: true, mediaPath: '/' });
      } else {
        await refresh({ tree: true });
      }
    } catch (err) {
      setError(err.message || 'Удаление невозможно');
    }
  }

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
            onSelect={(path) => setSelectedPath(path)}
            onMoveFile={moveFileToFolder}
            onMoveFolder={moveFolderToFolder}
            onDeleteFolder={deleteFolderFromTree}
            onCreateFolder={createFolderInTree}
            dragPayload={dragPayload}
            onDragPayloadChange={setDragPayload}
          />
        )}
        <input ref={fileInputRef} className="hidden-input" type="file" multiple onChange={handleFileInput} />
        <input ref={folderInputRef} className="hidden-input" type="file" multiple onChange={handleFolderInput} />
        <div
          className={`sidebar-upload ${uploadDropActive ? 'drop-active' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(event) => {
            if (event.dataTransfer?.types?.includes('Files')) setUploadDropActive(true);
          }}
          onDragOver={(event) => {
            if (event.dataTransfer?.types?.includes('Files')) {
              event.preventDefault();
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
        <header className="content-header">
          <div>
            <h1>{selectedPath === '/' ? 'MEDIA_ROOT' : selectedPath}</h1>
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
          onDragPayloadChange={setDragPayload}
        />
        {uploadDropActive && <div className="drop-hint">Отпустите файлы или папки для загрузки в текущую папку</div>}
      </main>

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

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || 'Ошибка запроса');
    error.status = response.status;
    throw error;
  }

  return data;
}

async function jsonFetch(url, body, options = {}) {
  return apiFetch(url, {
    method: options.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function uploadWithProgress(targetPath, entries, onProgress) {
  const formData = new FormData();
  formData.append('paths', JSON.stringify(entries.map((entry) => entry.path)));
  entries.forEach((entry) => {
    formData.append('files', entry.file, entry.file.name);
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?path=${encodeURIComponent(targetPath)}`);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      const data = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const error = new Error(data.error || 'Загрузка не удалась');
        error.details = data;
        reject(error);
      }
    };

    xhr.onerror = () => reject(new Error('Загрузка не удалась'));
    xhr.send(formData);
  });
}

async function collectDroppedEntries(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const handles = [];
  const entries = [];

  for (const item of items) {
    if (typeof item.getAsFileSystemHandle === 'function') {
      try {
        const handle = await item.getAsFileSystemHandle();
        if (handle) handles.push(handle);
      } catch {
        // Fallback below handles browsers that expose but do not allow this API for dropped folders.
      }
    }

    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (handles.length) {
    const collected = [];
    for (const handle of handles) {
      await collectHandle(handle, '', collected);
    }
    return collected;
  }

  if (entries.length) {
    const collected = [];
    for (const entry of entries) {
      await collectEntry(entry, '', collected);
    }
    return collected;
  }

  return Array.from(dataTransfer?.files || [])
    .filter((file) => file.size > 0 || file.name.includes('.'))
    .map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

async function collectEntry(entry, parentPath, collected) {
  const entryPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await readEntryFile(entry);
    collected.push({ file, path: entryPath });
    return;
  }

  if (entry.isDirectory) {
    const reader = entry.createReader();
    let children = [];
    do {
      children = await readDirectoryEntries(reader);
      for (const child of children) {
        await collectEntry(child, entryPath, collected);
      }
    } while (children.length);
  }
}

async function collectHandle(handle, parentPath, collected) {
  const handlePath = parentPath ? `${parentPath}/${handle.name}` : handle.name;

  if (handle.kind === 'file') {
    const file = await handle.getFile();
    collected.push({ file, path: handlePath });
    return;
  }

  if (handle.kind === 'directory') {
    for await (const child of handle.values()) {
      await collectHandle(child, handlePath, collected);
    }
  }
}

function readEntryFile(entry) {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readDirectoryEntries(reader) {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function handleAuthError(error, setIsAuthenticated, setError) {
  if (error.status === 401) {
    sessionStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
    return;
  }

  setError(error.message);
}
