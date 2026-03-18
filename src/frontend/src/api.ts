const api = {
  async request<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const opts: RequestInit & { headers: Record<string, string> } = { method, headers: {} }
    if (body && !(body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    } else if (body instanceof FormData) {
      opts.body = body
    }
    const res = await fetch('/api' + path, opts)
    const text = await res.text()
    try { return JSON.parse(text) as T } catch (_) { return text as unknown as T }
  },
  get<T = unknown>(path: string): Promise<T> { return api.request<T>('GET', path) },
  post<T = unknown>(path: string, body?: unknown): Promise<T> { return api.request<T>('POST', path, body) },
  put<T = unknown>(path: string, body?: unknown): Promise<T> { return api.request<T>('PUT', path, body) },
  delete<T = unknown>(path: string): Promise<T> { return api.request<T>('DELETE', path) },
}

export default api
