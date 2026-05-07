export function parentPath(clientPath) {
  const index = clientPath.lastIndexOf('/');
  if (index <= 0) return '/';
  return clientPath.slice(0, index);
}
