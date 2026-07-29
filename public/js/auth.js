// Gère les formulaires de connexion / inscription et l'affichage
// conditionnel : formulaire d'auth / en attente de validation /
// compte bloqué / calendrier.

function showAuthMessage(text, type) {
  const el = document.getElementById("auth-msg");
  el.textContent = text;
  el.className = "msg " + (type || "");
}

function switchAuthTab(tab) {
  document.getElementById("tab-login").classList.toggle("active", tab === "login");
  document.getElementById("tab-signup").classList.toggle("active", tab === "signup");
  document.getElementById("form-login").classList.toggle("hidden", tab !== "login");
  document.getElementById("form-signup").classList.toggle("hidden", tab !== "signup");
  showAuthMessage("", "");
}

async function handleSignup(e) {
  e.preventDefault();
  const full_name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  showAuthMessage("Création du compte...", "");
  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { data: { full_name } },
  });

  if (error) {
    showAuthMessage(error.message, "error");
    return;
  }
  showAuthMessage(
    "Compte créé. Vérifiez votre boîte mail pour confirmer votre adresse. Un administrateur devra ensuite valider votre compte avant que vous puissiez accéder au calendrier.",
    "success"
  );
  switchAuthTab("login");
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  showAuthMessage("Connexion...", "");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    showAuthMessage(error.message, "error");
    return;
  }
  showAuthMessage("", "");
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
}

async function refreshAuthUI() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const authSection = document.getElementById("auth-section");
  const appSection = document.getElementById("app-section");
  const pendingSection = document.getElementById("pending-section");
  const blockedSection = document.getElementById("blocked-section");
  const logoutBtn = document.getElementById("logout-btn");
  const userLabel = document.getElementById("user-label");

  if (session && session.user) {
    logoutBtn.classList.remove("hidden");
    userLabel.textContent = session.user.email;
    userLabel.classList.remove("hidden");

    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single();

    if (error || !profile) {
      authSection.classList.remove("hidden");
      appSection.classList.add("hidden");
      pendingSection.classList.add("hidden");
      if (blockedSection) blockedSection.classList.add("hidden");
      return;
    }

    // Un compte bloqué (retraits tardifs répétés, ou décision manuelle de
    // l'admin) ne doit jamais accéder au calendrier, même si la session
    // du navigateur est encore valide.
    if (profile.blocked) {
      authSection.classList.add("hidden");
      appSection.classList.add("hidden");
      pendingSection.classList.add("hidden");
      if (blockedSection) blockedSection.classList.remove("hidden");
      return;
    }

    if (profile.approved) {
      authSection.classList.add("hidden");
      pendingSection.classList.add("hidden");
      if (blockedSection) blockedSection.classList.add("hidden");
      appSection.classList.remove("hidden");
      if (typeof onAuthenticated === "function") onAuthenticated(session.user, profile);
    } else {
      authSection.classList.add("hidden");
      appSection.classList.add("hidden");
      if (blockedSection) blockedSection.classList.add("hidden");
      pendingSection.classList.remove("hidden");
    }
  } else {
    authSection.classList.remove("hidden");
    appSection.classList.add("hidden");
    pendingSection.classList.add("hidden");
    if (blockedSection) blockedSection.classList.add("hidden");
    logoutBtn.classList.add("hidden");
    userLabel.classList.add("hidden");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("tab-login").addEventListener("click", () => switchAuthTab("login"));
  document.getElementById("tab-signup").addEventListener("click", () => switchAuthTab("signup"));
  document.getElementById("form-login").addEventListener("submit", handleLogin);
  document.getElementById("form-signup").addEventListener("submit", handleSignup);
  document.getElementById("logout-btn").addEventListener("click", handleLogout);

  supabaseClient.auth.onAuthStateChange(() => refreshAuthUI());
  refreshAuthUI();
});
