import axios from 'axios'

const TOKEN_KEY = 'skillswap_token'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
})

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t)
    else localStorage.removeItem(TOKEN_KEY)
  } catch { /* storage unavailable */ }
}

api.interceptors.request.use((config) => {
  const t = getToken()
  if (t) config.headers.Authorization = `Bearer ${t}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && getToken()) {
      setToken(null)
      window.dispatchEvent(new Event('auth:logout'))
    }
    return Promise.reject(err)
  },
)

/** Human-readable message from a FastAPI error response. */
export function errorText(err) {
  const d = err?.response?.data?.detail
  if (Array.isArray(d)) return d.map((e) => `${e.loc?.slice(-1)[0] ?? ''}: ${e.msg.replace(/^Value error, /, '')}`).join('; ')
  if (typeof d === 'string') return d
  if (err?.code === 'ERR_NETWORK') return 'Cannot reach the server. Is the backend running on port 8000?'
  return err?.message || 'Something went wrong'
}
