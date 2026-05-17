const CSRF_KEY = 'media-viewer-csrf-token';

export async function apiFetch(url, options = {}) {
  const response = await fetch(url, await withCsrfHeader(options));
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

export async function fetchCsrfToken() {
  const response = await fetch('/api/csrf-token');
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Не удалось получить CSRF-токен');
  }

  setCsrfToken(data.csrfToken);
  return data.csrfToken;
}

export async function uploadWithProgress(targetPath, entries, onProgress) {
  const formData = new FormData();
  formData.append('paths', JSON.stringify(entries.map((entry) => entry.path)));
  entries.forEach((entry) => {
    formData.append('files', entry.file, entry.file.name);
  });

  const csrfToken = await getCsrfToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/upload?path=${encodeURIComponent(targetPath)}`);
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

async function withCsrfHeader(options) {
  const method = (options.method || 'GET').toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return options;

  const csrfToken = await getCsrfToken();
  if (!csrfToken) return options;

  return {
    ...options,
    headers: {
      ...options.headers,
      'X-CSRF-Token': csrfToken
    }
  };
}

async function getCsrfToken() {
  return sessionStorage.getItem(CSRF_KEY) || fetchCsrfToken();
}
