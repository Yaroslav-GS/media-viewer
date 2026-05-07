export async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || 'Ошибка запроса');
    error.status = response.status;
    throw error;
  }

  return data;
}

export function jsonFetch(url, body, options = {}) {
  return apiFetch(url, {
    method: options.method || 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export function uploadWithProgress(targetPath, entries, onProgress) {
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
        return;
      }

      const error = new Error(data.error || 'Загрузка не удалась');
      error.details = data;
      reject(error);
    };

    xhr.onerror = () => reject(new Error('Загрузка не удалась'));
    xhr.send(formData);
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
