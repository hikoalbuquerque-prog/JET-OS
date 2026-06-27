"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supaAdmin = supaAdmin;
const supabase_js_1 = require("@supabase/supabase-js");
let _client = null;
function supaAdmin() {
    if (_client)
        return _client;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE;
    if (!url || !key)
        throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE not set');
    _client = (0, supabase_js_1.createClient)(url, key, { auth: { persistSession: false } });
    return _client;
}
//# sourceMappingURL=supabase-admin.js.map