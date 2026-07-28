// ============================================================
// Configuration Supabase
// Remplacez les deux valeurs ci-dessous par celles de votre
// projet Supabase (Dashboard > Project Settings > API).
// La clé "anon public" est faite pour être publique : elle ne
// donne accès qu'à ce que les règles RLS autorisent.
// ============================================================
const SUPABASE_URL = "https://VOTRE-PROJET.supabase.co";
const SUPABASE_ANON_KEY = "VOTRE-CLE-ANON-PUBLIC";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
