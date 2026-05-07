export async function collectDroppedEntries(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const handles = [];
  const handlePromises = [];
  const entries = [];

  const canUseFileSystemHandles = typeof window !== 'undefined' && window.isSecureContext;

  for (const item of items) {
    if (canUseFileSystemHandles && item.kind === 'file' && typeof item.getAsFileSystemHandle === 'function') {
      try {
        handlePromises.push(item.getAsFileSystemHandle().catch(() => null));
      } catch {
        // Some browsers expose the API but deny folder handles for drops.
      }
    }

    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (handlePromises.length) {
    handles.push(...(await Promise.all(handlePromises)).filter(Boolean));
  }

  if (handles.length) {
    try {
      const collected = await collectFromHandles(handles);
      if (collected.length) return collected;
    } catch {
      // Fall back to the older entries/files APIs; some deployments expose
      // handles but block recursive reads depending on browser permissions.
    }
  }

  if (entries.length) {
    try {
      const collected = await collectFromEntries(entries);
      if (collected.length) return collected;
    } catch {
      // Last fallback below still works for plain file drops.
    }
  }

  return Array.from(dataTransfer?.files || [])
    .filter((file) => file.size > 0 || file.name.includes('.'))
    .map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

async function collectFromHandles(handles) {
  const collected = [];
  for (const handle of handles) {
    await collectHandle(handle, '', collected);
  }
  return collected;
}

async function collectFromEntries(entries) {
  const collected = [];
  for (const entry of entries) {
    await collectEntry(entry, '', collected);
  }
  return collected;
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
