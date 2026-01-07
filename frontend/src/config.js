const isProd = import.meta.env.PROD;

// Support both common Vite naming conventions and remove trailing /api if present 
// to avoid double /api/api in components
const rawUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_API_BASE_URL ||
    (isProd ? 'https://xevytalk.xevyte.com' : 'http://13.205.101.250:4000');

const API_URL = rawUrl.replace(/\/api$/, '');

export default API_URL;
