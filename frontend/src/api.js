import axios from "axios";

// In dev, Vite proxies /api -> http://localhost:8000. Override with VITE_API_URL for production builds.
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || "/api", timeout: 120000 });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("tc_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && localStorage.getItem("tc_token")) {
      localStorage.removeItem("tc_token");
      window.dispatchEvent(new Event("tc:logout"));
    }
    return Promise.reject(err);
  }
);

/** Turn FastAPI error payloads (string or validation array) into a readable message. */
export function errMsg(e) {
  const d = e?.response?.data?.detail;
  if (Array.isArray(d)) return d.map((x) => `${(x.loc || []).slice(1).join(".")}: ${x.msg}`).join("; ");
  return d || e?.message || "Something went wrong";
}

export const ROLE_LABEL = { organiser: "Trip Organiser", member: "Group Member", partner: "Travel Partner", admin: "Admin" };
export const money = (n, cur = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n ?? 0);
export const money2 = (n, cur = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: cur, minimumFractionDigits: 2 }).format(n ?? 0);

export default api;
