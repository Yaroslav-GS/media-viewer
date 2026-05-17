const CSRF_KEY = 'media-viewer-csrf-token';

export async function apiFetch(url, options = {}) {
  const response = await fetch(url, withCsrfHeader(options));
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
    headers: { ...options.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

export function setCsrfToken(token) {
  if (typeof token === 'string' && token) {
    sessionStorage.setItem(CSRF_KEY, token);
  }
}

export function clearCsrfToken() {
  sessionStorage.removeItem(CSRF_KEY);
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
    const csrfToken = sessionStorage.getItem(CSRF_KEY);
    if (csrfToken) {
      xhr.setRequestHeader('X-CSRF-Token', csrfToken);
    }

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

function withCsrfHeader(options) {
  const method = (options.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return options;

  const csrfToken = sessionStorage.getItem(CSRF_KEY);
  if (!csrfToken) return options;

  return {
    ...options,
    headers: {
      ...options.headers,
      'X-CSRF-Token': csrfToken
    }
  };
}
