// supabaseClient.js
// ─────────────────────────────────────────────────────────────
// Preencha com os dados do seu projeto no Supabase:
//   supabase.com → Settings → API
// ─────────────────────────────────────────────────────────────

const _SUPABASE_URL = 'https://ovuvztzhudeocqqroawv.supabase.co';
const _SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92dXZ6dHpodWRlb2NxcXJvYXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc1MDM1NjksImV4cCI6MjEwMzA3OTU2OX0.91IM_jySlmmMNZYVx0fi_YXz13PSS6uRxJRhfEqIBp0';

if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    console.error('ERRO CRÍTICO: Biblioteca Supabase não carregou. Verifique sua conexão.');
    // Não usa alert() — apenas loga. O checkUser() vai redirecionar para login se supa for null.
} else {
    window.supa = window.supabase.createClient(_SUPABASE_URL, _SUPABASE_KEY);
    console.log('Banco iniciado.');
}

async function checkUser() {
    try {
        if (!window.supa) {
            console.error('checkUser: cliente Supabase não inicializado.');
            window.location.href = 'login.html';
            return null;
        }
        const { data: { session } } = await window.supa.auth.getSession();
        if (!session) {
            window.location.href = 'login.html';
            return null;
        }
        return session;
    } catch(e) {
        console.error('checkUser error:', e);
        window.location.href = 'login.html';
        return null;
    }
}