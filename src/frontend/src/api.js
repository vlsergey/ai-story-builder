const api = {
  async request(method, path, body) {
    const opts = { method, headers: {} }
    if (body && !(body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    } else if (body instanceof FormData) {
      opts.body = body
    }
    const res = await fetch('/api' + path, opts)
    const text = await res.text()
    try { return JSON.parse(text) } catch (e) { return text }
  },
  get(path) { return api.request('GET', path) },
  post(path, body) { return api.request('POST', path, body) },
  put(path, body) { return api.request('PUT', path, body) },
  delete(path) { return api.request('DELETE', path) }
}

export default api
