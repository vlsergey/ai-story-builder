const api = {
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    // All backend calls are now routed through tRPC over Electron IPC.
    // The `path` argument should match the tRPC procedure path, e.g. 'aiConfig.get' or 'plan.generate'.
    // For queries without input (GET), we pass undefined as the second argument.
    // For mutations (POST/PUT), we pass the payload as the second argument.
    const result = await (window as any).electronAPI.trpc.invoke(path, body);
    return result as T;
  },
  get<T = unknown>(path: string): Promise<T> { return api.request<T>('GET', path) },
  post<T = unknown>(path: string, body?: unknown): Promise<T> { return api.request<T>('POST', path, body) },
  put<T = unknown>(path: string, body?: unknown): Promise<T> { return api.request<T>('PUT', path, body) },
  delete<T = unknown>(path: string): Promise<T> { return api.request<T>('DELETE', path) },
}

export default api
